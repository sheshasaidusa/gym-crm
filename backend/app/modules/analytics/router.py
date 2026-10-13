import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import DbSession
from app.core.permissions import Cap, branch_bound, ctx_with
from app.modules.analytics import dashboards, service
from app.modules.analytics.schemas import (
    AnalyticsOut,
    DeskDashboard,
    PersonRef,
    SalesDashboard,
    StaffAnalytics,
    TrainerDashboard,
)
from app.modules.auth.models import User
from app.modules.gyms.models import Branch, Gym, Role, StaffMembership
from app.modules.members.service import gym_today

AnalyticsContext = ctx_with(Cap.ANALYTICS)

TrainerBoardContext = ctx_with(Cap.CHECKUPS)  # owner, manager, trainer
DeskBoardContext = ctx_with(Cap.PAYMENTS)
SalesBoardContext = ctx_with(Cap.LEADS)

router = APIRouter(tags=["analytics"])


@router.get("/analytics", response_model=AnalyticsOut)
async def analytics(
    ctx: AnalyticsContext,
    db: DbSession,
    months: Annotated[int, Query(ge=1, le=24)] = 6,
    branch_id: uuid.UUID | None = None,
):
    """Members, money, leads and progress over the last `months` months (this one included)."""
    if branch_bound(ctx):
        branch_id = ctx.branch_id
    if branch_id is not None:
        found = await db.scalar(
            select(Branch.id).where(Branch.id == branch_id, Branch.gym_id == ctx.gym_id)
        )
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    gym = await db.get_one(Gym, ctx.gym_id)
    today = await gym_today(db, ctx.gym_id)
    return await service.build(db, gym, today, months, branch_id)


@router.get("/analytics/staff", response_model=StaffAnalytics)
async def staff_analytics(
    ctx: AnalyticsContext, db: DbSession, months: Annotated[int, Query(ge=1, le=12)] = 3
):
    """How each trainer and salesperson is doing over the last `months` months."""
    gym = await db.get_one(Gym, ctx.gym_id)
    return await dashboards.staff_analytics(db, ctx, gym, await gym_today(db, ctx.gym_id), months)


@router.get("/dashboard/trainer", response_model=TrainerDashboard)
async def trainer_dashboard(
    ctx: TrainerBoardContext, db: DbSession, trainer_id: uuid.UUID | None = None
):
    """A trainer's clients and what needs doing. Owners and managers can look at any trainer's."""
    if ctx.role == Role.TRAINER and trainer_id not in (None, ctx.user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trainer not found")
    subject_id = trainer_id or ctx.user.id
    subject = (
        await db.execute(
            select(User.id, User.name)
            .join(StaffMembership, StaffMembership.user_id == User.id)
            .where(StaffMembership.gym_id == ctx.gym_id, User.id == subject_id)
        )
    ).first()
    if subject is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trainer not found")
    gym = await db.get_one(Gym, ctx.gym_id)
    return await dashboards.trainer_dashboard(
        db, ctx, gym, await gym_today(db, ctx.gym_id), PersonRef(id=subject.id, name=subject.name)
    )


@router.get("/dashboard/desk", response_model=DeskDashboard)
async def desk_dashboard(ctx: DeskBoardContext, db: DbSession):
    """Today at the front desk: renewals, dues, takings and trials."""
    gym = await db.get_one(Gym, ctx.gym_id)
    return await dashboards.desk_dashboard(db, ctx, gym, await gym_today(db, ctx.gym_id))


@router.get("/dashboard/sales", response_model=SalesDashboard)
async def sales_dashboard(ctx: SalesBoardContext, db: DbSession):
    """The caller's pipeline against the team's, follow-ups and trials."""
    gym = await db.get_one(Gym, ctx.gym_id)
    return await dashboards.sales_dashboard(db, ctx, gym, await gym_today(db, ctx.gym_id))
