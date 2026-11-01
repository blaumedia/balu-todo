"""Filesystem storage for attachment blobs.

Layout: `{BALU_DATA_DIR}/attachments/{workspace_id}/{attachment_id}` - a flat
uuid with no extension. The original filename and the content type are database
columns, so nothing the uploader controls ever becomes a path component; the
only way to name a file here is to own the row it belongs to.

Blob removal is always best-effort: the database is the authority on what
exists, and a leftover or missing file degrades to a 404 on download rather
than to an inconsistent workspace.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import time
import uuid
from pathlib import Path

from .config import get_settings

logger = logging.getLogger("balu.attachments")

#: Matches the `filename` column (String(255)).
MAX_FILENAME = 255
#: Matches the `content_type` column (String(128)).
MAX_CONTENT_TYPE = 128
DEFAULT_CONTENT_TYPE = "application/octet-stream"

# A conservative `type/subtype` with optional parameters. The value is echoed
# into a response header by the download endpoint, so anything carrying a
# newline (or simply not looking like a media type) is replaced rather than
# trusted.
_CONTENT_TYPE_RE = re.compile(r"^[\w.+-]+/[\w.+-]+(\s*;\s*[\w.+-]+=[^\s;]+)*$")


def attachments_root() -> Path:
    return Path(get_settings().data_dir) / "attachments"


def workspace_dir(workspace_id: uuid.UUID) -> Path:
    return attachments_root() / str(workspace_id)


def blob_path(workspace_id: uuid.UUID, attachment_id: uuid.UUID) -> Path:
    return workspace_dir(workspace_id) / str(attachment_id)


def max_bytes() -> int:
    return get_settings().max_attachment_mb * 1024 * 1024


def sanitize_filename(name: str | None) -> str:
    """Reduce a client-supplied name to a bare, printable basename.

    Browsers send a plain name, but nothing stops a client from sending
    `../../etc/passwd` or an embedded NUL. The result is only ever used as
    display text and as the `Content-Disposition` filename, never as a path,
    but it is normalised here so that stays true by construction.
    """
    raw = (name or "").replace("\\", "/")
    base = os.path.basename(raw)
    base = "".join(ch for ch in base if ch.isprintable()).strip()
    if base in ("", ".", ".."):
        base = "file"
    return base[:MAX_FILENAME]


def sanitize_content_type(value: str | None) -> str:
    value = (value or "").strip()
    if not value or len(value) > MAX_CONTENT_TYPE or not _CONTENT_TYPE_RE.match(value):
        return DEFAULT_CONTENT_TYPE
    return value


def remove_blob(workspace_id: uuid.UUID, attachment_id: uuid.UUID) -> None:
    """Delete one blob if it is there (best-effort)."""
    path = blob_path(workspace_id, attachment_id)
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("could not remove attachment blob %s", path, exc_info=True)


def remove_workspace_blobs(workspace_id: uuid.UUID) -> None:
    """Delete a whole workspace's blob directory (best-effort).

    `DELETE /workspaces/{id}` is a hard delete: the rows go with an FK cascade,
    and without this the bytes would outlive them with nothing left pointing at
    them.
    """
    shutil.rmtree(workspace_dir(workspace_id), ignore_errors=True)


#: A blob is written before its row commits, so a young file without a live row
#: may be an upload in flight. An upload is bounded by the size cap and writes
#: continuously (each write refreshes the mtime); an hour is far beyond that.
ORPHAN_MIN_AGE_SECONDS = 3600


def sweep_orphan_blobs(min_age_seconds: int = ORPHAN_MIN_AGE_SECONDS) -> int:
    """Remove blob files with no live attachment row (best-effort), return the count.

    Covers a process that died between a delete's commit and the file removal.
    Only files older than `min_age_seconds` are considered, and anything that
    does not look like `{workspace_uuid}/{attachment_uuid}` is left alone.
    """
    from .db import get_sessionmaker
    from .models import Attachment

    root = attachments_root()
    if not root.is_dir():
        return 0
    candidates: list[tuple[uuid.UUID, uuid.UUID, Path]] = []
    cutoff = time.time() - min_age_seconds
    for ws_dir in root.iterdir():
        try:
            ws_id = uuid.UUID(ws_dir.name)
            if not ws_dir.is_dir():
                continue
            for f in ws_dir.iterdir():
                try:
                    att_id = uuid.UUID(f.name)
                    if f.is_file() and f.stat().st_mtime < cutoff:
                        candidates.append((ws_id, att_id, f))
                except (ValueError, OSError):
                    continue
        except (ValueError, OSError):
            continue
    if not candidates:
        return 0
    db = get_sessionmaker()()
    try:
        live = {
            row[0]
            for row in db.query(Attachment.id)
            .filter(Attachment.id.in_([c[1] for c in candidates]), Attachment.is_deleted.is_(False))
            .all()
        }
    finally:
        db.close()
    removed = 0
    for _ws_id, att_id, f in candidates:
        if att_id in live:
            continue
        try:
            f.unlink()
            removed += 1
        except OSError:
            logger.warning("could not remove orphan blob %s", f, exc_info=True)
    if removed:
        logger.info("orphan blob sweep removed %d file(s)", removed)
    return removed
