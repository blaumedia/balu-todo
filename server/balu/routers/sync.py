"""The sync endpoint: POST /workspaces/{id}/sync."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db, get_sessionmaker
from ..events import EventSender, get_event_sender
from ..models import User
from ..schemas.sync import SyncRequest, SyncResponse
from ..sync.commands import process_commands
from ..sync.engine import collect_changes, current_version, decode_token, encode_token
from .workspaces import _parse_ws_id, get_membership

router = APIRouter(prefix="/workspaces", tags=["sync"])


@router.post("/{workspace_id}/sync", response_model=SyncResponse)
def sync(
    workspace_id: str,
    body: SyncRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    event_sender: EventSender = Depends(get_event_sender),
) -> SyncResponse:
    ws_id = _parse_ws_id(workspace_id)
    membership = get_membership(db, ws_id, user.id)

    # Apply commands first (each in its own transaction via the sessionmaker).
    sm = get_sessionmaker()
    sync_status, temp_id_mapping = process_commands(
        sm, ws_id, user.id, membership.role, body.commands, event_sender=event_sender
    )

    # Then read the (post-command) changes for this client.
    since = decode_token(body.sync_token)
    full_sync = since is None

    # Read the version counter FIRST and use it as the upper bound of the
    # collection, never the other way round. Under READ COMMITTED each statement
    # gets its own snapshot, so reading the rows first and the counter second
    # meant a write committing in between (another device's upload or command -
    # its version bump and its row commit together) advanced this client's token
    # past a row it was never sent. The client persists that token, so no later
    # incremental pull and no restart ever asked for that version again and the
    # object stayed invisible on that device forever.
    #
    # Bounding the other way is safe: anything above `token_version` is simply
    # delivered by the next sync. Delivery is at-least-once and clients upsert
    # by id, so a repeat is a no-op - being sent twice is free, being skipped is
    # permanent.
    token_version = current_version(db, ws_id)
    changes = collect_changes(db, ws_id, since, upper=token_version)
    token = encode_token(token_version)

    return SyncResponse(
        sync_token=token,
        full_sync=full_sync,
        sync_status=sync_status,
        temp_id_mapping=temp_id_mapping,
        projects=changes["projects"],
        sections=changes["sections"],
        tasks=changes["tasks"],
        labels=changes["labels"],
        comments=changes["comments"],
        attachments=changes["attachments"],
        members=changes["members"],
    )
