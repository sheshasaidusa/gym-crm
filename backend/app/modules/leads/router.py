import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.db import utcnow
from app.core.deps import CurrentContext, DbSession, ManagerContext, TenantContext, require_roles
from app.core.security import generate_url_token
from app.modules.audit import service as audit
from app.modules.gyms.models import Gym, Role
from app.modules.leads import service
from app.modules.leads.models import OPEN_STAGES, ActivityKind, Lead, LeadSource, LeadStage
from app.modules.leads.schemas import (
    ActivityIn,
    ConvertIn,
    LeadDetail,
    LeadFormSettings,
    LeadIn,
    LeadOut,
    LeadStats,
    LeadUpdate,
    StageIn,
)
from app.modules.members import service as members_service
from app.modules.members.models import Member
from app.modules.plans.models import Plan

router = APIRouter(prefix="/leads", tags=["leads"])

SOURCE_LABELS = {
    LeadSource.WALK_IN: "Walk-in",
    LeadSource.PHONE_CALL: "Phone call",
    LeadSource.INSTAGRAM: "Instagram",
    LeadSource.FACEBOOK: "Facebook",
    LeadSource.GOOGLE: "Google",
    LeadSource.REFERRAL: "Referral",
    LeadSource.WEBSITE: "Website",
    LeadSource.OTHER: "Other",
}

STAGE_LABELS = {
    LeadStage.NEW: "New",
    LeadStage.CONTACTED: "Contacted",
    LeadStage.TRIAL_BOOKED: "Trial booked",
    LeadStage.TRIAL_DONE: "Trial done",
    LeadStage.CONVERTED: "Converted",
    LeadStage.LOST: "Lost",
}

DeskContext = Annotated[
    TenantContext, Depends(require_roles(Role.OWNER, Role.MANAGER, Role.FRONT_DESK))
]


async def _lead(db: DbSession, gym_id: uuid.UUID, lead_id: uuid.UUID) -> Lead:
    lead = await db.scalar(
        select(Lead)
        .where(Lead.gym_id == gym_id, Lead.id == lead_id)
        .options(selectinload(Lead.activities))
        .execution_options(populate_existing=True)
    )
    if lead is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead not found")
    return lead


async def _ensure_plan(db: DbSession, gym_id: uuid.UUID, plan_id: uuid.UUID | None) -> None:
    if plan_id and not await db.scalar(
        select(Plan.id).where(Plan.gym_id == gym_id, Plan.id == plan_id)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")


def _duplicate(existing: Lead) -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        f"{existing.name} is already an open lead with this phone number",
    )


# --- Board & stats -----------------------------------------------------------


