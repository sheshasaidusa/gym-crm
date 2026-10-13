"""Unauthenticated endpoints. Everything here is reachable by anyone holding a link, so it
returns the minimum needed and never internal IDs, staff details or photos."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.db import utcnow
from app.core.deps import DbSession
from app.core.ratelimit import RateLimiter
from app.modules.ai_plans.content import PlanContent
from app.modules.gyms.models import Gym, Role
from app.modules.leads import service as lead_service
from app.modules.leads.models import ActivityKind, Lead, LeadSource, LeadStage
from app.modules.leads.schemas import PublicFormInfo, PublicLeadIn
from app.modules.member_app import service as member_service
from app.modules.member_app.schemas import PublicMemberPage
from app.modules.members.models import Member
from app.modules.members.service import gym_today
from app.modules.notifications.service import notify_staff

router = APIRouter(prefix="/public", tags=["public"])

preview_limiter = RateLimiter(limit=60, window_seconds=60)


NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "This link isn't valid anymore")


@router.get(
    "/members/{token}",
    response_model=PublicMemberPage,
    dependencies=[Depends(preview_limiter)],
)
async def member_page(token: str, response: Response, db: DbSession):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Referrer-Policy"] = "no-referrer"
    if len(token) < 20:
        raise NOT_FOUND
    member = await db.scalar(
        select(Member)
        .where(Member.preview_token == token)
        .options(selectinload(Member.memberships))
    )
    # Disabled links look exactly like unknown ones.
    if member is None or not member.preview_enabled:
        raise NOT_FOUND

    gym = await db.get_one(Gym, member.gym_id)
    today = await gym_today(db, gym.id)
    plan = await member_service.published_plan(db, member.id)
    trainer = await member_service.trainer_of(db, member)
    return PublicMemberPage(
        gym=member_service.gym_view(gym),
        member_name=member.name,
        first_name=member.name.split()[0],
        trainer_name=trainer.name if trainer else None,
        membership=member_service.membership_view(member, today),
        plan=PlanContent.model_validate(plan.content) if plan and plan.content else None,
        plan_updated_at=(plan.updated_at if plan else None),
        progress=member_service.progress_view(await member_service.checkups_of(db, member.id)),
    )


# --- Website enquiry form -----------------------------------------------------

lead_form_limiter = RateLimiter(limit=10, window_seconds=60)


async def _form_gym(db, token: str) -> Gym:
    gym = (
        await db.scalar(select(Gym).where(Gym.lead_form_token == token))
        if len(token) >= 20
        else None
    )
    if gym is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This form isn't available")
    return gym


@router.get(
    "/lead-forms/{token}",
    response_model=PublicFormInfo,
    dependencies=[Depends(preview_limiter)],
)
async def lead_form(token: str, db: DbSession):
    gym = await _form_gym(db, token)
    return PublicFormInfo(gym_name=gym.name, brand_color=gym.brand_color, logo_url=gym.logo_url)


@router.post(
    "/lead-forms/{token}",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(lead_form_limiter)],
)
async def submit_lead_form(token: str, body: PublicLeadIn, db: DbSession) -> dict[str, str]:
    """Creates a website lead. Repeat submissions from the same phone are added to the
    existing open lead instead of creating duplicates."""
    gym = await _form_gym(db, token)
    ok = {"status": "received"}
    if body.website:  # honeypot filled in: a bot. Pretend it worked.
        return ok

    message = f"Website form: {body.message}" if body.message else "Sent the website enquiry form"
    lead = await lead_service.open_lead_with_phone(db, gym.id, body.phone)
    if lead is not None:
        lead_service.log(lead, ActivityKind.NOTE, message, None)
        lead.next_follow_up_at = lead.next_follow_up_at or utcnow()
        title = f"{lead.name} enquired again on your website"
    else:
        lead = Lead(
            gym_id=gym.id,
            name=" ".join(body.name.split()),
            phone=body.phone,
            email=body.email,
            source=LeadSource.WEBSITE,
            stage=LeadStage.NEW,
            interest=body.message[:300] if body.message else None,
            next_follow_up_at=utcnow(),  # call back today
            stage_changed_at=utcnow(),
            activities=[],
        )
        lead_service.log(lead, ActivityKind.CREATED, message, None)
        db.add(lead)
        title = f"New website enquiry: {lead.name}"
    await db.flush()
    await notify_staff(
        db,
        gym.id,
        roles=(Role.OWNER, Role.MANAGER, Role.FRONT_DESK, Role.SALES),
        kind="lead_new",
        title=title,
        body=body.message[:200] if body.message else "Call them back today.",
        link=f"/leads?lead={lead.id}",
    )
    await db.commit()
    return ok
