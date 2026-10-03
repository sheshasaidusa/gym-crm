import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin, UTCDateTime
from app.modules.auth.models import User

DEFAULT_REMINDER_OFFSETS = [7, 3, 1, 0, -3]


class Role(enum.StrEnum):
    OWNER = "owner"
    MANAGER = "manager"
    TRAINER = "trainer"
    FRONT_DESK = "front_desk"


role_enum = Enum(Role, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e])


class Gym(IdMixin, TimestampMixin, Base):
    """The tenant. Every tenant-owned row references a gym."""

    __tablename__ = "gyms"

    name: Mapped[str] = mapped_column(String(120))
    logo_url: Mapped[str | None] = mapped_column(String(500))
    brand_color: Mapped[str] = mapped_column(String(9), default="#16a34a")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    phone: Mapped[str | None] = mapped_column(String(30))
    # Days relative to membership end date; negative = after expiry.
    reminder_offsets: Mapped[list[int]] = mapped_column(
        JSON, default=lambda: list(DEFAULT_REMINDER_OFFSETS)
    )
    reminders_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Local hour (gym time zone) after which the day's reminders go out.
    reminder_hour: Mapped[int] = mapped_column(Integer, default=9, server_default="9")
    # {"before"|"on_day"|"after": {"subject": ..., "body": ...}}; missing kinds use defaults.
    reminder_templates: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    checkup_interval_days: Mapped[int] = mapped_column(Integer, default=7, server_default="7")
    # Public website enquiry form (/join/{token}). Null = form turned off.
    lead_form_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    # Last receipt number issued (RCPT-0001, RCPT-0002, ...). Incremented atomically.
    receipt_counter: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Branch(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "branches"

    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(30))


class StaffMembership(IdMixin, TenantMixin, TimestampMixin, Base):
    """Links a user to a gym with a role (and optionally a home branch)."""

    __tablename__ = "staff_memberships"
    __table_args__ = (UniqueConstraint("user_id", "gym_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[Role] = mapped_column(role_enum)
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("branches.id", ondelete="SET NULL")
    )

    user: Mapped[User] = relationship(lazy="joined")


class Invite(IdMixin, TenantMixin, TimestampMixin, Base):
    """A shareable link that lets someone join a gym as staff."""

    __tablename__ = "invites"

    email: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(role_enum)
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("branches.id", ondelete="SET NULL")
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    accepted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
