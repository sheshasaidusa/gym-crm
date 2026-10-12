import re
import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.dates import DurationUnit
from app.core.schemas import Money, MoneyIn, ORMModel
from app.modules.finance.models import PaymentMethod
from app.modules.members.models import DietPref, ExperienceLevel, Gender, Goal
from app.modules.members.status import Status


def normalize_phone(v: str) -> str:
    """Keep a leading + and digits only: "+91 98765-43210" -> "+919876543210"."""
    v = v.strip()
    digits = re.sub(r"\D", "", v)
    if not 7 <= len(digits) <= 15:
        raise ValueError("Enter a valid phone number")
    return ("+" if v.startswith("+") else "") + digits


def _optional_phone(v: str | None) -> str | None:
    return normalize_phone(v) if v and v.strip() else None


def _phone_if_given(v: str | None) -> str | None:
    return normalize_phone(v) if v is not None else None


MAX_GOALS = 3


def _clean_goals(v: list[Goal] | None) -> list[Goal] | None:
    if v is None:
        return v
    goals = list(dict.fromkeys(v))
    if len(goals) > MAX_GOALS:
        raise ValueError(f"Pick up to {MAX_GOALS} goals")
    return goals


def _clean_tags(v: list[str] | None) -> list[str] | None:
    if v is None:
        return v
    tags = list(dict.fromkeys(t.strip().lower()[:30] for t in v if t.strip()))
    if len(tags) > 15:
        raise ValueError("Up to 15 tags")
    return tags


def _empty_to_none(v):
    return None if isinstance(v, str) and not v.strip() else v


# --- Memberships ------------------------------------------------------------


class InitialPayment(BaseModel):
    """Money taken at the moment a membership is sold."""

    amount: MoneyIn
    method: PaymentMethod = PaymentMethod.CASH
    reference: str | None = Field(None, max_length=100)


class MembershipIn(BaseModel):
    plan_id: uuid.UUID
    start_date: date | None = None  # default: today, or the day after the current one ends
    price: MoneyIn | None = None  # default: the plan's price
    discount: MoneyIn = Decimal(0)
    joining_fee: MoneyIn | None = None  # default: plan's fee on a member's first membership
    notes: str | None = Field(None, max_length=1000)
    payment: InitialPayment | None = None


class FreezeIn(BaseModel):
    days: int = Field(ge=1, le=365)
    start_date: date | None = None  # default: today


class MembershipOut(ORMModel):
    id: uuid.UUID
    plan_id: uuid.UUID | None
    plan_name: str
    duration_value: int
    duration_unit: DurationUnit
    start_date: date
    end_date: date
    price: Money
    discount: Money
    joining_fee: Money
    tax_pct: Money
    total: Money
    max_freeze_days: int
    frozen_days: int
    freeze_start: date | None
    freeze_end: date | None
    cancelled_at: datetime | None
    notes: str | None
    created_at: datetime
    status: Status
    days_left: int | None
    paid: Money
    balance: Money


class CurrentMembershipOut(BaseModel):
    id: uuid.UUID
    plan_name: str
    start_date: date
    end_date: date
    status: Status
    days_left: int | None


# --- Members ----------------------------------------------------------------


class MemberFields(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: EmailStr | None = None
    dob: date | None = None
    gender: Gender | None = None
    address: str | None = Field(None, max_length=500)
    emergency_contact_name: str | None = Field(None, max_length=120)
    emergency_contact_phone: str | None = None
    height_cm: float | None = Field(None, ge=50, le=260)
    goals: list[Goal] = []
    diet_pref: DietPref | None = None
    experience_level: ExperienceLevel | None = None
    medical_notes: str | None = Field(None, max_length=2000)
    notes: str | None = Field(None, max_length=2000)
    tags: list[str] = []
    trainer_id: uuid.UUID | None = None
    branch_id: uuid.UUID | None = None

    _empty = field_validator(
        "email", "address", "emergency_contact_name", "medical_notes", "notes", mode="before"
    )(_empty_to_none)
    _phone = field_validator("phone")(_phone_if_given)
    _ec_phone = field_validator("emergency_contact_phone")(_optional_phone)
    _tags = field_validator("tags")(_clean_tags)
    _goals = field_validator("goals")(_clean_goals)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        return " ".join(v.split()) if v is not None else None

    @field_validator("dob")
    @classmethod
    def _valid_dob(cls, v: date | None) -> date | None:
        if v and not date(1900, 1, 1) <= v <= date.today():
            raise ValueError("Enter a valid date of birth")
        return v


class MemberIn(MemberFields):
    joined_on: date | None = None  # default: today
    membership: MembershipIn | None = None


class MemberUpdate(MemberFields):
    # Every field optional; only sent fields change.
    name: str | None = Field(None, min_length=2, max_length=120)  # type: ignore[assignment]
    phone: str | None = None  # type: ignore[assignment]
    tags: list[str] | None = None  # type: ignore[assignment]
    goals: list[Goal] | None = None  # type: ignore[assignment]
    joined_on: date | None = None
    preview_enabled: bool | None = None


class StaffRef(BaseModel):
    id: uuid.UUID
    name: str


class MemberListItem(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    email: str | None
    photo_url: str | None
    branch_id: uuid.UUID | None
    trainer: StaffRef | None
    tags: list[str]
    joined_on: date
    status: Status
    current_membership: CurrentMembershipOut | None


class MemberOut(MemberListItem):
    dob: date | None
    gender: Gender | None
    address: str | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    height_cm: float | None
    goals: list[Goal]
    diet_pref: DietPref | None
    experience_level: ExperienceLevel | None
    medical_notes: str | None
    notes: str | None
    preview_enabled: bool
    preview_url: str
    memberships: list[MembershipOut]
    last_checkup_on: date | None
    created_at: datetime


class MemberCounts(BaseModel):
    all: int = 0
    active: int = 0  # includes expiring
    expiring: int = 0
    frozen: int = 0
    upcoming: int = 0
    expired: int = 0
    none: int = 0
