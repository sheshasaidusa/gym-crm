"""Creates a demo gym for local development (idempotent).

    uv run python scripts/seed.py

Local-only test accounts (never use these anywhere real), all with DemoPass123!:
    owner      demo-owner@example.com
    manager    demo-manager@example.com    (Main branch only)
    front desk demo-desk@example.com       (Main branch only)
    sales      demo-sales@example.com
    trainer    demo-trainer@example.com    (Main branch; owns the demo members)
    trainer 2  demo-trainer2@example.com   (Downtown branch; no members yet)
"""

import asyncio
import os
import sys
from datetime import timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.core.dates import DurationUnit, membership_end, today_in  # noqa: E402
from app.core.db import SessionLocal, utcnow  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import Branch, Gym, Member, Membership, Plan, StaffMembership, User  # noqa: E402
from app.modules.attendance.models import Attendance, AttendanceSource  # noqa: E402
from app.modules.gyms.models import Role  # noqa: E402
from app.modules.leads.models import Lead, LeadSource, LeadStage  # noqa: E402
from app.modules.members.service import compute_total  # noqa: E402

DEMO_PASSWORD = "DemoPass123!"
OWNER_EMAIL = "demo-owner@example.com"
TRAINER_EMAIL = "demo-trainer@example.com"

# (email, name, role, which branch): one login per role so every dashboard can be tried.
TEAM = [
    ("demo-manager@example.com", "Demo Manager", Role.MANAGER, "main"),
    ("demo-desk@example.com", "Demo Front Desk", Role.FRONT_DESK, "main"),
    ("demo-sales@example.com", "Demo Sales", Role.SALES, None),
    ("demo-trainer2@example.com", "Demo Trainer Two", Role.TRAINER, "downtown"),
]


async def get_or_create_user(db, email: str, name: str, phone: str | None = None) -> User:
    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, name=name, phone=phone, password_hash=hash_password(DEMO_PASSWORD))
        db.add(user)
        await db.flush()
    return user


async def main() -> None:
    async with SessionLocal() as db:
        owner = await get_or_create_user(db, OWNER_EMAIL, "Demo Owner")
        existing = await db.scalar(
            select(StaffMembership).where(StaffMembership.user_id == owner.id)
        )
        if existing:
            print("Demo gym already exists.")
            return

        gym = Gym(
            name="Iron Temple Fitness", phone="+91 98765 43210", onboarding_completed_at=utcnow()
        )
        db.add(gym)
        await db.flush()
        main_branch = Branch(gym_id=gym.id, name="Main branch", address="12 MG Road")
        db.add(main_branch)
        await db.flush()

        downtown = Branch(gym_id=gym.id, name="Downtown", address="4 Park Street")
        db.add(downtown)
        await db.flush()
        branches = {"main": main_branch.id, "downtown": downtown.id, None: None}

        trainer = await get_or_create_user(db, TRAINER_EMAIL, "Demo Trainer", "+919800000001")
        for email, name, role, where in TEAM:
            user = await get_or_create_user(db, email, name)
            db.add(
                StaffMembership(
                    user_id=user.id, gym_id=gym.id, role=role, branch_id=branches[where]
                )
            )
        db.add_all(
            [
                StaffMembership(
                    user_id=owner.id, gym_id=gym.id, role=Role.OWNER, branch_id=main_branch.id
                ),
                StaffMembership(
                    user_id=trainer.id, gym_id=gym.id, role=Role.TRAINER, branch_id=main_branch.id
                ),
            ]
        )
        await db.flush()
        await seed_plans_and_members(db, gym, trainer.id)
        await seed_leads_and_visits(db, gym, owner.id)
        await db.commit()
        print(f"Created demo gym. Log in as {OWNER_EMAIL} / {DEMO_PASSWORD}")


