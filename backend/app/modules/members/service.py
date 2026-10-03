import uuid
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dates import membership_end, today_in
from app.core.db import utcnow
from app.core.repository import TenantRepository
from app.core.schemas import round_money
from app.modules.auth.models import User
from app.modules.gyms.models import Gym, StaffMembership
from app.modules.gyms.repository import BranchRepository
from app.modules.members.models import Member, Membership
from app.modules.members.schemas import (
    CurrentMembershipOut,
    FreezeIn,
    MemberListItem,
    MemberOut,
    MembershipIn,
    MembershipOut,
    StaffRef,
)
from app.modules.members.status import Status, membership_status, pick_current
from app.modules.plans.models import Plan


class MemberRepository(TenantRepository[Member]):
    model = Member


class MembershipRepository(TenantRepository[Membership]):
    model = Membership


class PlanRepository(TenantRepository[Plan]):
    model = Plan


def conflict(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail)


def invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


async def gym_today(db: AsyncSession, gym_id: uuid.UUID) -> date:
    """'Today' in the gym's own time zone, which decides when memberships start/end."""
    gym = await db.get_one(Gym, gym_id)
    return today_in(gym.timezone)


async def validate_refs(
    db: AsyncSession, gym_id: uuid.UUID, branch_id: uuid.UUID | None, trainer_id: uuid.UUID | None
) -> None:
    if branch_id is not None:
        await BranchRepository(db, gym_id).get_or_404(branch_id)
    if trainer_id is not None:
        is_staff = await db.scalar(
            select(StaffMembership.id).where(
                StaffMembership.gym_id == gym_id, StaffMembership.user_id == trainer_id
            )
        )
        if not is_staff:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Trainer not found")


