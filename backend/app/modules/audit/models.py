import uuid

from sqlalchemy import JSON, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin


class AuditLog(IdMixin, TenantMixin, TimestampMixin, Base):
    """Who did what, when. Written in the same transaction as the change it describes,
    so a rolled-back change leaves no entry. Never edited or deleted from the app."""

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_gym_created", "gym_id", "created_at"),)

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    # Kept as text so the log still reads right after a user or record is gone.
    actor_name: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(50), index=True)  # "payment.voided"
    target_type: Mapped[str] = mapped_column(String(30))  # "payment"
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    summary: Mapped[str] = mapped_column(String(300))
    details: Mapped[dict | None] = mapped_column(JSON)
