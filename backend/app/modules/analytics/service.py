"""Gym analytics, computed live from the source tables.

Each query loads only the few columns it needs for one gym, and the numbers are put
together in Python so the rules match the member status logic exactly. For gyms with
up to tens of thousands of memberships this takes milliseconds; nightly rollup tables
can replace it later without changing the API.
"""

import calendar
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.schemas import round_money
from app.modules.analytics.schemas import (
    AnalyticsOut,
    CheckupProgress,
    FinanceMonth,
    GoalProgress,
    Kpis,
    LeadAnalytics,
    MemberMonth,
    PlanAmount,
    PlanCount,
    SourceCount,
    StageCount,
    Upcoming,
)
from app.modules.checkups.models import CheckUp
from app.modules.finance.models import Expense, Payment
from app.modules.gyms.models import Gym
from app.modules.leads.models import Lead, LeadSource, LeadStage
from app.modules.members.models import Goal, Member, Membership

ZERO = Decimal("0.00")
OTHER_PAYMENTS = "Other payments"


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def shift_month(d: date, months: int) -> date:
    """First day of the month `months` away from d's month."""
    total = d.year * 12 + (d.month - 1) + months
    return date(total // 12, total % 12 + 1, 1)


def month_end(first: date) -> date:
    return first.replace(day=calendar.monthrange(first.year, first.month)[1])


def pct(part: int, whole: int) -> float | None:
    return round(part * 100 / whole, 1) if whole else None


def avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


@dataclass
class Ms:
    member_id: uuid.UUID
    start: date
    end: date
    freeze_start: date | None
    freeze_end: date | None
    plan_name: str
    total: Decimal

    def active_on(self, d: date) -> bool:
        if not self.start <= d <= self.end:
            return False
        return not (
            self.freeze_start and self.freeze_end and self.freeze_start <= d <= self.freeze_end
        )


async def build(
    db: AsyncSession, gym: Gym, today: date, months: int, branch_id: uuid.UUID | None
) -> AnalyticsOut:
    firsts = [shift_month(today, i - months + 1) for i in range(months)]
    keys = [month_key(f) for f in firsts]
    period_start = firsts[0]
    this_key, last_key = month_key(today), month_key(shift_month(today, -1))
    try:
        tz = ZoneInfo(gym.timezone)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")

    def member_scope(stmt):
        stmt = stmt.where(Member.gym_id == gym.id)
        return stmt.where(Member.branch_id == branch_id) if branch_id else stmt

    # --- Memberships & members ------------------------------------------------------
    rows = await db.execute(
        member_scope(
            select(
                Membership.member_id,
                Membership.start_date,
                Membership.end_date,
                Membership.freeze_start,
                Membership.freeze_end,
                Membership.plan_name,
                Membership.total,
            )
            .join(Member, Member.id == Membership.member_id)
            .where(Membership.cancelled_at.is_(None))
        )
    )
    memberships = [Ms(*r) for r in rows.all()]
    by_member: dict[uuid.UUID, list[Ms]] = defaultdict(list)
    for m in memberships:
        by_member[m.member_id].append(m)

    def active_count(d: date) -> int:
        return sum(1 for ms in by_member.values() if any(m.active_on(d) for m in ms))

    def renewed(m: Ms) -> bool:
        return any(o.start > m.start for o in by_member[m.member_id])

    joined = Counter(
        month_key(d)
        for (d,) in (
            await db.execute(
                member_scope(select(Member.joined_on)).where(
                    Member.joined_on >= shift_month(today, -months)
                )
            )
        ).all()
    )

    ended: dict[str, list[Ms]] = defaultdict(list)
    for m in memberships:
        if period_start <= m.end < today:  # only memberships that have fully run out
            ended[month_key(m.end)].append(m)

    # --- Check-ups --------------------------------------------------------------------
    checkup_rows = (
        await db.execute(
            member_scope(
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
                .where(CheckUp.recorded_on >= period_start, CheckUp.recorded_on <= today)
                .order_by(CheckUp.recorded_on, CheckUp.created_at)
            )
        )
    ).all()
    checkups_per_month = Counter(month_key(r.recorded_on) for r in checkup_rows)

    member_months = []
    for first, key in zip(firsts, keys, strict=True):
        done = ended.get(key, [])
        n_renewed = sum(1 for m in done if renewed(m))
        member_months.append(
            MemberMonth(
                month=key,
                active=active_count(min(month_end(first), today)),
                new=joined[key],
                renewed=n_renewed,
                churned=len(done) - n_renewed,
                renewal_rate=pct(n_renewed, len(done)),
                checkups=checkups_per_month[key],
            )
        )
    all_ended = [m for ms in ended.values() for m in ms]

    # --- Money --------------------------------------------------------------------------
    pay_rows = (
        await db.execute(
            member_scope(
                select(Payment.paid_on, Payment.amount, Membership.plan_name)
                .join(Member, Member.id == Payment.member_id)
                .outerjoin(Membership, Membership.id == Payment.membership_id)
                .where(
                    Payment.voided_at.is_(None),
                    Payment.paid_on >= min(period_start, shift_month(today, -1)),
                    Payment.paid_on <= today,
                )
            )
        )
    ).all()
    revenue: dict[str, Decimal] = defaultdict(lambda: ZERO)
    by_plan: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for paid_on, amount, plan_name in pay_rows:
        revenue[month_key(paid_on)] += amount
        if paid_on >= period_start:
            by_plan[plan_name or OTHER_PAYMENTS] += amount

    expense_stmt = select(Expense.spent_on, Expense.amount).where(
        Expense.gym_id == gym.id, Expense.spent_on >= period_start, Expense.spent_on <= today
    )
    if branch_id:
        expense_stmt = expense_stmt.where(Expense.branch_id == branch_id)
    spent: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for spent_on, amount in (await db.execute(expense_stmt)).all():
        spent[month_key(spent_on)] += amount

    finance = []
    for key in keys:
        r, e = round_money(revenue[key]), round_money(spent[key])
        finance.append(FinanceMonth(month=key, revenue=r, expenses=e, profit=r - e))

    # --- Now & next 30 days -------------------------------------------------------------
    active_plans: Counter[str] = Counter()
    for ms in by_member.values():
        current = next((m for m in ms if m.active_on(today)), None)
        if current:
            active_plans[current.plan_name] += 1

    soon = today + timedelta(days=30)
    expiring = [
        m for m in memberships if today <= m.end <= soon and not renewed(m) and m.start <= today
    ]

    # --- Leads (gym-wide: leads aren't tied to a branch) ---------------------------------
    since = datetime.combine(period_start, datetime.min.time(), tzinfo=tz)
    lead_rows = (
        await db.execute(
            select(Lead.source, Lead.stage, Lead.created_at, Lead.converted_at).where(
                Lead.gym_id == gym.id, Lead.created_at >= since
            )
        )
    ).all()
    stage_counts = Counter(r.stage for r in lead_rows)
    source_counts: dict[LeadSource, list[int]] = defaultdict(lambda: [0, 0])
    days_to_convert = []
    for r in lead_rows:
        source_counts[r.source][0] += 1
        if r.stage == LeadStage.CONVERTED:
            source_counts[r.source][1] += 1
            if r.converted_at:
                days_to_convert.append((r.converted_at - r.created_at).total_seconds() / 86400)
    n_converted = stage_counts[LeadStage.CONVERTED]
    leads = LeadAnalytics(
        total=len(lead_rows),
        converted=n_converted,
        lost=stage_counts[LeadStage.LOST],
        conversion_rate=pct(n_converted, len(lead_rows)),
        avg_days_to_convert=avg(days_to_convert),
        by_stage=[StageCount(stage=s, leads=stage_counts[s]) for s in LeadStage],
        by_source=sorted(
            (SourceCount(source=s, leads=n, converted=c) for s, (n, c) in source_counts.items()),
            key=lambda x: -x.leads,
        ),
    )

    return AnalyticsOut(
        currency=gym.currency,
        today=today,
        period_start=period_start,
        kpis=Kpis(
            active_members=active_count(today),
            active_last_month=active_count(month_end(shift_month(today, -1))),
            new_this_month=joined[this_key],
            new_last_month=joined[last_key],
            renewal_rate=pct(sum(1 for m in all_ended if renewed(m)), len(all_ended)),
            revenue_this_month=round_money(revenue[this_key]),
            revenue_last_month=round_money(revenue[last_key]),
            lead_conversion_rate=leads.conversion_rate,
        ),
        members=member_months,
        finance=finance,
        revenue_by_plan=[
            PlanAmount(plan=p, amount=round_money(a))
            for p, a in sorted(by_plan.items(), key=lambda x: -x[1])
        ],
        active_by_plan=[PlanCount(plan=p, members=n) for p, n in active_plans.most_common()],
        upcoming=Upcoming(
            expiring_30_days=len({m.member_id for m in expiring}),
            renewal_value=round_money(sum((m.total for m in expiring), ZERO)),
        ),
        leads=leads,
        checkups=checkup_progress(checkup_rows),
    )


def _change(first, last, attr: str) -> float | None:
    a, b = getattr(first, attr), getattr(last, attr)
    return None if a is None or b is None else b - a


def on_track(goal: Goal | None, first, last) -> bool:
    """Did the member move in the direction their goal asks for? Unknown counts as no."""
    weight = _change(first, last, "weight_kg")
    fat = _change(first, last, "body_fat_pct")
    if goal == Goal.WEIGHT_LOSS:
        change = weight if weight is not None else fat
        return change is not None and change < 0
    if goal in (Goal.MUSCLE_GAIN, Goal.STRENGTH):
        muscle = _change(first, last, "muscle_mass_kg")
        change = muscle if muscle is not None else weight
        return change is not None and change > 0
    for change in (fat, _change(first, last, "waist_cm")):
        if change is not None:
            return change < 0
    return False


def checkup_progress(rows) -> CheckupProgress:
    """First vs last check-up in the period, for members with at least two."""
    per_member: dict[uuid.UUID, list] = defaultdict(list)
    for r in rows:
        per_member[r.member_id].append(r)

    weight_changes: list[float] = []
    fat_changes: list[float] = []
    goals: dict[Goal | None, list] = defaultdict(lambda: [0, 0, []])
    n_tracked = n_on_track = 0
    for checks in per_member.values():
        if len(checks) < 2:
            continue
        first, last = checks[0], checks[-1]
        n_tracked += 1
        member_goals: list[Goal | None] = [Goal(x) for x in first.goals or []] or [None]
        # Overall progress follows the first (primary) goal; each goal also gets its own row.
        n_on_track += on_track(member_goals[0], first, last)
        w = _change(first, last, "weight_kg")
        for goal in member_goals:
            g = goals[goal]
            g[0] += 1
            g[1] += on_track(goal, first, last)
            if w is not None:
                g[2].append(w)
        if w is not None:
            weight_changes.append(w)
        if (f := _change(first, last, "body_fat_pct")) is not None:
            fat_changes.append(f)

    return CheckupProgress(
        members_tracked=n_tracked,
        on_track=n_on_track,
        avg_weight_change=avg(weight_changes),
        avg_body_fat_change=avg(fat_changes),
        by_goal=sorted(
            (
                GoalProgress(goal=goal, members=n, on_track=ok, avg_weight_change=avg(ws))
                for goal, (n, ok, ws) in goals.items()
            ),
            key=lambda x: -x.members,
        ),
    )
