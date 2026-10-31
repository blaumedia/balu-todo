"""Attachment blob transfer (§3.7) - the only workspace data that is not sync.

Metadata travels through the sync endpoint like every other resource, so a
client can render the attachment list of a task offline. The bytes do not:
upload and download are plain online-only REST, because pushing megabytes
through a command queue that is replayed on every reconnect is a different
product.

**The upload endpoint deliberately declares no `File()`/`Form()` parameters.**
FastAPI awaits `request.form()` in its request handler *before* it solves
dependencies, and Starlette's multipart parser spools file parts to a temporary
file with no size limit of its own. Declaring those parameters therefore lets an
**unauthenticated** caller write an arbitrarily large body to the server's disk
and only then be told "401" - the auth dependency never gets a say. Taking a
bare `Request` keeps FastAPI away from the body entirely: the dependencies (and
with them authentication, membership and the role check) run first, and this
module then parses the stream itself, enforcing the cap as the bytes arrive.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import FileResponse
from python_multipart.exceptions import FormParserError
from python_multipart.multipart import MultipartParser, parse_options_header
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from ..attachments import (
    blob_path,
    max_bytes,
    sanitize_content_type,
    sanitize_filename,
)
from ..auth import get_current_user
from ..db import get_db, get_sessionmaker
from ..errors import forbidden, not_found, too_large, validation_error
from ..models import Attachment, Task, User
from ..services import require_member_under_lock
from ..sync.engine import ROLE_RANK, bump_version
from ..sync.serialize import serialize_attachment
from .workspaces import _parse_ws_id, get_membership

logger = logging.getLogger("balu.attachments")

router = APIRouter(prefix="/workspaces", tags=["attachments"])

#: Room for the multipart envelope itself (boundaries, part headers, the
#: `task_id` field) on top of the file's own byte cap, so a legitimate upload of
#: exactly `max_attachment_mb` is never rejected for its packaging.
ENVELOPE_OVERHEAD = 64 * 1024

#: Non-file fields are held in memory. Nothing legitimate here is longer than a
#: uuid, so this only has to be generous enough not to matter.
MAX_FIELD_BYTES = 4096


class _TooLarge(Exception):
    """Internal signal: the upload crossed the cap mid-stream."""


class _BadUpload(Exception):
    """Internal signal: the body is not a usable single-file multipart form."""


class _UploadSink:
    """Streaming multipart receiver.

    The file part goes straight to its final path as it arrives - never through
    a temporary spool and never fully into memory - while small form fields are
    buffered so `task_id` can be read once the body is complete.
    """

    def __init__(self, destination: Path, limit: int) -> None:
        self._destination = destination
        self._limit = limit
        self._handle: Any = None

        self._header_field = b""
        self._header_value = b""
        self._headers: dict[bytes, bytes] = {}
        self._field_name: str | None = None
        self._field_buffer = b""
        self._is_file = False

        self.file_started = False
        self.file_completed = False
        self.ended = False
        self.file_bytes = 0
        self.filename: str | None = None
        self.content_type: str | None = None
        self.fields: dict[str, str] = {}

    # -- part headers -----------------------------------------------------
    def on_part_begin(self) -> None:
        self._headers = {}
        self._header_field = b""
        self._header_value = b""
        self._field_name = None
        self._field_buffer = b""
        self._is_file = False

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self._header_field += data[start:end]

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self._header_value += data[start:end]

    def on_header_end(self) -> None:
        self._headers[self._header_field.lower()] = self._header_value
        self._header_field = b""
        self._header_value = b""

    def on_headers_finished(self) -> None:
        _, options = parse_options_header(self._headers.get(b"content-disposition", b""))
        name = options.get(b"name")
        filename = options.get(b"filename")
        self._field_name = name.decode("utf-8", "replace") if name else None
        self._is_file = filename is not None
        if not self._is_file:
            return
        if self.file_started:
            raise _BadUpload("only one file part is accepted")
        self.file_started = True
        self.filename = filename.decode("utf-8", "replace") if filename else None
        ctype = self._headers.get(b"content-type")
        self.content_type = ctype.decode("latin-1") if ctype else None
        self._handle = self._destination.open("wb")

    # -- part body --------------------------------------------------------
    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        chunk = data[start:end]
        if self._is_file:
            self.file_bytes += len(chunk)
            if self.file_bytes > self._limit:
                # The moment the cap is crossed, not after the body finishes.
                raise _TooLarge
            self._handle.write(chunk)
            return
        self._field_buffer += chunk
        if len(self._field_buffer) > MAX_FIELD_BYTES:
            raise _BadUpload("form field is too large")

    def on_part_end(self) -> None:
        if self._is_file:
            self.file_completed = True
            self.close()
        elif self._field_name is not None:
            self.fields[self._field_name] = self._field_buffer.decode("utf-8", "replace")
        self._field_buffer = b""

    def on_end(self) -> None:
        self.ended = True

    def close(self) -> None:
        if self._handle is not None:
            self._handle.close()
            self._handle = None

    def callbacks(self) -> dict[str, Any]:
        return {
            "on_part_begin": self.on_part_begin,
            "on_header_field": self.on_header_field,
            "on_header_value": self.on_header_value,
            "on_header_end": self.on_header_end,
            "on_headers_finished": self.on_headers_finished,
            "on_part_data": self.on_part_data,
            "on_part_end": self.on_part_end,
            "on_end": self.on_end,
        }


def _parse_attachment_id(attachment_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(attachment_id)
    except ValueError:
        raise not_found("attachment not found") from None


def _get_task(db: Session, ws_id: uuid.UUID, task_id: str) -> Task:
    try:
        tid = uuid.UUID(task_id)
    except (ValueError, AttributeError, TypeError):
        raise not_found("task not found") from None
    task = db.get(Task, tid)
    # A task of another workspace is "not found", not "forbidden": the caller
    # must not be able to probe ids across workspace boundaries.
    if task is None or task.is_deleted or task.workspace_id != ws_id:
        raise not_found("task not found")
    return task


def _boundary(request: Request) -> bytes:
    content_type, options = parse_options_header(
        request.headers.get("content-type", "").encode("latin-1")
    )
    if content_type != b"multipart/form-data" or not options.get(b"boundary"):
        raise validation_error("expected a multipart/form-data body")
    return options[b"boundary"]


def _declared_length_within(request: Request, ceiling: int) -> None:
    """Refuse an announced-oversized body before reading a single byte.

    Only an optimisation: a client is free to lie or to omit the header (chunked
    transfer), which is why the streaming counters below are the real guard.
    """
    declared = request.headers.get("content-length")
    if declared is None:
        return
    try:
        length = int(declared)
    except ValueError:
        raise validation_error("invalid Content-Length") from None
    if length > ceiling:
        raise too_large(f"File exceeds the {max_bytes() // (1024 * 1024)} MB limit")


def _authorize_upload(db: Session, ws_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Pre-stream gate (threadpool). Not authoritative: `_store_attachment` judges
    again under the lock once the body is in."""
    try:
        membership = get_membership(db, ws_id, user_id)
        if ROLE_RANK.get(membership.role, 0) < ROLE_RANK["member"]:
            raise forbidden("viewer role is read-only")
    finally:
        # End the transaction auth and this check opened: otherwise the pooled
        # connection sits idle in transaction for as long as the body streams.
        db.rollback()


