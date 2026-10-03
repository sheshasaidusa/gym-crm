import uuid
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.auth.models import User
from app.modules.gyms.models import Gym, Role, StaffMembership
from app.modules.leads.models import OPEN_STAGES, ActivityKind, Lead, LeadActivity
from app.modules.leads.schemas import ActivityOut, LeadDetail, LeadOut
from app.modules.members.schemas import StaffRef
from app.modules.notifications.service import notify_staff


def end_of_day_utc(gym: Gym, day: date) -> datetime:
    """Midnight at the end of `day` in the gym's time zone, as UTC."""
    try:
        zone = ZoneInfo(gym.timezone)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    return datetime.combine(day + timedelta(days=1), time(0), zone).astimezone(UTC)


async def ensure_staff(db: AsyncSession, gym_id: uuid.UUID, user_id: uuid.UUID | None) -> None:
    if user_id is None:
        return
    ok = await db.scalar(
        select(StaffMembership.id).where(
            StaffMembership.gym_id == gym_id, StaffMembership.user_id == user_id
        )
    )
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staff member not found")


async def open_lead_with_phone(
    db: AsyncSession, gym_id: uuid.UUID, phone: str, exclude: uuid.UUID | None = None
) -> Lead | None:
    # Activities loaded up front: callers may append to them (no lazy loading under async).
    stmt = (
        select(Lead)
        .where(Lead.gym_id == gym_id, Lead.phone == phone, Lead.stage.in_(OPEN_STAGES))
        .options(selectinload(Lead.activities))
    )
    if exclude:
        stmt = stmt.where(Lead.id != exclude)
    return await db.scalar(stmt.limit(1))


def log(lead: Lead, kind: ActivityKind, content: str | None, user_id: uuid.UUID | None) -> None:
    lead.activities.append(
        LeadActivity(gym_id=lead.gym_id, kind=kind, content=content, created_by=user_id)
    )


async def _names(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.name).where(User.id.in_(ids)))
    return dict(rows.all())


def _ref(user_id: uuid.UUID | None, names: dict[uuid.UUID, str]) -> StaffRef | None:
    return StaffRef(id=user_id, name=names[user_id]) if user_id and user_id in names else None


async def leads_out(db: AsyncSession, leads: list[Lead]) -> list[LeadOut]:
    names = await _names(db, {lead.assigned_to for lead in leads if lead.assigned_to})
    last: dict[uuid.UUID, datetime] = {}
    if leads:
        rows = await db.execute(
            select(LeadActivity.lead_id, func.max(LeadActivity.created_at))
            .where(LeadActivity.lead_id.in_([lead.id for lead in leads]))
            .group_by(LeadActivity.lead_id)
        )
        last = dict(rows.all())
    return [
        LeadOut(
            **{
                f: getattr(lead, f)
                for f in LeadOut.model_fields
                if f not in ("assigned_to", "last_activity_at")
            },
            assigned_to=_ref(lead.assigned_to, names),
            last_activity_at=last.get(lead.id),
        )
        for lead in leads
    ]


async def lead_detail(db: AsyncSession, lead: Lead) -> LeadDetail:
    (base,) = await leads_out(db, [lead])
    names = await _names(db, {a.created_by for a in lead.activities if a.created_by})
    return LeadDetail(
        **base.model_dump(),
        activities=[
            ActivityOut(
                id=a.id,
                kind=a.kind,
                content=a.content,
                created_by=_ref(a.created_by, names),
                created_at=a.created_at,
            )
            for a in lead.activities
        ],
    )


async def notify_due_follow_ups(db: AsyncSession, gym: Gym, today: date) -> int:
    """One notification per staff member with lead follow-ups due today or overdue.
    Unassigned leads go to owners and managers. Returns notifications created."""
    cutoff = end_of_day_utc(gym, today)
    rows = (
        await db.execute(
            select(Lead.assigned_to).where(
                Lead.gym_id == gym.id,
                Lead.stage.in_(OPEN_STAGES),
                Lead.next_follow_up_at.is_not(None),
                Lead.next_follow_up_at < cutoff,
            )
        )
    ).all()
    if not rows:
        return 0
    per_user = Counter(r[0] for r in rows)
    created = 0
    key = f"leads:{today.isoformat()}"
    unassigned = per_user.pop(None, 0)
    for user_id, n in per_user.items():
        created += await notify_staff(
            db,
            gym.id,
            roles=tuple(Role),
            kind="lead_follow_ups",
            title=f"{n} lead follow-up{'s' if n != 1 else ''} due today",
            body="Call or message them and log what happened.",
            link="/leads?due=1&assigned=me",
            dedupe_key=key,
            user_ids=[user_id],
        )
    if unassigned:
        created += await notify_staff(
            db,
            gym.id,
            roles=(Role.OWNER, Role.MANAGER),
            kind="lead_follow_ups",
            title=f"{unassigned} unassigned lead follow-up{'s' if unassigned != 1 else ''} due",
            body="Assign them to someone on your team.",
            link="/leads?due=1",
            dedupe_key=f"{key}:unassigned",
        )
    return created
