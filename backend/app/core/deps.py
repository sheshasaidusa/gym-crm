import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.security import decode_token
from app.modules.auth.models import User
from app.modules.gyms.models import Role, StaffMembership
from app.modules.members.models import Member

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
MEMBER_ACCESS_COOKIE = "m_access"
MEMBER_REFRESH_COOKIE = "m_refresh"

DbSession = Annotated[AsyncSession, Depends(get_db)]


@dataclass(frozen=True)
class TenantContext:
    """Who is calling and which gym they are acting in. Every tenant query uses gym_id."""

    user: User
    gym_id: uuid.UUID
    role: Role
    branch_id: uuid.UUID | None


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _extract_access_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(ACCESS_COOKIE)


async def get_tenant_context(request: Request, db: DbSession) -> TenantContext:
    token = _extract_access_token(request)
    if not token:
        raise _unauthorized()
    try:
        payload = decode_token(token, "access")
        user_id = uuid.UUID(payload["sub"])
        gym_id = uuid.UUID(payload["gym"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise _unauthorized("Invalid or expired token") from exc

    # Role comes from the database, not the token, so role changes and removals apply at once.
    membership = await db.scalar(
        select(StaffMembership).where(
            StaffMembership.user_id == user_id, StaffMembership.gym_id == gym_id
        )
    )
    if membership is None or not membership.is_active or not membership.user.is_active:
        raise _unauthorized("No access to this gym")
    return TenantContext(
        user=membership.user, gym_id=gym_id, role=membership.role, branch_id=membership.branch_id
    )


CurrentContext = Annotated[TenantContext, Depends(get_tenant_context)]


@dataclass(frozen=True)
class MemberContext:
    """A gym member signed in to the member app. It carries no staff role and can only
    reach /api/m/* routes; staff tokens are rejected there too."""

    member: Member
    gym_id: uuid.UUID


async def get_member_context(request: Request, db: DbSession) -> MemberContext:
    from app.modules.member_app.models import MemberAccount

    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else None
    token = token or request.cookies.get(MEMBER_ACCESS_COOKIE)
    if not token:
        raise _unauthorized()
    try:
        payload = decode_token(token, "m_access")
        member_id = uuid.UUID(payload["sub"])
        gym_id = uuid.UUID(payload["gym"])
        version = int(payload["tv"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise _unauthorized("Invalid or expired token") from exc

    # Checked against the database so disabling access or resetting a PIN signs them out at once.
    account = await db.scalar(
        select(MemberAccount).where(
            MemberAccount.member_id == member_id, MemberAccount.gym_id == gym_id
        )
    )
    if (
        account is None
        or account.disabled_at is not None
        or account.pin_hash is None
        or account.token_version != version
    ):
        raise _unauthorized("Session expired")
    member = await db.get(Member, member_id)
    if member is None:
        raise _unauthorized("Session expired")
    return MemberContext(member=member, gym_id=gym_id)


CurrentMember = Annotated[MemberContext, Depends(get_member_context)]


def require_roles(*roles: Role) -> Callable:
    async def checker(ctx: CurrentContext) -> TenantContext:
        if ctx.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission to do this")
        return ctx

    return checker


ManagerContext = Annotated[TenantContext, Depends(require_roles(Role.OWNER, Role.MANAGER))]
OwnerContext = Annotated[TenantContext, Depends(require_roles(Role.OWNER))]
