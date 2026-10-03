import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import exists, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import aliased

from app.core import email as email_module
from app.core.config import settings
from app.core.dates import today_in
from app.core.db import utcnow
from app.modules.gyms.models import Gym, Role
from app.modules.members.models import Member, Membership
from app.modules.notifications.service import notify_staff
from app.modules.reminders.models import Channel, ReminderLog, SendStatus
from app.modules.reminders.templates import Kind, kind_for, render, template_for, values_for

log = logging.getLogger("gym_crm.reminders")


@dataclass
class DueReminder:
    membership: Membership
    member: Member
    offset_days: int
    kind: Kind
    subject: str
    body: str
    logs: dict[Channel, ReminderLog] = field(default_factory=dict)


@dataclass
class RunSummary:
    due: int = 0
    emailed: int = 0
    failed: int = 0
    no_email: int = 0
    already_sent: int = 0


def preview_link(member: Member) -> str:
    return f"{settings.frontend_url}/p/{member.preview_token}"


async def due_reminders(db: AsyncSession, gym: Gym, day: date) -> list[DueReminder]:
    """Memberships whose end date is exactly one of the gym's reminder offsets away from
    `day`, skipping members who have already renewed (have a later-ending membership)."""
    by_end_date = {day + timedelta(days=o): o for o in gym.reminder_offsets or []}
    if not by_end_date:
        return []

    later = aliased(Membership)
    renewed = exists().where(
        later.member_id == Membership.member_id,
        later.id != Membership.id,
        later.cancelled_at.is_(None),
        later.end_date > Membership.end_date,
    )
    rows = (
        await db.execute(
            select(Membership, Member)
            .join(Member, Member.id == Membership.member_id)
            .where(
                Membership.gym_id == gym.id,
                Membership.cancelled_at.is_(None),
                Membership.end_date.in_(list(by_end_date)),
                ~renewed,
            )
            .order_by(Membership.end_date, Member.name)
        )
    ).all()
    if not rows:
        return []

    logs = (
        await db.scalars(
            select(ReminderLog).where(
                ReminderLog.membership_id.in_([m.id for m, _ in rows]),
                ReminderLog.offset_days.in_(list(by_end_date.values())),
            )
        )
    ).all()

    items = []
    for membership, member in rows:
        offset = by_end_date[membership.end_date]
        kind = kind_for(offset)
        template = template_for(gym.reminder_templates, kind)
        values = values_for(
            member_name=member.name,
            plan_name=membership.plan_name,
            end_date=membership.end_date,
            offset_days=offset,
            gym_name=gym.name,
            gym_phone=gym.phone,
            preview_link=preview_link(member),
        )
        items.append(
            DueReminder(
                membership=membership,
                member=member,
                offset_days=offset,
                kind=kind,
                subject=render(template.subject, values),
                body=render(template.body, values),
                logs={
                    lg.channel: lg
                    for lg in logs
                    if lg.membership_id == membership.id and lg.offset_days == offset
                },
            )
        )
    return items


async def _claim_email(
    db: AsyncSession,
    gym: Gym,
    item: DueReminder,
    retry_failed: bool,
    triggered_by: uuid.UUID | None,
) -> ReminderLog | None:
    """Reserves the email send for this reminder. Returns None if another run already
    sent, is sending, or (unless retrying) failed it."""
    existing = item.logs.get(Channel.EMAIL)
    if existing is not None:
        if existing.status != SendStatus.FAILED or not retry_failed:
            return None
        result = await db.execute(
            update(ReminderLog)
            .where(ReminderLog.id == existing.id, ReminderLog.status == SendStatus.FAILED)
            .values(status=SendStatus.PENDING, error=None, sent_by=triggered_by)
        )
        await db.commit()
        return existing if result.rowcount else None

    claim = ReminderLog(
        gym_id=gym.id,
        membership_id=item.membership.id,
        member_id=item.member.id,
        offset_days=item.offset_days,
        channel=Channel.EMAIL,
        status=SendStatus.PENDING,
        recipient=item.member.email or "",
        sent_by=triggered_by,
    )
    try:
        # A savepoint, so losing the race only undoes this insert (a full rollback would
        # expire every loaded object in the session).
        async with db.begin_nested():
            db.add(claim)
    except IntegrityError:
        return None
    await db.commit()  # make the claim visible to other runs before sending
    return claim


