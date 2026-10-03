import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.modules.leads.models import ActivityKind, LeadSource, LeadStage
from app.modules.members.schemas import MembershipIn, StaffRef, normalize_phone


def _empty_to_none(v):
    return None if isinstance(v, str) and not v.strip() else v


class LeadIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: EmailStr | None = None
    source: LeadSource = LeadSource.WALK_IN
    interest: str | None = Field(None, max_length=300)
    interested_plan_id: uuid.UUID | None = None
    assigned_to: uuid.UUID | None = None
    next_follow_up_at: datetime | None = None
    notes: str | None = Field(None, max_length=2000)

    _empty = field_validator("email", "interest", "notes", mode="before")(_empty_to_none)
    _phone = field_validator("phone")(normalize_phone)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return " ".join(v.split())


class LeadUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    phone: str | None = None
    email: EmailStr | None = None
    source: LeadSource | None = None
    interest: str | None = Field(None, max_length=300)
    interested_plan_id: uuid.UUID | None = None
    assigned_to: uuid.UUID | None = None
    next_follow_up_at: datetime | None = None
    trial_at: datetime | None = None
    notes: str | None = Field(None, max_length=2000)

    _empty = field_validator("email", "interest", "notes", mode="before")(_empty_to_none)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return normalize_phone(v) if v is not None else None


class StageIn(BaseModel):
    stage: LeadStage
    lost_reason: str | None = Field(None, max_length=300)
    trial_at: datetime | None = None  # when booking a trial


class ActivityIn(BaseModel):
    kind: ActivityKind = ActivityKind.NOTE
    content: str = Field(min_length=1, max_length=2000)
    # Set (or clear with null) the next follow-up in the same step.
    next_follow_up_at: datetime | None = None
    clear_follow_up: bool = False

    @field_validator("kind")
    @classmethod
    def _manual_kinds(cls, v: ActivityKind) -> ActivityKind:
        if v not in (
            ActivityKind.NOTE,
            ActivityKind.CALL,
            ActivityKind.WHATSAPP,
            ActivityKind.VISIT,
        ):
            raise ValueError("Use note, call, whatsapp or visit")
        return v


class ConvertIn(BaseModel):
    membership: MembershipIn | None = None


class ActivityOut(BaseModel):
    id: uuid.UUID
    kind: ActivityKind
    content: str | None
    created_by: StaffRef | None
    created_at: datetime


class LeadOut(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    email: str | None
    source: LeadSource
    stage: LeadStage
    interest: str | None
    interested_plan_id: uuid.UUID | None
    assigned_to: StaffRef | None
    next_follow_up_at: datetime | None
    trial_at: datetime | None
    lost_reason: str | None
    notes: str | None
    converted_member_id: uuid.UUID | None
    converted_at: datetime | None
    stage_changed_at: datetime | None
    created_at: datetime
    last_activity_at: datetime | None


class LeadDetail(LeadOut):
    activities: list[ActivityOut]


class LeadStats(BaseModel):
    open: int
    by_stage: dict[LeadStage, int]
    follow_ups_due: int  # due today or overdue, open leads only
    new_last_30_days: int
    converted_last_30_days: int
    conversion_rate_90_days: float | None  # converted / closed (converted + lost)
    by_source_90_days: dict[LeadSource, dict[str, int]]  # {"leads": n, "converted": n}


class LeadFormSettings(BaseModel):
    enabled: bool
    url: str | None


class PublicLeadIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: EmailStr | None = None
    message: str | None = Field(None, max_length=1000)
    # Honeypot: real visitors never see or fill this field.
    website: str | None = Field(None, max_length=200)

    _empty = field_validator("email", "message", mode="before")(_empty_to_none)
    _phone = field_validator("phone")(normalize_phone)


class PublicFormInfo(BaseModel):
    gym_name: str
    brand_color: str
    logo_url: str | None
