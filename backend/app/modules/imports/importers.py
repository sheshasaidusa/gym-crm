"""Per-entity import logic.

Each importer has two steps so the dry run and the real import share exactly the same
validation: `prepare` turns raw cells into clean values (raising RowError on problems) and
finds any existing record it duplicates; `apply` writes. The dry run only prepares.
"""

import re
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dates import DurationUnit, membership_end
from app.core.schemas import round_money
from app.modules.checkups.models import CheckUp
from app.modules.finance.models import Payment, PaymentMethod
from app.modules.gyms.models import Gym
from app.modules.imports.models import DateOrder, DuplicateMode, ImportEntity
from app.modules.imports.parsing import (
    ParseError,
    parse_choice,
    parse_date,
    parse_decimal,
    parse_duration,
    parse_float,
    text,
)
from app.modules.leads.models import (
    OPEN_STAGES,
    ActivityKind,
    Lead,
    LeadActivity,
    LeadSource,
    LeadStage,
)
from app.modules.members.models import DietPref, ExperienceLevel, Gender, Goal, Member, Membership
from app.modules.members.schemas import normalize_phone
from app.modules.members.service import compute_total
from app.modules.plans.models import Plan


class RowError(Exception):
    def __init__(self, messages: list[str]):
        super().__init__("; ".join(messages))
        self.messages = messages


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    required: bool = False
    aliases: tuple[str, ...] = ()
    hint: str = ""


# --- Field definitions (what the mapping screen shows) --------------------------

PHONE = Field(
    "phone",
    "Phone",
    True,
    ("mobile", "mobile no", "contact", "contact no", "phone number", "whatsapp", "cell"),
)

