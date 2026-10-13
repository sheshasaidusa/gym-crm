"""Recording visits. The desk, scanners and (later) imports all go through `record_visit`, so a
member has one visit per day however many times they are reported."""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.attendance.models import Attendance, AttendanceSource
from app.modules.attendance.schemas import VisitHistory
from app.modules.gyms.models import Gym
from app.modules.members.models import Member, Membership
from app.modules.members.status import Status, membership_status, pick_current


def gym_zone(gym: Gym) -> ZoneInfo:
    try:
        return ZoneInfo(gym.timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def local_date(gym: Gym, at: datetime) -> date:
    return at.astimezone(gym_zone(gym)).date()


async def record_visit(
    db: AsyncSession,
    gym: Gym,
    member: Member,
    at: datetime,
    source: AttendanceSource,
    *,
    recorded_by: uuid.UUID | None = None,
    device_id: uuid.UUID | None = None,
    device_ref: str | None = None,
) -> tuple[Attendance, bool]:
    """Returns (visit, created). When the member already visited that day, returns the
    existing visit and False."""
    day = local_date(gym, at)
    existing = await db.scalar(
        select(Attendance).where(
            Attendance.gym_id == gym.id,
            Attendance.member_id == member.id,
            Attendance.local_date == day,
        )
    )
    if existing is not None:
        return existing, False
    visit = Attendance(
        gym_id=gym.id,
        member_id=member.id,
        branch_id=member.branch_id,
        checked_in_at=at.astimezone(UTC),
        local_date=day,
        source=source,
        device_id=device_id,
        device_ref=device_ref,
        recorded_by=recorded_by,
    )
    try:
        async with db.begin_nested():  # a race with another check-in loses cleanly
            db.add(visit)
            await db.flush()
    except IntegrityError:
        existing = await db.scalar(
            select(Attendance).where(
                Attendance.gym_id == gym.id,
                Attendance.member_id == member.id,
                Attendance.local_date == day,
            )
        )
        if existing is None:
            raise
        return existing, False
    return visit, True


ABSENT_DAYS = 14


async def history(
    db: AsyncSession, member_id: uuid.UUID, today: date, days: int = 90
) -> VisitHistory:
    """A member's visits, for staff and for the member's own app."""
    # Streaks look back further than the list so a long run isn't cut off.
    rows = (
        await db.scalars(
            select(Attendance.local_date)
            .where(
                Attendance.member_id == member_id,
                Attendance.local_date >= today - timedelta(days=400),
            )
            .order_by(Attendance.local_date.desc())
        )
    ).all()
    return VisitHistory(
        dates=[d for d in rows if d >= today - timedelta(days=days)],
        visits_30d=sum(1 for d in rows if d >= today - timedelta(days=30)),
        last_visit=rows[0] if rows else None,
        streak_weeks=streak_weeks(list(rows), today),
    )


def last_visit(gym_id: uuid.UUID):
    """Subquery of (member_id, last_on): the date of each member's latest visit."""
    return (
        select(Attendance.member_id, func.max(Attendance.local_date).label("last_on"))
        .where(Attendance.gym_id == gym_id)
        .group_by(Attendance.member_id)
        .subquery()
    )


def established_member_ids(gym_id: uuid.UUID, today: date):
    """Members whose running membership began at least ABSENT_DAYS ago: only they can have
    "gone quiet" (someone who joined yesterday simply hasn't had time to visit)."""
    return (
        select(Membership.member_id)
        .where(
            Membership.gym_id == gym_id,
            Membership.cancelled_at.is_(None),
            Membership.start_date <= today - timedelta(days=ABSENT_DAYS),
            Membership.end_date >= today,
        )
        .distinct()
    )


async def is_tracked(db: AsyncSession, gym_id: uuid.UUID, today: date) -> bool:
    """Does this gym record attendance at all? Without it, "hasn't visited" means nothing, so
    the dashboards hide anything built on it."""
    return (
        await db.scalar(
            select(Attendance.id)
            .where(Attendance.gym_id == gym_id, Attendance.local_date >= today - timedelta(days=30))
            .limit(1)
        )
    ) is not None


async def visits_today(db: AsyncSession, gym_id: uuid.UUID, today: date) -> int:
    return (
        await db.scalar(
            select(func.count()).where(Attendance.gym_id == gym_id, Attendance.local_date == today)
        )
        or 0
    )


def membership_warning(member: Member, today: date) -> str | None:
    """Something the desk should know when this member walks in, or None if all is well.
    `member.memberships` must be loaded."""
    current = pick_current(member.memberships, today)
    if current is None:
        return "No membership on file"
    state = membership_status(current, today)
    if state == Status.EXPIRED:
        return f"Membership expired on {current.end_date:%d %b}"
    if state == Status.FROZEN:
        return f"Membership is frozen until {current.freeze_end:%d %b}"
    if state == Status.UPCOMING:
        return f"Membership starts on {current.start_date:%d %b}"
    return None


def streak_weeks(visit_days: list[date], today: date) -> int:
    """Consecutive ISO weeks with at least one visit, counting back from this week (or last
    week, so Monday morning doesn't show a broken streak)."""
    weeks = {d.isocalendar()[:2] for d in visit_days}
    cursor = today
    if cursor.isocalendar()[:2] not in weeks:
        cursor -= timedelta(weeks=1)
    n = 0
    while cursor.isocalendar()[:2] in weeks:
        n += 1
        cursor -= timedelta(weeks=1)
    return n
