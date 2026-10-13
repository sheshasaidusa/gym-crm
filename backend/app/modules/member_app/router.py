"""The member app API: staff send activation links, members sign in with phone + PIN and see
their own membership, trainer, plan and check-ups. Nothing here exposes other members, money
or staff details beyond the trainer's name and phone."""

import uuid
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.db import as_utc, utcnow
from app.core.deps import (
    MEMBER_REFRESH_COOKIE,
    CurrentMember,
    DbSession,
)
from app.core.permissions import Cap, ctx_with, ensure_member_visible
from app.core.ratelimit import RateLimiter
from app.core.security import decode_token
from app.core.storage import get_storage
from app.modules.ai_plans.content import PlanContent
from app.modules.attendance import service as attendance
from app.modules.attendance.schemas import VisitHistory
from app.modules.audit import service as audit
from app.modules.checkups.models import CheckUp, CheckUpPhoto
from app.modules.gyms.models import Gym
from app.modules.member_app import service
from app.modules.member_app.models import MemberAccount
from app.modules.member_app.schemas import (
    ActivateIn,
    ActivationPreview,
    AppAccessOut,
    AppLinkOut,
    MemberCheckUp,
    MemberLoginIn,
    MemberMe,
    MemberPlan,
    MemberSession,
)
from app.modules.members.models import Member
from app.modules.members.service import gym_today

# --- Staff: manage one member's app access -------------------------------------------------

AccessContext = ctx_with(Cap.MEMBERS_VIEW)  # trainers for their own clients, front desk and up

staff_router = APIRouter(prefix="/members/{member_id}/app-access", tags=["member-app"])


async def _member(db: DbSession, ctx, member_id: uuid.UUID) -> Member:
    member = await db.scalar(
        select(Member).where(Member.gym_id == ctx.gym_id, Member.id == member_id)
    )
    ensure_member_visible(ctx, member)
    return member


def _access(account: MemberAccount | None) -> AppAccessOut:
    if account is None:
        return AppAccessOut(status="none")
    now = utcnow()
    if account.disabled_at is not None:
        return AppAccessOut(status="disabled")
    locked = account.locked_until is not None and as_utc(account.locked_until) > now
    if account.pin_hash is not None:
        return AppAccessOut(
            status="active",
            activated_at=account.activated_at,
            last_login_at=account.last_login_at,
            locked=locked,
        )
    expires = account.activation_expires_at
    live = expires is not None and as_utc(expires) > now
    return AppAccessOut(
        status="invited" if live else "none", link_expires_at=expires if live else None
    )


@staff_router.get("", response_model=AppAccessOut)
async def app_access(member_id: uuid.UUID, ctx: AccessContext, db: DbSession):
    member = await _member(db, ctx, member_id)
    return _access(await service.account_for(db, member))


@staff_router.post("/link", response_model=AppLinkOut)
async def send_link(member_id: uuid.UUID, ctx: AccessContext, db: DbSession):
    """A new activation link. Using it again resets the member's PIN and signs them out."""
    member = await _member(db, ctx, member_id)
    url, expires = await service.issue_link(db, member)
    audit.record(
        db, ctx, "member.app_link", f"Made an app activation link for {member.name}", member.id
    )
    await db.commit()
    return AppLinkOut(url=url, expires_at=expires)


@staff_router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def disable_access(member_id: uuid.UUID, ctx: AccessContext, db: DbSession) -> None:
    member = await _member(db, ctx, member_id)
    account = await service.account_for(db, member)
    if account is None or account.disabled_at is not None:
        return
    account.disabled_at = utcnow()
    account.pin_hash = None
    account.activation_token_hash = None
    account.token_version += 1
    audit.record(
        db, ctx, "member.app_disabled", f"Turned off app access for {member.name}", member.id
    )
    await db.commit()


# --- Members: sign in ----------------------------------------------------------------------

router = APIRouter(prefix="/m", tags=["member-app"])

