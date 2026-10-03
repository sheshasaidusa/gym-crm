import uuid
from datetime import date, datetime, time, timedelta
from typing import Annotated, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.deps import DbSession, OwnerContext
from app.core.schemas import Page
from app.modules.audit.models import AuditLog
from app.modules.gyms.models import Gym

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    actor_id: uuid.UUID | None
    actor_name: str
    action: str
    target_type: str
    target_id: uuid.UUID | None
    summary: str
    details: dict[str, Any] | None


@router.get("", response_model=Page[AuditOut])
async def list_audit(
    ctx: OwnerContext,
    db: DbSession,
    target_type: str | None = None,
    actor_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
):
    """The gym's activity log, newest first. Owners only: it covers managers too."""
    gym = await db.get_one(Gym, ctx.gym_id)
    try:
        tz = ZoneInfo(gym.timezone)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")

    conds = [AuditLog.gym_id == ctx.gym_id]
    if target_type:
        conds.append(AuditLog.target_type == target_type)
    if actor_id:
        conds.append(AuditLog.actor_id == actor_id)
    if date_from:
        conds.append(AuditLog.created_at >= datetime.combine(date_from, time.min, tz))
    if date_to:
        conds.append(
            AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min, tz)
        )
    if q and q.strip():
        conds.append(AuditLog.summary.ilike(f"%{q.strip()}%"))

    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*conds)) or 0
    rows = await db.scalars(
        select(AuditLog)
        .where(*conds)
        .order_by(AuditLog.created_at.desc(), AuditLog.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return Page(
        items=[AuditOut.model_validate(r, from_attributes=True) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )
