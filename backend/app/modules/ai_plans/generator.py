"""Generates a workout + diet plan with Claude.

Only what's needed to write a plan is sent: age, sex, body metrics, goals, diet, experience,
medical notes and the trainer's instructions. Never the member's name, phone or email.
"""

import json
import logging
from dataclasses import dataclass
from typing import Any

import anthropic

from app.core.config import settings
from app.modules.ai_plans.content import PlanContent

log = logging.getLogger("gym_crm.ai")

# Fixed text first so it is cached across every gym and member (prompt caching is a
# prefix match - keep anything variable out of the system prompt).
SYSTEM_PROMPT = """You are an experienced strength & conditioning coach and sports nutritionist \
writing a personalised 4-week starting plan for a gym member. A qualified trainer at the gym \
reviews and edits your plan before the member sees it.

Write for the member: plain language, encouraging, specific. Use exercises available in a \
typical commercial gym unless the equipment setting says otherwise.

Safety comes first:
- Treat the medical notes as hard constraints. Leave out or substitute any exercise that could \
aggravate a listed condition or injury, and say what you substituted in that exercise's notes.
- If a condition needs medical clearance before training (e.g. recent surgery, uncontrolled \
blood pressure, pregnancy complications, chest pain), say so first in safety_notes and keep \
the programme gentle.
- Match volume and intensity to the experience level. Beginners get fewer sets, simpler \
movements and full-body sessions.

Nutrition:
- Respect the diet preference strictly (vegetarian means no meat or fish, eggetarian allows \
eggs, vegan excludes all animal products).
- Use foods that are common and affordable in the member's region (inferred from the gym's \
time zone) and realistic for daily life.
- The member may have up to 3 goals, listed most important first; balance the plan across \
them, letting the first lead when they conflict.
- Set calories and macros from the goals and current body metrics; keep a weight-loss deficit \
moderate (about 15-20% below maintenance). Meal calories should add up to daily_calories.
- This is general guidance, not medical nutrition therapy; do not prescribe supplements beyond \
basics like whey or creatine, and flag anything that needs a doctor.

Produce exactly as many workout days in weekly_schedule as the days per week requested, each \
fitting the session length. Give rest_seconds as whole seconds and reps as text ("8-10", \
"12 each side", "30 sec")."""


class AIUnavailable(Exception):
    """Generation isn't configured (no API key)."""


class GenerationError(Exception):
    """Claude couldn't produce a plan; the message is safe to show to staff."""


@dataclass
class GenerationResult:
    content: PlanContent
    model: str
    input_tokens: int
    output_tokens: int


def is_configured() -> bool:
    return bool(settings.anthropic_api_key)


def build_prompt(member: dict[str, Any], params: dict[str, Any]) -> str:
    return (
        "Member profile and recent check-ups:\n"
        f"{json.dumps(member, indent=2, default=str)}\n\n"
        "Programme settings from the trainer:\n"
        f"{json.dumps(params, indent=2)}\n\n"
        "Write the plan."
    )


async def generate_plan(member: dict[str, Any], params: dict[str, Any]) -> GenerationResult:
    if not is_configured():
        raise AIUnavailable("AI plans aren't set up. Add ANTHROPIC_API_KEY to the server settings.")

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, max_retries=2)
    try:
        response = await client.beta.messages.parse(
            model=settings.ai_model,
            max_tokens=16000,
            system=[
                {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}
            ],
            messages=[{"role": "user", "content": build_prompt(member, params)}],
            output_format=PlanContent,
            output_config={"effort": settings.ai_effort},
            # If a safety classifier declines, re-run on Anthropic's recommended fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError as exc:
        raise GenerationError("The AI service is busy. Try again in a minute.") from exc
    except anthropic.AuthenticationError as exc:
        raise GenerationError("The AI API key was rejected. Check ANTHROPIC_API_KEY.") from exc
    except anthropic.BadRequestError as exc:
        log.warning("AI plan request rejected: %s", exc)
        raise GenerationError("The AI service rejected the request.") from exc
    except anthropic.APIStatusError as exc:
        log.warning("AI plan API error %s: %s", exc.status_code, exc)
        raise GenerationError("The AI service had a problem. Try again shortly.") from exc
    except anthropic.APIConnectionError as exc:
        raise GenerationError("Couldn't reach the AI service. Try again shortly.") from exc

    if response.stop_reason == "refusal":
        raise GenerationError(
            "The AI declined to write a plan for this profile. Write this one manually or "
            "adjust the medical notes/instructions."
        )
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise GenerationError("The AI response was incomplete. Try again with fewer days.")

    return GenerationResult(
        content=response.parsed_output,
        model=response.model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