FIELDS: dict[ImportEntity, list[Field]] = {
    ImportEntity.MEMBERS: [
        Field(
            "name",
            "Name",
            True,
            ("full name", "member name", "member", "client name", "customer name"),
        ),
        PHONE,
        Field("email", "Email", aliases=("email id", "e-mail", "mail")),
        Field("gender", "Gender", aliases=("sex",), hint="M / F / Male / Female"),
        Field("dob", "Date of birth", aliases=("birthday", "birth date", "date of birth", "d.o.b")),
        Field("address", "Address", aliases=("location", "area")),
        Field(
            "joined_on",
            "Joined on",
            aliases=("joining date", "join date", "date of joining", "doj", "admission date"),
        ),
        Field(
            "plan",
            "Plan",
            aliases=("package", "membership", "plan name", "membership type", "package name"),
            hint="Must match a plan name",
        ),
        Field(
            "membership_start",
            "Membership start",
            aliases=("start date", "from", "valid from", "renewal date"),
        ),
        Field(
            "membership_end",
            "Membership end",
            aliases=(
                "end date",
                "expiry",
                "expiry date",
                "valid till",
                "valid until",
                "due date",
                "to",
            ),
        ),
        Field(
            "amount_paid",
            "Amount paid",
            aliases=("paid", "amount", "fees paid", "fee paid", "payment"),
            hint="Recorded as a payment",
        ),
        Field("payment_method", "Payment method", aliases=("mode", "payment mode", "paid by")),
        Field("goal", "Goal", aliases=("fitness goal", "objective")),
        Field("diet_pref", "Diet", aliases=("diet preference", "food preference", "veg/non-veg")),
        Field("experience_level", "Experience", aliases=("level", "fitness level")),
        Field("height_cm", "Height (cm)", aliases=("height",)),
        Field(
            "medical_notes",
            "Medical notes",
            aliases=("medical", "medical history", "injuries", "health issues", "health"),
        ),
        Field(
            "emergency_contact_name", "Emergency contact", aliases=("emergency name", "guardian")
        ),
        Field(
            "emergency_contact_phone",
            "Emergency phone",
            aliases=("emergency number", "emergency contact number", "guardian phone"),
        ),
        Field("tags", "Tags", aliases=("batch", "labels"), hint="Comma separated"),
        Field("notes", "Notes", aliases=("remarks", "comments", "comment")),
    ],
    ImportEntity.LEADS: [
        Field("name", "Name", True, ("full name", "lead name", "enquiry name", "customer name")),
        PHONE,
        Field("email", "Email", aliases=("email id", "e-mail")),
        Field("source", "Source", aliases=("lead source", "how did you hear", "channel", "medium")),
        Field("stage", "Stage", aliases=("status", "lead status")),
        Field(
            "interest",
            "Interested in",
            aliases=("interest", "requirement", "enquiry", "looking for"),
        ),
        Field(
            "next_follow_up",
            "Next follow-up",
            aliases=("follow up", "follow-up date", "followup", "call back"),
        ),
        Field("notes", "Notes", aliases=("remarks", "comments")),
    ],
    ImportEntity.PAYMENTS: [
        PHONE,
        Field("amount", "Amount", True, ("amount paid", "paid", "fees", "total")),
        Field("paid_on", "Date", True, ("payment date", "paid on", "date paid", "receipt date")),
        Field("method", "Method", aliases=("mode", "payment mode", "payment method")),
        Field(
            "reference",
            "Reference",
            aliases=("transaction id", "txn id", "utr", "receipt no", "ref"),
        ),
        Field("note", "Note", aliases=("remarks", "description", "for")),
    ],
    ImportEntity.CHECKUPS: [
        PHONE,
        Field("date", "Date", True, ("checkup date", "measured on", "assessment date")),
        Field("weight_kg", "Weight (kg)", aliases=("weight", "wt")),
        Field("body_fat_pct", "Body fat %", aliases=("body fat", "fat %", "bf", "fat")),
        Field("muscle_mass_kg", "Muscle mass (kg)", aliases=("muscle", "muscle mass", "smm")),
        Field("height_cm", "Height (cm)", aliases=("height",)),
        Field("chest_cm", "Chest (cm)", aliases=("chest",)),
        Field("waist_cm", "Waist (cm)", aliases=("waist",)),
        Field("hips_cm", "Hips (cm)", aliases=("hips", "hip")),
        Field("arm_cm", "Arm (cm)", aliases=("arm", "arms", "bicep", "biceps")),
        Field("thigh_cm", "Thigh (cm)", aliases=("thigh", "thighs")),
        Field("notes", "Notes", aliases=("remarks", "comments")),
    ],
    ImportEntity.PLANS: [
        Field("name", "Plan name", True, ("plan", "package", "package name")),
        Field(
            "duration",
            "Duration",
            True,
            ("validity", "period", "length"),
            hint='"3 months", "Quarterly", "1 year"',
        ),
        Field("price", "Price", True, ("fee", "fees", "amount", "cost")),
        Field(
            "joining_fee",
            "Joining fee",
            aliases=("admission fee", "registration fee", "enrollment fee"),
        ),
        Field("tax_pct", "Tax %", aliases=("gst", "gst %", "tax")),
        Field("max_freeze_days", "Freeze days", aliases=("freeze", "pause days")),
        Field(
            "services",
            "Included services",
            aliases=("includes", "features", "facilities"),
            hint="Comma separated",
        ),
    ],
}

SAMPLE_ROWS: dict[ImportEntity, list[dict[str, str]]] = {
    ImportEntity.MEMBERS: [
        {
            "name": "Asha Rao",
            "phone": "9876543210",
            "email": "asha@example.com",
            "gender": "F",
            "joined_on": "05/01/2026",
            "plan": "Monthly",
            "membership_start": "01/10/2026",
            "membership_end": "31/10/2026",
            "amount_paid": "1800",
            "payment_method": "UPI",
            "goal": "Weight loss",
            "diet_pref": "Veg",
            "notes": "Morning batch",
        },
    ],
    ImportEntity.LEADS: [
        {
            "name": "Ravi Kumar",
            "phone": "9123456780",
            "source": "Instagram",
            "stage": "New",
            "interest": "Personal training",
            "next_follow_up": "03/10/2026",
        },
    ],
    ImportEntity.PAYMENTS: [
        {
            "phone": "9876543210",
            "amount": "1800",
            "paid_on": "01/10/2026",
            "method": "UPI",
            "reference": "UPI123456",
        },
    ],
    ImportEntity.CHECKUPS: [
        {
            "phone": "9876543210",
            "date": "01/10/2026",
            "weight_kg": "72.5",
            "body_fat_pct": "28",
            "waist_cm": "86",
        },
    ],
    ImportEntity.PLANS: [
        {
            "name": "Quarterly",
            "duration": "3 months",
            "price": "4500",
            "joining_fee": "500",
            "tax_pct": "18",
            "max_freeze_days": "15",
            "services": "Gym, Cardio",
        },
    ],
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9%]+", " ", s.lower()).strip()