async def send_due_emails(
    db: AsyncSession,
    gym: Gym,
    day: date,
    *,
    retry_failed: bool = False,
    triggered_by: uuid.UUID | None = None,
) -> RunSummary:
    """Emails due reminders. triggered_by is the staff user for a manual run (None = scheduler)."""
    items = await due_reminders(db, gym, day)
    summary = RunSummary(due=len(items))
    sender = email_module.get_sender()

    for item in items:
        if not item.member.email:
            summary.no_email += 1
            continue
        claim = await _claim_email(db, gym, item, retry_failed, triggered_by)
        if claim is None:
            prior = item.logs.get(Channel.EMAIL)
            if prior is not None and prior.status == SendStatus.FAILED:
                summary.failed += 1
            else:
                summary.already_sent += 1
            continue
        try:
            await sender.send(
                email_module.Email(
                    to=item.member.email,
                    subject=item.subject,
                    text=item.body,
                    from_name=gym.name,
                )
            )
            claim.status = SendStatus.SENT
            summary.emailed += 1
        except email_module.EmailError as exc:
            claim.status = SendStatus.FAILED
            claim.error = str(exc)[:500]
            summary.failed += 1
            log.warning("Reminder email to %s failed: %s", item.member.email, exc)
        await db.commit()

    if items:
        await _notify_digest(db, gym, day, items, summary)
        await db.commit()
    return summary


async def _notify_digest(
    db: AsyncSession, gym: Gym, day: date, items: list[DueReminder], summary: RunSummary
) -> None:
    by_kind = {k: sum(1 for i in items if i.kind == k) for k in Kind}
    parts = [
        f"{by_kind[Kind.BEFORE]} ending soon" if by_kind[Kind.BEFORE] else "",
        f"{by_kind[Kind.ON_DAY]} ending today" if by_kind[Kind.ON_DAY] else "",
        f"{by_kind[Kind.AFTER]} recently expired" if by_kind[Kind.AFTER] else "",
    ]
    body = ", ".join(p for p in parts if p) + "."
    if summary.emailed:
        body += f" {summary.emailed} emailed automatically."
    if summary.no_email:
        body += f" {summary.no_email} without email – send on WhatsApp."
    n = len(items)
    await notify_staff(
        db,
        gym.id,
        roles=(Role.OWNER, Role.MANAGER, Role.FRONT_DESK),
        kind="reminders_digest",
        title=f"{n} membership reminder{'s' if n != 1 else ''} today",
        body=body,
        link="/reminders",
        dedupe_key=f"reminders:{day.isoformat()}",
    )


async def record_whatsapp(
    db: AsyncSession, gym_id: uuid.UUID, membership: Membership, offset_days: int, user_id
) -> ReminderLog:
    """Logs that staff sent this reminder from their own WhatsApp. Re-sending updates it."""
    existing = await db.scalar(
        select(ReminderLog).where(
            ReminderLog.membership_id == membership.id,
            ReminderLog.offset_days == offset_days,
            ReminderLog.channel == Channel.WHATSAPP,
        )
    )
    member = await db.get_one(Member, membership.member_id)
    if existing:
        existing.sent_by = user_id
        existing.recipient = member.phone
        existing.updated_at = utcnow()
        return existing
    entry = ReminderLog(
        gym_id=gym_id,
        membership_id=membership.id,
        member_id=member.id,
        offset_days=offset_days,
        channel=Channel.WHATSAPP,
        status=SendStatus.SENT,
        recipient=member.phone,
        sent_by=user_id,
    )
    db.add(entry)
    return entry


async def run_all_gyms(
    session_factory: async_sessionmaker[AsyncSession], now: datetime | None = None
) -> dict[uuid.UUID, RunSummary]:
    """Scheduler entry point (daily jobs): once each gym's local send hour has passed, sends
    today's membership reminders and lead follow-up alerts. Safe to call as often as you
    like - everything is deduplicated. Returns reminder summaries per gym."""
    from app.modules.leads.service import notify_due_follow_ups

    async with session_factory() as db:
        gyms = (await db.scalars(select(Gym))).all()
        gym_ids = [(g.id, g.timezone, g.reminder_hour, g.reminders_enabled) for g in gyms]

    results: dict[uuid.UUID, RunSummary] = {}
    for gym_id, tz, hour, reminders_on in gym_ids:
        local_now = _local_now(tz, now)
        if local_now.hour < hour:
            continue
        async with session_factory() as db:
            try:
                gym = await db.get_one(Gym, gym_id)
                await notify_due_follow_ups(db, gym, local_now.date())
                await db.commit()
                if reminders_on:
                    results[gym_id] = await send_due_emails(db, gym, local_now.date())
            except Exception:
                log.exception("Reminder run failed for gym %s", gym_id)
                await db.rollback()
    return results


def _local_now(tz: str, now: datetime | None) -> datetime:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        zone = ZoneInfo(tz)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    return (now or datetime.now(zone)).astimezone(zone)


def gym_today(gym: Gym) -> date:
    return today_in(gym.timezone)
