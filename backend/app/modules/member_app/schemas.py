import re
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.modules.ai_plans.content import PlanContent
from app.modules.members.status import Status

# --- Shared with the public /p/{token} page -----------------------------------------------


class PublicGym(BaseModel):
    name: str
    brand_color: str
    logo_url: str | None
    phone: str | None


class PublicMembership(BaseModel):
    plan_name: str
    status: Status
    start_date: date
    end_date: date
    days_left: int | None
    frozen_until: date | None
    renewal_starts: date | None


class Point(BaseModel):
    date: date
    value: float


class PublicProgress(BaseModel):
    checkups: int
    latest_date: date
    weight_kg: float | None
    body_fat_pct: float | None
    bmi: float | None
    waist_cm: float | None
    weight_change_kg: float | None  # since the first check-up
    first_date: date
    weight_series: list[Point]


class PublicMemberPage(BaseModel):
    gym: PublicGym
    member_name: str
    first_name: str
    trainer_name: str | None
    membership: PublicMembership | None
    plan: PlanContent | None
    plan_updated_at: datetime | None
    progress: PublicProgress | None


# --- Staff side: app access for one member ------------------------------------------------


class AppAccessOut(BaseModel):
    status: Literal["none", "invited", "active", "disabled"]
    activated_at: datetime | None = None
    last_login_at: datetime | None = None
    link_expires_at: datetime | None = None
    locked: bool = False


class AppLinkOut(BaseModel):
    url: str
    expires_at: datetime


# --- Member side --------------------------------------------------------------------------


def _check_pin(v: str) -> str:
    if not re.fullmatch(r"\d{4,6}", v):
        raise ValueError("Use 4 to 6 digits")
    digits = [int(c) for c in v]
    steps = {b - a for a, b in zip(digits, digits[1:], strict=False)}
    repeated_pair = len(v) % 2 == 0 and v == v[:2] * (len(v) // 2)  # 1212
    if len(set(v)) == 1 or steps in ({1}, {-1}) or repeated_pair:
        raise ValueError("That PIN is too easy to guess. Pick something less obvious")
    return v


class ActivationPreview(BaseModel):
    gym_name: str
    brand_color: str
    logo_url: str | None
    first_name: str


class ActivateIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    pin: str

    _pin = field_validator("pin")(_check_pin)


class MemberLoginIn(BaseModel):
    phone: str = Field(min_length=7, max_length=30)
    pin: str = Field(min_length=4, max_length=6)
    gym_id: uuid.UUID | None = None


class MemberSession(BaseModel):
    gym_name: str
    first_name: str


class MemberMe(BaseModel):
    gym: PublicGym
    member_name: str
    first_name: str
    trainer_name: str | None
    trainer_phone: str | None
    membership: PublicMembership | None
    progress: PublicProgress | None
    next_checkup_on: date | None  # when their next check-up is due (today or earlier = due now)
    has_plan: bool


class MemberPlan(BaseModel):
    plan: PlanContent | None
    updated_at: datetime | None


class MemberCheckUp(BaseModel):
    id: uuid.UUID
    recorded_on: date
    weight_kg: float | None
    bmi: float | None
    body_fat_pct: float | None
    muscle_mass_kg: float | None
    chest_cm: float | None
    waist_cm: float | None
    hips_cm: float | None
    arm_cm: float | None
    thigh_cm: float | None
    notes: str | None
    photos: list[str]  # URLs under /api/m/checkup-photos
