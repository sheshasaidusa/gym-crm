"""Attendance: check-ins at the front desk, scanner punches, and the devices that send them."""

import hashlib
import secrets
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.db import utcnow
from app.core.deps import CurrentDevice, DbSession
from app.core.permissions import Cap, ctx_with, ensure_member_visible, scope_members
from app.core.ratelimit import RateLimiter
from app.modules.attendance import service
from app.modules.attendance.models import Attendance, AttendanceSource, Device
from app.modules.attendance.schemas import (
    CheckInIn,
    CheckInOut,
    DayList,
    DeviceCreated,
    DeviceIn,
    DeviceOut,
    DeviceUpdate,
    PunchesIn,
    PunchesOut,
    VisitHistory,
    VisitRow,
)
from app.modules.audit import service as audit
from app.modules.gyms.models import Branch, Gym
from app.modules.members.models import Member
from app.modules.members.service import gym_today

DeskContext = ctx_with(Cap.ATTENDANCE)
DevicesContext = ctx_with(Cap.DEVICES)
ViewContext = ctx_with(Cap.MEMBERS_VIEW)  # a member's history: trainers see their own clients

router = APIRouter(tags=["attendance"])

device_limiter = RateLimiter(120, 60)  # scanners batch, so this is generous


async def _member(db: DbSession, ctx, member_id: uuid.UUID) -> Member:
    member = await db.scalar(
        select(Member)
        .where(Member.gym_id == ctx.gym_id, Member.id == member_id)
        .options(selectinload(Member.memberships))
    )
    ensure_member_visible(ctx, member)
    return member


# --- Front desk -----------------------------------------------------------------------------


@router.post("/attendance", response_model=CheckInOut)
async def check_in(body: CheckInIn, ctx: DeskContext, db: DbSession):
    """Check a member in now. Doing it twice in a day returns the first visit. An expired or
    frozen membership gives a warning but never blocks the visit."""
    member = await _member(db, ctx, body.member_id)
    gym = await db.get_one(Gym, ctx.gym_id)
    visit, created = await service.record_visit(
        db, gym, member, utcnow(), AttendanceSource.DESK, recorded_by=ctx.user.id
    )
    await db.commit()
    return CheckInOut(
        id=visit.id,
        member_id=member.id,
        member_name=member.name,
        checked_in_at=visit.checked_in_at,
        already=not created,
        warning=service.membership_warning(member, await gym_today(db, ctx.gym_id)),
    )


