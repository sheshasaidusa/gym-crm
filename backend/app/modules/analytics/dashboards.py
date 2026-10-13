"""What each role sees first: a trainer's clients, the front desk's day, a salesperson's pipeline,
and how each trainer and salesperson is doing.

Everything is a SQL aggregate or a short, limited list, so it stays cheap as a gym grows.
Member-based queries go through `scope_members` like every other member endpoint, so a
branch-bound manager only ever sees their own branch.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import and_, distinct, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.deps import TenantContext
from app.core.permissions import scope_members
from app.core.schemas import round_money
from app.modules.ai_plans.models import AIPlan, PlanStatus
from app.modules.analytics.schemas import (
    DeskDashboard,
    DueRow,
    LeadRow,
    LostReason,
    MemberRow,
    MethodAmount,
    PersonRef,
    SalesDashboard,
    SalesPerformance,
    StaffAnalytics,
    StageCount,
    TrainerDashboard,
    TrainerPerformance,
    TrialRow,
)
from app.modules.analytics.service import Ms, checkup_progress, pct, shift_month
from app.modules.auth.models import User
from app.modules.checkups.models import CheckUp
from app.modules.checkups.queries import is_due, last_checkup, running_member_ids
from app.modules.finance.models import Payment
from app.modules.finance.service import paid_subquery
from app.modules.gyms.models import Gym, Role, StaffMembership
from app.modules.leads.models import OPEN_STAGES, Lead, LeadStage
from app.modules.leads.service import end_of_day_utc
from app.modules.members.models import Member, Membership
from app.modules.members.schemas import MemberCounts
from app.modules.members.status import CurrentMembership, current_membership_id, status_expr

LIST_SIZE = 8


def _start_of_day_utc(gym: Gym, day: date) -> datetime:
    return end_of_day_utc(gym, day - timedelta(days=1))


def _rows(rows, today: date, *, days_from_today: bool) -> list[MemberRow]:
    """(id, name, phone, date) rows -> MemberRow; days is signed so "5 days left" is positive
    when `days_from_today` (dates in the future) and "5 days ago" is positive otherwise."""
    return [
        MemberRow(
            member_id=r[0],
            name=r[1],
            phone=r[2],
            on=r[3],
            days=None
            if r[3] is None
            else ((r[3] - today).days if days_from_today else (today - r[3]).days),
        )
        for r in rows
    ]


# --- Trainer ----------------------------------------------------------------------------


async def trainer_dashboard(
    db: AsyncSession, ctx: TenantContext, gym: Gym, today: date, subject: PersonRef
) -> TrainerDashboard:
    def mine(stmt):
        return scope_members(
            stmt.where(Member.gym_id == gym.id, Member.trainer_id == subject.id), ctx
        )

    member_status = status_expr(today)
    current = CurrentMembership.id == current_membership_id(today)
    counts = MemberCounts()
    by_status = await db.execute(
        mine(
            select(member_status, func.count())
            .select_from(Member)
            .outerjoin(CurrentMembership, current)
        ).group_by(member_status)
    )
    for key, n in by_status.all():
        setattr(counts, key, n)
        counts.all += n
    counts.active += counts.expiring

    expiring = await db.execute(
        mine(
            select(Member.id, Member.name, Member.phone, CurrentMembership.end_date)
            .select_from(Member)
            .outerjoin(CurrentMembership, current)
        )
        .where(member_status == "expiring")
        .order_by(CurrentMembership.end_date)
        .limit(LIST_SIZE)
    )

    last = last_checkup(gym.id)
    due_stmt = mine(
        select(Member.id, Member.name, Member.phone, last.c.last_on)
        .outerjoin(last, last.c.member_id == Member.id)
        .where(
            Member.id.in_(running_member_ids(gym.id, today)),
            is_due(last, today - timedelta(days=gym.checkup_interval_days)),
        )
    )
    due_total = await db.scalar(select(func.count()).select_from(due_stmt.subquery())) or 0
    due_rows = await db.execute(
        due_stmt.order_by(last.c.last_on.is_not(None), last.c.last_on, Member.name).limit(LIST_SIZE)
    )

    published = select(AIPlan.member_id).where(
        AIPlan.gym_id == gym.id, AIPlan.status == PlanStatus.PUBLISHED
    )
    bare_stmt = mine(
        select(Member.id, Member.name, Member.phone).where(
            Member.id.in_(running_member_ids(gym.id, today)), Member.id.not_in(published)
        )
    )
    bare_total = await db.scalar(select(func.count()).select_from(bare_stmt.subquery())) or 0
    bare_rows = await db.execute(bare_stmt.order_by(Member.name).limit(LIST_SIZE))

    since = today - timedelta(days=90)
    progress_rows = (
        await db.execute(
            mine(
                select(
                    CheckUp.member_id,
                    CheckUp.recorded_on,
                    CheckUp.weight_kg,
                    CheckUp.body_fat_pct,
                    CheckUp.muscle_mass_kg,
                    CheckUp.waist_cm,
                    Member.goals,
                ).join(Member, Member.id == CheckUp.member_id)
            )
            .where(CheckUp.recorded_on >= since, CheckUp.recorded_on <= today)
            .order_by(CheckUp.recorded_on, CheckUp.created_at)
        )
    ).all()

    return TrainerDashboard(
        trainer=subject,
        clients=counts,
        expiring=_rows(expiring.all(), today, days_from_today=True),
        checkups_due=due_total,
        checkups_due_list=_rows(due_rows.all(), today, days_from_today=False),
        without_plan=bare_total,
        without_plan_list=_rows(
            [(r[0], r[1], r[2], None) for r in bare_rows.all()], today, days_from_today=True
        ),
        progress=checkup_progress(progress_rows),
    )


# --- Front desk -------------------------------------------------------------------------


async def desk_dashboard(
    db: AsyncSession, ctx: TenantContext, gym: Gym, today: date
) -> DeskDashboard:
    # Renewals: ending soon (or just ended) with no later membership started.
    later = Membership.__table__.alias("later")
    renewed = exists().where(
        later.c.member_id == Membership.member_id,
        later.c.cancelled_at.is_(None),
        later.c.start_date > Membership.start_date,
    )
    renew_stmt = scope_members(
        select(Member.id, Member.name, Member.phone, Membership.end_date)
        .join(Member, Member.id == Membership.member_id)
        .where(
            Membership.gym_id == gym.id,
            Membership.cancelled_at.is_(None),
            Membership.end_date >= today - timedelta(days=7),
            Membership.end_date <= today + timedelta(days=3),
            ~renewed,
        ),
        ctx,
    )
    renewals_count = await db.scalar(select(func.count()).select_from(renew_stmt.subquery())) or 0
    renewals = await db.execute(renew_stmt.order_by(Membership.end_date, Member.name).limit(10))

    # Dues: the same rule as /finance/dues, summed in SQL.
    paid = paid_subquery()
    balance = Membership.total - func.coalesce(paid.c.paid, 0)
    owed = scope_members(
        select(
            Member.id.label("member_id"),
            Member.name,
            Member.phone,
            Membership.plan_name,
            balance.label("balance"),
        )
        .select_from(Membership)
        .join(Member, Member.id == Membership.member_id)
        .outerjoin(paid, paid.c.membership_id == Membership.id)
        .where(
            Membership.gym_id == gym.id,
            Membership.cancelled_at.is_(None),
            balance > Decimal("0.005"),
        ),
        ctx,
    ).subquery()
    total_owed, owing = (
        await db.execute(select(func.sum(owed.c.balance), func.count(distinct(owed.c.member_id))))
    ).one()
    dues = await db.execute(select(owed).order_by(owed.c.balance.desc()).limit(6))

    # Today's takings, by method.
    taken = await db.execute(
        scope_members(
            select(Payment.method, func.sum(Payment.amount), func.count())
            .join(Member, Member.id == Payment.member_id)
            .where(Payment.gym_id == gym.id, Payment.paid_on == today, Payment.voided_at.is_(None)),
            ctx,
        ).group_by(Payment.method)
    )
    methods = [
        MethodAmount(method=m.value, amount=round_money(Decimal(a)), payments=n)
        for m, a, n in taken.all()
    ]

    trials = await db.execute(
        select(Lead, User.name)
        .outerjoin(User, User.id == Lead.assigned_to)
        .where(
            Lead.gym_id == gym.id,
            Lead.stage.in_(OPEN_STAGES),
            Lead.trial_at >= _start_of_day_utc(gym, today),
            Lead.trial_at < end_of_day_utc(gym, today),
        )
        .order_by(Lead.trial_at)
    )
    new_today = await db.scalar(
        scope_members(
            select(func.count())
            .select_from(Member)
            .where(Member.gym_id == gym.id, Member.joined_on == today),
            ctx,
        )
    )

    return DeskDashboard(
        renewals=_rows(renewals.all(), today, days_from_today=True),
        renewals_count=renewals_count,
        outstanding=round_money(Decimal(total_owed or 0)),
        dues_count=owing or 0,
        dues=[
            DueRow(
                member_id=r.member_id,
                name=r.name,
                phone=r.phone,
                plan_name=r.plan_name,
                balance=round_money(Decimal(r.balance)),
            )
            for r in dues.all()
        ],
        payments_today=round_money(sum((m.amount for m in methods), Decimal(0))),
        payments_today_count=sum(m.payments for m in methods),
        payments_by_method=sorted(methods, key=lambda m: -m.amount),
        trials_today=[
            TrialRow(
                lead_id=lead.id,
                name=lead.name,
                phone=lead.phone,
                trial_at=lead.trial_at,
                assigned_to=who,
            )
            for lead, who in trials.all()
        ],
        new_members_today=new_today or 0,
    )


# --- Sales ------------------------------------------------------------------------------


async def sales_dashboard(
    db: AsyncSession, ctx: TenantContext, gym: Gym, today: date
) -> SalesDashboard:
    me = ctx.user.id
    now = utcnow()
    team_leads = select(Lead).where(Lead.gym_id == gym.id)

    async def pipeline(only_mine: bool) -> list[StageCount]:
        stmt = select(Lead.stage, func.count()).where(
            Lead.gym_id == gym.id, Lead.stage.in_(OPEN_STAGES)
        )
        if only_mine:
            stmt = stmt.where(Lead.assigned_to == me)
        found = dict((await db.execute(stmt.group_by(Lead.stage))).all())
        return [StageCount(stage=s, leads=found.get(s, 0)) for s in OPEN_STAGES]

    my_open = and_(Lead.gym_id == gym.id, Lead.assigned_to == me, Lead.stage.in_(OPEN_STAGES))
    due_cutoff = end_of_day_utc(gym, today)
    follow_up_where = and_(my_open, Lead.next_follow_up_at < due_cutoff)
    follow_ups_due = await db.scalar(select(func.count()).where(follow_up_where)) or 0
    follow_ups = await db.scalars(
        team_leads.where(follow_up_where).order_by(Lead.next_follow_up_at).limit(LIST_SIZE)
    )
    trials = await db.scalars(
        team_leads.where(
            my_open,
            Lead.trial_at >= _start_of_day_utc(gym, today),
            Lead.trial_at < end_of_day_utc(gym, today + timedelta(days=7)),
        )
        .order_by(Lead.trial_at)
        .limit(LIST_SIZE)
    )

    async def converted_since(days: int, only_mine: bool) -> int:
        stmt = select(func.count()).where(
            Lead.gym_id == gym.id, Lead.converted_at >= now - timedelta(days=days)
        )
        return await db.scalar(stmt.where(Lead.assigned_to == me) if only_mine else stmt) or 0

    async def conversion_90d(only_mine: bool) -> float | None:
        stmt = select(func.count(), func.count().filter(Lead.stage == LeadStage.CONVERTED)).where(
            Lead.gym_id == gym.id, Lead.created_at >= now - timedelta(days=90)
        )
        if only_mine:
            stmt = stmt.where(Lead.assigned_to == me)
        total, converted = (await db.execute(stmt)).one()
        return pct(converted, total)

    reasons = await db.execute(
        select(Lead.lost_reason, func.count())
        .where(
            Lead.gym_id == gym.id,
            Lead.stage == LeadStage.LOST,
            Lead.updated_at >= now - timedelta(days=90),
        )
        .group_by(Lead.lost_reason)
        .order_by(func.count().desc())
        .limit(5)
    )

    def lead_row(lead: Lead, at: datetime | None) -> LeadRow:
        return LeadRow(
            lead_id=lead.id,
            name=lead.name,
            phone=lead.phone,
            stage=lead.stage,
            source=lead.source,
            at=at,
        )

    return SalesDashboard(
        pipeline_mine=await pipeline(True),
        pipeline_team=await pipeline(False),
        follow_ups_due=follow_ups_due,
        follow_ups=[lead_row(x, x.next_follow_up_at) for x in follow_ups.all()],
        trials=[lead_row(x, x.trial_at) for x in trials.all()],
        converted_mine_30d=await converted_since(30, True),
        converted_team_30d=await converted_since(30, False),
        conversion_mine_90d=await conversion_90d(True),
        conversion_team_90d=await conversion_90d(False),
        lost_reasons=[LostReason(reason=r or "No reason given", leads=n) for r, n in reasons.all()],
    )


# --- Who is doing how well --------------------------------------------------------------


async def staff_analytics(
    db: AsyncSession, ctx: TenantContext, gym: Gym, today: date, months: int
) -> StaffAnalytics:
    period_start = shift_month(today, -(months - 1))
    cutoff = today - timedelta(days=gym.checkup_interval_days)
    utc_start = _start_of_day_utc(gym, period_start)

    # --- Trainers
    coaches = (
        await db.execute(
            select(User.id, User.name)
            .join(StaffMembership, StaffMembership.user_id == User.id)
            .where(
                StaffMembership.gym_id == gym.id,
                StaffMembership.is_active,
                StaffMembership.role == Role.TRAINER,
            )
        )
    ).all()
    names = dict(coaches)
    members = (
        await db.execute(
            scope_members(
                select(Member.id, Member.trainer_id).where(
                    Member.gym_id == gym.id, Member.trainer_id.is_not(None)
                ),
                ctx,
            )
        )
    ).all()
    owner_of = dict(members)
    # Managers/owners with clients show up too.
    stray = {t for t in owner_of.values() if t not in names}
    if stray:
        names.update((await db.execute(select(User.id, User.name).where(User.id.in_(stray)))).all())

    ms_rows = (
        await db.execute(
            select(
                Membership.member_id,
                Membership.start_date,
                Membership.end_date,
                Membership.freeze_start,
                Membership.freeze_end,
                Membership.plan_name,
                Membership.total,
            ).where(
                Membership.gym_id == gym.id,
                Membership.cancelled_at.is_(None),
                Membership.member_id.in_(owner_of),
            )
        )
    ).all()
    by_member: dict[uuid.UUID, list[Ms]] = defaultdict(list)
    for r in ms_rows:
        by_member[r[0]].append(Ms(*r))

    last_on = dict(
        (
            await db.execute(
                select(CheckUp.member_id, func.max(CheckUp.recorded_on))
                .where(CheckUp.gym_id == gym.id, CheckUp.member_id.in_(owner_of))
                .group_by(CheckUp.member_id)
            )
        ).all()
    )
    checkup_rows = (
        await db.execute(
            select(
                CheckUp.member_id,
                CheckUp.recorded_on,
                CheckUp.weight_kg,
                CheckUp.body_fat_pct,
                CheckUp.muscle_mass_kg,
                CheckUp.waist_cm,
                Member.goals,
            )
            .join(Member, Member.id == CheckUp.member_id)
            .where(
                CheckUp.gym_id == gym.id,
                CheckUp.member_id.in_(owner_of),
                CheckUp.recorded_on >= period_start,
                CheckUp.recorded_on <= today,
            )
            .order_by(CheckUp.recorded_on, CheckUp.created_at)
        )
    ).all()

    clients: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for member_id, trainer_id in owner_of.items():
        clients[trainer_id].append(member_id)
    trainers = []
    for trainer_id, name in names.items():
        mine = clients.get(trainer_id, [])
        active = sum(1 for m in mine if any(x.active_on(today) for x in by_member[m]))
        running = [m for m in mine if any(x.start <= today <= x.end for x in by_member[m])]
        checked = sum(1 for m in running if last_on.get(m) and last_on[m] > cutoff)
        ended = [x for m in mine for x in by_member[m] if period_start <= x.end < today]
        renewed = sum(1 for x in ended if any(o.start > x.start for o in by_member[x.member_id]))
        progress = checkup_progress(
            [r for r in checkup_rows if owner_of[r.member_id] == trainer_id]
        )
        trainers.append(
            TrainerPerformance(
                user_id=trainer_id,
                name=name,
                clients=len(mine),
                active_clients=active,
                renewal_rate=pct(renewed, len(ended)),
                checkup_compliance=pct(checked, len(running)),
                members_tracked=progress.members_tracked,
                on_track=progress.on_track,
                avg_weight_change=progress.avg_weight_change,
            )
        )
    trainers.sort(key=lambda t: (-t.active_clients, t.name))

    # --- Sales (leads are gym-wide, not branch-bound)
    lead_rows = (
        await db.execute(
            select(
                Lead.assigned_to,
                Lead.stage,
                Lead.trial_at.is_not(None),
                Lead.converted_member_id,
            ).where(
                Lead.gym_id == gym.id,
                Lead.assigned_to.is_not(None),
                Lead.created_at >= utc_start,
            )
        )
    ).all()
    converted_members = {r[3] for r in lead_rows if r[3]}
    paid_by_member: dict[uuid.UUID, Decimal] = {}
    if converted_members:
        paid_by_member = dict(
            (
                await db.execute(
                    select(Payment.member_id, func.sum(Payment.amount))
                    .where(
                        Payment.gym_id == gym.id,
                        Payment.voided_at.is_(None),
                        Payment.member_id.in_(converted_members),
                    )
                    .group_by(Payment.member_id)
                )
            ).all()
        )
    per_rep: dict[uuid.UUID, list] = defaultdict(list)
    for row in lead_rows:
        per_rep[row[0]].append(row)
    rep_names = (
        dict((await db.execute(select(User.id, User.name).where(User.id.in_(per_rep)))).all())
        if per_rep
        else {}
    )
    sales = []
    for rep_id, rows in per_rep.items():
        converted = [r for r in rows if r[1] == LeadStage.CONVERTED]
        sales.append(
            SalesPerformance(
                user_id=rep_id,
                name=rep_names.get(rep_id, "Former staff"),
                leads=len(rows),
                contacted=sum(1 for r in rows if r[1] != LeadStage.NEW),
                trials=sum(1 for r in rows if r[2]),
                converted=len(converted),
                conversion_rate=pct(len(converted), len(rows)),
                revenue=round_money(
                    sum(
                        (Decimal(paid_by_member.get(r[3], 0)) for r in converted if r[3]),
                        Decimal(0),
                    )
                ),
            )
        )
    sales.sort(key=lambda s: (-s.converted, -s.leads, s.name))

    return StaffAnalytics(period_start=period_start, trainers=trainers, sales=sales)
