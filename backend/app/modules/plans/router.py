import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select

from app.core.deps import CurrentContext, DbSession, ManagerContext
from app.modules.audit import service as audit
from app.modules.members.models import Membership
from app.modules.members.service import PlanRepository, conflict, gym_today
from app.modules.plans.models import Plan
from app.modules.plans.schemas import PlanIn, PlanOut, PlanUpdate

router = APIRouter(prefix="/plans", tags=["plans"])


async def _active_counts(db: DbSession, gym_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """Members currently on each plan (running today, including frozen)."""
    today = await gym_today(db, gym_id)
    rows = await db.execute(
        select(Membership.plan_id, func.count(func.distinct(Membership.member_id)))
        .where(
            Membership.gym_id == gym_id,
            Membership.cancelled_at.is_(None),
            Membership.start_date <= today,
            Membership.end_date >= today,
        )
        .group_by(Membership.plan_id)
    )
    return {plan_id: n for plan_id, n in rows.all() if plan_id}


def _out(plan: Plan, counts: dict[uuid.UUID, int]) -> PlanOut:
    out = PlanOut.model_validate(plan)
    out.active_members = counts.get(plan.id, 0)
    return out


@router.get("", response_model=list[PlanOut])
async def list_plans(ctx: CurrentContext, db: DbSession, include_archived: bool = False):
    repo = PlanRepository(db, ctx.gym_id)
    stmt = repo.query().order_by(Plan.is_active.desc(), Plan.price)
    if not include_archived:
        stmt = stmt.where(Plan.is_active.is_(True))
    counts = await _active_counts(db, ctx.gym_id)
    return [_out(p, counts) for p in await repo.list(stmt)]


@router.post("", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
async def create_plan(body: PlanIn, ctx: ManagerContext, db: DbSession):
    plan = await PlanRepository(db, ctx.gym_id).create(**body.model_dump())
    audit.record(db, ctx, "plan.created", f"Created plan {plan.name}", plan.id)
    await db.commit()
    return _out(plan, {})


@router.get("/{plan_id}", response_model=PlanOut)
async def get_plan(plan_id: uuid.UUID, ctx: CurrentContext, db: DbSession):
    plan = await PlanRepository(db, ctx.gym_id).get_or_404(plan_id)
    return _out(plan, await _active_counts(db, ctx.gym_id))


@router.patch("/{plan_id}", response_model=PlanOut)
async def update_plan(plan_id: uuid.UUID, body: PlanUpdate, ctx: ManagerContext, db: DbSession):
    """Changes apply to future memberships only; existing ones keep their copied terms."""
    repo = PlanRepository(db, ctx.gym_id)
    values = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    plan = await repo.get_or_404(plan_id)
    changed = audit.changes({k: getattr(plan, k) for k in values}, values)
    plan = await repo.update(plan, values)
    if changed:
        if set(changed) == {"is_active"}:
            action, verb = (
                ("plan.restored", "Reactivated")
                if plan.is_active
                else (
                    "plan.archived",
                    "Archived",
                )
            )
            audit.record(db, ctx, action, f"{verb} plan {plan.name}", plan.id)
        else:
            audit.record(
                db, ctx, "plan.updated", f"Edited plan {plan.name}", plan.id, {"changes": changed}
            )
    await db.commit()
    return _out(plan, await _active_counts(db, ctx.gym_id))


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(plan_id: uuid.UUID, ctx: ManagerContext, db: DbSession) -> None:
    repo = PlanRepository(db, ctx.gym_id)
    plan = await repo.get_or_404(plan_id)
    used = await db.scalar(select(Membership.id).where(Membership.plan_id == plan.id).limit(1))
    if used:
        raise conflict("This plan has been sold before, so it can only be archived")
    await repo.delete(plan)
    audit.record(db, ctx, "plan.deleted", f"Deleted plan {plan.name}")
    await db.commit()
