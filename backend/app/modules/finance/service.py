import uuid
from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.schemas import round_money
from app.modules.auth.models import User
from app.modules.finance.models import Payment
from app.modules.finance.schemas import PaymentIn, PaymentOut
from app.modules.gyms.models import Gym
from app.modules.members.models import Member, Membership
from app.modules.members.schemas import StaffRef

ZERO = Decimal("0.00")


async def next_receipt_no(db: AsyncSession, gym_id: uuid.UUID) -> str:
    """Atomically issues the gym's next receipt number (safe under concurrent payments)."""
    n = await db.scalar(
        update(Gym)
        .where(Gym.id == gym_id)
        .values(receipt_counter=Gym.receipt_counter + 1)
        .returning(Gym.receipt_counter)
    )
    return f"RCPT-{n:05d}"


async def paid_by_membership(
    db: AsyncSession, membership_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    if not membership_ids:
        return {}
    rows = await db.execute(
        select(Payment.membership_id, func.sum(Payment.amount))
        .where(Payment.membership_id.in_(membership_ids), Payment.voided_at.is_(None))
        .group_by(Payment.membership_id)
    )
    return {mid: round_money(Decimal(total)) for mid, total in rows.all()}


def paid_subquery():
    """Per-membership sum of non-voided payments, for SQL joins."""
    return (
        select(Payment.membership_id.label("membership_id"), func.sum(Payment.amount).label("paid"))
        .where(Payment.membership_id.is_not(None), Payment.voided_at.is_(None))
        .group_by(Payment.membership_id)
        .subquery()
    )


async def record_payment(
    db: AsyncSession,
    gym_id: uuid.UUID,
    member: Member,
    body: PaymentIn,
    user_id: uuid.UUID | None,
    today: date,
) -> Payment:
    paid_on = body.paid_on or today
    if paid_on > today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Payment date can't be in the future"
        )
    if body.membership_id is not None:
        membership = await db.scalar(
            select(Membership).where(
                Membership.id == body.membership_id,
                Membership.gym_id == gym_id,
                Membership.member_id == member.id,
            )
        )
        if membership is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
        if membership.cancelled_at is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "This membership was cancelled")
        paid = (await paid_by_membership(db, [membership.id])).get(membership.id, ZERO)
        balance = round_money(membership.total - paid)
        if body.amount > balance:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"Only {balance} is due on this membership"
                if balance > 0
                else "This membership is already fully paid",
            )
    payment = Payment(
        gym_id=gym_id,
        member_id=member.id,
        membership_id=body.membership_id,
        amount=body.amount,
        method=body.method,
        paid_on=paid_on,
        reference=body.reference,
        note=body.note,
        receipt_no=await next_receipt_no(db, gym_id),
        recorded_by=user_id,
    )
    db.add(payment)
    await db.flush()
    return payment


async def payments_out(db: AsyncSession, payments: list[Payment]) -> list[PaymentOut]:
    member_names = (
        dict(
            (
                await db.execute(
                    select(Member.id, Member.name).where(
                        Member.id.in_({p.member_id for p in payments})
                    )
                )
            ).all()
        )
        if payments
        else {}
    )
    plan_names = (
        dict(
            (
                await db.execute(
                    select(Membership.id, Membership.plan_name).where(
                        Membership.id.in_({p.membership_id for p in payments if p.membership_id})
                    )
                )
            ).all()
        )
        if payments
        else {}
    )
    user_ids = {p.recorded_by for p in payments if p.recorded_by}
    users = (
        dict((await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all())
        if user_ids
        else {}
    )
    return [
        PaymentOut(
            id=p.id,
            receipt_no=p.receipt_no,
            member_id=p.member_id,
            member_name=member_names.get(p.member_id, "—"),
            membership_id=p.membership_id,
            plan_name=plan_names.get(p.membership_id) if p.membership_id else None,
            amount=p.amount,
            method=p.method,
            paid_on=p.paid_on,
            reference=p.reference,
            note=p.note,
            recorded_by=StaffRef(id=p.recorded_by, name=users[p.recorded_by])
            if p.recorded_by in users
            else None,
            voided_at=p.voided_at,
            void_reason=p.void_reason,
            created_at=p.created_at,
        )
        for p in payments
    ]
