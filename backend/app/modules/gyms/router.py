import uuid
from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.config import settings
from app.core.db import utcnow
from app.core.deps import CurrentContext, DbSession
from app.core.permissions import Cap, ctx_with, ensure_outranks
from app.core.security import generate_url_token
from app.modules.audit import service as audit
from app.modules.gyms.models import Gym, Invite, Role, StaffMembership
from app.modules.gyms.profile import GymProfile, merge_profile
from app.modules.gyms.repository import BranchRepository, InviteRepository, StaffRepository
from app.modules.gyms.schemas import (
    BranchIn,
    BranchOut,
    BranchUpdate,
    GymOut,
    GymUpdate,
    InviteIn,
    InviteOut,
    StaffDeactivate,
    StaffOut,
    StaffUpdate,
)

router = APIRouter(tags=["gym"])

SettingsContext = ctx_with(Cap.GYM_SETTINGS)  # owner: gym details, onboarding, branch removal
BranchContext = ctx_with(Cap.BRANCHES)
StaffContext = ctx_with(Cap.STAFF_MANAGE)  # owner, and managers for staff below them


# --- Gym settings -----------------------------------------------------------


@router.get("/gym", response_model=GymOut)
async def get_gym(ctx: CurrentContext, db: DbSession) -> Gym:
    return await db.get_one(Gym, ctx.gym_id)


@router.patch("/gym", response_model=GymOut)
async def update_gym(body: GymUpdate, ctx: SettingsContext, db: DbSession) -> Gym:
    gym = await db.get_one(Gym, ctx.gym_id)
    values = body.model_dump(exclude_unset=True)
    changed = audit.changes({k: getattr(gym, k) for k in values}, values)
    for key, value in values.items():
        setattr(gym, key, value)
    if changed:
        fields = ", ".join(k.replace("_", " ") for k in changed)
        audit.record(
            db, ctx, "gym.updated", f"Changed gym settings: {fields}", gym.id, {"changes": changed}
        )
    await db.commit()
    return gym


@router.patch("/gym/profile", response_model=GymOut)
async def update_gym_profile(body: GymProfile, ctx: SettingsContext, db: DbSession) -> Gym:
    """Saves onboarding answers. Merges into what is stored, so each step can save alone.
    Not audited: the wizard saves after every step and the final result is audited on completion."""
    gym = await db.get_one(Gym, ctx.gym_id)
    gym.profile = merge_profile(gym.profile, body)
    await db.commit()
    return gym


@router.post("/gym/onboarding/complete", response_model=GymOut)
async def complete_onboarding(ctx: SettingsContext, db: DbSession) -> Gym:
    gym = await db.get_one(Gym, ctx.gym_id)
    if gym.onboarding_completed_at is None:
        gym.onboarding_completed_at = utcnow()
        audit.record(db, ctx, "gym.onboarded", "Finished gym setup", gym.id)
        await db.commit()
    return gym


# --- Branches ---------------------------------------------------------------


@router.get("/branches", response_model=list[BranchOut])
async def list_branches(ctx: CurrentContext, db: DbSession):
    repo = BranchRepository(db, ctx.gym_id)
    return await repo.list(repo.query().order_by(repo.model.created_at))


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
async def create_branch(body: BranchIn, ctx: BranchContext, db: DbSession):
    branch = await BranchRepository(db, ctx.gym_id).create(**body.model_dump())
    audit.record(db, ctx, "branch.created", f"Added branch {branch.name}", branch.id)
    await db.commit()
    return branch


@router.patch("/branches/{branch_id}", response_model=BranchOut)
async def update_branch(
    branch_id: uuid.UUID, body: BranchUpdate, ctx: BranchContext, db: DbSession
):
    repo = BranchRepository(db, ctx.gym_id)
    branch = await repo.get_or_404(branch_id)
    values = body.model_dump(exclude_unset=True)
    changed = audit.changes({k: getattr(branch, k) for k in values}, values)
    branch = await repo.update(branch, values)
    if changed:
        audit.record(
            db,
            ctx,
            "branch.updated",
            f"Edited branch {branch.name}",
            branch.id,
            {"changes": changed},
        )
    await db.commit()
    return branch


