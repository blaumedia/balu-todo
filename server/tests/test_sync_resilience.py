"""Sync under database trouble: transient errors are retryable, viewers stay off the lock."""

from __future__ import annotations

import threading
import uuid

import psycopg
import psycopg.errors as pg_errors
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.pool import QueuePool

from balu.db import database_url_with_lock_timeout, get_engine, is_transient_db_error
from balu.models import Membership, SyncedCommand, Workspace
from balu.routers import sync as sync_router
from balu.sync import commands as commands_mod
from balu.sync.engine import bump_version
from tests.conftest import auth_headers, cmd, register_user, sync


def _post(client, user, commands):
    return client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/sync",
        headers=user["headers"],
        json={"sync_token": "*", "commands": commands},
    )


def _fail_bump_on_call(monkeypatch, nth: int, exc: Exception):
    real = commands_mod.Ctx.bump
    calls = {"n": 0}

    def bump(self):
        calls["n"] += 1
        if calls["n"] == nth:
            raise exc
        return real(self)

    monkeypatch.setattr(commands_mod.Ctx, "bump", bump)


@pytest.mark.parametrize(
    "exc",
    [
        OperationalError(
            "SELECT 1", {}, Exception("server closed the connection"),
            connection_invalidated=True,
        ),
        OperationalError("SELECT 1", {}, pg_errors.LockNotAvailable("lock timeout")),
        OperationalError("SELECT 1", {}, pg_errors.SerializationFailure("retry")),
        OperationalError("SELECT 1", {}, pg_errors.AdminShutdown("restart")),
        PoolTimeoutError("QueuePool limit of size 5 overflow 10 reached"),
    ],
)
def test_transient_db_error_fails_the_request_and_resend_is_idempotent(
    client, user, db, monkeypatch, exc
):
    cmds = [
        cmd("project_add", temp_id="p1", name="One"),
        cmd("project_add", temp_id="p2", name="Two"),
        cmd("project_add", temp_id="p3", name="Three"),
    ]
    # bump runs twice per project_add (the lock, then the row stamp)
    _fail_bump_on_call(monkeypatch, 3, exc)

    resp = _post(client, user, cmds)
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["code"] == "unavailable"
    assert resp.headers["Retry-After"]
    ws_id = uuid.UUID(user["workspace_id"])
    stored = db.execute(
        select(SyncedCommand).where(SyncedCommand.workspace_id == ws_id)
    ).scalars().all()
    assert [str(r.uuid) for r in stored] == [cmds[0]["uuid"]]

    monkeypatch.undo()
    again = sync(client, user, "*", cmds)
    assert [again["sync_status"][c["uuid"]] for c in cmds] == ["ok", "ok", "ok"]
    assert sorted(p["name"] for p in again["projects"]) == ["One", "Three", "Two"]


@pytest.mark.parametrize(
    "exc",
    [
        OperationalError("SELECT 1", {}, pg_errors.ProgramLimitExceeded("too big")),
        OperationalError("SELECT 1", {}, pg_errors.ObjectNotInPrerequisiteState("no")),
        # libpq's client-side parameter limit carries no SQLSTATE at all
        OperationalError(
            "SELECT 1", {}, Exception("number of parameters must be between 0 and 65535")
        ),
        OperationalError(
            "SELECT 1", {},
            psycopg.OperationalError("number of parameters must be between 0 and 65535"),
        ),
        # a commit-time error has no statement but a deterministic SQLSTATE
        OperationalError(None, None, pg_errors.ProgramLimitExceeded("too big")),
        OperationalError(None, None, pg_errors.QueryCanceled("statement timeout")),
    ],
)
def test_deterministic_operational_errors_stay_rejections(client, user, monkeypatch, exc):
    assert not is_transient_db_error(exc)
    _fail_bump_on_call(monkeypatch, 1, exc)
    c = cmd("project_add", temp_id="p1", name="One")
    resp = _post(client, user, [c])
    assert resp.status_code == 200, resp.text
    assert resp.json()["sync_status"][c["uuid"]]["error_code"] == "invalid_args"


