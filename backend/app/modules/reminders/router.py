import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from app.core.config import settings
from app.core.deps import (
    CurrentContext,
    DbSession,
    ManagerContext,
    OwnerContext,
    TenantContext,
    require_roles,
)
from app.core.schemas import Page
from app.modules.audit import service as audit
from app.modules.auth.models import User
from app.modules.gyms.models import Gym, Role
from app.modules.members.models import Member, Membership
from app.modules.reminders import service
from app.modules.reminders.models import Channel, ReminderLog
from app.modules.reminders.schemas import (
    DueList,
    DueReminderOut,
    HistoryItem,
    PreviewIn,
    PreviewOut,
    ReminderSettingsOut,
    ReminderSettingsUpdate,
    RunSummaryOut,
    WhatsAppLogIn,
)
from app.modules.reminders.templates import (
    PLACEHOLDERS,
    Kind,
    render,
    template_for,
    values_for,
)

router = APIRouter(prefix="/reminders", tags=["reminders"])

DeskContext = Annotated[
    TenantContext, Depends(require_roles(Role.OWNER, Role.MANAGER, Role.FRONT_DESK))
]


def _due_out(item: service.DueReminder) -> DueReminderOut:
    email_log = item.logs.get(Channel.EMAIL)
    wa_log = item.logs.get(Channel.WHATSAPP)
    return DueReminderOut(
        membership_id=item.membership.id,
        member_id=item.member.id,
        member_name=item.member.name,
        phone=item.member.phone,
        email=item.member.email,
        plan_name=item.membership.plan_name,
        end_date=item.membership.end_date,
        offset_days=item.offset_days,
        kind=item.kind,
        subject=item.subject,
        body=item.body,
        email_status=email_log.status if email_log else None,
        email_error=email_log.error if email_log else None,
        whatsapp_sent_at=(wa_log.updated_at or wa_log.created_at) if wa_log else None,
    )


@router.get("/due", response_model=DueList)
async def due(ctx: DeskContext, db: DbSession, day: date | None = None):
    """Reminders due on `day` (default: today in the gym's time zone)."""
    gym = await db.get_one(Gym, ctx.gym_id)
    today = service.gym_today(gym)
    day = day or today
    if abs((day - today).days) > 60:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a date within 60 days")
    items = await service.due_reminders(db, gym, day)
    return DueList(
        day=day, items=[_due_out(i) for i in items], email_provider=settings.email_provider
    )


@router.post("/run", response_model=RunSummaryOut)
async def run_now(ctx: ManagerContext, db: DbSession):
    """Sends today's due reminder emails now, retrying any that failed earlier."""
    gym = await db.get_one(Gym, ctx.gym_id)
    summary = await service.send_due_emails(
        db, gym, service.gym_today(gym), retry_failed=True, triggered_by=ctx.user.id
    )
    return RunSummaryOut(**summary.__dict__)


@router.post("/whatsapp", status_code=status.HTTP_204_NO_CONTENT)
async def log_whatsapp(body: WhatsAppLogIn, ctx: DeskContext, db: DbSession) -> None:
    membership = await db.scalar(
        select(Membership).where(
            Membership.gym_id == ctx.gym_id, Membership.id == body.membership_id
        )
    )
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
    await service.record_whatsapp(db, ctx.gym_id, membership, body.offset_days, ctx.user.id)
    await db.commit()


@router.get("/history", response_model=Page[HistoryItem])
async def history(
    ctx: DeskContext,
    db: DbSession,
    channel: Channel | None = None,
    member_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    stmt = (
        select(ReminderLog, Member.name, Membership.plan_name, Membership.end_date, User.name)
        .join(Member, Member.id == ReminderLog.member_id)
        .join(Membership, Membership.id == ReminderLog.membership_id)
        .outerjoin(User, User.id == ReminderLog.sent_by)
        .where(ReminderLog.gym_id == ctx.gym_id)
    )
    if channel:
        stmt = stmt.where(ReminderLog.channel == channel)
    if member_id:
        stmt = stmt.where(ReminderLog.member_id == member_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.execute(
        stmt.order_by(func.coalesce(ReminderLog.updated_at, ReminderLog.created_at).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [
        HistoryItem(
            id=lg.id,
            member_id=lg.member_id,
            member_name=member_name,
            plan_name=plan_name,
            end_date=end_date,
            offset_days=lg.offset_days,
            channel=lg.channel,
            status=lg.status,
            recipient=lg.recipient,
            error=lg.error,
            sent_by_name=sent_by,
            sent_at=lg.updated_at or lg.created_at,
        )
        for lg, member_name, plan_name, end_date, sent_by in rows.all()
    ]
    return Page(items=items, total=total, page=page, page_size=page_size)


def _settings_out(gym: Gym) -> ReminderSettingsOut:
    stored = gym.reminder_templates or {}
    return ReminderSettingsOut(
        enabled=gym.reminders_enabled,
        hour=gym.reminder_hour,
        offsets=gym.reminder_offsets or [],
        templates={k: template_for(stored, k) for k in Kind},
        customized=[k for k in Kind if stored.get(k.value)],
        placeholders=PLACEHOLDERS,
        email_provider=settings.email_provider,
    )


@router.get("/settings", response_model=ReminderSettingsOut)
async def get_settings(ctx: CurrentContext, db: DbSession):
    return _settings_out(await db.get_one(Gym, ctx.gym_id))


@router.patch("/settings", response_model=ReminderSettingsOut)
async def update_settings(body: ReminderSettingsUpdate, ctx: OwnerContext, db: DbSession):
    gym = await db.get_one(Gym, ctx.gym_id)
    if body.enabled is not None:
        gym.reminders_enabled = body.enabled
    if body.hour is not None:
        gym.reminder_hour = body.hour
    if body.offsets is not None:
        gym.reminder_offsets = body.offsets
    if body.templates is not None:
        stored = dict(gym.reminder_templates or {})
        for kind, template in body.templates.items():
            if template is None:
                stored.pop(kind.value, None)
            else:
                stored[kind.value] = template.model_dump()
        gym.reminder_templates = stored  # reassign so SQLAlchemy sees the JSON change
    changed = [k for k, v in body.model_dump().items() if v is not None]
    if changed:
        audit.record(
            db, ctx, "reminders.updated", f"Changed reminder settings: {', '.join(changed)}"
        )
    await db.commit()
    return _settings_out(gym)


@router.post("/preview", response_model=PreviewOut)
async def preview(body: PreviewIn, ctx: CurrentContext, db: DbSession):
    """Renders a template with sample member data, for the template editor."""
    gym = await db.get_one(Gym, ctx.gym_id)
    offset = {Kind.BEFORE: 7, Kind.ON_DAY: 0, Kind.AFTER: -3}[body.kind]
    values = values_for(
        member_name="Priya Sharma",
        plan_name="Quarterly – Gym + Cardio",
        end_date=service.gym_today(gym) + timedelta(days=offset),
        offset_days=offset,
        gym_name=gym.name,
        gym_phone=gym.phone,
        preview_link=f"{settings.frontend_url}/p/example",
    )
    return PreviewOut(
        subject=render(body.template.subject, values), body=render(body.template.body, values)
    )
