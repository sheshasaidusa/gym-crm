import uuid
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased, selectinload

from app.core.deps import CurrentContext, DbSession, TenantContext
from app.core.schemas import Page
from app.core.storage import IMAGE_TYPES, get_storage, sniff_image_type
from app.modules.audit import service as audit
from app.modules.auth.models import User
from app.modules.checkups.models import CheckUp, CheckUpPhoto
from app.modules.checkups.schemas import (
    CheckUpIn,
    CheckUpOut,
    CheckUpUpdate,
    DueCheckUp,
    PhotoOut,
)
from app.modules.gyms.models import Gym, Role
from app.modules.members.models import Member, Membership
from app.modules.members.schemas import StaffRef
from app.modules.members.service import gym_today

router = APIRouter(tags=["checkups"])

MAX_PHOTO_BYTES = 8 * 1024 * 1024
MAX_PHOTOS_PER_CHECKUP = 4


def bmi(weight_kg: float | None, height_cm: float | None) -> float | None:
    if not weight_kg or not height_cm:
        return None
    return round(weight_kg / (height_cm / 100) ** 2, 1)


def photo_url(photo_id: uuid.UUID) -> str:
    return f"/api/checkup-photos/{photo_id}"


async def _out(db: DbSession, c: CheckUp) -> CheckUpOut:
    name = (
        await db.scalar(select(User.name).where(User.id == c.recorded_by))
        if c.recorded_by
        else None
    )
    return CheckUpOut.model_validate(
        {
            **{
                f: getattr(c, f)
                for f in CheckUpOut.model_fields
                if f not in ("recorded_by", "photos")
            },
            "recorded_by": StaffRef(id=c.recorded_by, name=name)
            if c.recorded_by and name
            else None,
            "photos": [
                PhotoOut(id=p.id, url=photo_url(p.id), created_at=p.created_at) for p in c.photos
            ],
        }
    )


async def _member(db: DbSession, gym_id: uuid.UUID, member_id: uuid.UUID) -> Member:
    m = await db.scalar(select(Member).where(Member.gym_id == gym_id, Member.id == member_id))
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return m


async def _checkup(db: DbSession, gym_id: uuid.UUID, checkup_id: uuid.UUID) -> CheckUp:
    c = await db.scalar(
        select(CheckUp)
        .where(CheckUp.gym_id == gym_id, CheckUp.id == checkup_id)
        .options(selectinload(CheckUp.photos))
        .execution_options(populate_existing=True)
    )
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-up not found")
    return c


def _can_modify(ctx: TenantContext, c: CheckUp) -> None:
    """Whoever recorded a check-up can fix it; managers and owners can change any."""
    if ctx.role not in (Role.OWNER, Role.MANAGER) and c.recorded_by != ctx.user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the person who recorded it can change this"
        )


def _duplicate_date() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT, "This member already has a check-up on that date"
    )


@router.get("/members/{member_id}/checkups", response_model=list[CheckUpOut])
async def list_checkups(member_id: uuid.UUID, ctx: CurrentContext, db: DbSession):
    await _member(db, ctx.gym_id, member_id)
    rows = (
        await db.scalars(
            select(CheckUp)
            .where(CheckUp.gym_id == ctx.gym_id, CheckUp.member_id == member_id)
            .options(selectinload(CheckUp.photos))
            .order_by(CheckUp.recorded_on.desc())
        )
    ).all()
    return [await _out(db, c) for c in rows]


@router.post(
    "/members/{member_id}/checkups", response_model=CheckUpOut, status_code=status.HTTP_201_CREATED
)
async def create_checkup(member_id: uuid.UUID, body: CheckUpIn, ctx: CurrentContext, db: DbSession):
    member = await _member(db, ctx.gym_id, member_id)
    recorded_on = body.recorded_on or await gym_today(db, ctx.gym_id)
    if recorded_on > await gym_today(db, ctx.gym_id):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Check-up date can't be in the future"
        )
    if body.height_cm:
        member.height_cm = body.height_cm  # keep the profile's height current
    height = body.height_cm or member.height_cm
    values = body.model_dump(exclude={"recorded_on", "height_cm"})
    checkup = CheckUp(
        **values,
        gym_id=ctx.gym_id,
        member_id=member.id,
        recorded_on=recorded_on,
        height_cm=height,
        bmi=bmi(body.weight_kg, height),
        recorded_by=ctx.user.id,
        photos=[],
    )
    db.add(checkup)
    try:
        await db.commit()
    except IntegrityError as exc:
        raise _duplicate_date() from exc
    return await _out(db, await _checkup(db, ctx.gym_id, checkup.id))


@router.patch("/checkups/{checkup_id}", response_model=CheckUpOut)
async def update_checkup(
    checkup_id: uuid.UUID, body: CheckUpUpdate, ctx: CurrentContext, db: DbSession
):
    c = await _checkup(db, ctx.gym_id, checkup_id)
    _can_modify(ctx, c)
    values = body.model_dump(exclude_unset=True)
    if values.get("recorded_on") is None:
        values.pop("recorded_on", None)
    for key, value in values.items():
        setattr(c, key, value)
    c.bmi = bmi(c.weight_kg, c.height_cm)
    try:
        await db.commit()
    except IntegrityError as exc:
        raise _duplicate_date() from exc
    return await _out(db, await _checkup(db, ctx.gym_id, checkup_id))