def test_ordinary_failures_are_still_rejections(client, user, monkeypatch):
    _fail_bump_on_call(monkeypatch, 1, RuntimeError("boom"))
    c = cmd("project_add", temp_id="p1", name="One")
    resp = _post(client, user, [c])
    assert resp.status_code == 200
    assert resp.json()["sync_status"][c["uuid"]]["error_code"] == "invalid_args"


def test_engine_sets_a_lock_timeout():
    with get_engine().connect() as conn:
        assert conn.execute(text("SHOW lock_timeout")).scalar_one() == "15s"


def test_a_real_lock_wait_timeout_is_retryable(client, user, monkeypatch):
    """A lock held elsewhere past lock_timeout answers 503 and keeps the command."""
    real = commands_mod.Ctx.bump

    def bump(self):
        self.session.execute(text("SET LOCAL lock_timeout = '200ms'"))
        return real(self)

    monkeypatch.setattr(commands_mod.Ctx, "bump", bump)
    ws_id = uuid.UUID(user["workspace_id"])
    with get_engine().connect() as holder:
        holder.execute(
            text("SELECT id FROM workspaces WHERE id = :i FOR UPDATE"), {"i": ws_id}
        )
        c = cmd("project_add", temp_id="p1", name="One")
        resp = _post(client, user, [c])
    assert resp.status_code == 503, resp.text

    # The holder is gone: resending the same command applies it exactly once.
    monkeypatch.undo()
    again = sync(client, user, "*", [c])
    assert again["sync_status"][c["uuid"]] == "ok"
    assert [p["name"] for p in again["projects"]] == ["One"]


def _viewer(client, user, db) -> dict:
    viewer = register_user(client, email=f"v-{uuid.uuid4().hex[:6]}@example.com", name="Vera")
    ws_id = uuid.UUID(user["workspace_id"])
    version = bump_version(db, ws_id)
    db.add(
        Membership(
            workspace_id=ws_id,
            user_id=uuid.UUID(viewer["user"]["id"]),
            role="viewer",
            version=version,
        )
    )
    db.commit()
    return {"headers": auth_headers(viewer["access_token"]), "workspace_id": user["workspace_id"]}


def test_viewer_batch_never_takes_the_workspace_lock(client, user, db, monkeypatch):
    viewer = _viewer(client, user, db)
    ws_id = uuid.UUID(user["workspace_id"])
    before = db.execute(select(Workspace.version).where(Workspace.id == ws_id)).scalar_one()

    def no_bump(self):
        raise AssertionError("a viewer's command took the workspace lock")

    monkeypatch.setattr(commands_mod.Ctx, "bump", no_bump)
    cmds = [cmd("task_add", temp_id=f"t{i}", title="x") for i in range(5)]
    resp = sync(client, viewer, "*", cmds)
    assert all(resp["sync_status"][c["uuid"]]["error_code"] == "forbidden" for c in cmds)
    db.expire_all()
    assert db.execute(select(Workspace.version).where(Workspace.id == ws_id)).scalar_one() == before


def _checked_out() -> int:
    pool = get_engine().pool
    assert isinstance(pool, QueuePool)
    return pool.checkedout()


def _no_events(*_args, **_kwargs) -> None:
    return None


def test_sync_releases_its_connection_before_applying_commands(client, user, monkeypatch):
    seen = {}
    real = sync_router.process_commands

    def spy(*args, **kwargs):
        seen["checked_out"] = _checked_out()
        return real(*args, **kwargs)

    monkeypatch.setattr(sync_router, "process_commands", spy)
    sync(client, user, "*", [cmd("project_add", temp_id="p1", name="One")])
    assert seen["checked_out"] == 0


def test_mcp_write_releases_its_connection_before_applying(client, user, db, monkeypatch):
    from balu.db import get_sessionmaker
    from balu.mcp import tools
    from balu.models import User
    from balu.schemas.sync import Command

    seen = {}
    real = tools.process_commands

    def spy(*args, **kwargs):
        seen["checked_out"] = _checked_out()
        return real(*args, **kwargs)

    monkeypatch.setattr(tools, "process_commands", spy)
    owner = db.get(User, uuid.UUID(user["user"]["id"]))
    ctx = tools.ToolContext(db=db, sm=get_sessionmaker(), user=owner, event_sender=_no_events)
    command = Command(
        type="project_add", uuid=str(uuid.uuid4()), temp_id="p1", args={"name": "One"}
    )
    tools._apply(ctx, uuid.UUID(user["workspace_id"]), "owner", [command])
    assert seen["checked_out"] == 0