@router.delete("/attendance/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def undo_check_in(visit_id: uuid.UUID, ctx: DeskContext, db: DbSession) -> None:
    """Undo a mistaken check-in. Only today's; older visits are history."""
    visit = await db.scalar(
        select(Attendance).where(Attendance.gym_id == ctx.gym_id, Attendance.id == visit_id)
    )
    member = await db.get(Member, visit.member_id) if visit else None
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    ensure_member_visible(ctx, member)
    if visit.local_date != await gym_today(db, ctx.gym_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Only today's check-ins can be undone")
    await db.delete(visit)
    await db.commit()


@router.get("/attendance", response_model=DayList)
async def day_list(
    ctx: DeskContext, db: DbSession, on: Annotated[date | None, Query(alias="date")] = None
):
    """Who came in on a day (default today), latest first."""
    day = on or await gym_today(db, ctx.gym_id)
    stmt = scope_members(
        select(Attendance, Member.name, Member.phone)
        .join(Member, Member.id == Attendance.member_id)
        .where(Attendance.gym_id == ctx.gym_id, Attendance.local_date == day),
        ctx,
    )
    rows = (await db.execute(stmt.order_by(Attendance.checked_in_at.desc()).limit(500))).all()
    return DayList(
        date=day,
        total=len(rows),
        items=[
            VisitRow(
                id=a.id,
                member_id=a.member_id,
                member_name=name,
                phone=phone,
                checked_in_at=a.checked_in_at,
                source=a.source,
            )
            for a, name, phone in rows
        ],
    )


@router.get("/members/{member_id}/attendance", response_model=VisitHistory)
async def member_history(
    member_id: uuid.UUID,
    ctx: ViewContext,
    db: DbSession,
    days: Annotated[int, Query(ge=7, le=365)] = 90,
):
    member = await _member(db, ctx, member_id)
    today = await gym_today(db, ctx.gym_id)
    return await service.history(db, member.id, today, days)


# --- Devices --------------------------------------------------------------------------------


def _new_key() -> tuple[str, str]:
    key = "dev_" + secrets.token_urlsafe(32)
    return key, hashlib.sha256(key.encode()).hexdigest()


async def _device(db: DbSession, ctx, device_id: uuid.UUID) -> Device:
    device = await db.scalar(
        select(Device).where(Device.gym_id == ctx.gym_id, Device.id == device_id)
    )
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    return device


async def _check_branch(db: DbSession, ctx, branch_id: uuid.UUID | None) -> None:
    if branch_id is not None:
        found = await db.scalar(
            select(Branch.id).where(Branch.gym_id == ctx.gym_id, Branch.id == branch_id)
        )
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")


@router.get("/devices", response_model=list[DeviceOut])
async def list_devices(ctx: DevicesContext, db: DbSession):
    rows = await db.scalars(
        select(Device).where(Device.gym_id == ctx.gym_id).order_by(Device.created_at)
    )
    return list(rows.all())


@router.post("/devices", response_model=DeviceCreated, status_code=status.HTTP_201_CREATED)
async def create_device(body: DeviceIn, ctx: DevicesContext, db: DbSession):
    await _check_branch(db, ctx, body.branch_id)
    key, key_hash = _new_key()
    device = Device(
        gym_id=ctx.gym_id, name=body.name, branch_id=body.branch_id, api_key_hash=key_hash
    )
    db.add(device)
    await db.flush()
    audit.record(db, ctx, "device.created", f"Added device {device.name}", device.id)
    await db.commit()
    return DeviceCreated(
        **DeviceOut.model_validate(device, from_attributes=True).model_dump(), api_key=key
    )


@router.post("/devices/{device_id}/rotate-key", response_model=DeviceCreated)
async def rotate_key(device_id: uuid.UUID, ctx: DevicesContext, db: DbSession):
    """A new key; the old one stops working at once."""
    device = await _device(db, ctx, device_id)
    key, device.api_key_hash = _new_key()
    audit.record(db, ctx, "device.key_rotated", f"New key for device {device.name}", device.id)
    await db.commit()
    return DeviceCreated(
        **DeviceOut.model_validate(device, from_attributes=True).model_dump(), api_key=key
    )


@router.patch("/devices/{device_id}", response_model=DeviceOut)
async def update_device(
    device_id: uuid.UUID, body: DeviceUpdate, ctx: DevicesContext, db: DbSession
):
    device = await _device(db, ctx, device_id)
    values = body.model_dump(exclude_unset=True)
    if values.get("name") is None:
        values.pop("name", None)
    if values.get("is_active") is None:
        values.pop("is_active", None)
    if "branch_id" in values:
        await _check_branch(db, ctx, values["branch_id"])
    for k, v in values.items():
        setattr(device, k, v)
    audit.record(db, ctx, "device.updated", f"Updated device {device.name}", device.id)
    await db.commit()
    return device


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(device_id: uuid.UUID, ctx: DevicesContext, db: DbSession) -> None:
    device = await _device(db, ctx, device_id)
    audit.record(db, ctx, "device.deleted", f"Removed device {device.name}", device.id)
    await db.delete(device)  # its past visits stay (device_id becomes null)
    await db.commit()


# --- Scanner punches (device key, not a user) -----------------------------------------------


@router.post(
    "/attendance/punches", response_model=PunchesOut, dependencies=[Depends(device_limiter)]
)
async def report_punches(body: PunchesIn, ctx: CurrentDevice, db: DbSession):
    """Scanners and turnstiles post their punches here with an `X-Device-Key` header. Safe to
    resend: a punch already reported, or a second one from a member that day, is counted as a
    duplicate. See docs/attendance-ingestion.md."""
    gym = await db.get_one(Gym, ctx.gym_id)
    wanted = {p.user_id for p in body.punches}
    members = {
        m.device_user_id: m
        for m in (
            await db.scalars(
                select(Member).where(Member.gym_id == ctx.gym_id, Member.device_user_id.in_(wanted))
            )
        ).all()
    }
    already = set(
        (
            await db.scalars(
                select(Attendance.device_ref).where(
                    Attendance.device_id == ctx.device.id,
                    Attendance.device_ref.in_({p.ref for p in body.punches}),
                )
            )
        ).all()
    )
    created = duplicates = 0
    unknown: list[str] = []
    for punch in sorted(body.punches, key=lambda p: p.at):
        member = members.get(punch.user_id)
        if member is None:
            if punch.user_id not in unknown:
                unknown.append(punch.user_id)
            continue
        if punch.ref in already:
            duplicates += 1
            continue
        _, new = await service.record_visit(
            db,
            gym,
            member,
            punch.at,
            AttendanceSource.DEVICE,
            device_id=ctx.device.id,
            device_ref=punch.ref,
        )
        created += new
        duplicates += not new
        already.add(punch.ref)
    ctx.device.last_seen_at = utcnow()
    await db.commit()
    return PunchesOut(created=created, duplicates=duplicates, unknown_user_ids=unknown)