async def seed_plans_and_members(db, gym: Gym, trainer_id) -> None:
    monthly = Plan(
        gym_id=gym.id,
        name="Monthly – Gym",
        duration_value=1,
        duration_unit=DurationUnit.MONTH,
        price=Decimal(1800),
        joining_fee=Decimal(500),
        tax_pct=Decimal(18),
        max_freeze_days=5,
        services=["Gym floor"],
    )
    quarterly = Plan(
        gym_id=gym.id,
        name="Quarterly – Gym + Cardio",
        duration_value=3,
        duration_unit=DurationUnit.MONTH,
        price=Decimal(4500),
        joining_fee=Decimal(500),
        tax_pct=Decimal(18),
        max_freeze_days=15,
        services=["Gym floor", "Cardio"],
    )
    db.add_all([monthly, quarterly])
    await db.flush()

    today = today_in(gym.timezone)
    # (name, phone, plan, start offset in days) -> active, expiring, expired, upcoming, none
    people = [
        ("Arjun Mehta", "+919811100001", quarterly, 0),
        ("Sneha Iyer", "+919811100002", monthly, -26),
        ("Rahul Verma", "+919811100003", monthly, -45),
        ("Kavya Nair", "+919811100004", quarterly, 5),
        ("Imran Khan", "+919811100005", None, 0),
    ]
    for name, phone, plan, offset in people:
        member = Member(
            gym_id=gym.id,
            name=name,
            phone=phone,
            joined_on=today + timedelta(days=min(offset, 0)),
            trainer_id=trainer_id,
            memberships=[],
        )
        if plan:
            start = today + timedelta(days=offset)
            member.memberships.append(
                Membership(
                    gym_id=gym.id,
                    plan_id=plan.id,
                    plan_name=plan.name,
                    duration_value=plan.duration_value,
                    duration_unit=plan.duration_unit,
                    start_date=start,
                    end_date=membership_end(start, plan.duration_value, plan.duration_unit),
                    price=plan.price,
                    discount=Decimal(0),
                    joining_fee=plan.joining_fee,
                    tax_pct=plan.tax_pct,
                    total=compute_total(plan.price, Decimal(0), plan.joining_fee, plan.tax_pct),
                    max_freeze_days=plan.max_freeze_days,
                    frozen_days=0,
                )
            )
        db.add(member)


async def seed_leads_and_visits(db, gym: Gym, owner_id) -> None:
    """A few leads and some visits, so the sales, desk and trainer boards have something on them."""
    staff = {
        m.role: m.user_id
        for m in (
            await db.scalars(select(StaffMembership).where(StaffMembership.gym_id == gym.id))
        ).all()
    }
    now = utcnow()
    leads = [
        ("Ananya Rao", "+919822200001", LeadSource.INSTAGRAM, LeadStage.NEW, Role.SALES, -1),
        ("Vikram Shah", "+919822200002", LeadSource.WALK_IN, LeadStage.CONTACTED, Role.SALES, 0),
        (
            "Meera Joshi",
            "+919822200003",
            LeadSource.REFERRAL,
            LeadStage.TRIAL_BOOKED,
            Role.SALES,
            2,
        ),
        ("Farhan Ali", "+919822200004", LeadSource.GOOGLE, LeadStage.CONTACTED, Role.TRAINER, -2),
    ]
    for name, phone, source, stage, owner_role, follow_days in leads:
        db.add(
            Lead(
                gym_id=gym.id,
                name=name,
                phone=phone,
                source=source,
                stage=stage,
                assigned_to=staff.get(owner_role),
                next_follow_up_at=now + timedelta(days=follow_days),
                trial_at=now + timedelta(days=2) if stage == LeadStage.TRIAL_BOOKED else None,
            )
        )

    # Visits: Arjun trains regularly, Sneha came a few times and then went quiet.
    members = {
        m.name: m for m in (await db.scalars(select(Member).where(Member.gym_id == gym.id))).all()
    }
    today = today_in(gym.timezone)
    pattern = {"Arjun Mehta": [0, 1, 3, 4, 6, 8, 10, 12, 15, 17], "Sneha Iyer": [18, 20, 22, 25]}
    for name, ago in pattern.items():
        member = members.get(name)
        if member is None:
            continue
        member.device_user_id = {"Arjun Mehta": "101", "Sneha Iyer": "102"}[name]
        for d in ago:
            day = today - timedelta(days=d)
            db.add(
                Attendance(
                    gym_id=gym.id,
                    member_id=member.id,
                    branch_id=member.branch_id,
                    checked_in_at=now - timedelta(days=d),
                    local_date=day,
                    source=AttendanceSource.DESK,
                )
            )


if __name__ == "__main__":
    asyncio.run(main())
