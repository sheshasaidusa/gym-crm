import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin, UTCDateTime


def _enum(e: type[enum.StrEnum]) -> Enum:
    return Enum(e, native_enum=False, length=20, values_callable=lambda x: [m.value for m in x])


class PaymentMethod(enum.StrEnum):
    CASH = "cash"
    UPI = "upi"
    CARD = "card"
    BANK_TRANSFER = "bank_transfer"
    CHEQUE = "cheque"
    OTHER = "other"


class ExpenseCategory(enum.StrEnum):
    RENT = "rent"
    SALARIES = "salaries"
    UTILITIES = "utilities"
    EQUIPMENT = "equipment"
    MAINTENANCE = "maintenance"
    MARKETING = "marketing"
    SUPPLIES = "supplies"
    SOFTWARE = "software"
    TAXES = "taxes"
    OTHER = "other"


class Payment(IdMixin, TenantMixin, TimestampMixin, Base):
    """Money received from a member, usually against a membership. Payments are never
    deleted - a mistake is voided (with a reason) so receipts and totals stay auditable."""

    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("gym_id", "receipt_no"),
        Index("ix_payments_gym_id_paid_on", "gym_id", "paid_on"),
    )

    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    membership_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="SET NULL"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    method: Mapped[PaymentMethod] = mapped_column(_enum(PaymentMethod))
    paid_on: Mapped[date] = mapped_column(Date)
    reference: Mapped[str | None] = mapped_column(String(100))  # UPI/card transaction id
    note: Mapped[str | None] = mapped_column(String(500))
    receipt_no: Mapped[str] = mapped_column(String(30))
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    voided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    void_reason: Mapped[str | None] = mapped_column(String(300))
    voided_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )


class Expense(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (Index("ix_expenses_gym_id_spent_on", "gym_id", "spent_on"),)

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("branches.id", ondelete="SET NULL")
    )
    category: Mapped[ExpenseCategory] = mapped_column(_enum(ExpenseCategory))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    spent_on: Mapped[date] = mapped_column(Date)
    vendor: Mapped[str | None] = mapped_column(String(120))
    method: Mapped[PaymentMethod | None] = mapped_column(_enum(PaymentMethod))
    note: Mapped[str | None] = mapped_column(Text)
    attachment_key: Mapped[str | None] = mapped_column(String(300))  # bill photo / PDF
    attachment_type: Mapped[str | None] = mapped_column(String(50))
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
