"""CSV downloads of a gym's data, for backups, accountants or moving elsewhere.

Member and plan columns use the same names as the import templates, so an export can be
imported again. Files start with a UTF-8 BOM so Excel shows ₹ and names correctly.
"""

import csv
import enum
import io
import uuid
from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Response
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.core.deps import DbSession, ManagerContext
from app.modules.audit import service as audit
from app.modules.auth.models import User
from app.modules.checkups.models import CheckUp
from app.modules.finance.models import Expense, Payment
from app.modules.gyms.models import Branch, Gym
from app.modules.leads.models import Lead
from app.modules.members.models import Member, Membership
from app.modules.members.service import gym_today
from app.modules.members.status import membership_status, pick_current
from app.modules.plans.models import Plan

router = APIRouter(prefix="/exports", tags=["exports"])


class ExportEntity(enum.StrEnum):
    MEMBERS = "members"
    MEMBERSHIPS = "memberships"
    PAYMENTS = "payments"
    EXPENSES = "expenses"
    LEADS = "leads"
    CHECKUPS = "checkups"
    PLANS = "plans"


def _cell(v: object, tz: ZoneInfo) -> object:
    if v is None:
        return ""
    if isinstance(v, enum.Enum):
        return str(v.value).replace("_", " ")
    if isinstance(v, datetime):
        return v.astimezone(tz).strftime("%Y-%m-%d %H:%M")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return f"{v:.2f}"
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    return v


def _csv(headers: list[str], rows: Iterable[Iterable[object]], tz: ZoneInfo) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    for row in rows:
        w.writerow([_cell(v, tz) for v in row])
    return buf.getvalue().encode("utf-8-sig")


