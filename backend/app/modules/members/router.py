import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, String, cast, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentContext, DbSession, TenantContext, require_roles
from app.core.schemas import Page
from app.core.security import generate_url_token
from app.modules.audit import service as audit
from app.modules.auth.models import User
from app.modules.gyms.models import Role
from app.modules.members import service
from app.modules.members.models import Member, Membership
from app.modules.members.schemas import (
    FreezeIn,
    MemberCounts,
    MemberIn,
    MemberListItem,
    MemberOut,
    MembershipIn,
    MemberUpdate,
)
from app.modules.members.status import CurrentMembership, Status, current_membership_id, status_expr

router = APIRouter(tags=["members"])

# Front desk onboards members and sells memberships; trainers can view.
DeskContext = Annotated[
    TenantContext, Depends(require_roles(Role.OWNER, Role.MANAGER, Role.FRONT_DESK))
]
ManagerContext = Annotated[TenantContext, Depends(require_roles(Role.OWNER, Role.MANAGER))]

StatusFilter = Literal["active", "expiring", "frozen", "upcoming", "expired", "none"]
SortOption = Literal["newest", "name", "ending"]


async def load_member(db: DbSession, gym_id: uuid.UUID, member_id: uuid.UUID) -> Member:
    member = await db.scalar(
        select(Member)
        .where(Member.gym_id == gym_id, Member.id == member_id)
        .options(selectinload(Member.memberships))
        .execution_options(populate_existing=True)
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


async def load_membership(db: DbSession, gym_id: uuid.UUID, membership_id: uuid.UUID) -> Membership:
    m = await db.scalar(
        select(Membership)
        .where(Membership.gym_id == gym_id, Membership.id == membership_id)
        .options(selectinload(Membership.member).selectinload(Member.memberships))
    )
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
    return m


def _filtered(
    stmt: Select,
    gym_id: uuid.UUID,
    q: str | None,
    branch_id: uuid.UUID | None,
    trainer_id: uuid.UUID | None,
    tag: str | None,
) -> Select:
    stmt = stmt.where(Member.gym_id == gym_id)
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        digits = "".join(ch for ch in q if ch.isdigit())
        conds = [func.lower(Member.name).like(term), func.lower(Member.email).like(term)]
        if len(digits) >= 3:
            conds.append(Member.phone.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    if branch_id:
        stmt = stmt.where(Member.branch_id == branch_id)
    if trainer_id:
        stmt = stmt.where(Member.trainer_id == trainer_id)
    if tag:
        # JSON array stored as text in SQLite / json in Postgres; a quoted match is portable.
        stmt = stmt.where(cast(Member.tags, String).like(f'%"{tag.lower()}"%'))
    return stmt


@router.get("/members", response_model=Page[MemberListItem])
async def list_members(
    ctx: CurrentContext,
    db: DbSession,
    q: str | None = None,
    status_: Annotated[StatusFilter | None, Query(alias="status")] = None,
    branch_id: uuid.UUID | None = None,
    trainer_id: uuid.UUID | None = None,
    tag: str | None = None,
    sort: SortOption = "newest",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    today = await service.gym_today(db, ctx.gym_id)
    member_status = status_expr(today)
    stmt = (
        select(Member, CurrentMembership, User.name)
        .select_from(Member)
        .outerjoin(CurrentMembership, CurrentMembership.id == current_membership_id(today))
        .outerjoin(User, User.id == Member.trainer_id)
    )
    stmt = _filtered(stmt, ctx.gym_id, q, branch_id, trainer_id, tag)
    if status_ == "active":
        stmt = stmt.where(member_status.in_([Status.ACTIVE.value, Status.EXPIRING.value]))
    elif status_:
        stmt = stmt.where(member_status == status_)

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {
        "newest": [Member.joined_on.desc(), Member.created_at.desc()],
        "name": [func.lower(Member.name)],
        "ending": [CurrentMembership.end_date.is_(None), CurrentMembership.end_date, Member.name],
    }[sort]
    rows = await db.execute(stmt.order_by(*order).offset((page - 1) * page_size).limit(page_size))
    items = [service.list_item(m, cm, trainer, today) for m, cm, trainer in rows.all()]
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/members/counts", response_model=MemberCounts)
async def member_counts(
    ctx: CurrentContext,
    db: DbSession,
    q: str | None = None,
    branch_id: uuid.UUID | None = None,
    trainer_id: uuid.UUID | None = None,
    tag: str | None = None,
):
    today = await service.gym_today(db, ctx.gym_id)
    member_status = status_expr(today)
    stmt = (
        select(member_status, func.count())
        .select_from(Member)
        .outerjoin(CurrentMembership, CurrentMembership.id == current_membership_id(today))
    )
    stmt = _filtered(stmt, ctx.gym_id, q, branch_id, trainer_id, tag).group_by(member_status)
    counts = MemberCounts()
    for key, n in (await db.execute(stmt)).all():
        setattr(counts, key, n)
        counts.all += n
    counts.active += counts.expiring
    return counts


@router.post("/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def create_member(body: MemberIn, ctx: DeskContext, db: DbSession):
    await service.validate_refs(db, ctx.gym_id, body.branch_id, body.trainer_id)
    await service.ensure_unique_phone(db, ctx.gym_id, body.phone)
    today = await service.gym_today(db, ctx.gym_id)

    values = body.model_dump(exclude={"membership", "joined_on"})
    # memberships=[] marks the collection as loaded, so appending needs no lazy load.
    member = Member(**values, gym_id=ctx.gym_id, joined_on=body.joined_on or today, memberships=[])
    if member.branch_id is None:
        member.branch_id = ctx.branch_id
    db.add(member)
    await db.flush()
    summary = f"Added member {member.name}"
    if body.membership:
        ms = await service.add_membership(
            db, ctx.gym_id, member, body.membership, today, ctx.user.id
        )
        summary += f" on {ms.plan_name}"
    audit.record(db, ctx, "member.created", summary, member.id)
    await db.commit()
    return await service.member_out(db, await load_member(db, ctx.gym_id, member.id), today)


@router.get("/members/{member_id}", response_model=MemberOut)
async def get_member(member_id: uuid.UUID, ctx: CurrentContext, db: DbSession):
    today = await service.gym_today(db, ctx.gym_id)
    return await service.member_out(db, await load_member(db, ctx.gym_id, member_id), today)


@router.patch("/members/{member_id}", response_model=MemberOut)
async def update_member(member_id: uuid.UUID, body: MemberUpdate, ctx: DeskContext, db: DbSession):
    member = await load_member(db, ctx.gym_id, member_id)
    values = body.model_dump(exclude_unset=True)
    if values.get("name") is None:
        values.pop("name", None)
    if values.get("phone") is None:
        values.pop("phone", None)
    if values.get("joined_on") is None:
        values.pop("joined_on", None)
    if "tags" in values and values["tags"] is None:
        values["tags"] = []
    if "phone" in values:
        await service.ensure_unique_phone(db, ctx.gym_id, values["phone"], exclude_id=member.id)
    await service.validate_refs(db, ctx.gym_id, values.get("branch_id"), values.get("trainer_id"))
    changed = audit.changes({k: getattr(member, k) for k in values}, values)
    for key, value in values.items():
        setattr(member, key, value)
    if changed:
        # Field names only: medical notes and the like don't belong in a log.
        audit.record(
            db,
            ctx,
            "member.updated",
            f"Updated {member.name}: {', '.join(k.replace('_', ' ') for k in changed)}",
            member.id,
            {"fields": sorted(changed)},
        )
    try:
        await db.commit()
    except IntegrityError as exc:
        raise service.conflict("Another member already uses this phone number") from exc
    today = await service.gym_today(db, ctx.gym_id)
    return await service.member_out(db, await load_member(db, ctx.gym_id, member_id), today)


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member(member_id: uuid.UUID, ctx: ManagerContext, db: DbSession) -> None:
    from app.core.storage import get_storage
    from app.modules.checkups.models import CheckUp, CheckUpPhoto

    member = await load_member(db, ctx.gym_id, member_id)
    photo_keys = (
        await db.scalars(
            select(CheckUpPhoto.storage_key)
            .join(CheckUp, CheckUp.id == CheckUpPhoto.checkup_id)
            .where(CheckUp.member_id == member.id)
        )
    ).all()
    await db.delete(member)
    audit.record(db, ctx, "member.deleted", f"Deleted member {member.name} ({member.phone})")
    await db.commit()
    for key in photo_keys:  # rows cascade in the database; stored files need deleting here
        await get_storage().delete(key)


@router.post("/members/{member_id}/preview-link", response_model=MemberOut)
async def regenerate_preview_link(member_id: uuid.UUID, ctx: DeskContext, db: DbSession):
    """Issues a new preview link; the old one stops working."""
    member = await load_member(db, ctx.gym_id, member_id)
    member.preview_token = generate_url_token()
    audit.record(db, ctx, "member.link_reset", f"Reset {member.name}'s preview link", member.id)
    await db.commit()
    today = await service.gym_today(db, ctx.gym_id)
    return await service.member_out(db, await load_member(db, ctx.gym_id, member_id), today)


# --- Memberships ------------------------------------------------------------


@router.post(
    "/members/{member_id}/memberships",
    response_model=MemberOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_membership(member_id: uuid.UUID, body: MembershipIn, ctx: DeskContext, db: DbSession):
    member = await load_member(db, ctx.gym_id, member_id)
    today = await service.gym_today(db, ctx.gym_id)
    ms = await service.add_membership(db, ctx.gym_id, member, body, today, ctx.user.id)
    audit.record(
        db,
        ctx,
        "membership.created",
        f"Added {ms.plan_name} for {member.name} ({ms.start_date:%d %b %Y} to "
        f"{ms.end_date:%d %b %Y})",
        ms.id,
        {"member_id": member.id, "total": ms.total},
    )
    await db.commit()
    return await service.member_out(db, await load_member(db, ctx.gym_id, member_id), today)


async def _membership_action(
    membership_id: uuid.UUID,
    ctx: TenantContext,
    db: DbSession,
    action,
    event: tuple[str, str],  # ("frozen", "Froze")
) -> MemberOut:
    m = await load_membership(db, ctx.gym_id, membership_id)
    today = await service.gym_today(db, ctx.gym_id)
    action(m, today)
    name = await db.scalar(select(Member.name).where(Member.id == m.member_id))
    key, label = event
    summary = f"{label} {name}'s {m.plan_name} membership"
    if key == "frozen":
        summary += f" ({m.freeze_start:%d %b} to {m.freeze_end:%d %b})"
    audit.record(db, ctx, f"membership.{key}", summary, m.id, {"member_id": m.member_id})
    await db.commit()
    return await service.member_out(db, await load_member(db, ctx.gym_id, m.member_id), today)


@router.post("/memberships/{membership_id}/freeze", response_model=MemberOut)
async def freeze_membership(
    membership_id: uuid.UUID, body: FreezeIn, ctx: DeskContext, db: DbSession
):
    return await _membership_action(
        membership_id,
        ctx,
        db,
        lambda m, today: service.freeze(m, body, today),
        ("frozen", "Froze"),
    )


@router.post("/memberships/{membership_id}/unfreeze", response_model=MemberOut)
async def unfreeze_membership(membership_id: uuid.UUID, ctx: DeskContext, db: DbSession):
    return await _membership_action(
        membership_id, ctx, db, service.unfreeze, ("unfrozen", "Unfroze")
    )


@router.post("/memberships/{membership_id}/cancel", response_model=MemberOut)
async def cancel_membership(membership_id: uuid.UUID, ctx: ManagerContext, db: DbSession):
    return await _membership_action(
        membership_id, ctx, db, lambda m, _today: service.cancel(m), ("cancelled", "Cancelled")
    )
