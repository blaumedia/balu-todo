"""Programmatic Alembic runner (used on startup and as a CLI escape hatch).

Usage: ``python -m balu.migrate`` runs ``alembic upgrade head``.
"""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config

from alembic import command

from .config import get_settings

_SERVER_ROOT = Path(__file__).resolve().parent.parent


def _alembic_config(configure_logger: bool = False) -> Config:
    cfg = Config(str(_SERVER_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_SERVER_ROOT / "alembic"))
    # ConfigParser interpolation: a literal '%' (percent-encoded password) must be
    # doubled or set_main_option raises and echoes the URL.
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
    # Programmatic runs must not reconfigure the host application's logging.
    cfg.attributes["configure_logger"] = configure_logger
    return cfg


def run_migrations(configure_logger: bool = False) -> None:
    command.upgrade(_alembic_config(configure_logger), "head")


if __name__ == "__main__":
    run_migrations(configure_logger=True)