def suggest_mapping(entity: ImportEntity, columns: list[str]) -> dict[str, str]:
    """field key -> column, matching on key, label and aliases (exact first, then contains)."""
    mapping: dict[str, str] = {}
    used: set[str] = set()
    norm_cols = {c: _norm(c) for c in columns}
    for exact in (True, False):
        for f in FIELDS[entity]:
            if f.key in mapping:
                continue
            names = {_norm(f.key.replace("_", " ")), _norm(f.label), *(_norm(a) for a in f.aliases)}
            for col, nc in norm_cols.items():
                if col in used:
                    continue
                if (
                    (nc in names)
                    if exact
                    else any(len(n) > 3 and (n in nc or nc in n) for n in names)
                ):
                    mapping[f.key] = col
                    used.add(col)
                    break
    return mapping


# --- Synonyms for choice fields ---------------------------------------------------

GENDERS = {
    "m": Gender.MALE,
    "male": Gender.MALE,
    "man": Gender.MALE,
    "f": Gender.FEMALE,
    "female": Gender.FEMALE,
    "woman": Gender.FEMALE,
    "o": Gender.OTHER,
    "other": Gender.OTHER,
    "others": Gender.OTHER,
}
GOALS = {
    "weight loss": Goal.WEIGHT_LOSS,
    "fat loss": Goal.WEIGHT_LOSS,
    "lose weight": Goal.WEIGHT_LOSS,
    "slimming": Goal.WEIGHT_LOSS,
    "muscle gain": Goal.MUSCLE_GAIN,
    "weight gain": Goal.MUSCLE_GAIN,
    "bulking": Goal.MUSCLE_GAIN,
    "muscle building": Goal.MUSCLE_GAIN,
    "general fitness": Goal.GENERAL_FITNESS,
    "fitness": Goal.GENERAL_FITNESS,
    "general": Goal.GENERAL_FITNESS,
    "stay fit": Goal.GENERAL_FITNESS,
    "strength": Goal.STRENGTH,
    "powerlifting": Goal.STRENGTH,
    "endurance": Goal.ENDURANCE,
    "stamina": Goal.ENDURANCE,
    "running": Goal.ENDURANCE,
    "flexibility": Goal.FLEXIBILITY,
    "yoga": Goal.FLEXIBILITY,
    "sports": Goal.SPORTS,
    "sports performance": Goal.SPORTS,
    "rehab": Goal.REHAB,
    "rehabilitation": Goal.REHAB,
    "recovery": Goal.REHAB,
    "physio": Goal.REHAB,
}
DIETS = {
    "veg": DietPref.VEG,
    "vegetarian": DietPref.VEG,
    "non veg": DietPref.NON_VEG,
    "nonveg": DietPref.NON_VEG,
    "non vegetarian": DietPref.NON_VEG,
    "egg": DietPref.EGGETARIAN,
    "eggetarian": DietPref.EGGETARIAN,
    "vegan": DietPref.VEGAN,
}
LEVELS = {
    "beginner": ExperienceLevel.BEGINNER,
    "new": ExperienceLevel.BEGINNER,
    "novice": ExperienceLevel.BEGINNER,
    "intermediate": ExperienceLevel.INTERMEDIATE,
    "medium": ExperienceLevel.INTERMEDIATE,
    "advanced": ExperienceLevel.ADVANCED,
    "expert": ExperienceLevel.ADVANCED,
    "pro": ExperienceLevel.ADVANCED,
}
METHODS = {
    "cash": PaymentMethod.CASH,
    "upi": PaymentMethod.UPI,
    "gpay": PaymentMethod.UPI,
    "google pay": PaymentMethod.UPI,
    "phonepe": PaymentMethod.UPI,
    "paytm": PaymentMethod.UPI,
    "card": PaymentMethod.CARD,
    "credit card": PaymentMethod.CARD,
    "debit card": PaymentMethod.CARD,
    "neft": PaymentMethod.BANK_TRANSFER,
    "imps": PaymentMethod.BANK_TRANSFER,
    "rtgs": PaymentMethod.BANK_TRANSFER,
    "bank": PaymentMethod.BANK_TRANSFER,
    "bank transfer": PaymentMethod.BANK_TRANSFER,
    "online": PaymentMethod.UPI,
    "cheque": PaymentMethod.CHEQUE,
    "check": PaymentMethod.CHEQUE,
    "other": PaymentMethod.OTHER,
}
SOURCES = {
    "walk in": LeadSource.WALK_IN,
    "walkin": LeadSource.WALK_IN,
    "visit": LeadSource.WALK_IN,
    "phone": LeadSource.PHONE_CALL,
    "call": LeadSource.PHONE_CALL,
    "phone call": LeadSource.PHONE_CALL,
    "instagram": LeadSource.INSTAGRAM,
    "insta": LeadSource.INSTAGRAM,
    "ig": LeadSource.INSTAGRAM,
    "facebook": LeadSource.FACEBOOK,
    "fb": LeadSource.FACEBOOK,
    "google": LeadSource.GOOGLE,
    "justdial": LeadSource.OTHER,
    "referral": LeadSource.REFERRAL,
    "reference": LeadSource.REFERRAL,
    "friend": LeadSource.REFERRAL,
    "website": LeadSource.WEBSITE,
    "web": LeadSource.WEBSITE,
    "other": LeadSource.OTHER,
}
STAGES = {
    "new": LeadStage.NEW,
    "open": LeadStage.NEW,
    "contacted": LeadStage.CONTACTED,
    "called": LeadStage.CONTACTED,
    "follow up": LeadStage.CONTACTED,
    "trial": LeadStage.TRIAL_BOOKED,
    "trial booked": LeadStage.TRIAL_BOOKED,
    "trial done": LeadStage.TRIAL_DONE,
    "visited": LeadStage.TRIAL_DONE,
    "lost": LeadStage.LOST,
    "not interested": LeadStage.LOST,
    "closed": LeadStage.LOST,
}


