import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.db import as_utc, get_sessionmaker, utcnow
from app.core.deps import CurrentContext, DbSession, TenantContext, require_roles
from app.modules.ai_plans import generator
from app.modules.ai_plans.content import PlanContent
from app.modules.ai_plans.models import AIPlan, PlanStatus
from app.modules.audit import service as audit
from app.modules.auth.models import User
from app.modules.checkups.models import CheckUp
from app.modules.gyms.models import Gym, Role
from app.modules.members.models import Member
from app.modules.members.schemas import StaffRef
from app.modules.members.service import gym_today

log = logging.getLogger("gym_crm.ai")
router = APIRouter(tags=["ai-plans"])

CoachContext = Annotated[
    TenantContext, Depends(require_roles(Role.OWNER, Role.MANAGER, Role.TRAINER))
]
Sessions = Annotated[async_sessionmaker[AsyncSession], Depends(get_sessionmaker)]

STALE_AFTER = timedelta(minutes=10)


class GenerateIn(BaseModel):
    days_per_week: int = Field(4, ge=2, le=6)
    session_minutes: int = Field(60, ge=30, le=120)
    equipment: Literal["full_gym", "basic", "bodyweight"] = "full_gym"
    instructions: str | None = Field(None, max_length=1000)


class AIPlanUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: PlanContent | None = None


class AIPlanOut(BaseModel):
    id: uuid.UUID
    member_id: uuid.UUID
    version: int
    status: PlanStatus
    title: str
    params: dict
    content: PlanContent | None
    error: str | None
    model: str | None
    created_by: StaffRef | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AIStatus(BaseModel):
    configured: bool
    used_this_month: int
    monthly_limit: int
    model: str


# --- Helpers ----------------------------------------------------------------


async def _out(db: AsyncSession, p: AIPlan) -> AIPlanOut:
    name = (
        await db.scalar(select(User.name).where(User.id == p.created_by)) if p.created_by else None
    )
    return AIPlanOut(
        id=p.id,
        member_id=p.member_id,
        version=p.version,
        status=p.status,
        title=p.title,
        params=p.params or {},
        content=PlanContent.model_validate(p.content) if p.content else None,
        error=p.error,
        model=p.model,
        created_by=StaffRef(id=p.created_by, name=name) if p.created_by and name else None,
        published_at=p.published_at,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


async def _expire_stale(db: AsyncSession, gym_id: uuid.UUID) -> None:
    """A generation that never finished (e.g. the server restarted) is marked failed."""
    await db.execute(
        update(AIPlan)
        .where(
            AIPlan.gym_id == gym_id,
            AIPlan.status == PlanStatus.GENERATING,
            AIPlan.created_at < utcnow() - STALE_AFTER,
        )
        .values(status=PlanStatus.FAILED, error="Generation timed out. Try again.")
    )
    await db.commit()


async def _plan(db: AsyncSession, gym_id: uuid.UUID, plan_id: uuid.UUID) -> AIPlan:
    p = await db.scalar(
        select(AIPlan)
        .where(AIPlan.gym_id == gym_id, AIPlan.id == plan_id)
        .execution_options(populate_existing=True)
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return p


async def _member(db: AsyncSession, gym_id: uuid.UUID, member_id: uuid.UUID) -> Member:
    m = await db.scalar(select(Member).where(Member.gym_id == gym_id, Member.id == member_id))
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return m


def _month_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def _used_this_month(db: AsyncSession, gym_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count()).where(AIPlan.gym_id == gym_id, AIPlan.created_at >= _month_start())
        )
        or 0
    )