def test_lock_timeout_keeps_an_operator_options_parameter():
    url = database_url_with_lock_timeout(
        "postgresql+psycopg://u:p@h/db?options=-csearch_path%3Dbalu"
    )
    assert url.query["options"] == "-c lock_timeout=15000 -csearch_path=balu"
    plain = database_url_with_lock_timeout("postgresql+psycopg://u:p@h/db")
    assert plain.query["options"] == "-c lock_timeout=15000"


@pytest.mark.parametrize(
    "exc",
    [
        OperationalError("SELECT 1", {}, pg_errors.LockNotAvailable("lock timeout")),
        PoolTimeoutError("QueuePool limit of size 5 overflow 10 reached"),
    ],
)
def test_transient_error_outside_sync_answers_503(client, user, monkeypatch, exc):
    from balu.routers import me as me_router

    def boom(*a, **k):
        raise exc

    monkeypatch.setattr(me_router, "MeResponse", boom)
    resp = client.get("/api/v1/me", headers=user["headers"])
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["code"] == "unavailable"
    assert resp.headers["Retry-After"]


def test_deterministic_error_outside_sync_stays_500(client, user, monkeypatch):
    from balu.routers import me as me_router

    def boom(*a, **k):
        raise OperationalError("SELECT 1", {}, pg_errors.ProgramLimitExceeded("too big"))

    monkeypatch.setattr(me_router, "MeResponse", boom)
    resp = client.get("/api/v1/me", headers=user["headers"])
    assert resp.status_code == 500
    assert resp.json()["detail"]["code"] == "internal_error"


def test_refresh_family_lock_restores_lock_timeout(db):
    from balu.auth import _lock_family

    _lock_family(db, uuid.uuid4())
    # lifted only for the wait: the connection's own value is back afterwards
    assert db.execute(text("SHOW lock_timeout")).scalar_one() == "15s"
    db.rollback()


def test_refresh_waits_past_lock_timeout_for_a_sibling(db):
    from balu.auth import _lock_family

    family = uuid.uuid4()
    db.execute(text("SET LOCAL lock_timeout = '150ms'"))
    with get_engine().connect() as holder:
        holder.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:f, 0))"), {"f": str(family)}
        )
        timer = threading.Timer(0.6, holder.rollback)
        timer.start()
        try:
            _lock_family(db, family)  # waits ~0.6s although lock_timeout is 150ms
        finally:
            timer.join()
    db.rollback()


def test_mcp_transient_error_names_what_committed(client, user, db, monkeypatch):
    from balu.db import get_sessionmaker
    from balu.mcp import tools
    from balu.models import User
    from balu.schemas.sync import Command

    real = tools.process_commands
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise commands_mod.TransientDbError("OperationalError")
        return real(*args, **kwargs)

    monkeypatch.setattr(tools, "process_commands", flaky)
    owner = db.get(User, uuid.UUID(user["user"]["id"]))
    ctx = tools.ToolContext(db=db, sm=get_sessionmaker(), user=owner, event_sender=_no_events)
    commands = [
        Command(type="project_add", uuid=str(uuid.uuid4()), temp_id=f"p{i}", args={"name": "N"})
        for i in range(2)
    ]
    with pytest.raises(tools.ToolError) as info:
        tools._apply(ctx, uuid.UUID(user["workspace_id"]), "owner", commands)
    assert info.value.applied == ["project_add"]
    assert "may or may not have been applied" in str(info.value)


def _refused_connection() -> OperationalError:
    from sqlalchemy import create_engine

    engine = create_engine(
        "postgresql+psycopg://u:sekrit-pw@127.0.0.1:1/db", connect_args={"connect_timeout": 2}
    )
    with pytest.raises(OperationalError) as info:
        engine.connect()
    return info.value