# --- Shared context ----------------------------------------------------------------


@dataclass
class Ctx:
    db: AsyncSession
    gym: Gym
    user_id: uuid.UUID | None
    today: date
    date_order: DateOrder
    mode: DuplicateMode
    dry_run: bool
    plans: dict[str, Plan] = field(default_factory=dict)  # lowercase name -> plan
    # Keys seen earlier in this file, so a repeated row counts as a duplicate in the dry run too.
    seen: set[str] = field(default_factory=set)

    async def load(self) -> None:
        plans = (await self.db.scalars(select(Plan).where(Plan.gym_id == self.gym.id))).all()
        self.plans = {p.name.strip().lower(): p for p in plans}

    async def member_by_phone(self, phone: str) -> Member | None:
        return await self.db.scalar(
            select(Member).where(Member.gym_id == self.gym.id, Member.phone == phone)
        )


@dataclass
class Prepared:
    values: dict[str, Any]
    # The record this row duplicates, if any. True means "an earlier row in this file"
    # (only seen in the dry run - during the import that row has already been written).
    existing: Any = None
    duplicate_key: str | None = None

    @property
    def is_duplicate(self) -> bool:
        return self.existing is not None


def _collect(raw: dict[str, object], parsers: dict[str, Any]) -> dict[str, Any]:
    """Runs each parser on its cell, collecting every problem instead of stopping at the first."""
    out, errors = {}, []
    for key, parse in parsers.items():
        try:
            out[key] = parse(raw.get(key))
        except ParseError as exc:
            errors.append(str(exc))
    if errors:
        raise RowError(errors)
    return out


def _require(values: dict[str, Any], *labels: tuple[str, str]) -> None:
    missing = [label for key, label in labels if values.get(key) in (None, "")]
    if missing:
        raise RowError([f"{', '.join(missing)} {'is' if len(missing) == 1 else 'are'} missing"])


def _phone(v: object) -> str | None:
    s = text(v)
    if s is None:
        return None
    try:
        return normalize_phone(s)
    except ValueError as exc:
        raise ParseError(f'"{s}" isn\'t a valid phone number') from exc


def _email(v: object) -> str | None:
    s = text(v)
    if s and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", s):
        raise ParseError(f'"{s}" isn\'t a valid email')
    return s.lower() if s else None


def _bounded(lo: float, hi: float, label: str):
    def parse(v: object) -> float | None:
        n = parse_float(v)
        if n is not None and not lo <= n <= hi:
            raise ParseError(f"{label} {n:g} looks wrong (expected {lo:g}–{hi:g})")
        return n

    return parse


def _money(v: object) -> Decimal | None:
    d = parse_decimal(v)
    if d is not None and d < 0:
        raise ParseError(f"{d} can't be negative")
    return round_money(d) if d is not None else None


