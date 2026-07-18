"""The sync endpoint: POST /workspaces/{id}/sync."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db, get_sessionmaker
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
) -> SyncResponse:
    ws_id = _parse_ws_id(workspace_id)
    membership = get_membership(db, ws_id, user.id)

    # Apply commands first (each in its own transaction via the sessionmaker).
    sm = get_sessionmaker()
    sync_status, temp_id_mapping = process_commands(
        sm, ws_id, user.id, membership.role, body.commands
    )

    # Then read the (post-command) changes for this client.
    since = decode_token(body.sync_token)
    full_sync = since is None
    changes = collect_changes(db, ws_id, since)
    token = encode_token(current_version(db, ws_id))

    return SyncResponse(
        sync_token=token,
        full_sync=full_sync,
        sync_status=sync_status,
        temp_id_mapping=temp_id_mapping,
        projects=changes["projects"],
        sections=changes["sections"],
        tasks=changes["tasks"],
        labels=changes["labels"],
        members=changes["members"],
    )
