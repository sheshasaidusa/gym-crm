import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin, UTCDateTime


def _enum(e: type[enum.StrEnum]) -> Enum:
    return Enum(e, native_enum=False, length=20, values_callable=lambda x: [m.value for m in x])


class LeadSource(enum.StrEnum):
    WALK_IN = "walk_in"
    PHONE_CALL = "phone_call"
    INSTAGRAM = "instagram"
    FACEBOOK = "facebook"
    GOOGLE = "google"
    REFERRAL = "referral"
    WEBSITE = "website"
    OTHER = "other"


class LeadStage(enum.StrEnum):
    NEW = "new"
    CONTACTED = "contacted"
    TRIAL_BOOKED = "trial_booked"
    TRIAL_DONE = "trial_done"
    CONVERTED = "converted"
    LOST = "lost"


OPEN_STAGES = (LeadStage.NEW, LeadStage.CONTACTED, LeadStage.TRIAL_BOOKED, LeadStage.TRIAL_DONE)


class ActivityKind(enum.StrEnum):
    CREATED = "created"
    NOTE = "note"
    CALL = "call"
    WHATSAPP = "whatsapp"
    VISIT = "visit"
    STAGE = "stage"  # stage changed (content has the details)
    CONVERTED = "converted"


class Lead(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "leads"
    __table_args__ = (
        Index("ix_leads_gym_id_stage", "gym_id", "stage"),
        Index("ix_leads_gym_id_phone", "gym_id", "phone"),
    )

    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(255))
    source: Mapped[LeadSource] = mapped_column(_enum(LeadSource))
    stage: Mapped[LeadStage] = mapped_column(_enum(LeadStage), default=LeadStage.NEW)
    interest: Mapped[str | None] = mapped_column(String(300))  # "weight loss, PT, mornings"
    interested_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("plans.id", ondelete="SET NULL")
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    next_follow_up_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)
    trial_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    lost_reason: Mapped[str | None] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text)

    converted_member_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("members.id", ondelete="SET NULL")
    )
    converted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    stage_changed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    activities: Mapped[list["LeadActivity"]] = relationship(
        back_populates="lead",
        cascade="all, delete-orphan",
        order_by="LeadActivity.created_at.desc()",
    )


class LeadActivity(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "lead_activities"

    lead_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("leads.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[ActivityKind] = mapped_column(_enum(ActivityKind))
    content: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )

    lead: Mapped[Lead] = relationship(back_populates="activities")
