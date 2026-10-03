import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select

from app.core.db import utcnow
from app.core.deps import DbSession, ManagerContext, TenantContext, require_roles
from app.core.schemas import round_money
from app.core.storage import IMAGE_TYPES, get_storage, sniff_image_type
from app.modules.audit import service as audit
from app.modules.auth.models import User
from app.modules.finance import service
from app.modules.finance.models import Expense, ExpenseCategory, Payment, PaymentMethod
from app.modules.finance.schemas import (
    DueList,
    DueOut,
    ExpenseIn,
    ExpenseList,
    ExpenseOut,
    ExpenseUpdate,
    FinanceSummary,
    MonthTotals,
    PaymentIn,
    PaymentList,
    PaymentOut,
    ReceiptGym,
    ReceiptMembership,
    ReceiptOut,
    VoidIn,
)
from app.modules.gyms.models import Branch, Gym, Role
from app.modules.gyms.repository import BranchRepository
from app.modules.members.models import Member, Membership
from app.modules.members.schemas import StaffRef
from app.modules.members.service import gym_today

router = APIRouter(tags=["finance"])

# Front desk takes payments; trainers don't handle money.
DeskContext = Annotated[
    TenantContext, Depends(require_roles(Role.OWNER, Role.MANAGER, Role.FRONT_DESK))
]

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
ZERO = Decimal("0.00")


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _shift_month(d: date, months: int) -> date:
    total = d.year * 12 + (d.month - 1) + months
    return date(total // 12, total % 12 + 1, 1)


# --- Payments ----------------------------------------------------------------


@router.post(
    "/members/{member_id}/payments", response_model=PaymentOut, status_code=status.HTTP_201_CREATED
)
async def record_payment(member_id: uuid.UUID, body: PaymentIn, ctx: DeskContext, db: DbSession):
    member = await db.scalar(
        select(Member).where(Member.gym_id == ctx.gym_id, Member.id == member_id)
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    payment = await service.record_payment(
        db, ctx.gym_id, member, body, ctx.user.id, await gym_today(db, ctx.gym_id)
    )
    audit.record(
        db,
        ctx,
        "payment.recorded",
        f"Recorded {audit.amount(payment.amount)} {payment.method.value.replace('_', ' ')} "
        f"payment from {member.name} ({payment.receipt_no})",
        payment.id,
        {"member_id": member.id, "amount": payment.amount},
    )
    await db.commit()
    (out,) = await service.payments_out(db, [payment])
    return out


@router.get("/payments", response_model=PaymentList)
async def list_payments(
    ctx: DeskContext,
    db: DbSession,
    member_id: uuid.UUID | None = None,
    method: PaymentMethod | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    include_voided: bool = True,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    stmt = select(Payment).where(Payment.gym_id == ctx.gym_id)
    if member_id:
        stmt = stmt.where(Payment.member_id == member_id)
    if method:
        stmt = stmt.where(Payment.method == method)
    if date_from:
        stmt = stmt.where(Payment.paid_on >= date_from)
    if date_to:
        stmt = stmt.where(Payment.paid_on <= date_to)
    if not include_voided:
        stmt = stmt.where(Payment.voided_at.is_(None))
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        stmt = stmt.join(Member, Member.id == Payment.member_id).where(
            func.lower(Member.name).like(term) | func.lower(Payment.receipt_no).like(term)
        )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    sub = stmt.subquery()
    amount_total = await db.scalar(
        select(func.coalesce(func.sum(sub.c.amount), 0)).where(sub.c.voided_at.is_(None))
    )
    rows = (
        await db.scalars(
            stmt.order_by(Payment.paid_on.desc(), Payment.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return PaymentList(
        items=await service.payments_out(db, list(rows)),
        total=total,
        page=page,
        page_size=page_size,
        amount_total=round_money(Decimal(amount_total or 0)),
    )


async def _payment(db: DbSession, gym_id: uuid.UUID, payment_id: uuid.UUID) -> Payment:
    p = await db.scalar(select(Payment).where(Payment.gym_id == gym_id, Payment.id == payment_id))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    return p


@router.get("/payments/{payment_id}/receipt", response_model=ReceiptOut)
async def receipt(payment_id: uuid.UUID, ctx: DeskContext, db: DbSession):
    p = await _payment(db, ctx.gym_id, payment_id)
    (out,) = await service.payments_out(db, [p])
    gym = await db.get_one(Gym, ctx.gym_id)
    member = await db.get_one(Member, p.member_id)
    address = None
    if member.branch_id:
        address = await db.scalar(select(Branch.address).where(Branch.id == member.branch_id))
    membership = None
    if p.membership_id:
        ms = await db.get(Membership, p.membership_id)
        if ms:
            paid = (await service.paid_by_membership(db, [ms.id])).get(ms.id, ZERO)
            membership = ReceiptMembership(
                plan_name=ms.plan_name,
                start_date=ms.start_date,
                end_date=ms.end_date,
                total=ms.total,
                paid=paid,
                balance=round_money(ms.total - paid),
            )
    return ReceiptOut(
        payment=out,
        gym=ReceiptGym(
            name=gym.name,
            phone=gym.phone,
            address=address,
            logo_url=gym.logo_url,
            brand_color=gym.brand_color,
            currency=gym.currency,
        ),
        member_phone=member.phone,
        membership=membership,
    )


@router.post("/payments/{payment_id}/void", response_model=PaymentOut)
async def void_payment(payment_id: uuid.UUID, body: VoidIn, ctx: ManagerContext, db: DbSession):
    p = await _payment(db, ctx.gym_id, payment_id)
    if p.voided_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This payment is already voided")
    p.voided_at = utcnow()
    p.void_reason = body.reason.strip()
    p.voided_by = ctx.user.id
    name = await db.scalar(select(Member.name).where(Member.id == p.member_id))
    audit.record(
        db,
        ctx,
        "payment.voided",
        f"Voided {p.receipt_no} ({audit.amount(p.amount)} from {name}): {p.void_reason}",
        p.id,
        {"member_id": p.member_id, "amount": p.amount},
    )
    await db.commit()
    (out,) = await service.payments_out(db, [p])
    return out


# --- Dues --------------------------------------------------------------------


@router.get("/finance/dues", response_model=DueList)
async def dues(ctx: DeskContext, db: DbSession, member_id: uuid.UUID | None = None):
    """Memberships (not cancelled) with money still owed. Oldest first."""
    paid = service.paid_subquery()
    balance = Membership.total - func.coalesce(paid.c.paid, 0)
    stmt = (
        select(Membership, Member.name, Member.phone, func.coalesce(paid.c.paid, 0))
        .join(Member, Member.id == Membership.member_id)
        .outerjoin(paid, paid.c.membership_id == Membership.id)
        .where(
            Membership.gym_id == ctx.gym_id,
            Membership.cancelled_at.is_(None),
            balance > Decimal("0.005"),
        )
        .order_by(Membership.start_date)
    )
    if member_id:
        stmt = stmt.where(Membership.member_id == member_id)
    items = []
    outstanding = ZERO
    for ms, name, phone, paid_amount in (await db.execute(stmt)).all():
        paid_amount = round_money(Decimal(paid_amount))
        bal = round_money(ms.total - paid_amount)
        outstanding += bal
        items.append(
            DueOut(
                membership_id=ms.id,
                member_id=ms.member_id,
                member_name=name,
                phone=phone,
                plan_name=ms.plan_name,
                start_date=ms.start_date,
                end_date=ms.end_date,
                total=ms.total,
                paid=paid_amount,
                balance=bal,
            )
        )
    return DueList(items=items, outstanding=outstanding)


# --- Expenses ----------------------------------------------------------------


def _expense_url(e: Expense) -> str | None:
    return f"/api/expenses/{e.id}/attachment" if e.attachment_key else None


async def _expenses_out(db: DbSession, expenses: list[Expense]) -> list[ExpenseOut]:
    ids = {e.recorded_by for e in expenses if e.recorded_by}
    users = (
        dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all())
        if ids
        else {}
    )
    return [
        ExpenseOut(
            id=e.id,
            category=e.category,
            amount=e.amount,
            spent_on=e.spent_on,
            vendor=e.vendor,
            method=e.method,
            note=e.note,
            branch_id=e.branch_id,
            attachment_url=_expense_url(e),
            recorded_by=StaffRef(id=e.recorded_by, name=users[e.recorded_by])
            if e.recorded_by in users
            else None,
            created_at=e.created_at,
        )
        for e in expenses
    ]


async def _expense(db: DbSession, gym_id: uuid.UUID, expense_id: uuid.UUID) -> Expense:
    e = await db.scalar(select(Expense).where(Expense.gym_id == gym_id, Expense.id == expense_id))
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")
    return e


@router.get("/expenses", response_model=ExpenseList)
async def list_expenses(
    ctx: ManagerContext,
    db: DbSession,
    category: ExpenseCategory | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    stmt = select(Expense).where(Expense.gym_id == ctx.gym_id)
    if category:
        stmt = stmt.where(Expense.category == category)
    if date_from:
        stmt = stmt.where(Expense.spent_on >= date_from)
    if date_to:
        stmt = stmt.where(Expense.spent_on <= date_to)
    sub = stmt.subquery()
    total = await db.scalar(select(func.count()).select_from(sub)) or 0
    by_cat = dict(
        (
            await db.execute(
                select(sub.c.category, func.sum(sub.c.amount)).group_by(sub.c.category)
            )
        ).all()
    )
    rows = (
        await db.scalars(
            stmt.order_by(Expense.spent_on.desc(), Expense.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return ExpenseList(
        items=await _expenses_out(db, list(rows)),
        total=total,
        page=page,
        page_size=page_size,
        amount_total=round_money(sum((Decimal(v) for v in by_cat.values()), ZERO)),
        by_category={k: round_money(Decimal(v)) for k, v in by_cat.items()},
    )


def _expense_label(e: Expense) -> str:
    vendor = f" to {e.vendor}" if e.vendor else ""
    return (
        f"{e.category.value.replace('_', ' ')} expense of {audit.amount(e.amount)}{vendor} "
        f"on {e.spent_on:%d %b %Y}"
    )


@router.post("/expenses", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(body: ExpenseIn, ctx: ManagerContext, db: DbSession):
    today = await gym_today(db, ctx.gym_id)
    if body.spent_on and body.spent_on > today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Expense date can't be in the future"
        )
    if body.branch_id:
        await BranchRepository(db, ctx.gym_id).get_or_404(body.branch_id)
    e = Expense(
        **body.model_dump(exclude={"spent_on"}),
        spent_on=body.spent_on or today,
        gym_id=ctx.gym_id,
        recorded_by=ctx.user.id,
    )
    db.add(e)
    await db.flush()
    audit.record(
        db, ctx, "expense.created", f"Added {_expense_label(e)}", e.id, {"amount": e.amount}
    )
    await db.commit()
    (out,) = await _expenses_out(db, [e])
    return out


@router.patch("/expenses/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    expense_id: uuid.UUID, body: ExpenseUpdate, ctx: ManagerContext, db: DbSession
):
    e = await _expense(db, ctx.gym_id, expense_id)
    values = body.model_dump(exclude_unset=True)
    for required in ("category", "amount", "spent_on"):
        if values.get(required, ...) is None:
            values.pop(required)
    if values.get("spent_on") and values["spent_on"] > await gym_today(db, ctx.gym_id):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Expense date can't be in the future"
        )
    if values.get("branch_id"):
        await BranchRepository(db, ctx.gym_id).get_or_404(values["branch_id"])
    changed = audit.changes({k: getattr(e, k) for k in values}, values)
    for k, v in values.items():
        setattr(e, k, v)
    if changed:
        audit.record(
            db, ctx, "expense.updated", f"Edited {_expense_label(e)}", e.id, {"changes": changed}
        )
    await db.commit()
    (out,) = await _expenses_out(db, [e])
    return out


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(expense_id: uuid.UUID, ctx: ManagerContext, db: DbSession) -> None:
    e = await _expense(db, ctx.gym_id, expense_id)
    key = e.attachment_key
    await db.delete(e)
    audit.record(
        db, ctx, "expense.deleted", f"Deleted {_expense_label(e)}", details={"amount": e.amount}
    )
    await db.commit()
    if key:
        await get_storage().delete(key)


@router.post("/expenses/{expense_id}/attachment", response_model=ExpenseOut)
async def upload_attachment(
    expense_id: uuid.UUID, file: UploadFile, ctx: ManagerContext, db: DbSession
):
    e = await _expense(db, ctx.gym_id, expense_id)
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Files must be 10 MB or smaller")
    content_type = "application/pdf" if data.startswith(b"%PDF-") else sniff_image_type(data)
    if content_type is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a PDF, JPEG, PNG or WebP file"
        )
    ext = "pdf" if content_type == "application/pdf" else IMAGE_TYPES[content_type]
    key = f"gyms/{ctx.gym_id}/expenses/{e.id}/{uuid.uuid4()}.{ext}"
    await get_storage().save(key, data, content_type)
    old = e.attachment_key
    e.attachment_key, e.attachment_type = key, content_type
    await db.commit()
    if old:
        await get_storage().delete(old)
    (out,) = await _expenses_out(db, [e])
    return out


@router.get("/expenses/{expense_id}/attachment", response_class=Response)
async def get_attachment(expense_id: uuid.UUID, ctx: ManagerContext, db: DbSession):
    e = await _expense(db, ctx.gym_id, expense_id)
    if not e.attachment_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No attachment")
    storage = get_storage()
    if url := storage.signed_url(e.attachment_key):
        return RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    data = await storage.read(e.attachment_key)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No attachment")
    return Response(
        data,
        media_type=e.attachment_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


# --- Summary -----------------------------------------------------------------


@router.get("/finance/summary", response_model=FinanceSummary)
async def summary(
    ctx: ManagerContext, db: DbSession, months: Annotated[int, Query(ge=1, le=24)] = 6
):
    """Revenue (non-voided payments) vs expenses per month, oldest first."""
    gym = await db.get_one(Gym, ctx.gym_id)
    today = await gym_today(db, ctx.gym_id)
    first = _shift_month(today, -(months - 1))
    keys = [_month_key(_shift_month(first, i)) for i in range(months)]
    # Always load at least last month too, for the month-on-month comparison.
    load_from = min(first, _shift_month(today, -1))

    revenue: dict[str, Decimal] = defaultdict(lambda: ZERO)
    by_method: dict[PaymentMethod, Decimal] = defaultdict(lambda: ZERO)
    this_key = _month_key(today)
    rows = await db.execute(
        select(Payment.paid_on, Payment.amount, Payment.method).where(
            Payment.gym_id == ctx.gym_id, Payment.voided_at.is_(None), Payment.paid_on >= load_from
        )
    )
    for paid_on, amount, method in rows.all():
        revenue[_month_key(paid_on)] += amount
        if _month_key(paid_on) == this_key:
            by_method[method] += amount

    spent: dict[str, Decimal] = defaultdict(lambda: ZERO)
    by_cat: dict[ExpenseCategory, Decimal] = defaultdict(lambda: ZERO)
    rows = await db.execute(
        select(Expense.spent_on, Expense.amount, Expense.category).where(
            Expense.gym_id == ctx.gym_id, Expense.spent_on >= load_from
        )
    )
    for spent_on, amount, category in rows.all():
        spent[_month_key(spent_on)] += amount
        if _month_key(spent_on) == this_key:
            by_cat[category] += amount

    def totals(key: str) -> MonthTotals:
        r, e = round_money(revenue[key]), round_money(spent[key])
        return MonthTotals(month=key, revenue=r, expenses=e, profit=r - e)

    month_list = [totals(k) for k in keys]
    last_key = _month_key(_shift_month(today, -1))
    dues_total = (await dues(ctx, db)).outstanding
    return FinanceSummary(
        currency=gym.currency,
        months=month_list,
        this_month=totals(this_key),
        last_month=totals(last_key),
        outstanding_dues=dues_total,
        revenue_by_method={k: round_money(v) for k, v in by_method.items()},
        expenses_by_category={k: round_money(v) for k, v in by_cat.items()},
    )
