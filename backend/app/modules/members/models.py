import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.dates import DurationUnit
from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin, UTCDateTime
from app.core.security import generate_url_token
from app.modules.plans.models import duration_unit_enum


def _str_enum(e: type[enum.StrEnum], length: int = 20) -> Enum:
    return Enum(e, native_enum=False, length=length, values_callable=lambda x: [m.value for m in x])


class Gender(enum.StrEnum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class Goal(enum.StrEnum):
    WEIGHT_LOSS = "weight_loss"
    MUSCLE_GAIN = "muscle_gain"
    GENERAL_FITNESS = "general_fitness"
    STRENGTH = "strength"
    ENDURANCE = "endurance"
    FLEXIBILITY = "flexibility"
    SPORTS = "sports"
    REHAB = "rehab"


class DietPref(enum.StrEnum):
    VEG = "veg"
    NON_VEG = "non_veg"
    EGGETARIAN = "eggetarian"
    VEGAN = "vegan"


class ExperienceLevel(enum.StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class Member(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "members"
    __table_args__ = (UniqueConstraint("gym_id", "phone"),)

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("branches.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(120), index=True)
    phone: Mapped[str] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(255))
    dob: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[Gender | None] = mapped_column(_str_enum(Gender))
    address: Mapped[str | None] = mapped_column(String(500))
    emergency_contact_name: Mapped[str | None] = mapped_column(String(120))
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(30))

    height_cm: Mapped[float | None] = mapped_column(Float)
    goals: Mapped[list[str]] = mapped_column(JSON, default=list)  # Goal values, up to 3
    diet_pref: Mapped[DietPref | None] = mapped_column(_str_enum(DietPref))
    experience_level: Mapped[ExperienceLevel | None] = mapped_column(_str_enum(ExperienceLevel))
    medical_notes: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    trainer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    photo_url: Mapped[str | None] = mapped_column(String(500))
    joined_on: Mapped[date] = mapped_column(Date)

    # Unguessable token for the member's public preview page (/p/{token}).
    preview_token: Mapped[str] = mapped_column(String(64), unique=True, default=generate_url_token)
    preview_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="member",
        cascade="all, delete-orphan",
        order_by="Membership.start_date.desc()",
    )


class Membership(IdMixin, TenantMixin, TimestampMixin, Base):
    """One purchased period of a plan. Plan details are copied in so later plan edits
    don't rewrite history."""

    __tablename__ = "memberships"
    __table_args__ = (Index("ix_memberships_gym_id_end_date", "gym_id", "end_date"),)

    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("plans.id", ondelete="SET NULL"), index=True
    )
    plan_name: Mapped[str] = mapped_column(String(120))
    duration_value: Mapped[int] = mapped_column(Integer)
    duration_unit: Mapped[DurationUnit] = mapped_column(duration_unit_enum)

    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)

    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal(0))
    joining_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal(0))
    tax_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal(0))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    max_freeze_days: Mapped[int] = mapped_column(Integer, default=0)
    frozen_days: Mapped[int] = mapped_column(Integer, default=0)
    freeze_start: Mapped[date | None] = mapped_column(Date)
    freeze_end: Mapped[date | None] = mapped_column(Date)

    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )

    member: Mapped[Member] = relationship(back_populates="memberships")