class _Claim:
    """Atomic hand-over of the blob between the handler and the worker thread.

    Exactly one side wins: the worker `start()`s (and owns the blob) or the
    handler `abandon()`s (and unlinks the blob). A worker that loses never
    opens a session. The worker uses a session of its own, so the request
    session that the dependency teardown closes (possibly while the worker is
    still running, on a native task cancellation) is never shared with it.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = "pending"

    def start(self) -> bool:
        with self._lock:
            if self._state != "pending":
                return False
            self._state = "started"
            return True

    def abandon(self) -> bool:
        with self._lock:
            if self._state != "pending":
                return False
            self._state = "abandoned"
            return True


def _store_attachment(
    ws_id: uuid.UUID,
    user_id: uuid.UUID,
    attachment_id: uuid.UUID,
    path: Path,
    task_ref: str,
    sink: _UploadSink,
    claim: _Claim,
) -> dict[str, Any]:
    """Everything after the body (threadpool): lock, re-judge, store.

    Every statement here can wait on the workspace lock for as long as a
    concurrent command holds it; on the event loop that wait stalled every
    request the process was serving.
    """
    if not claim.start():
        raise asyncio.CancelledError
    db = get_sessionmaker()()
    try:
        return _store_with_session(db, ws_id, user_id, attachment_id, path, task_ref, sink)
    finally:
        db.close()


def _store_with_session(
    db: Session,
    ws_id: uuid.UUID,
    user_id: uuid.UUID,
    attachment_id: uuid.UUID,
    path: Path,
    task_ref: str,
    sink: _UploadSink,
) -> dict[str, Any]:
    committing = False
    try:
        # After the stream, not during it: the parts may arrive in any order, so
        # this is the first point at which `task_id` is guaranteed to be known.
        # The write it may discard is bounded by the cap and is only reachable
        # by a caller who is already an authenticated, writable member.
        # Workspace lock first (as every sync command does), then the caller
        # again: a member removed or demoted to viewer, or a workspace deleted,
        # while the body streamed must not get the upload stored. The task
        # lookup comes after the lock too, so a task_delete or project_delete
        # still in flight is committed, and its cascade complete, before the
        # task is looked up: no attachment lands on a deleted task.
        require_member_under_lock(db, ws_id, user_id, "member", "viewer role is read-only")
        version = bump_version(db, ws_id)
        task = _get_task(db, ws_id, task_ref)

        attachment = Attachment(
            id=attachment_id,
            workspace_id=ws_id,
            task_id=task.id,
            filename=sanitize_filename(sink.filename),
            content_type=sanitize_content_type(sink.content_type),
            size_bytes=sink.file_bytes,
            created_by=user_id,
            # A fresh workspace version, exactly as a command would take: without
            # it the row carries version 0 and no incremental sync ever reports
            # the new attachment.
            version=version,
        )
        db.add(attachment)
        # Flushed apart from the commit: a flush failure (constraint, data error)
        # is a definite rollback, and only the COMMIT itself has an unknown
        # outcome once it is sent.
        db.flush()
        committing = True
        db.commit()
    except Exception:
        db.rollback()
        # A failure before the commit is a definite rollback. A commit whose
        # acknowledgement was lost may still have reached the server, and the
        # blob of a committed row must stay: that outcome is unknown, so the
        # blob is kept (an orphan file is the lesser harm, and a check from a
        # fresh session could run before the in-flight commit is visible).
        if not committing:
            path.unlink(missing_ok=True)
        raise
    # After the commit and outside the try: a failure here must not delete the
    # blob of a committed row.
    db.refresh(attachment)
    # The serializer, not a response_model: the sync payload and this response
    # are the same object shape, and one of them drifting is a client bug.
    return serialize_attachment(attachment)


@router.post(
    "/{workspace_id}/attachments",
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    workspace_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    # Everything in this block runs before a single body byte is read - that is
    # the whole point of taking a bare `Request` (see the module docstring).
    ws_id = _parse_ws_id(workspace_id)
    # Captured before the rollback in `_authorize_upload` expires `user`, so
    # nothing lazy-loads on the event loop.
    user_id = user.id
    await run_in_threadpool(_authorize_upload, db, ws_id, user_id)

    limit = max_bytes()
    ceiling = limit + ENVELOPE_OVERHEAD
    boundary = _boundary(request)
    _declared_length_within(request, ceiling)

    attachment_id = uuid.uuid4()
    path = blob_path(ws_id, attachment_id)
    path.parent.mkdir(parents=True, exist_ok=True)

    sink = _UploadSink(path, limit)
    # Deliberately no `max_size` on the parser: when its own limit is crossed it
    # *silently truncates* the data it forwards rather than raising, which would
    # store a corrupted file and report success. The two counters below are the
    # guard, and they reject instead of truncating.
    parser = MultipartParser(boundary, sink.callbacks())

    total = 0
    try:
        async for chunk in request.stream():
            total += len(chunk)
            if total > ceiling:
                raise _TooLarge
            parser.write(chunk)
        parser.finalize()
    except _TooLarge:
        sink.close()
        path.unlink(missing_ok=True)
        raise too_large(f"File exceeds the {limit // (1024 * 1024)} MB limit") from None
    except _BadUpload as exc:
        sink.close()
        path.unlink(missing_ok=True)
        raise validation_error(str(exc)) from None
    except FormParserError:
        # A body that is not well-formed multipart is the client's mistake, not
        # a server fault - without this it would surface as a 500.
        sink.close()
        path.unlink(missing_ok=True)
        raise validation_error("malformed multipart body") from None
    except ClientDisconnect:
        # The client went away mid-body. Not a server fault, so it must not
        # escape as an unhandled exception (uvicorn would log it as an ERROR
        # with a traceback). The response cannot reach the client; the 4xx only
        # keeps the ASGI app from treating it as a crash.
        sink.close()
        path.unlink(missing_ok=True)
        logger.info("upload aborted by client: workspace=%s bytes_received=%d", ws_id, total)
        raise validation_error("upload aborted") from None
    except Exception:
        # Anything else (a full disk, an unexpected I/O error): never leave the
        # half-written blob behind.
        sink.close()
        path.unlink(missing_ok=True)
        raise
    finally:
        sink.close()

    task_ref = sink.fields.get("task_id")
    if not sink.file_started or task_ref is None:
        path.unlink(missing_ok=True)
        raise validation_error("task_id and file are required")
    if not (sink.file_completed and sink.ended):
        # `MultipartParser.finalize()` is a no-op - its own docstring notes that
        # it does not yet verify the message ended well-formed - so a body cut
        # off mid-part fires neither `on_part_end` nor `on_end`, and the bytes
        # still held in the parser's boundary lookbehind are never flushed.
        # Without this check a truncated upload commits a silently corrupt blob
        # whose `size_bytes` matches the truncation, reported as a 201.
        path.unlink(missing_ok=True)
        raise validation_error("truncated or incomplete multipart body")

    claim = _Claim()
    try:
        return await run_in_threadpool(
            _store_attachment, ws_id, user_id, attachment_id, path, task_ref, sink, claim
        )
    except BaseException:
        # Any failure before the worker thread took the job (cancelled at
        # anyio's checkpoint or while waiting for a threadpool token, a
        # threadpool error, or a native `task.cancel()` such as uvicorn's
        # graceful-shutdown timeout after the job was queued but before the
        # worker ran it - anyio's shield does not stop that, and this claim
        # decides the race, so do not replace it with a plain flag): nothing
        # was committed and the thread never owned the blob. A worker that
        # already claimed the job handles its own blob and its own session.
        if claim.abandon():
            path.unlink(missing_ok=True)
        raise


@router.get("/{workspace_id}/attachments/{attachment_id}/file")
def download_attachment(
    workspace_id: str,
    attachment_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    ws_id = _parse_ws_id(workspace_id)
    get_membership(db, ws_id, user.id)  # any role, including viewer
    aid = _parse_attachment_id(attachment_id)

    attachment = db.get(Attachment, aid)
    if attachment is None or attachment.is_deleted or attachment.workspace_id != ws_id:
        raise not_found("attachment not found")

    path = blob_path(ws_id, attachment.id)
    if not path.is_file():
        # Row without bytes: a torn upload or a restored database on an empty
        # volume. Nothing to serve, and nothing the caller can do about it.
        raise not_found("attachment not found")

    return FileResponse(
        str(path),
        media_type=attachment.content_type,
        # `filename=` makes this `Content-Disposition: attachment`, so a stored
        # `text/html` upload is downloaded rather than rendered in the origin
        # that holds everyone's session. `nosniff` closes the other half: without
        # it a browser may ignore the declared type and execute what it guesses.
        filename=attachment.filename,
        headers={"X-Content-Type-Options": "nosniff"},
    )
