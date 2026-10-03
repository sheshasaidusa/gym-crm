import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from app.core.deps import REFRESH_COOKIE, CurrentContext, DbSession
from app.core.ratelimit import RateLimiter
from app.core.security import decode_token
from app.modules.auth import service
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    AcceptInviteIn,
    AuthOut,
    InvitePreviewOut,
    LoginIn,
    MeOut,
    RefreshIn,
    SignupIn,
    SwitchGymIn,
)
from app.modules.gyms.models import Gym

router = APIRouter(prefix="/auth", tags=["auth"])

# Brakes on password guessing: per IP, and per account so rotating IPs doesn't help.
login_ip_limiter = RateLimiter(20, 60)
login_account_limiter = RateLimiter(
    10, 15 * 60, "Too many sign-in attempts for this account. Try again in 15 minutes."
)
signup_limiter = RateLimiter(10, 60 * 60, "Too many sign-ups from here. Try again later.")
invite_limiter = RateLimiter(20, 60)


@router.post(
    "/signup",
    response_model=AuthOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(signup_limiter)],
)
async def signup(body: SignupIn, response: Response, db: DbSession):
    user, gym = await service.signup(db, body)
    return await service.issue_session(db, response, user, gym.id)


@router.post("/login", response_model=AuthOut, dependencies=[Depends(login_ip_limiter)])
async def login(body: LoginIn, response: Response, db: DbSession):
    login_account_limiter.check(body.email.lower())
    user, gym_id = await service.authenticate(db, body.email, body.password, body.gym_id)
    return await service.issue_session(db, response, user, gym_id)


@router.post("/refresh", response_model=AuthOut)
async def refresh(
    request: Request, response: Response, db: DbSession, body: RefreshIn | None = None
):
    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_token(token, "refresh")
        user = await db.get(User, uuid.UUID(payload["sub"]))
        gym_id = uuid.UUID(payload["gym"])
        if user is None or not user.is_active:
            raise ValueError("inactive user")
        return await service.issue_session(db, response, user, gym_id)
    except (jwt.PyJWTError, KeyError, ValueError, HTTPException):
        # Return (not raise) so the cookie-clearing headers reach the browser.
        expired = JSONResponse({"detail": "Session expired"}, status.HTTP_401_UNAUTHORIZED)
        service.clear_auth_cookies(expired)
        return expired


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    service.clear_auth_cookies(response)


@router.get("/me", response_model=MeOut)
async def me(ctx: CurrentContext, db: DbSession):
    return await service.build_me(db, ctx.user, ctx.gym_id)


@router.post("/switch-gym", response_model=AuthOut)
async def switch_gym(body: SwitchGymIn, ctx: CurrentContext, response: Response, db: DbSession):
    return await service.issue_session(db, response, ctx.user, body.gym_id)


@router.get(
    "/invites/{token}", response_model=InvitePreviewOut, dependencies=[Depends(invite_limiter)]
)
async def preview_invite(token: str, db: DbSession):
    invite = await service.get_valid_invite(db, token)
    gym = await db.get_one(Gym, invite.gym_id)
    existing = await service.get_user_by_email(db, invite.email)
    return InvitePreviewOut(
        gym_name=gym.name, email=invite.email, role=invite.role, existing_user=existing is not None
    )


@router.post(
    "/invites/{token}/accept", response_model=AuthOut, dependencies=[Depends(invite_limiter)]
)
async def accept_invite(token: str, body: AcceptInviteIn, response: Response, db: DbSession):
    invite = await service.get_valid_invite(db, token)
    gym_id = invite.gym_id
    user = await service.accept_invite(db, invite, body.name, body.password)
    return await service.issue_session(db, response, user, gym_id)
