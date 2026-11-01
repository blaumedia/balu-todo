"""Boot-time migration failures and the migrate CLI."""

from __future__ import annotations

import logging

import pytest
from alembic.script.revision import ResolutionError
from alembic.util.exc import CommandError
from fastapi.testclient import TestClient
from sqlalchemy import text

from balu import migrate
from balu.db import get_engine
from balu.main import app


def _boot_with(monkeypatch, exc: Exception) -> None:
    monkeypatch.setenv("BALU_AUTO_MIGRATE", "1")

    def boom() -> None:
        raise exc

    monkeypatch.setattr(migrate, "run_migrations", boom)
    with TestClient(app):
        pass


def test_boot_on_a_newer_database_logs_how_to_roll_back_and_reraises(monkeypatch, caplog):
    err = CommandError("Can't locate revision identified by 'f6a7b8c9d0e1'")
    with caplog.at_level(logging.ERROR, logger="balu.main"), pytest.raises(CommandError):
        _boot_with(monkeypatch, err)
    messages = [r.getMessage() for r in caplog.records if r.name == "balu.main"]
    assert len(messages) == 1
    assert "newer schema revision" in messages[0]
    # names this image's own head, to be run in the newer image
    assert f"`python -m balu.migrate downgrade {migrate.image_head()}`" in messages[0]
    assert "in the newer image" in messages[0]


def test_boot_detects_an_unknown_revision_by_the_chained_resolution_error(monkeypatch, caplog):
    err = CommandError("some future alembic wording")
    err.__cause__ = ResolutionError("x", "zzz")
    with caplog.at_level(logging.ERROR, logger="balu.main"), pytest.raises(CommandError):
        _boot_with(monkeypatch, err)
    assert [r for r in caplog.records if r.name == "balu.main"]


def test_boot_on_a_database_stamped_with_an_unknown_revision_uses_the_real_migration(
    monkeypatch, caplog
):
    """No stubbed error text: alembic itself must produce what the handler detects."""
    monkeypatch.setenv("BALU_AUTO_MIGRATE", "1")
    head = migrate.image_head()
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num = 'zz_unknown_future'"))
    try:
        with caplog.at_level(logging.ERROR, logger="balu.main"), pytest.raises(CommandError):
            with TestClient(app):
                pass
    finally:
        with get_engine().begin() as conn:
            conn.execute(text("UPDATE alembic_version SET version_num = :h"), {"h": head})
    messages = [r.getMessage() for r in caplog.records if r.name == "balu.main"]
    assert len(messages) == 1
    assert f"downgrade {head}" in messages[0]


def test_other_alembic_errors_are_reraised_without_the_rollback_hint(monkeypatch, caplog):
    with caplog.at_level(logging.ERROR, logger="balu.main"), pytest.raises(CommandError):
        _boot_with(monkeypatch, CommandError("Multiple head revisions"))
    assert not [r for r in caplog.records if r.name == "balu.main"]


def test_migrate_cli_downgrade_passes_the_revision(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(
        migrate, "run_downgrade", lambda rev, configure_logger=False: calls.append(rev)
    )
    assert migrate.main(["downgrade", "e5f6a7b8c9d0"]) == 0
    assert calls == ["e5f6a7b8c9d0"]
    assert migrate.main(["bogus"]) == 2


@pytest.fixture
def downgrade_calls(monkeypatch) -> list[str]:
    calls: list[str] = []
    monkeypatch.setattr(
        migrate, "run_downgrade", lambda rev, configure_logger=False: calls.append(rev)
    )
    monkeypatch.setattr(migrate, "current_revision", lambda: migrate.image_head())
    return calls


def test_migrate_cli_downgrade_prints_current_and_target(downgrade_calls, capsys):
    assert migrate.main(["downgrade", "e5f6a7b8c9d0"]) == 0
    out = capsys.readouterr().out
    assert f"current revision: {migrate.image_head()}" in out
    assert "target revision:  e5f6a7b8c9d0" in out


@pytest.mark.parametrize("target", ["base", "-2", "d4e5f6a7b8c9", "e5f6a7b8c9d1", "zzz"])
def test_migrate_cli_refuses_a_data_dropping_downgrade_without_yes(
    downgrade_calls, capsys, target
):
    assert migrate.main(["downgrade", target]) == 2
    assert downgrade_calls == []
    assert "--yes" in capsys.readouterr().err


@pytest.mark.parametrize("target", ["base", "-2", "d4e5f6a7b8c9"])
def test_migrate_cli_downgrade_with_yes_proceeds(downgrade_calls, target):
    assert migrate.main(["downgrade", target, "--yes"]) == 0
    assert migrate.main(["downgrade", "--yes", target]) == 0
    assert downgrade_calls == [target, target]


def test_migrate_cli_allows_the_one_step_targets_without_yes(downgrade_calls):
    assert migrate.main(["downgrade", "-1"]) == 0
    assert downgrade_calls == ["-1"]


def test_migrate_cli_rejects_malformed_downgrade_arguments(downgrade_calls):
    assert migrate.main(["downgrade"]) == 2
    assert migrate.main(["downgrade", "a", "b"]) == 2
    assert migrate.main(["downgrade", "--yes"]) == 2
    assert migrate.main(["downgrade", "a", "--yes", "--yes"]) == 2
    assert downgrade_calls == []


def test_current_revision_reads_the_stamp():
    assert migrate.current_revision() == migrate.image_head()