# Per IP; the per-account lockout lives in the database (see service.check_pin).
auth_limiter = RateLimiter(20, 60)
link_limiter = RateLimiter(30, 60)


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Referrer-Policy"] = "no-referrer"


@router.get(
    "/activate/{token}", response_model=ActivationPreview, dependencies=[Depends(link_limiter)]
)
async def preview_activation(token: str, response: Response, db: DbSession):
    _no_store(response)
    account = await service.account_by_link(db, token)
    member = await db.get_one(Member, account.member_id)
    gym = await db.get_one(Gym, account.gym_id)
    return ActivationPreview(
        gym_name=gym.name,
        brand_color=gym.brand_color,
        logo_url=gym.logo_url,
        first_name=member.name.split()[0],
    )


@router.post("/activate", response_model=MemberSession, dependencies=[Depends(auth_limiter)])
async def activate(body: ActivateIn, response: Response, db: DbSession):
    _no_store(response)
    account = await service.account_by_link(db, body.token)
    account.pin_hash = service.hash_password(body.pin)
    account.activation_token_hash = None  # a link works once
    account.activation_expires_at = None
    account.activated_at = account.last_login_at = utcnow()
    account.failed_attempts = 0
    account.locked_until = None
    member = await db.get_one(Member, account.member_id)
    gym = await db.get_one(Gym, account.gym_id)
    await db.commit()
    service.set_session_cookies(response, account)
    return MemberSession(gym_name=gym.name, first_name=member.name.split()[0])


@router.post("/auth/login", response_model=MemberSession, dependencies=[Depends(auth_limiter)])
async def login(body: MemberLoginIn, response: Response, db: DbSession):
    _no_store(response)
    rows = (
        await db.execute(
            select(MemberAccount, Member, Gym)
            .join(Member, Member.id == MemberAccount.member_id)
            .join(Gym, Gym.id == MemberAccount.gym_id)
            .where(
                Member.phone.in_(service.phone_candidates(body.phone)),
                MemberAccount.pin_hash.is_not(None),
                MemberAccount.disabled_at.is_(None),
            )
        )
    ).all()
    if body.gym_id is not None:
        rows = [r for r in rows if r[0].gym_id == body.gym_id]
    if len(rows) > 1:
        # The same number is a member of several gyms: ask which one before checking the PIN.
        gyms = [{"gym_id": str(g.id), "name": g.name} for _, _, g in rows]
        return JSONResponse({"detail": "Choose your gym", "gyms": gyms}, status.HTTP_409_CONFLICT)
    row = rows[0] if rows else None
    try:
        account = service.check_pin(row[0] if row else None, body.pin)
    except HTTPException:
        await db.commit()  # keep the failed-attempt count
        raise
    account.last_login_at = utcnow()
    await db.commit()
    service.set_session_cookies(response, account)
    return MemberSession(gym_name=row[2].name, first_name=row[1].name.split()[0])


@router.post("/auth/refresh", response_model=MemberSession)
async def refresh(request: Request, response: Response, db: DbSession):
    _no_store(response)
    token = request.cookies.get(MEMBER_REFRESH_COOKIE)
    try:
        if not token:
            raise ValueError("no token")
        payload = decode_token(token, "m_refresh")
        account = await db.scalar(
            select(MemberAccount).where(
                MemberAccount.member_id == uuid.UUID(payload["sub"]),
                MemberAccount.gym_id == uuid.UUID(payload["gym"]),
            )
        )
        if (
            account is None
            or account.pin_hash is None
            or account.disabled_at is not None
            or account.token_version != int(payload["tv"])
        ):
            raise ValueError("revoked")
    except (jwt.PyJWTError, KeyError, ValueError):
        # Return (not raise) so the cookie-clearing headers reach the browser.
        expired = JSONResponse({"detail": "Session expired"}, status.HTTP_401_UNAUTHORIZED)
        service.clear_session_cookies(expired)
        return expired
    member = await db.get_one(Member, account.member_id)
    gym = await db.get_one(Gym, account.gym_id)
    service.set_session_cookies(response, account)
    return MemberSession(gym_name=gym.name, first_name=member.name.split()[0])


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    service.clear_session_cookies(response)