def _tags(v: object) -> list[str]:
    s = text(v)
    return (
        list(dict.fromkeys(t.strip().lower()[:30] for t in re.split(r"[,;/|]", s) if t.strip()))[
            :15
        ]
        if s
        else []
    )


def _limit(n: int):
    return lambda v: (text(v) or None) and text(v)[:n]


# --- Members --------------------------------------------------------------------


async def prepare_member(ctx: Ctx, raw: dict[str, object]) -> Prepared:
    d = lambda v: parse_date(v, ctx.date_order)  # noqa: E731
    v = _collect(
        raw,
        {
            "name": _limit(120),
            "phone": _phone,
            "email": _email,
            "gender": lambda x: parse_choice(x, GENDERS, "gender"),
            "dob": d,
            "address": _limit(500),
            "joined_on": d,
            "plan": text,
            "membership_start": d,
            "membership_end": d,
            "amount_paid": _money,
            "payment_method": lambda x: parse_choice(x, METHODS, "payment method"),
            "goal": lambda x: parse_choice(x, GOALS, "goal"),
            "diet_pref": lambda x: parse_choice(x, DIETS, "diet"),
            "experience_level": lambda x: parse_choice(x, LEVELS, "experience level"),
            "height_cm": _bounded(50, 260, "Height"),
            "medical_notes": _limit(2000),
            "emergency_contact_name": _limit(120),
            "emergency_contact_phone": _phone,
            "tags": _tags,
            "notes": _limit(2000),
        },
    )
    _require(v, ("name", "Name"), ("phone", "Phone"))
    errors = []
    if v["dob"] and not date(1900, 1, 1) <= v["dob"] <= ctx.today:
        errors.append("Date of birth looks wrong")
    plan = None
    if v["plan"]:
        plan = ctx.plans.get(v["plan"].strip().lower())
        if plan is None:
            errors.append(f'Plan "{v["plan"]}" doesn\'t exist. Create it (or import plans) first')
    elif v["membership_start"] or v["membership_end"] or v["amount_paid"]:
        errors.append("Membership dates or amount given without a plan")
    if (
        v["membership_start"]
        and v["membership_end"]
        and v["membership_end"] < v["membership_start"]
    ):
        errors.append("Membership end is before its start")
    if plan and v["amount_paid"]:
        total = compute_total(plan.price, Decimal(0), Decimal(0), plan.tax_pct)
        if v["amount_paid"] > total:
            errors.append(f"Amount paid {v['amount_paid']} is more than the plan's total {total}")
    if errors:
        raise RowError(errors)
    v["plan_obj"] = plan

    key = f"phone:{v['phone']}"
    existing = await ctx.member_by_phone(v["phone"])
    if existing is None and key in ctx.seen:
        existing = True
    ctx.seen.add(key)
    return Prepared(v, existing, key)


PROFILE_FIELDS = (
    "name",
    "email",
    "gender",
    "dob",
    "address",
    "goal",
    "diet_pref",
    "experience_level",
    "height_cm",
    "medical_notes",
    "emergency_contact_name",
    "emergency_contact_phone",
    "notes",
)


async def apply_member(ctx: Ctx, p: Prepared) -> str:
    v = p.values
    if p.existing is not None:
        if ctx.mode == DuplicateMode.SKIP:
            return "skipped"
        member = p.existing
        for f in PROFILE_FIELDS:
            if v.get(f) not in (None, ""):
                setattr(member, f, v[f])
        if v["tags"]:
            member.tags = list(dict.fromkeys([*(member.tags or []), *v["tags"]]))
        return "updated"

    member = Member(
        gym_id=ctx.gym.id,
        phone=v["phone"],
        tags=v["tags"],
        joined_on=v["joined_on"] or v["membership_start"] or ctx.today,
        memberships=[],
        **{f: v[f] for f in PROFILE_FIELDS},
    )
    ctx.db.add(member)
    await ctx.db.flush()
    plan: Plan | None = v["plan_obj"]
    if plan:
        start = v["membership_start"] or v["joined_on"] or ctx.today
        end = v["membership_end"] or membership_end(
            start, plan.duration_value, DurationUnit(plan.duration_unit)
        )
        total = compute_total(plan.price, Decimal(0), Decimal(0), plan.tax_pct)
        membership = Membership(
            gym_id=ctx.gym.id,
            member_id=member.id,
            plan_id=plan.id,
            plan_name=plan.name,
            duration_value=plan.duration_value,
            duration_unit=plan.duration_unit,
            start_date=start,
            end_date=end,
            price=plan.price,
            discount=Decimal(0),
            joining_fee=Decimal(0),
            tax_pct=plan.tax_pct,
            total=total,
            max_freeze_days=plan.max_freeze_days,
            frozen_days=0,
            notes="Imported",
            created_by=ctx.user_id,
        )
        member.memberships.append(membership)
        await ctx.db.flush()
        if v["amount_paid"]:
            from app.modules.finance.service import next_receipt_no

            ctx.db.add(
                Payment(
                    gym_id=ctx.gym.id,
                    member_id=member.id,
                    membership_id=membership.id,
                    amount=v["amount_paid"],
                    method=v["payment_method"] or PaymentMethod.CASH,
                    paid_on=min(start, ctx.today),
                    note="Imported",
                    recorded_by=ctx.user_id,
                    receipt_no=await next_receipt_no(ctx.db, ctx.gym.id),
                )
            )
    return "created"


