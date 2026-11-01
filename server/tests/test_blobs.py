"""`python -m balu.blobs sweep`: the operator command for orphan attachment blobs."""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from balu import blobs
from balu.config import get_settings
from tests.conftest import cmd, sync
from tests.test_attachments import _add_task, _blob_dir, _upload


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("BALU_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _age(path, seconds: int) -> None:
    t = time.time() - seconds
    os.utime(path, (t, t))


def _orphan(d, age=7200, content=b"x"):
    f = d / str(uuid.uuid4())
    f.write_bytes(content)
    _age(f, age)
    return f


def _setup(client, user, data_dir, live_count=3):
    """A workspace dir holding `live_count` live blobs (aged) plus the dir itself."""
    task_id = _add_task(client, user)
    d = _blob_dir(data_dir, user["workspace_id"])
    lives = []
    for _ in range(live_count):
        meta = _upload(client, user, task_id).json()
        _age(d / meta["id"], 7200)
        lives.append(d / meta["id"])
    return d, lives, task_id


def _quarantined(data_dir):
    q = data_dir / "attachments" / ".orphans"
    return sorted(p for p in q.rglob("*") if p.is_file()) if q.exists() else []


def test_dry_run_changes_nothing_and_reports_counts_and_bytes(client, user, data_dir, capsys):
    d, lives, _ = _setup(client, user, data_dir)
    orphan = _orphan(d, content=b"12345")
    assert blobs.main(["sweep"]) == 0
    out = capsys.readouterr().out
    assert "orphans: 1 (5 byte(s))" in out
    assert "dry run" in out
    assert orphan.exists()
    assert not (data_dir / "attachments" / ".orphans").exists()
    assert str(orphan.name) not in out


def test_apply_quarantines_only_old_orphans(client, user, data_dir, capsys):
    d, lives, task_id = _setup(client, user, data_dir)
    gone = _upload(client, user, task_id).json()
    sync(client, user, "*", [cmd("attachment_delete", id=gone["id"])])
    deleted_blob = d / gone["id"]
    deleted_blob.write_bytes(b"x")  # a crashed removal leaves it behind
    _age(deleted_blob, 7200)
    orphan = _orphan(d)
    young = _orphan(d, age=10)
    stray = d / "not-a-uuid"
    stray.write_bytes(b"x")
    _age(stray, 7200)
    outside = data_dir / "outside"
    outside.mkdir()
    target = outside / str(uuid.uuid4())
    target.write_bytes(b"x")
    _age(target, 7200)
    (d / str(uuid.uuid4())).symlink_to(target)  # symlinked file
    (data_dir / "attachments" / str(uuid.uuid4())).symlink_to(outside)  # symlinked workspace

    assert blobs.main(["sweep", "--apply"]) == 0
    assert not orphan.exists() and not deleted_blob.exists()
    assert all(f.exists() for f in lives)
    assert young.exists() and stray.exists() and target.exists()
    moved = _quarantined(data_dir)
    assert sorted(p.name for p in moved) == sorted([orphan.name, gone["id"]])
    assert all(p.is_relative_to(data_dir / "attachments" / ".orphans") for p in moved)
    assert "moved 2 orphan file(s)" in capsys.readouterr().out
    # a second run finds nothing in the quarantine (it is not a workspace dir)
    assert blobs.main(["sweep", "--apply"]) == 0
    assert len(_quarantined(data_dir)) == 2


def test_apply_refuses_when_the_table_has_no_live_rows(client, user, data_dir, capsys, db):
    from balu.models import Attachment

    d, lives, _ = _setup(client, user, data_dir, live_count=1)
    db.query(Attachment).delete()
    db.commit()
    assert blobs.main(["sweep", "--apply"]) == 2
    assert "no live rows" in capsys.readouterr().err
    assert lives[0].exists() and not _quarantined(data_dir)
    assert blobs.main(["sweep"]) == 0  # a dry run only reports
    assert blobs.main(["sweep", "--apply", "--force"]) == 0
    assert not lives[0].exists() and len(_quarantined(data_dir)) == 1


def test_apply_refuses_when_orphans_exceed_half_of_the_candidates(
    client, user, data_dir, capsys
):
    d, lives, _ = _setup(client, user, data_dir, live_count=1)
    orphans = [_orphan(d), _orphan(d)]
    assert blobs.main(["sweep", "--apply"]) == 2
    assert "more than 50%" in capsys.readouterr().err
    assert all(o.exists() for o in orphans) and not _quarantined(data_dir)
    assert blobs.main(["sweep", "--apply", "--force"]) == 0
    assert len(_quarantined(data_dir)) == 2 and lives[0].exists()


def test_exactly_half_orphans_is_allowed(client, user, data_dir):
    d, lives, _ = _setup(client, user, data_dir, live_count=1)
    _orphan(d)
    assert blobs.main(["sweep", "--apply"]) == 0
    assert len(_quarantined(data_dir)) == 1


def test_live_lookup_is_chunked(client, user, data_dir, monkeypatch):
    d, lives, _ = _setup(client, user, data_dir, live_count=5)
    orphan = _orphan(d)
    monkeypatch.setattr(blobs, "CHUNK_SIZE", 2)
    from sqlalchemy import event

    from balu.db import get_engine

    seen: list[tuple] = []

    def grab(conn, cursor, statement, parameters, context, executemany):
        if "attachments.id IN" in statement:
            seen.append(parameters)

    event.listen(get_engine(), "before_cursor_execute", grab)
    try:
        assert blobs.main(["sweep", "--apply"]) == 0
    finally:
        event.remove(get_engine(), "before_cursor_execute", grab)
    assert not orphan.exists() and all(f.exists() for f in lives)
    assert len(seen) == 3  # 6 candidates in chunks of 2
    assert all(len(p) <= 2 + 1 for p in seen)  # ids (+ the is_deleted literal, if bound)


def test_a_file_vanishing_during_the_move_counts_as_gone(client, user, data_dir, caplog):
    d, lives, _ = _setup(client, user, data_dir)
    orphan = _orphan(d)
    report = blobs.find_orphans()
    assert [c.path for c in report.orphans] == [orphan]
    orphan.unlink()  # a racing delete after the scan
    assert blobs.quarantine(report) == 0
    assert not [r for r in caplog.records if r.name == "balu.blobs"]  # no warning either


def test_purge_quarantine_deletes_only_old_batches(client, user, data_dir, capsys):
    q = data_dir / "attachments" / ".orphans"
    now = datetime.now(UTC)
    old = q / (now - timedelta(days=40)).strftime(blobs._STAMP_FORMAT) / "ws"
    new = q / (now - timedelta(days=2)).strftime(blobs._STAMP_FORMAT) / "ws"
    for d in (old, new):
        d.mkdir(parents=True)
        (d / "f").write_bytes(b"abc")
    (q / "keep-me").mkdir()
    assert blobs.main(["sweep", "--purge-quarantine", "--older-than-days", "30"]) == 0
    assert "purged 1 quarantined file(s), 3 byte(s)" in capsys.readouterr().out
    assert not old.exists() and (new / "f").exists() and (q / "keep-me").exists()


def test_purge_needs_an_age_and_age_needs_purge(data_dir, capsys):
    assert blobs.main(["sweep", "--purge-quarantine"]) == 2
    assert blobs.main(["sweep", "--older-than-days", "3"]) == 2
    assert blobs.main([]) == 2


def test_empty_data_dir_is_a_no_op(data_dir, capsys):
    assert blobs.main(["sweep", "--apply"]) == 0
    assert "candidate files: 0" in capsys.readouterr().out


def test_the_app_no_longer_sweeps_at_startup():
    import balu.attachments
    import balu.main

    assert not hasattr(balu.attachments, "sweep_orphan_blobs")
    assert not hasattr(balu.main, "_start_orphan_sweep")


def test_purge_counts_only_removed_files_and_fails_when_some_remain(
    data_dir, capsys, monkeypatch
):
    q = data_dir / "attachments" / ".orphans"
    old = q / (datetime.now(UTC) - timedelta(days=40)).strftime(blobs._STAMP_FORMAT) / "ws"
    old.mkdir(parents=True)
    (old / "f").write_bytes(b"abc")
    monkeypatch.setattr(blobs.shutil, "rmtree", lambda *a, **k: None)  # removal fails
    assert blobs.main(["sweep", "--purge-quarantine", "--older-than-days", "30"]) == 1
    captured = capsys.readouterr()
    assert "purged 0 quarantined file(s), 0 byte(s)" in captured.out
    assert "1 file(s) could not be removed" in captured.err
    assert (old / "f").exists()


def test_a_symlinked_quarantine_is_refused_for_apply_and_purge(
    client, user, data_dir, capsys, tmp_path_factory
):
    d, lives, _ = _setup(client, user, data_dir)
    orphan = _orphan(d)
    outside = tmp_path_factory.mktemp("outside")
    old = outside / (datetime.now(UTC) - timedelta(days=40)).strftime(blobs._STAMP_FORMAT)
    old.mkdir()
    (old / "f").write_bytes(b"abc")
    (data_dir / "attachments" / ".orphans").symlink_to(outside, target_is_directory=True)
    assert blobs.main(["sweep", "--apply"]) == 1
    assert orphan.exists() and not list(outside.glob("*/*/*"))
    assert blobs.main(["sweep", "--purge-quarantine", "--older-than-days", "30"]) == 1
    assert (old / "f").exists()
    assert "symlink" in capsys.readouterr().err


def test_only_canonical_uuid_names_are_candidates(client, user, data_dir):
    d, lives, _ = _setup(client, user, data_dir)
    odd = [
        d / str(uuid.uuid4()).upper(),
        d / uuid.uuid4().hex,
        d / ("{" + str(uuid.uuid4()) + "}"),
    ]
    for f in odd:
        f.write_bytes(b"x")
        _age(f, 7200)
    odd_ws = d.parent / str(uuid.uuid4()).upper()
    odd_ws.mkdir()
    (odd_ws / str(uuid.uuid4())).write_bytes(b"x")
    _age(odd_ws / next(odd_ws.iterdir()).name, 7200)
    report = blobs.find_orphans()
    assert report.candidates == len(lives)
    assert not report.orphans


def test_contradictory_flags_are_rejected(data_dir, capsys):
    base = ["sweep", "--purge-quarantine", "--older-than-days", "30"]
    assert blobs.main([*base, "--apply"]) == 2
    assert blobs.main([*base, "--force"]) == 2
    assert "cannot be combined" in capsys.readouterr().err


def test_a_database_failure_is_a_short_message_and_exit_1(
    client, user, data_dir, capsys, monkeypatch
):
    from sqlalchemy.exc import SQLAlchemyError

    d, lives, _ = _setup(client, user, data_dir)
    orphan = _orphan(d)

    def boom(ids):
        raise SQLAlchemyError("SELECT secret FROM attachments")

    monkeypatch.setattr(blobs, "_live_ids", boom)
    assert blobs.main(["sweep", "--apply"]) == 1
    err = capsys.readouterr().err
    assert "nothing was changed" in err and "SELECT" not in err
    assert orphan.exists()
