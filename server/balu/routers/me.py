"""Account endpoints: GET/PATCH /me."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import Membership, User, Workspace
from ..schemas.user import MeUpdate, UserOut
from ..schemas.workspace import MembershipOut, MeResponse, WorkspaceOut

router = APIRouter(tags=["account"])


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        locale=user.locale,
        theme=user.theme,
        created_at=user.created_at,
    )


@router.get("/me", response_model=MeResponse)
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeResponse:
    rows = db.execute(
        select(Membership, Workspace)
        .join(Workspace, Workspace.id == Membership.workspace_id)
        .where(Membership.user_id == user.id, Membership.is_deleted.is_(False))
    ).all()
    memberships = [
        MembershipOut(
            workspace=WorkspaceOut(
                id=str(ws.id), name=ws.name, created_at=ws.created_at
            ),
            role=m.role,
        )
        for m, ws in rows
    ]
    return MeResponse(user=_user_out(user), memberships=memberships)


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
    return _user_out(user)
