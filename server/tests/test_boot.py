"""Boot-time migration failures and the migrate CLI."""

from __future__ import annotations

import logging

import pytest
from alembic.util.exc import CommandError
from fastapi.testclient import TestClient

from balu import migrate
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
    assert "python -m balu.migrate downgrade" in messages[0]


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
