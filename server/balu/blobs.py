"""Operator command for attachment blobs that no live row points at.

    python -m balu.blobs sweep                       # dry run: counts and bytes only
    python -m balu.blobs sweep --apply               # move orphans into the quarantine
    python -m balu.blobs sweep --purge-quarantine --older-than-days 30

When to use it: a process that dies between a delete's commit and the file
removal leaves bytes nothing points at. That is harmless disk usage, so this is
NOT a routine job and nothing runs it automatically. An automatic sweep once
looked attractive and was dropped: a database that is empty or older than the
data volume (a new Postgres before the dump is restored, a wrong DATABASE_URL, a
downgrade below the attachments migration) makes every blob look orphaned.

Safety rules, all in this module:
- the default is a dry run; only `--apply` changes anything;
- orphans are MOVED into `attachments/.orphans/<UTC timestamp>/` (inside the
  attachments root, so it is the same volume and the same backup), never
  unlinked; `--purge-quarantine --older-than-days N` is the only deletion;
- `--apply` refuses when the attachments table has no live rows, or when the
  orphans exceed half of the candidate files, unless `--force` is given;
- only regular files named `{workspace_uuid}/{attachment_uuid}` older than an
  hour are considered; symlinks (files and directories) are never followed.
"""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from .attachments import attachments_root
from .db import describe_transient_error

logger = logging.getLogger("balu.blobs")

QUARANTINE_DIR = ".orphans"
#: A blob is written before its row commits, so a young file without a live row
#: may be an upload in flight. Assumption: an upload that has not finished within
#: an hour has stalled or died (the size cap bounds a healthy one, but nothing
#: enforces a body-read timeout or refreshes the mtime while waiting for the
#: workspace lock), so only older files are candidates.
MIN_AGE_SECONDS = 3600
#: Ids per IN (...) query: Postgres allows 65535 bind parameters per statement.
CHUNK_SIZE = 1000
#: `--apply` refuses when more than this share of the candidates are orphans.
MAX_ORPHAN_RATIO = 0.5
_STAMP_FORMAT = "%Y%m%dT%H%M%SZ"


class QuarantineError(RuntimeError):
    """The quarantine directory cannot be used safely."""


def _canonical_uuid(name: str) -> uuid.UUID:
    """Parse only the spelling the server writes (lowercase, dashed); else ValueError."""
    parsed = uuid.UUID(name)
    if str(parsed) != name:
        raise ValueError(name)
    return parsed


def _quarantine_root() -> Path:
    qdir = attachments_root() / QUARANTINE_DIR
    if os.path.islink(qdir):
        raise QuarantineError(
            f"{qdir} is a symlink: refusing to write or delete through it"
        )
    return qdir


@dataclass
class Candidate:
    attachment_id: uuid.UUID
    workspace_id: uuid.UUID
    path: Path
    size: int


@dataclass
class SweepReport:
    candidates: int = 0
    live_rows: int = 0
    orphans: list[Candidate] = field(default_factory=list)
    refusal: str | None = None

    @property
    def orphan_bytes(self) -> int:
        return sum(c.size for c in self.orphans)


def _scan(root: Path, min_age_seconds: int) -> list[Candidate]:
    """Old regular `{workspace_uuid}/{attachment_uuid}` files; symlinks are skipped."""
    found: list[Candidate] = []
    if not root.is_dir():
        return found
    cutoff = time.time() - min_age_seconds
    with os.scandir(root) as top:
        for ws_entry in top:
            try:
                ws_id = _canonical_uuid(ws_entry.name)
                if ws_entry.is_symlink() or not ws_entry.is_dir(follow_symlinks=False):
                    continue
                with os.scandir(ws_entry.path) as inner:
                    for entry in inner:
                        try:
                            att_id = _canonical_uuid(entry.name)
                            if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                                continue
                            st = entry.stat(follow_symlinks=False)
                        except (ValueError, OSError):
                            continue
                        if st.st_mtime < cutoff:
                            found.append(
                                Candidate(att_id, ws_id, Path(entry.path), st.st_size)
                            )
            except (ValueError, OSError):
                continue
    return found


def _live_ids(ids: list[uuid.UUID]) -> tuple[set[uuid.UUID], int]:
    """Which of `ids` have a live row (queried in chunks), and how many live rows exist."""
    from .db import get_sessionmaker
    from .models import Attachment

    db = get_sessionmaker()()
    try:
        live_total = (
            db.query(Attachment.id).filter(Attachment.is_deleted.is_(False)).limit(1).count()
        )
        live: set[uuid.UUID] = set()
        for i in range(0, len(ids), CHUNK_SIZE):
            chunk = ids[i : i + CHUNK_SIZE]
            live.update(
                row[0]
                for row in db.query(Attachment.id)
                .filter(Attachment.id.in_(chunk), Attachment.is_deleted.is_(False))
                .all()
            )
        return live, live_total
    finally:
        db.close()