# --- Leads ----------------------------------------------------------------------


async def prepare_lead(ctx: Ctx, raw: dict[str, object]) -> Prepared:
    v = _collect(
        raw,
        {
            "name": _limit(120),
            "phone": _phone,
            "email": _email,
            "source": lambda x: parse_choice(x, SOURCES, "source"),
            "stage": lambda x: parse_choice(x, STAGES, "stage"),
            "interest": _limit(300),
            "next_follow_up": lambda x: parse_date(x, ctx.date_order),
            "notes": _limit(2000),
        },
    )
    _require(v, ("name", "Name"), ("phone", "Phone"))
    key = f"phone:{v['phone']}"
    if await ctx.member_by_phone(v["phone"]):
        raise RowError(["Already a member with this phone number"])
    existing = await ctx.db.scalar(
        select(Lead).where(
            Lead.gym_id == ctx.gym.id, Lead.phone == v["phone"], Lead.stage.in_(OPEN_STAGES)
        )
    )
    if existing is None and key in ctx.seen:
        existing = True
    ctx.seen.add(key)
    return Prepared(v, existing, key)


async def apply_lead(ctx: Ctx, p: Prepared) -> str:
    v = p.values
    from app.core.db import utcnow
    from app.modules.leads.service import end_of_day_utc

    # 10:00 local time on the follow-up date (end of the previous day + 10 hours).
    follow_up = (
        end_of_day_utc(ctx.gym, v["next_follow_up"] - timedelta(days=1)) + timedelta(hours=10)
        if v["next_follow_up"]
        else None
    )
    if p.existing is not None:
        if ctx.mode == DuplicateMode.SKIP:
            return "skipped"
        lead = p.existing
        for f in ("name", "email", "interest", "notes"):
            if v.get(f):
                setattr(lead, f, v[f])
        if v["source"]:
            lead.source = v["source"]
        if follow_up:
            lead.next_follow_up_at = follow_up
        return "updated"
    stage = v["stage"] or LeadStage.NEW
    lead = Lead(
        gym_id=ctx.gym.id,
        name=v["name"],
        phone=v["phone"],
        email=v["email"],
        source=v["source"] or LeadSource.OTHER,
        stage=stage,
        interest=v["interest"],
        notes=v["notes"],
        next_follow_up_at=follow_up if stage != LeadStage.LOST else None,
        lost_reason="Imported as lost" if stage == LeadStage.LOST else None,
        stage_changed_at=utcnow(),
        assigned_to=None,
    )
    ctx.db.add(lead)
    await ctx.db.flush()
    ctx.db.add(
        LeadActivity(
            gym_id=ctx.gym.id,
            lead_id=lead.id,
            kind=ActivityKind.CREATED,
            content="Imported from a spreadsheet",
            created_by=ctx.user_id,
        )
    )
    return "created"


# --- Payments -------------------------------------------------------------------