def test_refused_connection_is_transient():
    assert is_transient_db_error(_refused_connection())


def test_statement_less_connect_error_is_transient_and_statement_error_is_not():
    connect = OperationalError(None, None, psycopg.OperationalError("connection failed"))
    assert is_transient_db_error(connect)
    with_statement = OperationalError(
        "SELECT 1", {},
        psycopg.OperationalError("number of parameters must be between 0 and 65535"),
    )
    assert not is_transient_db_error(with_statement)


def test_refused_connection_during_sync_answers_503(client, user, monkeypatch):
    _fail_bump_on_call(monkeypatch, 1, _refused_connection())
    resp = _post(client, user, [cmd("project_add", temp_id="p1", name="One")])
    assert resp.status_code == 503, resp.text


def test_503_log_carries_the_connect_reason_but_no_secret(client, user, monkeypatch, caplog):
    refused = OperationalError(
        None, None,
        psycopg.OperationalError(
            'connection failed: FATAL: password authentication failed for user "balu"'
        ),
    )
    _fail_bump_on_call(monkeypatch, 1, refused)
    with caplog.at_level("ERROR"):
        resp = _post(client, user, [cmd("project_add", temp_id="p1", name="One")])
    assert resp.status_code == 503
    assert "password authentication failed" in caplog.text


_REJECTED_URLS = [
    "postgresql+psycopg://u:pa@sekrittail@db:5432/x",
    "postgresql+psycopg://u:ab@cdXYZ?q@db/x",
    "postgresql+psycopg://u:se/cr@etXYZ@db:5432/x",
    "postgresql+psycopg://u:a@b@cXYZ@db/x",
    "postgresql+psycopg://u:pw@db/x?application_name=a@b",
    "postgresql+psycopg://u:ab@cdXYZ/efGH@db/x",
    "postgresql+psycopg://db:5432/x?password=pa@sekrittail",
    "postgresql+psycopg://balu:3f9ab27c1d/balu",
    "postgresql+psycopg://balu:31415926/balu",
    "postgresql+psycopg://balu:70000/balu",
    "postgresql+psycopg://balu:3_14/balu",
    "postgresql+psycopg://balu:+314/balu",
    "postgresql+psycopg://balu:\uff11\uff12/balu",
    "postgresql+psycopg://balu:123456/balu",
    "postgresql+psycopg:/u:unparsableSECRETZ@db/x",
]
_ENCODED_URLS = [
    "postgresql+psycopg://u:pa%40sekrittail@db:5432/x",
    "postgresql+psycopg://u:ab%40cdXYZ%3Fq@db/x",
    "postgresql+psycopg://u:se%2Fcr%40etXYZ@db:5432/x",
    "postgresql+psycopg://u:a%40b%40cXYZ@db/x",
    "postgresql+psycopg://u:pw@db/x?application_name=a%40b",
    "postgresql+psycopg://u:ab%40cdXYZ%2FefGH%40db@db/x",
]


@pytest.mark.parametrize("url", _REJECTED_URLS)
def test_bad_database_url_is_rejected_without_echoing_it(url):
    with pytest.raises(ValueError) as info:
        database_url_with_lock_timeout(url)
    message = str(info.value)
    fragments = (
        "sekrittail", "cdXYZ", "etXYZ", "cXYZ", "efGH", "pa@", "pw",
        "3f9ab27c1d", "31415926", "70000", "SECRETZ", "3_14", "+314",
        "123456", "\uff11\uff12",
    )
    for fragment in fragments:
        assert fragment not in message


# Shapes the raw port check must keep accepting.
_LEGITIMATE_URLS = [
    "postgresql+psycopg://u:pw@[::1]/x",
    "postgresql+psycopg://u:pw@[::1]:5432/x",
    "postgresql+psycopg://u:pw@/x?host=/var/run/postgresql",
    "postgresql+psycopg://u:pw@db/x",
]


@pytest.mark.parametrize("url", _LEGITIMATE_URLS)
def test_legitimate_url_shapes_are_accepted(url):
    database_url_with_lock_timeout(url)