def find_orphans(min_age_seconds: int = MIN_AGE_SECONDS) -> SweepReport:
    report = SweepReport()
    candidates = _scan(attachments_root(), min_age_seconds)
    report.candidates = len(candidates)
    if not candidates:
        return report
    live, report.live_rows = _live_ids([c.attachment_id for c in candidates])
    report.orphans = [c for c in candidates if c.attachment_id not in live]
    if report.orphans and report.live_rows == 0:
        report.refusal = (
            "the attachments table has no live rows: this looks like an empty or "
            "wrong database, not like orphans"
        )
    elif len(report.orphans) > MAX_ORPHAN_RATIO * report.candidates:
        report.refusal = (
            f"{len(report.orphans)} of {report.candidates} candidate files "
            f"({len(report.orphans) * 100 // report.candidates}%) are orphans, more than "
            f"{int(MAX_ORPHAN_RATIO * 100)}%: this looks like the wrong database"
        )
    return report


def quarantine(report: SweepReport, now: datetime | None = None) -> int:
    """Move the orphans of `report` into a fresh quarantine batch; return how many moved."""
    stamp = (now or datetime.now(UTC)).strftime(_STAMP_FORMAT)
    batch = _quarantine_root() / stamp
    moved = 0
    for c in report.orphans:
        target_dir = batch / str(c.workspace_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.rename(c.path, target_dir / str(c.attachment_id))
            moved += 1
        except FileNotFoundError:
            continue  # already gone (a racing delete or a second operator)
        except OSError:
            logger.warning("could not quarantine orphan blob %s", c.path, exc_info=True)
    return moved


def purge_quarantine(
    older_than_days: int, now: datetime | None = None
) -> tuple[int, int, int]:
    """Delete quarantine batches older than N days; return (files, bytes, left_over).

    Only files that are really gone are counted; `left_over` is how many files
    of the selected batches could not be removed.
    """
    qdir = _quarantine_root()
    if not qdir.is_dir():
        return 0, 0, 0
    cutoff = (now or datetime.now(UTC)).timestamp() - older_than_days * 86400
    files = size = left = 0
    with os.scandir(qdir) as it:
        batches = [e for e in it if e.is_dir(follow_symlinks=False)]
    for entry in batches:
        try:
            when = datetime.strptime(entry.name, _STAMP_FORMAT).replace(tzinfo=UTC)
        except ValueError:
            continue
        if when.timestamp() >= cutoff:
            continue
        found: list[tuple[str, int]] = []
        for dirpath, _dirs, names in os.walk(entry.path):
            for name in names:
                path = os.path.join(dirpath, name)
                try:
                    found.append((path, os.lstat(path).st_size))
                except OSError:
                    continue
        shutil.rmtree(entry.path, ignore_errors=True)
        for path, nbytes in found:
            if os.path.lexists(path):
                left += 1
            else:
                files += 1
                size += nbytes
        if os.path.lexists(entry.path) and not any(os.path.lexists(p) for p, _ in found):
            # os.walk skips unreadable directories silently, so a batch can
            # survive with none of its counted files left: still not purged.
            left += 1
    return files, size, left


def _sweep(args: argparse.Namespace) -> int:
    if args.purge_quarantine:
        if args.apply or args.force:
            print("--purge-quarantine cannot be combined with --apply or --force", file=sys.stderr)
            return 2
        if args.older_than_days is None or args.older_than_days < 0:
            print("--purge-quarantine needs --older-than-days N (N >= 0)", file=sys.stderr)
            return 2
        try:
            files, size, left = purge_quarantine(args.older_than_days)
        except QuarantineError as exc:
            print(f"refusing: {exc}", file=sys.stderr)
            return 1
        print(f"purged {files} quarantined file(s), {size} byte(s)")
        if left:
            print(f"{left} file(s) could not be removed and are still there", file=sys.stderr)
            return 1
        return 0
    if args.older_than_days is not None:
        print("--older-than-days only applies with --purge-quarantine", file=sys.stderr)
        return 2
    try:
        report = find_orphans()
    except SQLAlchemyError as exc:
        print(
            f"cannot read the attachments table, nothing was changed: "
            f"{describe_transient_error(exc)}",
            file=sys.stderr,
        )
        return 1
    print(
        f"candidate files: {report.candidates}; orphans: {len(report.orphans)} "
        f"({report.orphan_bytes} byte(s)); live attachment rows: "
        f"{'none' if report.live_rows == 0 else 'present'}"
    )
    if report.refusal and not args.force:
        print(f"refusing to apply: {report.refusal} (override with --force)", file=sys.stderr)
        return 2 if args.apply else 0
    if not args.apply:
        print("dry run: nothing changed (add --apply to quarantine the orphans)")
        return 0
    try:
        moved = quarantine(report)
    except QuarantineError as exc:
        print(f"refusing: {exc}", file=sys.stderr)
        return 1
    print(f"moved {moved} orphan file(s) to {QUARANTINE_DIR}/ inside the attachments root")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m balu.blobs")
    sub = parser.add_subparsers(dest="command", required=True)
    sweep = sub.add_parser("sweep", help="find (and optionally quarantine) orphan blobs")
    sweep.add_argument("--apply", action="store_true", help="move orphans into the quarantine")
    sweep.add_argument("--force", action="store_true", help="skip the safety guards")
    sweep.add_argument("--purge-quarantine", action="store_true")
    sweep.add_argument("--older-than-days", type=int, default=None)
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code or 0) if isinstance(exc.code, int) else 2
    return _sweep(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