async def member_context(db: AsyncSession, member: Member, gym: Gym) -> dict:
    """What Claude needs about the member - deliberately without name or contact details."""
    today = await gym_today(db, gym.id)
    checkups = (
        await db.scalars(
            select(CheckUp)
            .where(CheckUp.member_id == member.id)
            .order_by(CheckUp.recorded_on.desc())
            .limit(6)
        )
    ).all()
    age = None
    if member.dob:
        age = (
            today.year
            - member.dob.year
            - ((today.month, today.day) < (member.dob.month, member.dob.day))
        )

    def metrics(c: CheckUp) -> dict:
        fields = (
            "weight_kg",
            "bmi",
            "body_fat_pct",
            "muscle_mass_kg",
            "waist_cm",
            "chest_cm",
            "hips_cm",
        )
        return {
            "date": c.recorded_on.isoformat(),
            **{f: getattr(c, f) for f in fields if getattr(c, f) is not None},
        }

    return {
        "age": age,
        "sex": member.gender.value if member.gender else None,
        "height_cm": member.height_cm,
        "goals": member.goals or ["general_fitness"],
        "diet_preference": member.diet_pref.value if member.diet_pref else "not specified",
        "experience_level": member.experience_level.value
        if member.experience_level
        else "beginner",
        "medical_notes": member.medical_notes or "none reported",
        "recent_checkups_newest_first": [metrics(c) for c in checkups],
        "gym_time_zone": gym.timezone,
    }


async def _run_generation(sessions: async_sessionmaker[AsyncSession], plan_id: uuid.UUID) -> None:
    async with sessions() as db:
        plan = await db.get(AIPlan, plan_id)
        if plan is None:
            return
        member = await db.get_one(Member, plan.member_id)
        gym = await db.get_one(Gym, plan.gym_id)
        try:
            result = await generator.generate_plan(
                await member_context(db, member, gym), plan.params
            )
        except (generator.GenerationError, generator.AIUnavailable) as exc:
            plan.status, plan.error = PlanStatus.FAILED, str(exc)
        except Exception:
            log.exception("AI plan generation crashed")
            plan.status, plan.error = PlanStatus.FAILED, "Something went wrong. Try again."
        else:
            plan.status = PlanStatus.DRAFT
            plan.content = result.content.model_dump()
            plan.model = result.model
            plan.input_tokens = result.input_tokens
            plan.output_tokens = result.output_tokens
        await db.commit()


# --- Endpoints --------------------------------------------------------------


@router.get("/ai/status", response_model=AIStatus)
async def ai_status(ctx: CurrentContext, db: DbSession):
    return AIStatus(
        configured=generator.is_configured(),
        used_this_month=await _used_this_month(db, ctx.gym_id),
        monthly_limit=settings.ai_monthly_plan_limit,
        model=settings.ai_model,
    )


@router.get("/members/{member_id}/ai-plans", response_model=list[AIPlanOut])
async def list_plans(member_id: uuid.UUID, ctx: CurrentContext, db: DbSession):
    await _member(db, ctx.gym_id, member_id)
    await _expire_stale(db, ctx.gym_id)
    plans = (
        await db.scalars(
            select(AIPlan)
            .where(AIPlan.gym_id == ctx.gym_id, AIPlan.member_id == member_id)
            .order_by(AIPlan.version.desc())
        )
    ).all()
    return [await _out(db, p) for p in plans]


@router.post(
    "/members/{member_id}/ai-plans", response_model=AIPlanOut, status_code=status.HTTP_202_ACCEPTED
)
async def generate(
    member_id: uuid.UUID,
    body: GenerateIn,
    ctx: CoachContext,
    db: DbSession,
    sessions: Sessions,
    background: BackgroundTasks,
):
    """Starts generating a new plan version. Poll the plan until it's no longer 'generating'."""
    member = await _member(db, ctx.gym_id, member_id)
    if not generator.is_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI plans aren't set up. Add ANTHROPIC_API_KEY to the server settings.",
        )
    if await _used_this_month(db, ctx.gym_id) >= settings.ai_monthly_plan_limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Your gym has used all {settings.ai_monthly_plan_limit} AI plans for this month.",
        )
    await _expire_stale(db, ctx.gym_id)
    busy = await db.scalar(
        select(AIPlan.id).where(
            AIPlan.member_id == member.id, AIPlan.status == PlanStatus.GENERATING
        )
    )
    if busy:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A plan is already being generated for this member"
        )

    version = (
        await db.scalar(select(func.max(AIPlan.version)).where(AIPlan.member_id == member.id)) or 0
    ) + 1
    plan = AIPlan(
        gym_id=ctx.gym_id,
        member_id=member.id,
        version=version,
        status=PlanStatus.GENERATING,
        title=f"Plan v{version}",
        params=body.model_dump(),
        created_by=ctx.user.id,
    )
    db.add(plan)
    await db.commit()
    background.add_task(_run_generation, sessions, plan.id)
    return await _out(db, plan)