# Documented boundary: without '@' the URL is taken literally. A forgotten
# '@host' whose password looks like "port/dbname?query" cannot be told apart
# from a legitimate credential-less URL, so these are accepted by design.
_CREDENTIALLESS_BOUNDARY_URLS = [
    "postgresql+psycopg://balu:4242/ab+cd/balu",
    "postgresql+psycopg://balu:12?ab=cd/balu",
    "postgresql+psycopg://balu:31415/balu",
]


@pytest.mark.parametrize("url", _CREDENTIALLESS_BOUNDARY_URLS)
def test_credentialless_url_with_valid_port_is_the_accepted_boundary(url):
    database_url_with_lock_timeout(url)


def test_invalid_port_and_unparsable_url_raise_distinct_fixed_messages():
    with pytest.raises(ValueError) as port_info:
        database_url_with_lock_timeout("postgresql+psycopg://balu:70000/balu")
    assert "invalid port" in str(port_info.value)
    with pytest.raises(ValueError) as parse_info:
        database_url_with_lock_timeout("postgresql+psycopg:/u:unparsableSECRETZ@db/x")
    assert "cannot be parsed" in str(parse_info.value)


@pytest.mark.parametrize("url", _ENCODED_URLS)
def test_url_with_percent_encoded_at_is_accepted(url):
    database_url_with_lock_timeout(url)


def test_describe_transient_error_redacts_the_configured_password(monkeypatch):
    from types import SimpleNamespace

    import balu.db as db_mod

    monkeypatch.setattr(
        db_mod,
        "get_settings",
        lambda: SimpleNamespace(database_url="postgresql+psycopg://u:sekritpw@db:5432/x"),
    )
    exc = OperationalError(
        None, None, psycopg.OperationalError("failed to resolve host 'sekritpw@db'")
    )
    text_ = db_mod.describe_transient_error(exc)
    assert "sekritpw" not in text_
    assert "***" in text_


def test_configured_secrets_are_the_decoded_password(monkeypatch):
    from types import SimpleNamespace

    import balu.db as db_mod

    def secrets_for(url):
        monkeypatch.setattr(db_mod, "get_settings", lambda: SimpleNamespace(database_url=url))
        return db_mod._configured_secrets()

    assert secrets_for("postgresql+psycopg://u:se%2Fcr%40etXYZ@db:5432/x") == ["se/cr@etXYZ"]
    assert secrets_for("postgresql+psycopg://u:pw@db/x?application_name=a%40b") == []
    assert secrets_for("not a url") == []


def _app_with_database_url(monkeypatch, url):
    import balu.main as main_mod

    real = main_mod.get_settings()
    patched = real.model_copy(update={"database_url": url})
    monkeypatch.setattr(main_mod, "get_settings", lambda: patched)
    return main_mod.create_app()


@pytest.mark.parametrize("auto_migrate", ["1", "0"])
def test_booting_with_an_unescaped_at_url_fails_before_migrations(
    monkeypatch, caplog, auto_migrate
):
    from fastapi.testclient import TestClient

    import balu.migrate as migrate_mod

    called = []
    monkeypatch.setattr(migrate_mod, "run_migrations", lambda *a, **k: called.append(1))
    monkeypatch.setenv("BALU_AUTO_MIGRATE", auto_migrate)
    app = _app_with_database_url(
        monkeypatch, "postgresql+psycopg://u:pa@sekrittail@127.0.0.1:1/x"
    )
    with caplog.at_level("DEBUG"), pytest.raises(ValueError) as info:
        with TestClient(app):
            pass
    assert called == []
    assert "sekrittail" not in str(info.value)
    assert "sekrittail" not in caplog.text


def test_migrations_accept_a_percent_encoded_url(monkeypatch):
    import balu.config as config_mod
    import balu.migrate as migrate_mod

    base = config_mod.get_settings()
    # '%2540' decodes to the application_name "a%40b": the literal '%' must
    # survive alembic's config parser and the connect.
    sep = "&" if "?" in base.database_url else "?"
    url = f"{base.database_url}{sep}application_name=a%2540b"
    patched = base.model_copy(update={"database_url": url})
    monkeypatch.setattr(migrate_mod, "get_settings", lambda: patched)
    monkeypatch.setattr(config_mod, "get_settings", lambda: patched)
    assert migrate_mod._alembic_config().get_main_option("sqlalchemy.url") == url
    migrate_mod.run_migrations()  # already at head: runs env.py and connects