async def ensure_unique_phone(
    db: AsyncSession, gym_id: uuid.UUID, phone: str, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(Member.id, Member.name).where(Member.gym_id == gym_id, Member.phone == phone)
    if exclude_id:
        stmt = stmt.where(Member.id != exclude_id)
    existing = (await db.execute(stmt)).first()
    if existing:
        raise conflict(f"{existing.name} already uses this phone number")


# --- Memberships ------------------------------------------------------------


def compute_total(price: Decimal, discount: Decimal, joining_fee: Decimal, tax_pct: Decimal):
    if discount > price:
        raise invalid("Discount can't be more than the price")
    subtotal = price - discount + joining_fee
    return round_money(subtotal * (1 + tax_pct / 100))


def _live(member: Member) -> list[Membership]:
    return [m for m in member.memberships if m.cancelled_at is None]


async def add_membership(
    db: AsyncSession,
    gym_id: uuid.UUID,
    member: Member,
    body: MembershipIn,
    today: date,
    created_by: uuid.UUID,
) -> Membership:
    plan = await PlanRepository(db, gym_id).get_or_404(body.plan_id)
    if not plan.is_active:
        raise conflict("This plan is archived. Reactivate it or pick another plan.")

    live = _live(member)
    if body.start_date is not None:
        start = body.start_date
    else:
        # Renewals start the day after the last running/upcoming membership ends.
        last_end = max((m.end_date for m in live if m.end_date >= today), default=None)
        start = last_end + timedelta(days=1) if last_end else today
    end = membership_end(start, plan.duration_value, plan.duration_unit)

    for m in live:
        if m.start_date <= end and m.end_date >= start:
            raise conflict(
                f"Overlaps with {m.plan_name} ({m.start_date:%d %b %Y} – {m.end_date:%d %b %Y})"
            )

    price = body.price if body.price is not None else plan.price
    joining_fee = (
        body.joining_fee
        if body.joining_fee is not None
        else (plan.joining_fee if not live else Decimal(0))
    )
    membership = Membership(
        gym_id=gym_id,
        member_id=member.id,
        plan_id=plan.id,
        plan_name=plan.name,
        duration_value=plan.duration_value,
        duration_unit=plan.duration_unit,
        start_date=start,
        end_date=end,
        price=price,
        discount=body.discount,
        joining_fee=joining_fee,
        tax_pct=plan.tax_pct,
        total=compute_total(price, body.discount, joining_fee, plan.tax_pct),
        max_freeze_days=plan.max_freeze_days,
        frozen_days=0,
        notes=body.notes,
        created_by=created_by,
    )
    member.memberships.append(membership)
    await db.flush()
    if body.payment is not None:
        from app.modules.finance.schemas import PaymentIn
        from app.modules.finance.service import record_payment

        await record_payment(
            db,
            gym_id,
            member,
            PaymentIn(
                membership_id=membership.id,
                amount=body.payment.amount,
                method=body.payment.method,
                reference=body.payment.reference,
            ),
            created_by,
            today,
        )
    return membership


def _shift_later(member: Membership, all_memberships: list[Membership], days: int) -> None:
    """Moves renewals that start after `member` so they don't overlap after a freeze."""
    for other in all_memberships:
        if (
            other.id != member.id
            and other.cancelled_at is None
            and other.start_date > member.start_date
        ):
            other.start_date += timedelta(days=days)
            other.end_date += timedelta(days=days)


def freeze(m: Membership, body: FreezeIn, today: date) -> None:
    state = membership_status(m, today)
    if state in (Status.CANCELLED, Status.EXPIRED):
        raise conflict(f"Can't freeze a {state.value} membership")
    if m.freeze_end is not None and m.freeze_end >= today:
        raise conflict("This membership already has a freeze. Unfreeze it first.")
    remaining = m.max_freeze_days - m.frozen_days
    if remaining <= 0:
        raise conflict("No freeze days left on this membership")
    if body.days > remaining:
        raise invalid(f"Only {remaining} freeze day{'s' if remaining != 1 else ''} left")
    start = body.start_date or max(today, m.start_date)
    if start < today or start < m.start_date or start > m.end_date:
        raise invalid("Freeze must start between today and the membership end date")

    m.freeze_start = start
    m.freeze_end = start + timedelta(days=body.days - 1)
    m.frozen_days += body.days
    m.end_date += timedelta(days=body.days)
    _shift_later(m, m.member.memberships, body.days)


def unfreeze(m: Membership, today: date) -> None:
    if m.freeze_start is None or m.freeze_end is None or m.freeze_end < today:
        raise conflict("This membership isn't frozen")
    # Give back the days that haven't been used yet.
    resume_from = max(today, m.freeze_start)
    unused = (m.freeze_end - resume_from).days + 1
    m.frozen_days -= unused
    m.end_date -= timedelta(days=unused)
    if resume_from == m.freeze_start:
        m.freeze_start = m.freeze_end = None
    else:
        m.freeze_end = today - timedelta(days=1)
    _shift_later(m, m.member.memberships, -unused)


def cancel(m: Membership) -> None:
    if m.cancelled_at is not None:
        raise conflict("Membership is already cancelled")
    m.cancelled_at = utcnow()


# --- Serialization ----------------------------------------------------------


def days_left(m: Membership, today: date) -> int | None:
    if m.cancelled_at is not None or m.end_date < today:
        return None
    return (m.end_date - today).days


def membership_out(m: Membership, today: date, paid: Decimal = Decimal(0)) -> MembershipOut:
    return MembershipOut.model_validate(
        {
            **{c: getattr(m, c) for c in MembershipOut.model_fields if hasattr(m, c)},
            "status": membership_status(m, today),
            "days_left": days_left(m, today),
            "paid": round_money(paid),
            "balance": round_money(m.total - paid) if m.cancelled_at is None else Decimal(0),
        }
    )


def current_out(m: Membership | None, today: date) -> CurrentMembershipOut | None:
    if m is None:
        return None
    return CurrentMembershipOut(
        id=m.id,
        plan_name=m.plan_name,
        start_date=m.start_date,
        end_date=m.end_date,
        status=membership_status(m, today),
        days_left=days_left(m, today),
    )


def member_status(current: Membership | None, today: date) -> Status:
    return membership_status(current, today) if current else Status.NONE


def list_item(
    member: Member, current: Membership | None, trainer_name: str | None, today: date
) -> MemberListItem:
    return MemberListItem(
        id=member.id,
        name=member.name,
        phone=member.phone,
        email=member.email,
        photo_url=member.photo_url,
        branch_id=member.branch_id,
        trainer=StaffRef(id=member.trainer_id, name=trainer_name)
        if member.trainer_id and trainer_name
        else None,
        tags=member.tags or [],
        joined_on=member.joined_on,
        status=member_status(current, today),
        current_membership=current_out(current, today),
    )


async def member_out(db: AsyncSession, member: Member, today: date) -> MemberOut:
    trainer_name = (
        await db.scalar(select(User.name).where(User.id == member.trainer_id))
        if member.trainer_id
        else None
    )
    from sqlalchemy import func

    from app.modules.checkups.models import CheckUp

    last_checkup_on = await db.scalar(
        select(func.max(CheckUp.recorded_on)).where(CheckUp.member_id == member.id)
    )
    from app.modules.finance.service import paid_by_membership

    paid = await paid_by_membership(db, [m.id for m in member.memberships])
    current = pick_current(member.memberships, today)
    base = list_item(member, current, trainer_name, today)
    return MemberOut(
        **base.model_dump(),
        dob=member.dob,
        gender=member.gender,
        address=member.address,
        emergency_contact_name=member.emergency_contact_name,
        emergency_contact_phone=member.emergency_contact_phone,
        height_cm=member.height_cm,
        goal=member.goal,
        diet_pref=member.diet_pref,
        experience_level=member.experience_level,
        medical_notes=member.medical_notes,
        notes=member.notes,
        preview_enabled=member.preview_enabled,
        preview_url=f"{settings.frontend_url}/p/{member.preview_token}",
        memberships=[
            membership_out(m, today, paid.get(m.id, Decimal(0))) for m in member.memberships
        ],
        last_checkup_on=last_checkup_on,
        created_at=member.created_at,
    )
