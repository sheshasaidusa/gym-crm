import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.core.schemas import Money, MoneyIn
from app.modules.finance.models import ExpenseCategory, PaymentMethod
from app.modules.members.schemas import StaffRef


def _empty_to_none(v):
    return None if isinstance(v, str) and not v.strip() else v


class PaymentIn(BaseModel):
    membership_id: uuid.UUID | None = None
    amount: MoneyIn
    method: PaymentMethod = PaymentMethod.CASH
    paid_on: date | None = None  # default: today
    reference: str | None = Field(None, max_length=100)
    note: str | None = Field(None, max_length=500)

    _empty = field_validator("reference", "note", mode="before")(_empty_to_none)

    @field_validator("amount")
    @classmethod
    def _positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Amount must be more than zero")
        return v


class VoidIn(BaseModel):
    reason: str = Field(min_length=2, max_length=300)


class PaymentOut(BaseModel):
    id: uuid.UUID
    receipt_no: str
    member_id: uuid.UUID
    member_name: str
    membership_id: uuid.UUID | None
    plan_name: str | None
    amount: Money
    method: PaymentMethod
    paid_on: date
    reference: str | None
    note: str | None
    recorded_by: StaffRef | None
    voided_at: datetime | None
    void_reason: str | None
    created_at: datetime


class PaymentList(BaseModel):
    items: list[PaymentOut]
    total: int
    page: int
    page_size: int
    amount_total: Money  # sum of non-voided payments matching the filters


class ReceiptGym(BaseModel):
    name: str
    phone: str | None
    address: str | None
    logo_url: str | None
    brand_color: str
    currency: str


class ReceiptMembership(BaseModel):
    plan_name: str
    start_date: date
    end_date: date
    total: Money
    paid: Money
    balance: Money


class ReceiptOut(BaseModel):
    payment: PaymentOut
    gym: ReceiptGym
    member_phone: str
    membership: ReceiptMembership | None


class DueOut(BaseModel):
    membership_id: uuid.UUID
    member_id: uuid.UUID
    member_name: str
    phone: str
    plan_name: str
    start_date: date
    end_date: date
    total: Money
    paid: Money
    balance: Money


class DueList(BaseModel):
    items: list[DueOut]
    outstanding: Money


class ExpenseIn(BaseModel):
    category: ExpenseCategory
    amount: MoneyIn
    spent_on: date | None = None
    vendor: str | None = Field(None, max_length=120)
    method: PaymentMethod | None = None
    note: str | None = Field(None, max_length=2000)
    branch_id: uuid.UUID | None = None

    _empty = field_validator("vendor", "note", mode="before")(_empty_to_none)

    @field_validator("amount")
    @classmethod
    def _positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Amount must be more than zero")
        return v


class ExpenseUpdate(BaseModel):
    category: ExpenseCategory | None = None
    amount: MoneyIn | None = None
    spent_on: date | None = None
    vendor: str | None = Field(None, max_length=120)
    method: PaymentMethod | None = None
    note: str | None = Field(None, max_length=2000)
    branch_id: uuid.UUID | None = None

    _empty = field_validator("vendor", "note", mode="before")(_empty_to_none)


class ExpenseOut(BaseModel):
    id: uuid.UUID
    category: ExpenseCategory
    amount: Money
    spent_on: date
    vendor: str | None
    method: PaymentMethod | None
    note: str | None
    branch_id: uuid.UUID | None
    attachment_url: str | None
    recorded_by: StaffRef | None
    created_at: datetime


class ExpenseList(BaseModel):
    items: list[ExpenseOut]
    total: int
    page: int
    page_size: int
    amount_total: Money
    by_category: dict[ExpenseCategory, Money]


class MonthTotals(BaseModel):
    month: str  # "2026-10"
    revenue: Money
    expenses: Money
    profit: Money


class FinanceSummary(BaseModel):
    currency: str
    months: list[MonthTotals]  # oldest first
    this_month: MonthTotals
    last_month: MonthTotals
    outstanding_dues: Money
    revenue_by_method: dict[PaymentMethod, Money]  # this month
    expenses_by_category: dict[ExpenseCategory, Money]  # this month