def test_migrations_reject_an_ambiguous_url_before_connecting(monkeypatch):
    import balu.config as config_mod
    import balu.migrate as migrate_mod

    url = "postgresql+psycopg://u:pa@sekrittail@127.0.0.1:1/x"
    patched = config_mod.get_settings().model_copy(update={"database_url": url})
    monkeypatch.setattr(migrate_mod, "get_settings", lambda: patched)
    monkeypatch.setattr(config_mod, "get_settings", lambda: patched)
    with pytest.raises(ValueError) as info:
        migrate_mod.run_migrations()
    assert "sekrittail" not in str(info.value)


def test_describe_transient_error_is_one_line():
    from balu.db import describe_transient_error

    exc = OperationalError(
        None, None,
        psycopg.OperationalError("Multiple connection attempts failed.\n- host a: x\n- host b: y"),
    )
    assert "\n" not in describe_transient_error(exc)


def test_statement_error_log_omits_the_driver_message(client, user, monkeypatch, caplog):
    exc = OperationalError(
        "SELECT 1", {}, pg_errors.LockNotAvailable("DETAIL: Failing row contains (secret)")
    )
    _fail_bump_on_call(monkeypatch, 1, exc)
    with caplog.at_level("ERROR"):
        resp = _post(client, user, [cmd("project_add", temp_id="p1", name="One")])
    assert resp.status_code == 503
    assert "sqlstate 55P03" in caplog.text
    assert "Failing row" not in caplog.text


def test_mcp_transient_error_outside_apply_says_retry(client, user, db, monkeypatch):
    from balu.db import get_sessionmaker
    from balu.mcp import protocol, tools
    from balu.models import User

    def boom(*a, **k):
        raise OperationalError("SELECT 1", {}, pg_errors.LockNotAvailable("lock timeout"))

    monkeypatch.setattr(protocol, "call_tool", boom)
    owner = db.get(User, uuid.UUID(user["user"]["id"]))
    ctx = tools.ToolContext(db=db, sm=get_sessionmaker(), user=owner, event_sender=_no_events)
    resp = protocol._tools_call(1, {"name": "list_workspaces", "arguments": {}}, ctx)
    assert resp["result"]["isError"] is True
    assert "retry" in resp["result"]["content"][0]["text"]


def test_mcp_deterministic_error_outside_apply_stays_internal(client, user, db, monkeypatch):
    from balu.db import get_sessionmaker
    from balu.mcp import protocol, tools
    from balu.models import User

    def boom(*a, **k):
        raise OperationalError("SELECT 1", {}, pg_errors.ProgramLimitExceeded("too big"))

    monkeypatch.setattr(protocol, "call_tool", boom)
    owner = db.get(User, uuid.UUID(user["user"]["id"]))
    ctx = tools.ToolContext(db=db, sm=get_sessionmaker(), user=owner, event_sender=_no_events)
    resp = protocol._tools_call(1, {"name": "list_workspaces", "arguments": {}}, ctx)
    assert resp["error"]["code"] == protocol.INTERNAL_ERROR


def test_503_logs_record_the_sqlstate(client, user, monkeypatch, caplog):
    exc = OperationalError("SELECT 1", {}, pg_errors.LockNotAvailable("lock timeout"))
    _fail_bump_on_call(monkeypatch, 1, exc)
    with caplog.at_level("ERROR"):
        resp = _post(client, user, [cmd("project_add", temp_id="p1", name="One")])
    assert resp.status_code == 503
    assert "sqlstate 55P03" in caplog.text

    monkeypatch.undo()
    from balu.routers import me as me_router

    def boom(*a, **k):
        raise exc

    caplog.clear()
    monkeypatch.setattr(me_router, "MeResponse", boom)
    with caplog.at_level("ERROR"):
        assert client.get("/api/v1/me", headers=user["headers"]).status_code == 503
    assert "sqlstate 55P03" in caplog.text