async def prepare_payment(ctx: Ctx, raw: dict[str, object]) -> Prepared:
    v = _collect(
        raw,
        {
            "phone": _phone,
            "amount": _money,
            "paid_on": lambda x: parse_date(x, ctx.date_order),
            "method": lambda x: parse_choice(x, METHODS, "payment method"),
            "reference": _limit(100),
            "note": _limit(500),
        },
    )
    _require(v, ("phone", "Phone"), ("amount", "Amount"), ("paid_on", "Date"))
    errors = []
    if v["amount"] is not None and v["amount"] <= 0:
        errors.append("Amount must be more than zero")
    if v["paid_on"] and v["paid_on"] > ctx.today:
        errors.append("Payment date is in the future")
    member = await ctx.member_by_phone(v["phone"])
    if member is None:
        errors.append("No member with this phone number. Import members first")
    if errors:
        raise RowError(errors)
    v["member"] = member
    key = f"pay:{member.id}:{v['paid_on']}:{v['amount']}:{v['reference'] or ''}"
    stmt = select(Payment.id).where(
        Payment.member_id == member.id,
        Payment.paid_on == v["paid_on"],
        Payment.amount == v["amount"],
        Payment.voided_at.is_(None),
    )
    if v["reference"]:
        stmt = stmt.where(Payment.reference == v["reference"])
    existing = await ctx.db.scalar(stmt.limit(1))
    if existing is None and key in ctx.seen:
        existing = True
    ctx.seen.add(key)
    return Prepared(v, existing, key)


async def apply_payment(ctx: Ctx, p: Prepared) -> str:
    if p.existing is not None:
        return "skipped"  # payments are never overwritten
    v = p.values
    from app.modules.finance.service import next_receipt_no, paid_by_membership

    member: Member = v["member"]
    # Attach to the membership that covers the payment date, if it still has room.
    candidates = (
        await ctx.db.scalars(
            select(Membership)
            .where(
                Membership.member_id == member.id,
                Membership.cancelled_at.is_(None),
                Membership.start_date <= v["paid_on"] + timedelta(days=7),
                Membership.end_date >= v["paid_on"],
            )
            .order_by(Membership.start_date)
        )
    ).all()
    paid = await paid_by_membership(ctx.db, [m.id for m in candidates])
    membership_id = next(
        (m.id for m in candidates if m.total - paid.get(m.id, Decimal(0)) >= v["amount"]), None
    )
    ctx.db.add(
        Payment(
            gym_id=ctx.gym.id,
            member_id=member.id,
            membership_id=membership_id,
            amount=v["amount"],
            method=v["method"] or PaymentMethod.CASH,
            paid_on=v["paid_on"],
            reference=v["reference"],
            note=v["note"] or "Imported",
            recorded_by=ctx.user_id,
            receipt_no=await next_receipt_no(ctx.db, ctx.gym.id),
        )
    )
    return "created"


# --- Check-ups ------------------------------------------------------------------

METRICS = (
    "weight_kg",
    "body_fat_pct",
    "muscle_mass_kg",
    "chest_cm",
    "waist_cm",
    "hips_cm",
    "arm_cm",
    "thigh_cm",
)


async def prepare_checkup(ctx: Ctx, raw: dict[str, object]) -> Prepared:
    v = _collect(
        raw,
        {
            "phone": _phone,
            "date": lambda x: parse_date(x, ctx.date_order),
            "weight_kg": _bounded(20, 350, "Weight"),
            "body_fat_pct": _bounded(2, 75, "Body fat"),
            "muscle_mass_kg": _bounded(5, 200, "Muscle mass"),
            "height_cm": _bounded(50, 260, "Height"),
            "chest_cm": _bounded(30, 250, "Chest"),
            "waist_cm": _bounded(30, 250, "Waist"),
            "hips_cm": _bounded(30, 250, "Hips"),
            "arm_cm": _bounded(10, 100, "Arm"),
            "thigh_cm": _bounded(20, 150, "Thigh"),
            "notes": _limit(2000),
        },
    )
    _require(v, ("phone", "Phone"), ("date", "Date"))
    errors = []
    if all(v[m] is None for m in METRICS):
        errors.append("No measurements in this row")
    if v["date"] and v["date"] > ctx.today:
        errors.append("Check-up date is in the future")
    member = await ctx.member_by_phone(v["phone"])
    if member is None:
        errors.append("No member with this phone number. Import members first")
    if errors:
        raise RowError(errors)
    v["member"] = member
    key = f"checkup:{member.id}:{v['date']}"
    existing = await ctx.db.scalar(
        select(CheckUp).where(CheckUp.member_id == member.id, CheckUp.recorded_on == v["date"])
    )
    if existing is None and key in ctx.seen:
        existing = True
    ctx.seen.add(key)
    return Prepared(v, existing, key)