@router.delete("/branches/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(branch_id: uuid.UUID, ctx: SettingsContext, db: DbSession) -> None:
    repo = BranchRepository(db, ctx.gym_id)
    branch = await repo.get_or_404(branch_id)
    if await repo.count() <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A gym needs at least one branch")
    await repo.delete(branch)
    audit.record(db, ctx, "branch.deleted", f"Deleted branch {branch.name}")
    await db.commit()


# --- Staff ------------------------------------------------------------------


def _role(role: Role | str) -> str:
    return Role(role).value.replace("_", " ")


def _staff_out(m: StaffMembership) -> StaffOut:
    return StaffOut(
        id=m.id,
        user_id=m.user_id,
        name=m.user.name,
        email=m.user.email,
        phone=m.user.phone,
        role=m.role,
        branch_id=m.branch_id,
        is_active=m.is_active,
        joined_at=m.created_at,
    )


async def _ensure_branch(db: DbSession, gym_id: uuid.UUID, branch_id: uuid.UUID | None) -> None:
    if branch_id is not None:
        await BranchRepository(db, gym_id).get_or_404(branch_id)


@router.get("/staff", response_model=list[StaffOut])
async def list_staff(ctx: CurrentContext, db: DbSession):
    repo = StaffRepository(db, ctx.gym_id)
    stmt = repo.query().order_by(repo.model.is_active.desc(), repo.model.created_at)
    return [_staff_out(m) for m in await repo.list(stmt)]


@router.patch("/staff/{staff_id}", response_model=StaffOut)
async def update_staff(staff_id: uuid.UUID, body: StaffUpdate, ctx: StaffContext, db: DbSession):
    repo = StaffRepository(db, ctx.gym_id)
    member = await repo.get_or_404(staff_id)
    values = body.model_dump(exclude_unset=True)
    # You can only change staff ranked below you, and only to roles below you.
    ensure_outranks(ctx, member.role, *([values["role"]] if values.get("role") else []))
    phone = values.pop("phone", ...)
    if phone is not ...:
        member.user.phone = (phone or "").strip() or None
    if "branch_id" in values:
        await _ensure_branch(db, ctx.gym_id, values["branch_id"])
    if values.get("role") not in (None, Role.OWNER) and member.role == Role.OWNER:
        owners = await repo.count(repo.query().where(StaffMembership.role == Role.OWNER))
        if owners <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT, "A gym needs at least one owner")
    changed = audit.changes({k: getattr(member, k) for k in values}, values)
    await repo.update(member, values)
    if "role" in changed:
        old, new = changed["role"]
        audit.record(
            db,
            ctx,
            "staff.role_changed",
            f"Changed {member.user.name}'s role from {_role(old)} to {_role(new)}",
            member.user_id,
        )
    if "branch_id" in changed:
        audit.record(
            db, ctx, "staff.updated", f"Moved {member.user.name} to another branch", member.user_id
        )
    await db.commit()
    return _staff_out(member)


@router.delete("/staff/{staff_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_staff(staff_id: uuid.UUID, ctx: StaffContext, db: DbSession) -> None:
    repo = StaffRepository(db, ctx.gym_id)
    member = await repo.get_or_404(staff_id)
    ensure_outranks(ctx, member.role)
    if member.user_id == ctx.user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't remove yourself")
    audit.record(
        db,
        ctx,
        "staff.removed",
        f"Removed {member.user.name} ({_role(member.role)}) from the staff",
        member.user_id,
    )
    await repo.delete(member)
    await db.commit()


async def _owners_left(db: DbSession, gym_id: uuid.UUID, excluding: uuid.UUID) -> int:
    repo = StaffRepository(db, gym_id)
    return await repo.count(
        repo.query().where(
            StaffMembership.role == Role.OWNER,
            StaffMembership.is_active,
            StaffMembership.id != excluding,
        )
    )


@router.post("/staff/{staff_id}/deactivate", response_model=StaffOut)
async def deactivate_staff(
    staff_id: uuid.UUID, body: StaffDeactivate, ctx: StaffContext, db: DbSession
):
    """Stops someone logging in to this gym while keeping their history. Their clients and
    leads can be handed to another person in the same step."""
    from sqlalchemy import update

    from app.modules.leads.models import Lead
    from app.modules.members import service as members_service
    from app.modules.members.models import Member

    repo = StaffRepository(db, ctx.gym_id)
    member = await repo.get_or_404(staff_id)
    if member.user_id == ctx.user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't deactivate yourself")
    ensure_outranks(ctx, member.role)
    if member.role == Role.OWNER and await _owners_left(db, ctx.gym_id, member.id) == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "A gym needs at least one active owner")

    moved_members = moved_leads = 0
    if body.reassign_members_to is not None:
        await members_service.validate_refs(db, ctx.gym_id, None, body.reassign_members_to)
        moved_members = (
            await db.execute(
                update(Member)
                .where(Member.gym_id == ctx.gym_id, Member.trainer_id == member.user_id)
                .values(trainer_id=body.reassign_members_to)
            )
        ).rowcount
    if body.reassign_leads_to is not None:
        from app.modules.leads import service as leads_service

        await leads_service.ensure_staff(db, ctx.gym_id, body.reassign_leads_to)
        moved_leads = (
            await db.execute(
                update(Lead)
                .where(Lead.gym_id == ctx.gym_id, Lead.assigned_to == member.user_id)
                .values(assigned_to=body.reassign_leads_to)
            )
        ).rowcount
    member.is_active = False
    audit.record(
        db,
        ctx,
        "staff.deactivated",
        f"Deactivated {member.user.name} ({_role(member.role)})",
        member.user_id,
        {"members_reassigned": moved_members, "leads_reassigned": moved_leads},
    )
    await db.commit()
    return _staff_out(member)