async def _names(db: DbSession, model, ids: set) -> dict[uuid.UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict((await db.execute(select(model.id, model.name).where(model.id.in_(ids)))).all())


async def _paid(db: DbSession, gym_id: uuid.UUID) -> dict[uuid.UUID, Decimal]:
    rows = await db.execute(
        select(Payment.membership_id, func.sum(Payment.amount))
        .where(
            Payment.gym_id == gym_id,
            Payment.voided_at.is_(None),
            Payment.membership_id.is_not(None),
        )
        .group_by(Payment.membership_id)
    )
    return dict(rows.all())


async def _members(db: DbSession, gym_id: uuid.UUID, today: date, tz: ZoneInfo) -> bytes:
    members = (
        await db.scalars(select(Member).where(Member.gym_id == gym_id).order_by(Member.name))
    ).all()
    memberships: dict[uuid.UUID, list[Membership]] = defaultdict(list)
    for m in await db.scalars(select(Membership).where(Membership.gym_id == gym_id)):
        memberships[m.member_id].append(m)
    branches = await _names(db, Branch, {m.branch_id for m in members})
    trainers = await _names(db, User, {m.trainer_id for m in members})
    paid = await _paid(db, gym_id)

    def rows():
        for m in members:
            cur = pick_current(memberships[m.id], today)
            yield [
                m.name,
                m.phone,
                m.email,
                m.gender,
                m.dob,
                m.address,
                m.joined_on,
                cur.plan_name if cur else None,
                cur.start_date if cur else None,
                cur.end_date if cur else None,
                membership_status(cur, today) if cur else "no membership",
                (cur.total - paid.get(cur.id, Decimal(0))) if cur else None,
                m.goal,
                m.diet_pref,
                m.experience_level,
                m.height_cm,
                m.medical_notes,
                m.emergency_contact_name,
                m.emergency_contact_phone,
                branches.get(m.branch_id),
                trainers.get(m.trainer_id),
                m.tags,
                m.notes,
            ]

    headers = [
        "Name",
        "Phone",
        "Email",
        "Gender",
        "Date of birth",
        "Address",
        "Joined on",
        "Plan",
        "Membership start",
        "Membership end",
        "Status",
        "Balance due",
        "Goal",
        "Diet",
        "Experience",
        "Height (cm)",
        "Medical notes",
        "Emergency contact",
        "Emergency phone",
        "Branch",
        "Trainer",
        "Tags",
        "Notes",
    ]
    return _csv(headers, rows(), tz)


async def _memberships(db: DbSession, gym_id: uuid.UUID, today: date, tz: ZoneInfo) -> bytes:
    rows = (
        await db.execute(
            select(Membership, Member.name, Member.phone)
            .join(Member, Member.id == Membership.member_id)
            .where(Membership.gym_id == gym_id)
            .order_by(Membership.start_date.desc())
        )
    ).all()
    paid = await _paid(db, gym_id)
    headers = [
        "Member",
        "Phone",
        "Plan",
        "Start",
        "End",
        "Status",
        "Price",
        "Discount",
        "Joining fee",
        "Tax %",
        "Total",
        "Paid",
        "Balance",
        "Frozen days",
        "Cancelled on",
    ]

    def out():
        for ms, name, phone in rows:
            p = paid.get(ms.id, Decimal(0))
            yield [
                name,
                phone,
                ms.plan_name,
                ms.start_date,
                ms.end_date,
                membership_status(ms, today),
                ms.price,
                ms.discount,
                ms.joining_fee,
                ms.tax_pct,
                ms.total,
                p,
                ms.total - p if ms.cancelled_at is None else Decimal(0),
                ms.frozen_days,
                ms.cancelled_at,
            ]

    return _csv(headers, out(), tz)


async def _payments(db: DbSession, gym_id: uuid.UUID, tz: ZoneInfo) -> bytes:
    recorder = aliased(User)
    rows = (
        await db.execute(
            select(Payment, Member.name, Member.phone, Membership.plan_name, recorder.name)
            .join(Member, Member.id == Payment.member_id)
            .outerjoin(Membership, Membership.id == Payment.membership_id)
            .outerjoin(recorder, recorder.id == Payment.recorded_by)
            .where(Payment.gym_id == gym_id)
            .order_by(Payment.paid_on.desc(), Payment.receipt_no.desc())
        )
    ).all()
    headers = [
        "Receipt no",
        "Date",
        "Member",
        "Phone",
        "Amount",
        "Method",
        "Reference",
        "For",
        "Note",
        "Recorded by",
        "Voided on",
        "Void reason",
    ]
    return _csv(
        headers,
        (
            [
                p.receipt_no,
                p.paid_on,
                name,
                phone,
                p.amount,
                p.method,
                p.reference,
                plan or "Other",
                p.note,
                by,
                p.voided_at,
                p.void_reason,
            ]
            for p, name, phone, plan, by in rows
        ),
        tz,
    )


async def _expenses(db: DbSession, gym_id: uuid.UUID, tz: ZoneInfo) -> bytes:
    rows = (
        await db.execute(
            select(Expense, Branch.name)
            .outerjoin(Branch, Branch.id == Expense.branch_id)
            .where(Expense.gym_id == gym_id)
            .order_by(Expense.spent_on.desc())
        )
    ).all()
    headers = ["Date", "Category", "Amount", "Paid to", "Method", "Branch", "Note", "Has bill"]
    return _csv(
        headers,
        (
            [
                e.spent_on,
                e.category,
                e.amount,
                e.vendor,
                e.method,
                branch,
                e.note,
                "yes" if e.attachment_key else "no",
            ]
            for e, branch in rows
        ),
        tz,
    )


async def _leads(db: DbSession, gym_id: uuid.UUID, tz: ZoneInfo) -> bytes:
    rows = (
        await db.execute(
            select(Lead, User.name)
            .outerjoin(User, User.id == Lead.assigned_to)
            .where(Lead.gym_id == gym_id)
            .order_by(Lead.created_at.desc())
        )
    ).all()
    headers = [
        "Name",
        "Phone",
        "Email",
        "Source",
        "Stage",
        "Interest",
        "Assigned to",
        "Next follow-up",
        "Trial",
        "Added on",
        "Converted on",
        "Lost reason",
        "Notes",
    ]
    return _csv(
        headers,
        (
            [
                lead.name,
                lead.phone,
                lead.email,
                lead.source,
                lead.stage,
                lead.interest,
                assignee,
                lead.next_follow_up_at,
                lead.trial_at,
                lead.created_at,
                lead.converted_at,
                lead.lost_reason,
                lead.notes,
            ]
            for lead, assignee in rows
        ),
        tz,
    )


async def _checkups(db: DbSession, gym_id: uuid.UUID, tz: ZoneInfo) -> bytes:
    rows = (
        await db.execute(
            select(CheckUp, Member.name, Member.phone)
            .join(Member, Member.id == CheckUp.member_id)
            .where(CheckUp.gym_id == gym_id)
            .order_by(Member.name, CheckUp.recorded_on)
        )
    ).all()
    headers = [
        "Member",
        "Phone",
        "Date",
        "Weight (kg)",
        "Height (cm)",
        "BMI",
        "Body fat %",
        "Muscle mass (kg)",
        "Chest (cm)",
        "Waist (cm)",
        "Hips (cm)",
        "Arm (cm)",
        "Thigh (cm)",
        "Notes",
    ]
    return _csv(
        headers,
        (
            [
                name,
                phone,
                c.recorded_on,
                c.weight_kg,
                c.height_cm,
                c.bmi,
                c.body_fat_pct,
                c.muscle_mass_kg,
                c.chest_cm,
                c.waist_cm,
                c.hips_cm,
                c.arm_cm,
                c.thigh_cm,
                c.notes,
            ]
            for c, name, phone in rows
        ),
        tz,
    )


async def _plans(db: DbSession, gym_id: uuid.UUID, tz: ZoneInfo) -> bytes:
    plans = (await db.scalars(select(Plan).where(Plan.gym_id == gym_id).order_by(Plan.price))).all()
    headers = [
        "Plan name",
        "Duration",
        "Price",
        "Joining fee",
        "Tax %",
        "Freeze days",
        "Services",
        "Description",
        "Active",
    ]
    return _csv(
        headers,
        (
            [
                p.name,
                f"{p.duration_value} {p.duration_unit.value}{'s' if p.duration_value != 1 else ''}",
                p.price,
                p.joining_fee,
                p.tax_pct,
                p.max_freeze_days,
                p.services,
                p.description,
                "yes" if p.is_active else "no",
            ]
            for p in plans
        ),
        tz,
    )


@router.get("/{entity}.csv", response_class=Response)
async def export(entity: ExportEntity, ctx: ManagerContext, db: DbSession):
    gym = await db.get_one(Gym, ctx.gym_id)
    try:
        tz = ZoneInfo(gym.timezone)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    today = await gym_today(db, ctx.gym_id)

    match entity:
        case ExportEntity.MEMBERS:
            data = await _members(db, ctx.gym_id, today, tz)
        case ExportEntity.MEMBERSHIPS:
            data = await _memberships(db, ctx.gym_id, today, tz)
        case ExportEntity.PAYMENTS:
            data = await _payments(db, ctx.gym_id, tz)
        case ExportEntity.EXPENSES:
            data = await _expenses(db, ctx.gym_id, tz)
        case ExportEntity.LEADS:
            data = await _leads(db, ctx.gym_id, tz)
        case ExportEntity.CHECKUPS:
            data = await _checkups(db, ctx.gym_id, tz)
        case ExportEntity.PLANS:
            data = await _plans(db, ctx.gym_id, tz)

    # Downloads of member data are worth knowing about.
    audit.record(db, ctx, "export.downloaded", f"Downloaded {entity.value} as CSV")
    await db.commit()
    return Response(
        data,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{entity.value}-{today.isoformat()}.csv"',
            "Cache-Control": "no-store",
        },
    )
