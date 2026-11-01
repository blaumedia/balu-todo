"""Account endpoints: GET/PATCH /me."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import Membership, User, Workspace
from ..schemas.user import MeUpdate, UserOut, user_out
from ..schemas.workspace import MembershipOut, MeResponse, WorkspaceOut
from ..services import rescue_workspaceless_account

router = APIRouter(tags=["account"])


def _membership_rows(db: Session, user_id):
    return db.execute(
        select(Membership, Workspace)
        .join(Workspace, Workspace.id == Membership.workspace_id)
        .where(Membership.user_id == user_id, Membership.is_deleted.is_(False))
        # Stable, oldest-first: the clients fall back to `memberships[0]` when the
        # workspace they were in disappears, and an arbitrary row order would
        # drop them somewhere different on every call.
        .order_by(Membership.created_at)
    ).all()


@router.get("/me", response_model=MeResponse)
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeResponse:
    rows = _membership_rows(db, user.id)
    if not rows and rescue_workspaceless_account(db, user.id) is not None:
        # Rare path only: the common case is the one query above.
        db.commit()
        rows = _membership_rows(db, user.id)
    memberships = [
        MembershipOut(
            workspace=WorkspaceOut(
                id=str(ws.id), name=ws.name, created_at=ws.created_at
            ),
            role=m.role,
        )
        for m, ws in rows
    ]
    return MeResponse(user=user_out(user), memberships=memberships)


@router.patch("/me", response_model=UserOut)
def patch_me(
    body: MeUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    if body.name is not None:
        user.name = body.name
    if body.locale is not None:
        user.locale = body.locale
    if body.theme is not None:
        user.theme = body.theme
    db.commit()
    db.refresh(user)
    return user_out(user)
