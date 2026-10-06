import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from app.core.schemas import ORMModel
from app.modules.members.schemas import StaffRef

METRIC_FIELDS = (
    "weight_kg",
    "body_fat_pct",
    "muscle_mass_kg",
    "chest_cm",
    "waist_cm",
    "hips_cm",
    "arm_cm",
    "thigh_cm",
)


class CheckUpFields(BaseModel):
    weight_kg: float | None = Field(None, ge=20, le=350)
    height_cm: float | None = Field(None, ge=50, le=260)
    body_fat_pct: float | None = Field(None, ge=2, le=75)
    muscle_mass_kg: float | None = Field(None, ge=5, le=200)
    chest_cm: float | None = Field(None, ge=30, le=250)
    waist_cm: float | None = Field(None, ge=30, le=250)
    hips_cm: float | None = Field(None, ge=30, le=250)
    arm_cm: float | None = Field(None, ge=10, le=100)
    thigh_cm: float | None = Field(None, ge=20, le=150)
    notes: str | None = Field(None, max_length=2000)


class CheckUpIn(CheckUpFields):
    recorded_on: date | None = None  # default: today in the gym's time zone

    @model_validator(mode="after")
    def _has_a_metric(self):
        if all(getattr(self, f) is None for f in METRIC_FIELDS):
            raise ValueError("Enter at least one measurement")
        return self


class CheckUpUpdate(CheckUpFields):
    recorded_on: date | None = None


class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str
    created_at: datetime


class CheckUpOut(ORMModel):
    id: uuid.UUID
    member_id: uuid.UUID
    recorded_on: date
    weight_kg: float | None
    height_cm: float | None
    bmi: float | None
    body_fat_pct: float | None
    muscle_mass_kg: float | None
    chest_cm: float | None
    waist_cm: float | None
    hips_cm: float | None
    arm_cm: float | None
    thigh_cm: float | None
    notes: str | None
    recorded_by: StaffRef | None
    photos: list[PhotoOut]
    created_at: datetime


class DueCheckUp(BaseModel):
    member_id: uuid.UUID
    member_name: str
    phone: str
    trainer: StaffRef | None
    goals: list[str]
    last_checkup_on: date | None
    days_since: int | None  # None = never checked in
    last_weight_kg: float | None
