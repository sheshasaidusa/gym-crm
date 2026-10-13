import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


class WorkoutSet(BaseModel):
    reps: int = Field(ge=0, le=1000)
    weight_kg: float | None = Field(None, ge=0, le=1000)  # none for bodyweight


class WorkoutEntry(BaseModel):
    exercise: str = Field(min_length=1, max_length=120)
    from_plan: bool = False
    sets: list[WorkoutSet] = Field(min_length=1, max_length=20)

    @field_validator("exercise")
    @classmethod
    def _tidy(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Name the exercise")
        return v


class WorkoutIn(BaseModel):
    day_label: str | None = Field(None, max_length=120)
    performed_on: date | None = None  # default: today in the gym's time zone
    duration_min: int | None = Field(None, ge=1, le=600)
    notes: str | None = Field(None, max_length=500)
    entries: list[WorkoutEntry] = Field(min_length=1, max_length=30)

    @field_validator("day_label", "notes")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class WorkoutOut(BaseModel):
    id: uuid.UUID
    day_label: str | None
    performed_on: date
    duration_min: int | None
    notes: str | None
    entries: list[WorkoutEntry]
    volume_kg: float  # sum of reps x weight over the weighted sets
    editable: bool  # members can fix a session for a week after it
    created_at: datetime


class WeekVolume(BaseModel):
    week_start: date  # a Monday
    sessions: int
    volume_kg: float


class PersonalRecord(BaseModel):
    exercise: str
    weight_kg: float | None  # heaviest weighted set; none if only ever done at bodyweight
    reps: int  # reps in that set (or the most reps, for bodyweight work)
    performed_on: date


class WorkoutProgress(BaseModel):
    sessions_total: int
    sessions_30d: int
    streak_weeks: int
    weeks: list[WeekVolume]  # last 12 weeks, oldest first
    records: list[PersonalRecord]  # best first by recency, max 12


class WorkoutHistory(BaseModel):
    sessions: list[WorkoutOut]
    progress: WorkoutProgress


class TemplateEntry(BaseModel):
    exercise: str
    from_plan: bool = True
    sets: list[WorkoutSet]
    target: str | None = None  # "3 x 8-10, rest 90s"
    notes: str | None = None


class WorkoutTemplate(BaseModel):
    plan_id: uuid.UUID | None
    days: list[str]  # the plan's day labels, so the member can pick another day
    day_label: str | None
    entries: list[TemplateEntry]