@router.delete("/checkups/{checkup_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checkup(checkup_id: uuid.UUID, ctx: CurrentContext, db: DbSession) -> None:
    c = await _checkup(db, ctx.gym_id, checkup_id)
    _can_modify(ctx, c)
    keys = [p.storage_key for p in c.photos]
    await db.delete(c)
    name = await db.scalar(select(Member.name).where(Member.id == c.member_id))
    audit.record(
        db,
        ctx,
        "checkup.deleted",
        f"Deleted {name}'s check-up from {c.recorded_on:%d %b %Y}",
        details={"member_id": c.member_id},
    )
    await db.commit()
    for key in keys:
        await get_storage().delete(key)


# --- Photos -----------------------------------------------------------------


@router.post(
    "/checkups/{checkup_id}/photos", response_model=CheckUpOut, status_code=status.HTTP_201_CREATED
)
async def upload_photo(checkup_id: uuid.UUID, file: UploadFile, ctx: CurrentContext, db: DbSession):
    c = await _checkup(db, ctx.gym_id, checkup_id)
    _can_modify(ctx, c)
    if len(c.photos) >= MAX_PHOTOS_PER_CHECKUP:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Up to {MAX_PHOTOS_PER_CHECKUP} photos per check-up"
        )
    data = await file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Photos must be 8 MB or smaller")
    content_type = sniff_image_type(data)
    if content_type is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a JPEG, PNG or WebP image"
        )

    photo_id = uuid.uuid4()
    key = f"gyms/{ctx.gym_id}/checkups/{c.id}/{photo_id}.{IMAGE_TYPES[content_type]}"
    await get_storage().save(key, data, content_type)
    db.add(
        CheckUpPhoto(
            id=photo_id,
            gym_id=ctx.gym_id,
            checkup_id=c.id,
            storage_key=key,
            content_type=content_type,
            size_bytes=len(data),
        )
    )
    await db.commit()
    return await _out(db, await _checkup(db, ctx.gym_id, checkup_id))


async def _photo(db: DbSession, gym_id: uuid.UUID, photo_id: uuid.UUID) -> CheckUpPhoto:
    p = await db.scalar(
        select(CheckUpPhoto)
        .where(CheckUpPhoto.gym_id == gym_id, CheckUpPhoto.id == photo_id)
        .options(selectinload(CheckUpPhoto.checkup))
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    return p


@router.get("/checkup-photos/{photo_id}", response_class=Response)
async def get_photo(photo_id: uuid.UUID, ctx: CurrentContext, db: DbSession):
    p = await _photo(db, ctx.gym_id, photo_id)
    storage = get_storage()
    if url := storage.signed_url(p.storage_key):
        return RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    data = await storage.read(p.storage_key)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    return Response(
        data,
        media_type=p.content_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/checkup-photos/{photo_id}", response_model=CheckUpOut)
async def delete_photo(photo_id: uuid.UUID, ctx: CurrentContext, db: DbSession):
    p = await _photo(db, ctx.gym_id, photo_id)
    _can_modify(ctx, p.checkup)
    checkup_id, key = p.checkup_id, p.storage_key
    await db.delete(p)
    await db.commit()
    await get_storage().delete(key)
    return await _out(db, await _checkup(db, ctx.gym_id, checkup_id))


# --- Due list ---------------------------------------------------------------


@router.get("/checkups/due", response_model=Page[DueCheckUp])
async def due_checkups(
    ctx: CurrentContext,
    db: DbSession,
    scope: Literal["mine", "all"] = "all",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    """Members with a running membership whose last check-up is older than the gym's
    check-up interval (or who have never had one). Longest-waiting first."""
    gym = await db.get_one(Gym, ctx.gym_id)
    today = await gym_today(db, ctx.gym_id)
    cutoff = today - timedelta(days=gym.checkup_interval_days)

    last = (
        select(CheckUp.member_id, func.max(CheckUp.recorded_on).label("last_on"))
        .where(CheckUp.gym_id == ctx.gym_id)
        .group_by(CheckUp.member_id)
        .subquery()
    )
    running = (
        select(Membership.member_id)
        .where(
            Membership.gym_id == ctx.gym_id,
            Membership.cancelled_at.is_(None),
            Membership.start_date <= today,
            Membership.end_date >= today,
        )
        .distinct()
    )
    trainer = aliased(User)
    stmt = (
        select(Member, last.c.last_on, trainer.name)
        .outerjoin(last, last.c.member_id == Member.id)
        .outerjoin(trainer, trainer.id == Member.trainer_id)
        .where(
            Member.gym_id == ctx.gym_id,
            Member.id.in_(running),
            (last.c.last_on.is_(None)) | (last.c.last_on <= cutoff),
        )
    )
    if scope == "mine":
        stmt = stmt.where(Member.trainer_id == ctx.user.id)

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.execute(
            stmt.order_by(last.c.last_on.is_not(None), last.c.last_on, Member.name)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()

    # Latest weight for each listed member, for context in the list.
    weights: dict[uuid.UUID, float | None] = {}
    if rows:
        latest = await db.execute(
            select(CheckUp.member_id, CheckUp.weight_kg)
            .join(
                last,
                and_(last.c.member_id == CheckUp.member_id, last.c.last_on == CheckUp.recorded_on),
            )
            .where(CheckUp.member_id.in_([m.id for m, _, _ in rows]))
        )
        weights = dict(latest.all())

    items = [
        DueCheckUp(
            member_id=m.id,
            member_name=m.name,
            phone=m.phone,
            trainer=StaffRef(id=m.trainer_id, name=tname) if m.trainer_id and tname else None,
            goal=m.goal.value if m.goal else None,
            last_checkup_on=last_on,
            days_since=(today - last_on).days if last_on else None,
            last_weight_kg=weights.get(m.id),
        )
        for m, last_on, tname in rows
    ]
    return Page(items=items, total=total, page=page, page_size=page_size)
