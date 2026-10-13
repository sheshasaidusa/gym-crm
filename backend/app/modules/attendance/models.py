import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, Enum, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin, UTCDateTime


class AttendanceSource(enum.StrEnum):
    DESK = "desk"  # front desk typed it in
    DEVICE = "device"  # a scanner or turnstile reported it
    MEMBER_APP = "member_app"  # reserved: members can't check themselves in (fraud)
    IMPORT = "import"


class Device(IdMixin, TenantMixin, TimestampMixin, Base):
    """A fingerprint scanner, turnstile or door reader that reports punches over the API.
    It signs in with a key shown once at creation; only the hash is kept."""

    __tablename__ = "devices"

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("branches.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(80))
    api_key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class Attendance(IdMixin, TenantMixin, TimestampMixin, Base):
    """One visit. A member has at most one per day (their first), which keeps the numbers
    honest when a scanner reports every turn of the turnstile."""

    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("gym_id", "member_id", "local_date"),
        # A device that re-sends a punch it already reported is a no-op.
        UniqueConstraint("device_id", "device_ref"),
        Index("ix_attendance_gym_id_local_date", "gym_id", "local_date"),
    )

    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("branches.id", ondelete="SET NULL")
    )
    checked_in_at: Mapped[datetime] = mapped_column(UTCDateTime)
    local_date: Mapped[date] = mapped_column(Date)  # checked_in_at in the gym's time zone
    source: Mapped[AttendanceSource] = mapped_column(
        Enum(
            AttendanceSource,
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        )
    )
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("devices.id", ondelete="SET NULL")
    )
    device_ref: Mapped[str | None] = mapped_column(String(100))  # the device's own punch id
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
