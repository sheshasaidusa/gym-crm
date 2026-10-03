from datetime import date

from pydantic import BaseModel

from app.core.schemas import Money
from app.modules.leads.models import LeadSource, LeadStage
from app.modules.members.models import Goal


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
