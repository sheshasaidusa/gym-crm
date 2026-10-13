import uuid

from fastapi import HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import as_utc, utcnow
from app.core.deps import ACCESS_COOKIE, REFRESH_COOKIE
from app.core.permissions import capabilities
from app.core.security import create_token, hash_password, verify_password
from app.modules.auth.models import User
from app.modules.auth.schemas import AuthOut, GymMembershipOut, MeOut, SignupIn, UserOut
from app.modules.gyms.models import Branch, Gym, Invite, Role, StaffMembership
from app.modules.gyms.schemas import GymOut

# Verified against when the email is unknown so login timing doesn't reveal which emails exist.
_DUMMY_HASH = hash_password("timing-equalizer-password")


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(select(User).where(User.email == email.lower()))


async def signup(db: AsyncSession, body: SignupIn) -> tuple[User, Gym]:
    if await get_user_by_email(db, body.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    gym = Gym(name=body.gym_name, phone=body.phone)
    db.add_all([user, gym])
    await db.flush()
    branch = Branch(gym_id=gym.id, name="Main branch")
    db.add(branch)
    await db.flush()
    db.add(StaffMembership(user_id=user.id, gym_id=gym.id, role=Role.OWNER, branch_id=branch.id))
    await db.commit()
    return user, gym


async def authenticate(
    db: AsyncSession, email: str, password: str, gym_id: uuid.UUID | None
) -> tuple[User, uuid.UUID]:
    user = await get_user_by_email(db, email)
    if user is None:
        verify_password(password, _DUMMY_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if not verify_password(password, user.password_hash) or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    memberships = await list_memberships(db, user.id)
    if not memberships:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account isn't linked to any gym")
    if gym_id is None:
        return user, memberships[0].gym_id
    if all(m.gym_id != gym_id for m in memberships):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this gym")
    return user, gym_id


async def list_memberships(db: AsyncSession, user_id: uuid.UUID) -> list[GymMembershipOut]:
    rows = await db.execute(
        select(StaffMembership.gym_id, Gym.name, StaffMembership.role)
        .join(Gym, Gym.id == StaffMembership.gym_id)
        .where(StaffMembership.user_id == user_id, StaffMembership.is_active)
        .order_by(StaffMembership.created_at)
    )
    return [GymMembershipOut(gym_id=g, gym_name=n, role=r) for g, n, r in rows.all()]


async def build_me(db: AsyncSession, user: User, gym_id: uuid.UUID) -> MeOut:
    memberships = await list_memberships(db, user.id)
    current = next((m for m in memberships if m.gym_id == gym_id), None)
    if current is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this gym")
    gym = await db.get_one(Gym, gym_id)
    branch_id = await db.scalar(
        select(StaffMembership.branch_id).where(
            StaffMembership.user_id == user.id, StaffMembership.gym_id == gym_id
        )
    )
    return MeOut(
        user=UserOut.model_validate(user),
        gym=GymOut.model_validate(gym),
        role=current.role,
        branch_id=branch_id,
        capabilities=capabilities(current.role),
        gyms=memberships,
    )


async def issue_session(
    db: AsyncSession, response: Response, user: User, gym_id: uuid.UUID
) -> AuthOut:
    """Builds the auth payload and sets httpOnly cookies for the browser app."""
    me = await build_me(db, user, gym_id)
    access = create_token(user.id, gym_id, "access")
    refresh = create_token(user.id, gym_id, "refresh")
    set_auth_cookies(response, access, refresh)
    return AuthOut(**me.model_dump(), access_token=access, refresh_token=refresh)


def set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    common = {"httponly": True, "secure": settings.cookie_secure, "samesite": "lax"}
    response.set_cookie(
        ACCESS_COOKIE, access, max_age=settings.access_token_minutes * 60, path="/", **common
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=settings.refresh_token_days * 86400,
        path="/",
        **common,
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/")


async def get_valid_invite(db: AsyncSession, token: str) -> Invite:
    invite = await db.scalar(select(Invite).where(Invite.token == token))
    if invite is None or invite.accepted_at is not None or as_utc(invite.expires_at) < utcnow():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invite link is invalid or has expired")
    return invite


async def accept_invite(db: AsyncSession, invite: Invite, name: str | None, password: str) -> User:
    user = await get_user_by_email(db, invite.email)
    if user is None:
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Please enter your name")
        user = User(email=invite.email, name=name, password_hash=hash_password(password))
        db.add(user)
        await db.flush()
    elif not verify_password(password, user.password_hash):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "You already have an account. Enter its password."
        )
    exists = await db.scalar(
        select(StaffMembership.id).where(
            StaffMembership.user_id == user.id, StaffMembership.gym_id == invite.gym_id
        )
    )
    if not exists:
        db.add(
            StaffMembership(
                user_id=user.id, gym_id=invite.gym_id, role=invite.role, branch_id=invite.branch_id
            )
        )
    invite.accepted_at = utcnow()
    await db.commit()
    return user
