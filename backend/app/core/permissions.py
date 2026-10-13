"""Who can do what: the single source of truth for staff permissions.

Routes declare the capability they need (`ctx: Annotated[TenantContext, require(Cap.X)]`)
and record-level checks use the scope helpers below, so role rules live here and nowhere
else. The frontend reads each user's capabilities from /auth/me instead of re-deriving them.

Roles are fixed (owner, manager, front desk, sales, trainer). Two kinds of narrowing apply
on top of capabilities:
- trainers only ever see the members assigned to them and the leads assigned to them;
- staff with a home branch (except owners) only see that branch's members, plus members
  who belong to no branch.
"""

import enum
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import ColumnElement, Select, or_

from app.core.deps import CurrentContext, TenantContext
from app.modules.gyms.models import Role

OWNER, MANAGER, DESK, SALES, TRAINER = (
    Role.OWNER,
    Role.MANAGER,
    Role.FRONT_DESK,
    Role.SALES,
    Role.TRAINER,
)


class Cap(enum.StrEnum):
    # Members
    MEMBERS_VIEW = "members_view"  # see members (trainers: only their own)
    MEMBERS_EDIT = "members_edit"  # add members, edit profiles, sell and freeze memberships
    MEMBERS_DELETE = "members_delete"  # delete members, cancel memberships
    MEMBERS_ASSIGN_TRAINER = "members_assign_trainer"  # bulk (re)assign trainers
    MEMBER_MONEY = "member_money"  # see prices, totals and balances on members
    # Money
    PAYMENTS = "payments"  # record payments, receipts, dues
    PAYMENTS_VOID = "payments_void"
    FINANCE = "finance"  # revenue summary and expenses
    PLANS_MANAGE = "plans_manage"  # membership products and prices
    # Coaching
    CHECKUPS = "checkups"  # record and edit check-ups
    WORKOUT_PLANS = "workout_plans"  # create, edit and publish workout and diet plans
    # Leads
    LEADS = "leads"  # the whole pipeline
    LEADS_OWN = "leads_own"  # add leads (assigned to yourself) and work your own
    LEADS_CONVERT = "leads_convert"
    LEADS_DELETE = "leads_delete"
    LEAD_FORM = "lead_form"  # the public website enquiry form
    # Reminders
    REMINDERS = "reminders"  # due list, WhatsApp, history
    REMINDERS_RUN = "reminders_run"
    REMINDER_SETTINGS = "reminder_settings"
    # Business
    ANALYTICS = "analytics"
    EXPORTS = "exports"
    IMPORTS = "imports"
    AUDIT = "audit"
    # Gym administration
    STAFF_MANAGE = "staff_manage"  # invite, change role, deactivate staff ranked below you
    BRANCHES = "branches"
    GYM_SETTINGS = "gym_settings"


CAPS: dict[Cap, frozenset[Role]] = {
    Cap.MEMBERS_VIEW: frozenset({OWNER, MANAGER, DESK, TRAINER}),
    Cap.MEMBERS_EDIT: frozenset({OWNER, MANAGER, DESK}),
    Cap.MEMBERS_DELETE: frozenset({OWNER, MANAGER}),
    Cap.MEMBERS_ASSIGN_TRAINER: frozenset({OWNER, MANAGER}),
    Cap.MEMBER_MONEY: frozenset({OWNER, MANAGER, DESK}),
    Cap.PAYMENTS: frozenset({OWNER, MANAGER, DESK}),
    Cap.PAYMENTS_VOID: frozenset({OWNER, MANAGER}),
    Cap.FINANCE: frozenset({OWNER, MANAGER}),
    Cap.PLANS_MANAGE: frozenset({OWNER, MANAGER}),
    Cap.CHECKUPS: frozenset({OWNER, MANAGER, TRAINER}),
    Cap.WORKOUT_PLANS: frozenset({OWNER, MANAGER, TRAINER}),
    Cap.LEADS: frozenset({OWNER, MANAGER, DESK, SALES}),
    Cap.LEADS_OWN: frozenset({TRAINER}),
    Cap.LEADS_CONVERT: frozenset({OWNER, MANAGER, DESK, SALES}),
    Cap.LEADS_DELETE: frozenset({OWNER, MANAGER}),
    Cap.LEAD_FORM: frozenset({OWNER, MANAGER}),
    Cap.REMINDERS: frozenset({OWNER, MANAGER, DESK}),
    Cap.REMINDERS_RUN: frozenset({OWNER, MANAGER}),
    Cap.REMINDER_SETTINGS: frozenset({OWNER}),
    Cap.ANALYTICS: frozenset({OWNER, MANAGER}),
    Cap.EXPORTS: frozenset({OWNER, MANAGER}),
    Cap.IMPORTS: frozenset({OWNER, MANAGER}),
    Cap.AUDIT: frozenset({OWNER}),
    Cap.STAFF_MANAGE: frozenset({OWNER, MANAGER}),
    Cap.BRANCHES: frozenset({OWNER, MANAGER}),
    Cap.GYM_SETTINGS: frozenset({OWNER}),
}