@router.get("/ai-plans/{plan_id}", response_model=AIPlanOut)
async def get_plan(plan_id: uuid.UUID, ctx: CurrentContext, db: DbSession):
    await _expire_stale(db, ctx.gym_id)
    return await _out(db, await _plan(db, ctx.gym_id, plan_id))


@router.patch("/ai-plans/{plan_id}", response_model=AIPlanOut)
async def update_plan(plan_id: uuid.UUID, body: AIPlanUpdate, ctx: CoachContext, db: DbSession):
    """Trainer edits. Published plans can be edited too; members see changes right away."""
    p = await _plan(db, ctx.gym_id, plan_id)
    if p.status not in (PlanStatus.DRAFT, PlanStatus.PUBLISHED):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {p.status.value} plan can't be edited")
    if body.title is not None:
        p.title = body.title
    if body.content is not None:
        p.content = body.content.model_dump()
    await db.commit()
    return await _out(db, await _plan(db, ctx.gym_id, plan_id))


@router.post("/ai-plans/{plan_id}/publish", response_model=AIPlanOut)
async def publish_plan(plan_id: uuid.UUID, ctx: CoachContext, db: DbSession):
    p = await _plan(db, ctx.gym_id, plan_id)
    if p.status not in (PlanStatus.DRAFT, PlanStatus.ARCHIVED) or not p.content:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only a reviewed draft or older version can be published"
        )
    await db.execute(
        update(AIPlan)
        .where(AIPlan.member_id == p.member_id, AIPlan.status == PlanStatus.PUBLISHED)
        .values(status=PlanStatus.ARCHIVED)
    )
    p.status = PlanStatus.PUBLISHED
    p.published_at = utcnow()
    p.published_by = ctx.user.id
    name = await db.scalar(select(Member.name).where(Member.id == p.member_id))
    audit.record(
        db, ctx, "ai_plan.published", f"Published version {p.version} of {name}'s plan", p.id
    )
    await db.commit()
    return await _out(db, await _plan(db, ctx.gym_id, plan_id))


@router.post("/ai-plans/{plan_id}/unpublish", response_model=AIPlanOut)
async def unpublish_plan(plan_id: uuid.UUID, ctx: CoachContext, db: DbSession):
    p = await _plan(db, ctx.gym_id, plan_id)
    if p.status != PlanStatus.PUBLISHED:
        raise HTTPException(status.HTTP_409_CONFLICT, "This plan isn't published")
    p.status = PlanStatus.DRAFT
    name = await db.scalar(select(Member.name).where(Member.id == p.member_id))
    audit.record(
        db, ctx, "ai_plan.unpublished", f"Unpublished {name}'s plan (version {p.version})", p.id
    )
    await db.commit()
    return await _out(db, await _plan(db, ctx.gym_id, plan_id))


@router.delete("/ai-plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(plan_id: uuid.UUID, ctx: CoachContext, db: DbSession) -> None:
    p = await _plan(db, ctx.gym_id, plan_id)
    if p.status == PlanStatus.PUBLISHED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Unpublish this plan before deleting it")
    if p.status == PlanStatus.GENERATING and as_utc(p.created_at) > utcnow() - STALE_AFTER:
        raise HTTPException(status.HTTP_409_CONFLICT, "Wait for generation to finish")
    await db.delete(p)
    await db.commit()