# --- Members: their own data ---------------------------------------------------------------


@router.get("/me", response_model=MemberMe)
async def me(ctx: CurrentMember, response: Response, db: DbSession):
    _no_store(response)
    member = await service.load_member(db, ctx.member.id)
    gym = await db.get_one(Gym, ctx.gym_id)
    today = await gym_today(db, gym.id)
    trainer = await service.trainer_of(db, member)
    checkups = await service.checkups_of(db, member.id)
    plan = await service.published_plan(db, member.id)
    # Due again `checkup_interval_days` after the last one; new members are due now.
    next_checkup = (
        checkups[-1].recorded_on + timedelta(days=gym.checkup_interval_days) if checkups else today
    )
    return MemberMe(
        gym=service.gym_view(gym),
        member_name=member.name,
        first_name=member.name.split()[0],
        trainer_name=trainer.name if trainer else None,
        trainer_phone=trainer.phone if trainer else None,
        membership=service.membership_view(member, today),
        progress=service.progress_view(checkups),
        next_checkup_on=next_checkup,
        has_plan=plan is not None and plan.content is not None,
    )


@router.get("/attendance", response_model=VisitHistory)
async def attendance_history(ctx: CurrentMember, response: Response, db: DbSession):
    _no_store(response)
    return await attendance.history(db, ctx.member.id, await gym_today(db, ctx.gym_id))


@router.get("/plan", response_model=MemberPlan)
async def plan(ctx: CurrentMember, response: Response, db: DbSession):
    _no_store(response)
    published = await service.published_plan(db, ctx.member.id)
    if published is None or not published.content:
        return MemberPlan(plan=None, updated_at=None)
    return MemberPlan(
        plan=PlanContent.model_validate(published.content), updated_at=published.updated_at
    )


@router.get("/checkups", response_model=list[MemberCheckUp])
async def checkups(ctx: CurrentMember, response: Response, db: DbSession):
    _no_store(response)
    rows = await db.scalars(
        select(CheckUp)
        .where(CheckUp.member_id == ctx.member.id, CheckUp.gym_id == ctx.gym_id)
        .options(selectinload(CheckUp.photos))
        .order_by(CheckUp.recorded_on.desc(), CheckUp.created_at.desc())
    )
    return [
        MemberCheckUp(
            id=c.id,
            recorded_on=c.recorded_on,
            weight_kg=c.weight_kg,
            bmi=c.bmi,
            body_fat_pct=c.body_fat_pct,
            muscle_mass_kg=c.muscle_mass_kg,
            chest_cm=c.chest_cm,
            waist_cm=c.waist_cm,
            hips_cm=c.hips_cm,
            arm_cm=c.arm_cm,
            thigh_cm=c.thigh_cm,
            notes=c.notes,
            photos=[f"/api/m/checkup-photos/{p.id}" for p in c.photos],
        )
        for c in rows.all()
    ]


@router.get("/checkup-photos/{photo_id}", response_class=Response)
async def checkup_photo(photo_id: uuid.UUID, ctx: CurrentMember, db: DbSession):
    # Only the member's own photos; anyone else's looks like a missing one.
    photo = await db.scalar(
        select(CheckUpPhoto)
        .join(CheckUp, CheckUp.id == CheckUpPhoto.checkup_id)
        .where(
            CheckUpPhoto.id == photo_id,
            CheckUpPhoto.gym_id == ctx.gym_id,
            CheckUp.member_id == ctx.member.id,
        )
    )
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    storage = get_storage()
    if url := storage.signed_url(photo.storage_key):
        return RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    data = await storage.read(photo.storage_key)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    return Response(
        data,
        media_type=photo.content_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
