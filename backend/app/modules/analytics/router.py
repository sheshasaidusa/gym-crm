import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import DbSession, ManagerContext
from app.modules.analytics import service
from app.modules.analytics.schemas import AnalyticsOut
from app.modules.gyms.models import Branch, Gym
from app.modules.members.service import gym_today

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("", response_model=AnalyticsOut)
async def analytics(
    ctx: ManagerContext,
    db: DbSession,
    months: Annotated[int, Query(ge=1, le=24)] = 6,
    branch_id: uuid.UUID | None = None,
):
    """Members, money, leads and progress over the last `months` months (this one included)."""
    if branch_id is not None:
        found = await db.scalar(
            select(Branch.id).where(Branch.id == branch_id, Branch.gym_id == ctx.gym_id)
        )
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")
    gym = await db.get_one(Gym, ctx.gym_id)
    today = await gym_today(db, ctx.gym_id)
    return await service.build(db, gym, today, months, branch_id)
