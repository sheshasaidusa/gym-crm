"""Workout logging: members log sessions from the app; trainers see them on the member page."""

import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, select

from app.core.deps import CurrentMember, DbSession
from app.core.permissions import Cap, ctx_with, ensure_member_visible
from app.modules.ai_plans.content import PlanContent
from app.modules.member_app import service as member_service
from app.modules.members.models import Member
from app.modules.members.service import gym_today
from app.modules.workouts import service
from app.modules.workouts.models import WorkoutSession
from app.modules.workouts.schemas import WorkoutHistory, WorkoutIn, WorkoutOut, WorkoutTemplate

ViewContext = ctx_with(Cap.MEMBERS_VIEW)  # trainers: their own clients

HISTORY_DAYS = 365

# --- Members: their own sessions ---------------------------------------------------------------

m_router = APIRouter(prefix="/m", tags=["workouts"])


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


async def _history(db: DbSession, member_id: uuid.UUID, today: date) -> WorkoutHistory:
    rows = (
        await db.scalars(
            select(WorkoutSession)
            .where(
                WorkoutSession.member_id == member_id,
                WorkoutSession.performed_on >= today - timedelta(days=HISTORY_DAYS),
            )
            .order_by(WorkoutSession.performed_on.desc(), WorkoutSession.created_at.desc())
            .limit(1000)
        )
    ).all()
    return WorkoutHistory(
        sessions=[service.to_out(s, today) for s in rows[:50]],
        progress=service.progress(list(rows), today),
    )


async def _own(db: DbSession, ctx: CurrentMember, session_id: uuid.UUID) -> WorkoutSession:
    session = await db.scalar(
        select(WorkoutSession).where(
            WorkoutSession.id == session_id,
            WorkoutSession.member_id == ctx.member.id,
            WorkoutSession.gym_id == ctx.gym_id,
        )
    )
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workout not found")
    return session


def _check_date(day: date, today: date) -> None:
    if day > today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That date is in the future")
    if (today - day).days > service.EDIT_DAYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"You can log workouts up to {service.EDIT_DAYS} days back",
        )


@m_router.get("/workouts", response_model=WorkoutHistory)
async def my_workouts(ctx: CurrentMember, response: Response, db: DbSession):
    _no_store(response)
    return await _history(db, ctx.member.id, await gym_today(db, ctx.gym_id))


@m_router.get("/workouts/template", response_model=WorkoutTemplate)
async def my_template(
    ctx: CurrentMember,
    response: Response,
    db: DbSession,
    day: Annotated[str | None, Query(max_length=120)] = None,
):
    """A day of their published plan, ready to fill in. Without `day`, the day after the last
    one they logged."""
    _no_store(response)
    published = await member_service.published_plan(db, ctx.member.id)
    last = await db.scalar(
        select(WorkoutSession.day_label)
        .where(
            WorkoutSession.member_id == ctx.member.id,
            WorkoutSession.plan_id == (published.id if published else None),
        )
        .order_by(WorkoutSession.performed_on.desc(), WorkoutSession.created_at.desc())
        .limit(1)
    )
    plan = (
        PlanContent.model_validate(published.content) if published and published.content else None
    )
    return service.template(published.id if published else None, plan, day, last)


@m_router.post("/workouts", response_model=WorkoutOut, status_code=status.HTTP_201_CREATED)
async def log_workout(body: WorkoutIn, ctx: CurrentMember, db: DbSession):
    today = await gym_today(db, ctx.gym_id)
    day = body.performed_on or today
    _check_date(day, today)
    already = await db.scalar(
        select(func.count()).where(
            WorkoutSession.member_id == ctx.member.id, WorkoutSession.performed_on == day
        )
    )
    if (already or 0) >= service.MAX_PER_DAY:
        raise HTTPException(status.HTTP_409_CONFLICT, "That's plenty for one day")
    published = await member_service.published_plan(db, ctx.member.id)
    session = WorkoutSession(
        gym_id=ctx.gym_id,
        member_id=ctx.member.id,
        plan_id=published.id if published else None,
        day_label=body.day_label,
        performed_on=day,
        duration_min=body.duration_min,
        notes=body.notes,
        entries=[e.model_dump() for e in body.entries],
    )
    db.add(session)
    await db.commit()
    return service.to_out(session, today)


@m_router.patch("/workouts/{session_id}", response_model=WorkoutOut)
async def fix_workout(session_id: uuid.UUID, body: WorkoutIn, ctx: CurrentMember, db: DbSession):
    today = await gym_today(db, ctx.gym_id)
    session = await _own(db, ctx, session_id)
    if (today - session.performed_on).days > service.EDIT_DAYS:
        raise HTTPException(status.HTTP_409_CONFLICT, "This workout is too old to change")
    day = body.performed_on or session.performed_on
    _check_date(day, today)
    session.performed_on = day
    session.day_label = body.day_label
    session.duration_min = body.duration_min
    session.notes = body.notes
    session.entries = [e.model_dump() for e in body.entries]
    await db.commit()
    return service.to_out(session, today)


@m_router.delete("/workouts/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workout(session_id: uuid.UUID, ctx: CurrentMember, db: DbSession) -> None:
    today = await gym_today(db, ctx.gym_id)
    session = await _own(db, ctx, session_id)
    if (today - session.performed_on).days > service.EDIT_DAYS:
        raise HTTPException(status.HTTP_409_CONFLICT, "This workout is too old to delete")
    await db.delete(session)
    await db.commit()


# --- Staff: a member's sessions --------------------------------------------------------------

staff_router = APIRouter(tags=["workouts"])


@staff_router.get("/members/{member_id}/workouts", response_model=WorkoutHistory)
async def member_workouts(member_id: uuid.UUID, ctx: ViewContext, db: DbSession):
    member = await db.scalar(
        select(Member).where(Member.gym_id == ctx.gym_id, Member.id == member_id)
    )
    ensure_member_visible(ctx, member)
    return await _history(db, member.id, await gym_today(db, ctx.gym_id))
