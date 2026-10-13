"""Member-facing views and the PIN login rules. The public /p/{token} page and the member app
share the same summary code so they can never disagree about what a member sees."""

import hashlib
import re
import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.db import as_utc, utcnow
from app.core.deps import MEMBER_ACCESS_COOKIE, MEMBER_REFRESH_COOKIE
from app.core.security import (
    create_member_token,
    generate_url_token,
    hash_password,
    verify_password,
)
from app.modules.ai_plans.models import AIPlan, PlanStatus
from app.modules.auth.models import User
from app.modules.checkups.models import CheckUp
from app.modules.gyms.models import Gym
from app.modules.member_app.models import MemberAccount
from app.modules.member_app.schemas import (
    Point,
    PublicGym,
    PublicMembership,
    PublicProgress,
)
from app.modules.members.models import Member
from app.modules.members.service import days_left
from app.modules.members.status import Status, membership_status, pick_current

ACTIVATION_HOURS = 72
SOFT_LOCK_AFTER = 5  # wrong PINs before a 15 minute pause
SOFT_LOCK_MINUTES = 15
HARD_LOCK_AFTER = 10  # wrong PINs before staff must send a new link
HARD_LOCK_YEARS = 100  # "until a new link is issued", which clears it

# Verified when no account matches so "unknown phone" costs the same time as "wrong PIN".
_DUMMY_HASH = hash_password("0000-not-a-real-pin")


# --- What a member sees ---------------------------------------------------------------------


def gym_view(gym: Gym) -> PublicGym:
    return PublicGym(
        name=gym.name, brand_color=gym.brand_color, logo_url=gym.logo_url, phone=gym.phone
    )


def membership_view(member: Member, today) -> PublicMembership | None:
    current = pick_current(member.memberships, today)
    if current is None:
        return None
    renewal = min(
        (
            m.start_date
            for m in member.memberships
            if m.cancelled_at is None and m.start_date > current.end_date
        ),
        default=None,
    )
    state = membership_status(current, today)
    return PublicMembership(
        plan_name=current.plan_name,
        status=state,
        start_date=current.start_date,
        end_date=current.end_date,
        days_left=days_left(current, today),
        frozen_until=current.freeze_end if state == Status.FROZEN else None,
        renewal_starts=renewal,
    )


def progress_view(checkups: list[CheckUp]) -> PublicProgress | None:
    if not checkups:
        return None
    first, last = checkups[0], checkups[-1]
    weights = [c for c in checkups if c.weight_kg is not None]
    return PublicProgress(
        checkups=len(checkups),
        latest_date=last.recorded_on,
        weight_kg=last.weight_kg,
        body_fat_pct=last.body_fat_pct,
        bmi=last.bmi,
        waist_cm=last.waist_cm,
        weight_change_kg=round(weights[-1].weight_kg - weights[0].weight_kg, 1)
        if len(weights) > 1
        else None,
        first_date=first.recorded_on,
        weight_series=[Point(date=c.recorded_on, value=c.weight_kg) for c in weights],
    )


async def load_member(db: AsyncSession, member_id: uuid.UUID) -> Member:
    return await db.scalar(
        select(Member).where(Member.id == member_id).options(selectinload(Member.memberships))
    )


async def published_plan(db: AsyncSession, member_id: uuid.UUID) -> AIPlan | None:
    return await db.scalar(
        select(AIPlan).where(AIPlan.member_id == member_id, AIPlan.status == PlanStatus.PUBLISHED)
    )


async def checkups_of(db: AsyncSession, member_id: uuid.UUID) -> list[CheckUp]:
    return list(
        (
            await db.scalars(
                select(CheckUp).where(CheckUp.member_id == member_id).order_by(CheckUp.recorded_on)
            )
        ).all()
    )


async def trainer_of(db: AsyncSession, member: Member) -> User | None:
    return await db.get(User, member.trainer_id) if member.trainer_id else None