@router.post("/staff/{staff_id}/reactivate", response_model=StaffOut)
async def reactivate_staff(staff_id: uuid.UUID, ctx: StaffContext, db: DbSession):
    repo = StaffRepository(db, ctx.gym_id)
    member = await repo.get_or_404(staff_id)
    ensure_outranks(ctx, member.role)
    member.is_active = True
    audit.record(db, ctx, "staff.reactivated", f"Reactivated {member.user.name}", member.user_id)
    await db.commit()
    return _staff_out(member)


# --- Invites ----------------------------------------------------------------


def invite_url(token: str) -> str:
    return f"{settings.frontend_url}/invite/{token}"


def _invite_out(invite: Invite) -> InviteOut:
    return InviteOut(
        id=invite.id,
        email=invite.email,
        role=invite.role,
        branch_id=invite.branch_id,
        expires_at=invite.expires_at,
        accepted_at=invite.accepted_at,
        url=invite_url(invite.token),
    )


@router.get("/invites", response_model=list[InviteOut])
async def list_invites(ctx: StaffContext, db: DbSession):
    repo = InviteRepository(db, ctx.gym_id)
    stmt = repo.query().where(Invite.accepted_at.is_(None)).order_by(Invite.created_at.desc())
    return [_invite_out(i) for i in await repo.list(stmt)]


@router.post("/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(body: InviteIn, ctx: StaffContext, db: DbSession):
    ensure_outranks(ctx, body.role)  # managers can invite front desk, sales and trainers
    await _ensure_branch(db, ctx.gym_id, body.branch_id)
    already = await db.scalar(
        select(StaffMembership.id)
        .join(StaffMembership.user)
        .where(
            StaffMembership.gym_id == ctx.gym_id, StaffMembership.user.has(email=body.email.lower())
        )
    )
    if already:
        raise HTTPException(status.HTTP_409_CONFLICT, "This person is already on your staff")
    invite = await InviteRepository(db, ctx.gym_id).create(
        email=body.email.lower(),
        role=body.role,
        branch_id=body.branch_id,
        token=generate_url_token(),
        expires_at=utcnow() + timedelta(days=settings.invite_token_days),
        invited_by=ctx.user.id,
    )
    audit.record(
        db, ctx, "staff.invited", f"Invited {invite.email} as {_role(invite.role)}", invite.id
    )
    await db.commit()
    return _invite_out(invite)


@router.post("/invites/{invite_id}/resend", response_model=InviteOut)
async def resend_invite(invite_id: uuid.UUID, ctx: StaffContext, db: DbSession):
    """A fresh link and a fresh expiry; the old link stops working."""
    invite = await InviteRepository(db, ctx.gym_id).get_or_404(invite_id)
    ensure_outranks(ctx, invite.role)
    if invite.accepted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This invite was already accepted")
    invite.token = generate_url_token()
    invite.expires_at = utcnow() + timedelta(days=settings.invite_token_days)
    audit.record(
        db, ctx, "staff.invite_resent", f"Re-sent the invite for {invite.email}", invite.id
    )
    await db.commit()
    return _invite_out(invite)


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(invite_id: uuid.UUID, ctx: StaffContext, db: DbSession) -> None:
    repo = InviteRepository(db, ctx.gym_id)
    invite = await repo.get_or_404(invite_id)
    ensure_outranks(ctx, invite.role)
    await repo.delete(invite)
    audit.record(db, ctx, "staff.invite_revoked", f"Cancelled the invite for {invite.email}")
    await db.commit()