# Who may manage whom: you can only manage staff ranked strictly below you.
RANK = {OWNER: 3, MANAGER: 2, DESK: 1, SALES: 1, TRAINER: 1}

# Roles that can be someone's trainer.
COACH_ROLES = frozenset({OWNER, MANAGER, TRAINER})


def can(ctx: TenantContext, cap: Cap) -> bool:
    return ctx.role in CAPS[cap]


def can_any(ctx: TenantContext, *caps: Cap) -> bool:
    return any(can(ctx, c) for c in caps)


def capabilities(role: Role) -> list[str]:
    return sorted(cap.value for cap, roles in CAPS.items() if role in roles)


def require(*caps: Cap) -> Callable:
    """Dependency: the caller needs at least one of `caps`."""

    async def checker(ctx: CurrentContext) -> TenantContext:
        if not can_any(ctx, *caps):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission to do this")
        return ctx

    return Depends(checker)


def ctx_with(*caps: Cap):
    """`ctx: ctx_with(Cap.X)` reads better in signatures than the full Annotated form."""
    return Annotated[TenantContext, require(*caps)]


# --- Record-level scope -------------------------------------------------------------


def branch_bound(ctx: TenantContext) -> bool:
    return ctx.branch_id is not None and ctx.role != OWNER


def member_scope(ctx: TenantContext) -> ColumnElement[bool] | None:
    """Extra WHERE clause for member queries, or None when the caller sees every member."""
    from app.modules.members.models import Member

    if ctx.role == TRAINER:
        return Member.trainer_id == ctx.user.id
    if branch_bound(ctx):
        return or_(Member.branch_id == ctx.branch_id, Member.branch_id.is_(None))
    return None


def scope_members(stmt: Select, ctx: TenantContext) -> Select:
    clause = member_scope(ctx)
    return stmt if clause is None else stmt.where(clause)


def member_visible(ctx: TenantContext, member) -> bool:
    if ctx.role == TRAINER:
        return member.trainer_id == ctx.user.id
    if branch_bound(ctx):
        return member.branch_id in (ctx.branch_id, None)
    return True


def ensure_member_visible(ctx: TenantContext, member) -> None:
    """404, not 403: out-of-scope members look the same as missing ones."""
    if member is None or not member_visible(ctx, member):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")


def lead_scope(ctx: TenantContext) -> ColumnElement[bool] | None:
    from app.modules.leads.models import Lead

    if not can(ctx, Cap.LEADS):  # trainers: only leads assigned to them
        return Lead.assigned_to == ctx.user.id
    return None


def scope_leads(stmt: Select, ctx: TenantContext) -> Select:
    clause = lead_scope(ctx)
    return stmt if clause is None else stmt.where(clause)


def ensure_lead_visible(ctx: TenantContext, lead) -> None:
    if lead is None or (not can(ctx, Cap.LEADS) and lead.assigned_to != ctx.user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead not found")


def ensure_outranks(ctx: TenantContext, *roles: Role) -> None:
    """Managers can manage front desk, sales and trainers, not other managers or owners."""
    if ctx.role == OWNER:
        return
    if any(RANK[r] >= RANK[ctx.role] for r in roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You can only manage staff with a lower role than yours"
        )