# --- Accounts and PINs ----------------------------------------------------------------------


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def activation_url(token: str) -> str:
    return f"{settings.frontend_url}/m/activate/{token}"


async def account_for(db: AsyncSession, member: Member) -> MemberAccount | None:
    return await db.scalar(select(MemberAccount).where(MemberAccount.member_id == member.id))


async def issue_link(db: AsyncSession, member: Member) -> tuple[str, datetime]:
    """A fresh activation link. It resets the PIN and signs the member out everywhere, so a
    lost phone or a forgotten PIN is fixed the same way: send a new link."""
    account = await account_for(db, member)
    if account is None:
        account = MemberAccount(gym_id=member.gym_id, member_id=member.id)
        db.add(account)
    token = generate_url_token()
    expires = utcnow() + timedelta(hours=ACTIVATION_HOURS)
    account.activation_token_hash = token_hash(token)
    account.activation_expires_at = expires
    account.pin_hash = None
    account.failed_attempts = 0
    account.locked_until = None
    account.disabled_at = None
    account.token_version = (account.token_version or 0) + 1
    await db.flush()
    return activation_url(token), expires


async def account_by_link(db: AsyncSession, token: str) -> MemberAccount:
    account = await db.scalar(
        select(MemberAccount).where(MemberAccount.activation_token_hash == token_hash(token))
    )
    expires = account.activation_expires_at if account else None
    if (
        account is None
        or account.disabled_at is not None
        or expires is None
        or as_utc(expires) < utcnow()
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link isn't valid anymore")
    return account


def phone_candidates(phone: str) -> set[str]:
    """Members' phones are stored as typed ("+91..." or bare digits); match every spelling.
    A bare 10-digit number is assumed to be Indian, like the WhatsApp links."""
    digits = re.sub(r"\D", "", phone)
    found = {digits, f"+{digits}"}
    if len(digits) == 10:
        found |= {f"91{digits}", f"+91{digits}"}
    return found


def check_pin(account: MemberAccount | None, pin: str) -> MemberAccount:
    """Verifies the PIN with lockout. Raises 401 for anything wrong, 429 when locked."""
    now = utcnow()
    if account is None or account.pin_hash is None or account.disabled_at is not None:
        verify_password(pin, _DUMMY_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong phone number or PIN")
    if account.locked_until is not None and as_utc(account.locked_until) > now:
        hard = as_utc(account.locked_until) - now > timedelta(days=1)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many wrong PINs. Ask the gym for a new link."
            if hard
            else "Too many wrong PINs. Try again in 15 minutes.",
        )
    if not verify_password(pin, account.pin_hash):
        account.failed_attempts += 1
        if account.failed_attempts >= HARD_LOCK_AFTER:
            account.locked_until = now + timedelta(days=365 * HARD_LOCK_YEARS)
        elif account.failed_attempts >= SOFT_LOCK_AFTER:
            account.locked_until = now + timedelta(minutes=SOFT_LOCK_MINUTES)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong phone number or PIN")
    account.failed_attempts = 0
    account.locked_until = None
    return account


def set_session_cookies(response: Response, account: MemberAccount) -> None:
    access = create_member_token(
        account.member_id, account.gym_id, account.token_version, "m_access"
    )
    refresh = create_member_token(
        account.member_id, account.gym_id, account.token_version, "m_refresh"
    )
    common = {"httponly": True, "secure": settings.cookie_secure, "samesite": "lax", "path": "/"}
    response.set_cookie(
        MEMBER_ACCESS_COOKIE, access, max_age=settings.access_token_minutes * 60, **common
    )
    response.set_cookie(
        MEMBER_REFRESH_COOKIE, refresh, max_age=settings.member_refresh_token_days * 86400, **common
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(MEMBER_ACCESS_COOKIE, path="/")
    response.delete_cookie(MEMBER_REFRESH_COOKIE, path="/")