async def apply_checkup(ctx: Ctx, p: Prepared) -> str:
    from app.modules.checkups.router import bmi

    v = p.values
    member: Member = v["member"]
    if p.existing is not None:
        if ctx.mode == DuplicateMode.SKIP:
            return "skipped"
        c = p.existing
        for f in (*METRICS, "notes"):
            if v[f] is not None:
                setattr(c, f, v[f])
        if v["height_cm"]:
            c.height_cm = v["height_cm"]
        c.bmi = bmi(c.weight_kg, c.height_cm)
        return "updated"
    height = v["height_cm"] or member.height_cm
    if v["height_cm"] and not member.height_cm:
        member.height_cm = v["height_cm"]
    ctx.db.add(
        CheckUp(
            gym_id=ctx.gym.id,
            member_id=member.id,
            recorded_on=v["date"],
            height_cm=height,
            bmi=bmi(v["weight_kg"], height),
            notes=v["notes"],
            recorded_by=ctx.user_id,
            **{m: v[m] for m in METRICS},
        )
    )
    return "created"


# --- Plans ----------------------------------------------------------------------


async def prepare_plan(ctx: Ctx, raw: dict[str, object]) -> Prepared:
    v = _collect(
        raw,
        {
            "name": _limit(120),
            "duration": parse_duration,
            "price": _money,
            "joining_fee": _money,
            "tax_pct": _bounded(0, 100, "Tax %"),
            "max_freeze_days": _bounded(0, 365, "Freeze days"),
            "services": lambda x: [
                s.strip()[:60] for s in re.split(r"[,;|]", text(x) or "") if s.strip()
            ][:20],
        },
    )
    _require(v, ("name", "Plan name"), ("duration", "Duration"), ("price", "Price"))
    if v["name"] and len(v["name"]) < 2:
        raise RowError(["Plan name is too short"])
    key = f"plan:{v['name'].strip().lower()}"
    existing = ctx.plans.get(v["name"].strip().lower())
    if existing is None and key in ctx.seen:
        existing = True
    ctx.seen.add(key)
    return Prepared(v, existing, key)


async def apply_plan(ctx: Ctx, p: Prepared) -> str:
    v = p.values
    fields = {
        "duration_value": v["duration"][0],
        "duration_unit": DurationUnit(v["duration"][1]),
        "price": v["price"],
        "joining_fee": v["joining_fee"] or Decimal(0),
        "tax_pct": Decimal(str(v["tax_pct"] or 0)),
        "max_freeze_days": int(v["max_freeze_days"] or 0),
        "services": v["services"],
    }
    if p.existing is not None:
        if ctx.mode == DuplicateMode.SKIP:
            return "skipped"
        for k, val in fields.items():
            setattr(p.existing, k, val)
        return "updated"
    plan = Plan(gym_id=ctx.gym.id, name=v["name"], is_active=True, **fields)
    ctx.db.add(plan)
    await ctx.db.flush()
    ctx.plans[v["name"].strip().lower()] = plan
    return "created"


IMPORTERS = {
    ImportEntity.MEMBERS: (prepare_member, apply_member),
    ImportEntity.LEADS: (prepare_lead, apply_lead),
    ImportEntity.PAYMENTS: (prepare_payment, apply_payment),
    ImportEntity.CHECKUPS: (prepare_checkup, apply_checkup),
    ImportEntity.PLANS: (prepare_plan, apply_plan),
}


def map_row(row: dict[str, object], mapping: dict[str, str]) -> dict[str, object]:
    return {key: row.get(col) for key, col in mapping.items() if col}


def display_values(entity: ImportEntity, p: Prepared) -> dict[str, str]:
    """A readable version of a prepared row for the preview table."""
    out = {}
    for f in FIELDS[entity]:
        val = p.values.get(f.key)
        if val in (None, "", []):
            continue
        if isinstance(val, list):
            val = ", ".join(map(str, val))
        elif isinstance(val, tuple):
            val = f"{val[0]} {val[1]}{'s' if val[0] != 1 else ''}"
        elif isinstance(val, date):
            val = val.strftime("%d %b %Y")
        elif hasattr(val, "value"):
            val = val.value.replace("_", " ")
        out[f.key] = str(val)
    return out
