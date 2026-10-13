import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.modules.attendance.models import AttendanceSource


class CheckInIn(BaseModel):
    member_id: uuid.UUID


class CheckInOut(BaseModel):
    id: uuid.UUID
    member_id: uuid.UUID
    member_name: str
    checked_in_at: datetime
    already: bool  # they had already checked in today; nothing new was recorded
    warning: str | None  # e.g. "Membership expired on 3 Oct"; never blocks the visit


class VisitRow(BaseModel):
    id: uuid.UUID
    member_id: uuid.UUID
    member_name: str
    phone: str
    checked_in_at: datetime
    source: AttendanceSource


class DayList(BaseModel):
    date: date
    total: int
    items: list[VisitRow]  # latest first


class VisitHistory(BaseModel):
    dates: list[date]  # one per visit, newest first
    visits_30d: int
    last_visit: date | None
    streak_weeks: int  # consecutive weeks (ending this one or last) with at least one visit


# --- Devices ----------------------------------------------------------------------------


class DeviceIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    branch_id: uuid.UUID | None = None


class DeviceUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=80)
    branch_id: uuid.UUID | None = None
    is_active: bool | None = None


class DeviceOut(BaseModel):
    id: uuid.UUID
    name: str
    branch_id: uuid.UUID | None
    is_active: bool
    last_seen_at: datetime | None


class DeviceCreated(DeviceOut):
    api_key: str  # shown once; keep it safe


class Punch(BaseModel):
    user_id: str = Field(min_length=1, max_length=40)  # the member's number on the device
    at: datetime
    ref: str = Field(min_length=1, max_length=100)  # the device's own id for this punch

    @field_validator("at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("Send the time with its UTC offset, e.g. 2026-10-13T06:30:00+05:30")
        return v


class PunchesIn(BaseModel):
    punches: list[Punch] = Field(min_length=1, max_length=500)


class PunchesOut(BaseModel):
    created: int
    duplicates: int  # already reported, or the member had already visited that day
    unknown_user_ids: list[str]  # no member has this device number yet