@router.get("", response_model=list[LeadOut])
async def list_leads(
    ctx: CurrentContext,
    db: DbSession,
    q: str | None = None,
    source: LeadSource | None = None,
    assigned: Annotated[str | None, Query(description='"me", "none" or a user id')] = None,
    due: bool = False,
    include_closed: bool = False,
):
    """All open leads (for the board), plus converted/lost ones from the last 30 days when
    include_closed is set. Follow-ups due first."""
    gym = await db.get_one(Gym, ctx.gym_id)
    today = await members_service.gym_today(db, ctx.gym_id)
    stmt = select(Lead).where(Lead.gym_id == ctx.gym_id)
    if include_closed:
        stmt = stmt.where(
            or_(Lead.stage.in_(OPEN_STAGES), Lead.updated_at >= utcnow() - timedelta(days=30))
        )
    else:
        stmt = stmt.where(Lead.stage.in_(OPEN_STAGES))
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        digits = "".join(ch for ch in q if ch.isdigit())
        conds = [func.lower(Lead.name).like(term), func.lower(Lead.interest).like(term)]
        if len(digits) >= 3:
            conds.append(Lead.phone.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    if source:
        stmt = stmt.where(Lead.source == source)
    if assigned == "me":
        stmt = stmt.where(Lead.assigned_to == ctx.user.id)
    elif assigned == "none":
        stmt = stmt.where(Lead.assigned_to.is_(None))
    elif assigned:
        try:
            stmt = stmt.where(Lead.assigned_to == uuid.UUID(assigned))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Invalid assignee") from exc
    if due:
        stmt = stmt.where(
            Lead.stage.in_(OPEN_STAGES),
            Lead.next_follow_up_at < service.end_of_day_utc(gym, today),
        )
    stmt = stmt.order_by(
        Lead.next_follow_up_at.is_(None), Lead.next_follow_up_at, Lead.created_at.desc()
    ).limit(500)
    return await service.leads_out(db, list((await db.scalars(stmt)).all()))


@router.get("/stats", response_model=LeadStats)
async def lead_stats(ctx: CurrentContext, db: DbSession):
    gym = await db.get_one(Gym, ctx.gym_id)
    today = await members_service.gym_today(db, ctx.gym_id)
    by_stage = dict(
        (
            await db.execute(
                select(Lead.stage, func.count())
                .where(Lead.gym_id == ctx.gym_id)
                .group_by(Lead.stage)
            )
        ).all()
    )
    due = await db.scalar(
        select(func.count()).where(
            Lead.gym_id == ctx.gym_id,
            Lead.stage.in_(OPEN_STAGES),
            Lead.next_follow_up_at < service.end_of_day_utc(gym, today),
        )
    )
    since_30 = utcnow() - timedelta(days=30)
    since_90 = utcnow() - timedelta(days=90)
    new_30 = await db.scalar(
        select(func.count()).where(Lead.gym_id == ctx.gym_id, Lead.created_at >= since_30)
    )
    conv_30 = await db.scalar(
        select(func.count()).where(Lead.gym_id == ctx.gym_id, Lead.converted_at >= since_30)
    )
    rows = (
        await db.execute(
            select(Lead.source, Lead.stage, func.count())
            .where(Lead.gym_id == ctx.gym_id, Lead.created_at >= since_90)
            .group_by(Lead.source, Lead.stage)
        )
    ).all()
    by_source: dict[LeadSource, dict[str, int]] = {}
    converted = lost = 0
    for src, stage, n in rows:
        entry = by_source.setdefault(src, {"leads": 0, "converted": 0})
        entry["leads"] += n
        if stage == LeadStage.CONVERTED:
            entry["converted"] += n
            converted += n
        elif stage == LeadStage.LOST:
            lost += n
    return LeadStats(
        open=sum(by_stage.get(s, 0) for s in OPEN_STAGES),
        by_stage={s: by_stage.get(s, 0) for s in LeadStage},
        follow_ups_due=due or 0,
        new_last_30_days=new_30 or 0,
        converted_last_30_days=conv_30 or 0,
        conversion_rate_90_days=round(converted / (converted + lost), 3)
        if converted + lost
        else None,
        by_source_90_days=by_source,
    )


# --- CRUD --------------------------------------------------------------------


@router.post("", response_model=LeadDetail, status_code=status.HTTP_201_CREATED)
async def create_lead(body: LeadIn, ctx: CurrentContext, db: DbSession):
    if existing := await service.open_lead_with_phone(db, ctx.gym_id, body.phone):
        raise _duplicate(existing)
    await service.ensure_staff(db, ctx.gym_id, body.assigned_to)
    await _ensure_plan(db, ctx.gym_id, body.interested_plan_id)
    lead = Lead(
        **body.model_dump(),
        gym_id=ctx.gym_id,
        stage=LeadStage.NEW,
        stage_changed_at=utcnow(),
        activities=[],
    )
    if lead.assigned_to is None:
        lead.assigned_to = ctx.user.id
    service.log(
        lead, ActivityKind.CREATED, f"Added · source: {SOURCE_LABELS[body.source]}", ctx.user.id
    )
    db.add(lead)
    await db.commit()
    return await service.lead_detail(db, await _lead(db, ctx.gym_id, lead.id))


@router.get("/form-settings", response_model=LeadFormSettings)
async def form_settings(ctx: CurrentContext, db: DbSession):
    gym = await db.get_one(Gym, ctx.gym_id)
    return _form_settings(gym)


@router.post("/form-settings", response_model=LeadFormSettings)
async def set_form_settings(
    enabled: bool, ctx: ManagerContext, db: DbSession, new_link: bool = False
):
    """Turns the public enquiry form on/off. new_link=true issues a fresh URL."""
    gym = await db.get_one(Gym, ctx.gym_id)
    if not enabled:
        gym.lead_form_token = None
    elif gym.lead_form_token is None or new_link:
        gym.lead_form_token = generate_url_token()
    await db.commit()
    return _form_settings(gym)


def _form_settings(gym: Gym) -> LeadFormSettings:
    token = gym.lead_form_token
    return LeadFormSettings(
        enabled=token is not None,
        url=f"{settings.frontend_url}/join/{token}" if token else None,
    )


@router.get("/{lead_id}", response_model=LeadDetail)
async def get_lead(lead_id: uuid.UUID, ctx: CurrentContext, db: DbSession):
    return await service.lead_detail(db, await _lead(db, ctx.gym_id, lead_id))


@router.patch("/{lead_id}", response_model=LeadDetail)
async def update_lead(lead_id: uuid.UUID, body: LeadUpdate, ctx: CurrentContext, db: DbSession):
    lead = await _lead(db, ctx.gym_id, lead_id)
    values = body.model_dump(exclude_unset=True)
    for required in ("name", "phone", "source"):
        if values.get(required, ...) is None:
            values.pop(required)
    if "phone" in values and (
        existing := await service.open_lead_with_phone(
            db, ctx.gym_id, values["phone"], exclude=lead.id
        )
    ):
        raise _duplicate(existing)
    if "assigned_to" in values:
        await service.ensure_staff(db, ctx.gym_id, values["assigned_to"])
    if "interested_plan_id" in values:
        await _ensure_plan(db, ctx.gym_id, values["interested_plan_id"])
    for key, value in values.items():
        setattr(lead, key, value)
    await db.commit()
    return await service.lead_detail(db, await _lead(db, ctx.gym_id, lead_id))


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(lead_id: uuid.UUID, ctx: ManagerContext, db: DbSession) -> None:
    lead = await _lead(db, ctx.gym_id, lead_id)
    await db.delete(lead)
    audit.record(db, ctx, "lead.deleted", f"Deleted lead {lead.name} ({lead.phone})")
    await db.commit()


# --- Pipeline actions --------------------------------------------------------


@router.post("/{lead_id}/stage", response_model=LeadDetail)
async def change_stage(lead_id: uuid.UUID, body: StageIn, ctx: CurrentContext, db: DbSession):
    lead = await _lead(db, ctx.gym_id, lead_id)
    if body.stage == LeadStage.CONVERTED:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Use “Convert to member” to convert a lead"
        )
    if lead.stage == LeadStage.CONVERTED:
        raise HTTPException(status.HTTP_409_CONFLICT, "This lead is already a member")
    if body.stage == LeadStage.LOST and not (body.lost_reason and body.lost_reason.strip()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Say why the lead was lost")
    if body.stage == lead.stage:
        return await service.lead_detail(db, lead)

    text = f"{STAGE_LABELS[lead.stage]} → {STAGE_LABELS[body.stage]}"
    if body.stage == LeadStage.LOST:
        lead.lost_reason = body.lost_reason.strip()
        lead.next_follow_up_at = None
        text += f": {lead.lost_reason}"
    elif lead.stage == LeadStage.LOST:
        lead.lost_reason = None  # re-opened
    if body.stage == LeadStage.TRIAL_BOOKED and body.trial_at:
        lead.trial_at = body.trial_at
        text += f" (trial {body.trial_at:%d %b, %H:%M} UTC)"
    lead.stage = body.stage
    lead.stage_changed_at = utcnow()
    service.log(lead, ActivityKind.STAGE, text, ctx.user.id)
    await db.commit()
    return await service.lead_detail(db, await _lead(db, ctx.gym_id, lead_id))


@router.post(
    "/{lead_id}/activities", response_model=LeadDetail, status_code=status.HTTP_201_CREATED
)
async def add_activity(lead_id: uuid.UUID, body: ActivityIn, ctx: CurrentContext, db: DbSession):
    lead = await _lead(db, ctx.gym_id, lead_id)
    service.log(lead, body.kind, body.content.strip(), ctx.user.id)
    if body.clear_follow_up:
        lead.next_follow_up_at = None
    elif body.next_follow_up_at is not None:
        lead.next_follow_up_at = body.next_follow_up_at
    # Logging contact with a brand-new lead moves it along the pipeline.
    if lead.stage == LeadStage.NEW and body.kind in (
        ActivityKind.CALL,
        ActivityKind.WHATSAPP,
        ActivityKind.VISIT,
    ):
        lead.stage = LeadStage.CONTACTED
        lead.stage_changed_at = utcnow()
        service.log(lead, ActivityKind.STAGE, "New → Contacted", ctx.user.id)
    await db.commit()
    return await service.lead_detail(db, await _lead(db, ctx.gym_id, lead_id))


@router.post("/{lead_id}/convert", response_model=LeadDetail)
async def convert(lead_id: uuid.UUID, body: ConvertIn, ctx: DeskContext, db: DbSession):
    """Creates a member from the lead (optionally with a first membership)."""
    lead = await _lead(db, ctx.gym_id, lead_id)
    if lead.stage == LeadStage.CONVERTED:
        raise HTTPException(status.HTTP_409_CONFLICT, "This lead is already a member")
    existing = await db.scalar(
        select(Member).where(Member.gym_id == ctx.gym_id, Member.phone == lead.phone)
    )
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{existing.name} is already a member with this phone number"
        )
    today = await members_service.gym_today(db, ctx.gym_id)
    notes = f"Joined from a lead (source: {SOURCE_LABELS[lead.source]})."
    if lead.interest:
        notes += f" Interested in: {lead.interest}."
    member = Member(
        gym_id=ctx.gym_id,
        name=lead.name,
        phone=lead.phone,
        email=lead.email,
        notes=notes,
        branch_id=ctx.branch_id,
        joined_on=today,
        memberships=[],
    )
    db.add(member)
    await db.flush()
    if body.membership:
        await members_service.add_membership(
            db, ctx.gym_id, member, body.membership, today, ctx.user.id
        )

    lead.stage = LeadStage.CONVERTED
    lead.converted_member_id = member.id
    lead.converted_at = lead.stage_changed_at = utcnow()
    lead.next_follow_up_at = None
    service.log(lead, ActivityKind.CONVERTED, "Converted to a member", ctx.user.id)
    audit.record(db, ctx, "lead.converted", f"Converted lead {lead.name} into a member", member.id)
    await db.commit()
    return await service.lead_detail(db, await _lead(db, ctx.gym_id, lead_id))
