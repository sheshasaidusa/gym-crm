import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.core.schemas import Money
from app.modules.leads.models import LeadSource, LeadStage
from app.modules.members.models import Goal
from app.modules.members.schemas import MemberCounts


class Kpis(BaseModel):
    active_members: int
    active_last_month: int  # at the end of last month
    new_this_month: int
    new_last_month: int
    renewal_rate: float | None  # % of memberships that ended in the period and were renewed
    revenue_this_month: Money
    revenue_last_month: Money
    lead_conversion_rate: float | None  # % of leads created in the period that converted


class MemberMonth(BaseModel):
    month: str  # "2026-10"
    active: int  # at the end of the month (today for the current month)
    new: int  # joined this month
    renewed: int  # memberships that ended this month and have a later one
    churned: int  # memberships that ended this month with nothing after
    renewal_rate: float | None
    checkups: int


class FinanceMonth(BaseModel):
    month: str
    revenue: Money
    expenses: Money
    profit: Money


class PlanAmount(BaseModel):
    plan: str
    amount: Money


class PlanCount(BaseModel):
    plan: str
    members: int


class Upcoming(BaseModel):
    expiring_30_days: int  # current memberships ending within 30 days, not yet renewed
    renewal_value: Money  # what those memberships were sold for


class StageCount(BaseModel):
    stage: LeadStage
    leads: int


class SourceCount(BaseModel):
    source: LeadSource
    leads: int
    converted: int


class LeadAnalytics(BaseModel):
    total: int
    converted: int
    lost: int
    conversion_rate: float | None
    avg_days_to_convert: float | None
    by_stage: list[StageCount]
    by_source: list[SourceCount]


class GoalProgress(BaseModel):
    goal: Goal | None
    members: int
    on_track: int
    avg_weight_change: float | None


class CheckupProgress(BaseModel):
    members_tracked: int  # members with 2+ check-ups in the period
    on_track: int  # moved in the direction of their goal
    avg_weight_change: float | None  # kg, last minus first
    avg_body_fat_change: float | None  # percentage points
    by_goal: list[GoalProgress]


# --- Role dashboards ---------------------------------------------------------------


class PersonRef(BaseModel):
    id: uuid.UUID
    name: str


class MemberRow(BaseModel):
    """A member who needs attention, with the one date that matters."""

    member_id: uuid.UUID
    name: str
    phone: str
    on: date | None = None  # membership end, last check-up, ... depends on the list
    days: int | None = None  # days left / days since, from `on`


class TrainerDashboard(BaseModel):
    trainer: PersonRef
    clients: MemberCounts
    expiring: list[MemberRow]  # memberships ending within 7 days, soonest first
    checkups_due: int
    checkups_due_list: list[MemberRow]  # longest-waiting first; `on` = last check-up
    without_plan: int  # running members with no published workout plan
    without_plan_list: list[MemberRow]
    progress: CheckupProgress  # their clients, last 90 days
    attendance_tracked: bool = False  # false: the gym doesn't record visits, hide the rest
    visits_7d: int = 0  # visits by their clients in the last 7 days
    at_risk: int = 0  # running clients with no visit for 14 days
    at_risk_list: list[MemberRow] = []  # `on` = last visit


class DueRow(BaseModel):
    member_id: uuid.UUID
    name: str
    phone: str
    plan_name: str
    balance: Money


class MethodAmount(BaseModel):
    method: str
    amount: Money
    payments: int


class TrialRow(BaseModel):
    lead_id: uuid.UUID
    name: str
    phone: str
    trial_at: datetime
    assigned_to: str | None


class DeskDashboard(BaseModel):
    renewals: list[MemberRow]  # ending in the next 3 days or ended in the last 7, not renewed
    renewals_count: int
    outstanding: Money
    dues_count: int  # members who owe something
    dues: list[DueRow]  # biggest first
    payments_today: Money
    payments_today_count: int
    payments_by_method: list[MethodAmount]
    trials_today: list[TrialRow]
    new_members_today: int
    checkins_today: int = 0
    attendance_tracked: bool = False


class LeadRow(BaseModel):
    lead_id: uuid.UUID
    name: str
    phone: str
    stage: LeadStage
    source: LeadSource
    at: datetime | None  # follow-up or trial time, depending on the list


class LostReason(BaseModel):
    reason: str
    leads: int


class SalesDashboard(BaseModel):
    pipeline_mine: list[StageCount]  # open stages
    pipeline_team: list[StageCount]
    follow_ups_due: int
    follow_ups: list[LeadRow]  # mine, oldest first
    trials: list[LeadRow]  # mine, next 7 days
    converted_mine_30d: int
    converted_team_30d: int
    conversion_mine_90d: float | None
    conversion_team_90d: float | None
    lost_reasons: list[LostReason]  # team, 90 days


class TrainerPerformance(BaseModel):
    user_id: uuid.UUID
    name: str
    clients: int
    active_clients: int
    renewal_rate: float | None
    checkup_compliance: float | None  # % of running clients checked up within the interval
    members_tracked: int
    on_track: int
    avg_weight_change: float | None
    visits_per_client_week: float | None = None  # None when the gym doesn't record visits


class SalesPerformance(BaseModel):
    user_id: uuid.UUID
    name: str
    leads: int
    contacted: int
    trials: int
    converted: int
    conversion_rate: float | None
    revenue: Money  # payments from the members they converted


class StaffAnalytics(BaseModel):
    period_start: date
    trainers: list[TrainerPerformance]
    sales: list[SalesPerformance]


class NewVsRenewal(BaseModel):
    new: Money
    renewal: Money
    other: Money  # payments not tied to a membership


class BranchRow(BaseModel):
    branch: str
    active_members: int
    new_this_month: int
    revenue_this_month: Money


class AnalyticsOut(BaseModel):
    currency: str
    today: date
    period_start: date
    kpis: Kpis
    members: list[MemberMonth]
    finance: list[FinanceMonth]
    revenue_by_plan: list[PlanAmount]
    active_by_plan: list[PlanCount]
    upcoming: Upcoming
    leads: LeadAnalytics
    checkups: CheckupProgress
    revenue_by_method: list[MethodAmount] = []
    new_vs_renewal: NewVsRenewal | None = None
    branch_comparison: list[BranchRow] = []  # only when looking at every branch
    absent_14_days: int | None = (
        None  # running members with no visit for 14 days; None if untracked
    )
