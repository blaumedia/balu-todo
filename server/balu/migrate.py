"""Programmatic Alembic runner (used on startup and as a CLI escape hatch).

Usage: ``python -m balu.migrate`` runs ``alembic upgrade head``;
``python -m balu.migrate downgrade <revision> [--yes]`` runs ``alembic downgrade``
(the rollback step before switching to an older image, see the README). It prints
the current and the target revision and refuses, without ``--yes``, any target
this image's head or previous head (``base``, ``-2``, a mistyped id, ...): those
walks can drop tables such as ``attachments``. A relative target (``-1``) is
resolved against the database's current revision first, so ``-1`` passes only
while the database is at this image's head.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

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


def run_downgrade(revision: str, configure_logger: bool = False) -> None:
    command.downgrade(_alembic_config(configure_logger), revision)


def image_head() -> str | None:
    """The newest revision this image knows."""
    return ScriptDirectory.from_config(_alembic_config()).get_current_head()


def current_revision() -> str | None:
    """The revision the database is stamped with (None: unstamped)."""
    from .db import get_engine

    with get_engine().connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def _safe_downgrade_targets() -> set[str]:
    """This image's head and its previous head: the one step a rollback needs."""
    script = ScriptDirectory.from_config(_alembic_config())
    head = script.get_current_head()
    if head is None:
        return set()
    revision = script.get_revision(head)
    down = revision.down_revision if revision is not None else None
    return {head, *([down] if isinstance(down, str) else [])}


def _resolve_target(target: str, current: str | None) -> str:
    """A relative target (`-N`) as the concrete revision alembic would walk to.

    Alembic resolves `-N` against the database's current revision, not against
    this image's head. Anything unresolvable returns the target unchanged (and
    so fails the safe-set check).
    """
    match = re.fullmatch(r"-(\d+)", target)
    if match is None or current is None:
        return target
    script = ScriptDirectory.from_config(_alembic_config())
    rev: str | None = current
    for _ in range(int(match.group(1))):
        revision = script.get_revision(rev) if rev is not None else None
        down = revision.down_revision if revision is not None else None
        if not isinstance(down, str):
            return "base"
        rev = down
    return rev or "base"


def main(argv: list[str]) -> int:
    if not argv:
        run_migrations(configure_logger=True)
        return 0
    if argv[0] == "downgrade":
        yes = argv.count("--yes") == 1
        targets = [a for a in argv[1:] if a != "--yes"]
        if len(targets) == 1 and len(argv) == 2 + yes:
            target = targets[0]
            current = current_revision()
            print(f"current revision: {current}")
            print(f"target revision:  {target}")
            if not yes and _resolve_target(target, current) not in _safe_downgrade_targets():
                print(
                    "refusing: this target is not this image's head or its previous "
                    "head (a relative target such as -1 counts from the database's "
                    "current revision) and may drop tables (for example "
                    "`attachments`). Re-run with --yes if that is intended.",
                    file=sys.stderr,
                )
                return 2
            run_downgrade(target, configure_logger=True)
            return 0
    print("usage: python -m balu.migrate [downgrade <revision> [--yes]]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
