import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.modules.ai_plans import generator
from app.modules.ai_plans.content import DietPlan, Exercise, Meal, PlanContent, WorkoutDay
from tests.conftest import Account
from tests.helpers import make_member, make_plan
from tests.test_gym_and_staff import invite_and_accept


def sample_plan(days: int = 3) -> PlanContent:
    return PlanContent(
        summary="A simple full-body start.",
        weekly_schedule=[
            WorkoutDay(
                day=f"Day {i + 1}",
                focus="Full body",
                warmup="5 min bike",
                exercises=[
                    Exercise(name="Goblet squat", sets=3, reps="10", rest_seconds=90, notes="")
                ],
                cooldown="Stretch",
            )
            for i in range(days)
        ],
        diet=DietPlan(
            daily_calories=1800,
            protein_g=110,
            carbs_g=200,
            fat_g=55,
            meals=[
                Meal(
                    name="Breakfast",
                    time="8:00",
                    items=["Oats", "Curd"],
                    calories=450,
                    protein_g=25,
                )
            ],
            hydration="3 litres",
            notes=[],
        ),
        progression="Add 2.5 kg when all sets feel easy.",
        safety_notes=["Avoid deep knee flexion."],
    )


@pytest.fixture
def ai(monkeypatch):
    """Configures AI and replaces Claude with a recorder returning a fixed plan."""
    calls: list[tuple[dict, dict]] = []
    state = {"error": None}

    async def fake_generate(member: dict, params: dict):
        calls.append((member, params))
        if state["error"]:
            raise generator.GenerationError(state["error"])
        return generator.GenerationResult(
            content=sample_plan(params["days_per_week"]),
            model="claude-opus-5-5",
            input_tokens=900,
            output_tokens=2500,
        )

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    monkeypatch.setattr(generator, "generate_plan", fake_generate)
    return SimpleNamespace(calls=calls, state=state)


async def generate(client: AsyncClient, acct: Account, member_id: str, **params) -> dict:
    res = await client.post(f"/api/members/{member_id}/ai-plans", json=params, headers=acct.headers)
    assert res.status_code == 202, res.text
    return res.json()


async def test_generate_review_publish(client: AsyncClient, owner: Account, ai):
    member = await make_member(
        client,
        owner,
        email="ravi@x.com",
        goals=["weight_loss", "strength"],
        diet_pref="veg",
        medical_notes="Knee pain",
    )
    await client.post(
        f"/api/members/{member['id']}/checkups",
        json={"weight_kg": 82, "height_cm": 175},
        headers=owner.headers,
    )

    started = await generate(
        client, owner, member["id"], days_per_week=3, instructions="Loves cycling"
    )
    assert started["status"] == "generating" and started["version"] == 1

    plan = (await client.get(f"/api/ai-plans/{started['id']}", headers=owner.headers)).json()
    assert plan["status"] == "draft"
    assert len(plan["content"]["weekly_schedule"]) == 3
    assert plan["model"] == "claude-opus-5-5"

    # What was sent to Claude: profile and metrics, no name or contact details.
    sent_member, sent_params = ai.calls[0]
    assert sent_params["instructions"] == "Loves cycling"
    assert sent_member["goals"] == ["weight_loss", "strength"] and sent_member["diet_preference"] == "veg"
    assert sent_member["medical_notes"] == "Knee pain"
    assert sent_member["recent_checkups_newest_first"][0]["weight_kg"] == 82
    blob = json.dumps(sent_member)
    assert "Ravi" not in blob and "ravi@x.com" not in blob and "9876543210" not in blob

    # Trainer edits, then publishes.
    content = plan["content"]
    content["summary"] = "Edited by coach"
    res = await client.patch(
        f"/api/ai-plans/{plan['id']}",
        json={"content": content, "title": "Cut phase"},
        headers=owner.headers,
    )
    assert (
        res.json()["content"]["summary"] == "Edited by coach" and res.json()["title"] == "Cut phase"
    )

    res = await client.post(f"/api/ai-plans/{plan['id']}/publish", headers=owner.headers)
    assert res.json()["status"] == "published" and res.json()["published_at"]

    # A new version replaces the published one when it's published.
    v2 = await generate(client, owner, member["id"])
    await client.post(f"/api/ai-plans/{v2['id']}/publish", headers=owner.headers)
    plans = (
        await client.get(f"/api/members/{member['id']}/ai-plans", headers=owner.headers)
    ).json()
    assert [(p["version"], p["status"]) for p in plans] == [(2, "published"), (1, "archived")]

    # Published plans can't be deleted; archived ones can.
    assert (
        await client.delete(f"/api/ai-plans/{v2['id']}", headers=owner.headers)
    ).status_code == 409
    assert (
        await client.delete(f"/api/ai-plans/{plan['id']}", headers=owner.headers)
    ).status_code == 204


async def test_failed_generation_is_recorded(client: AsyncClient, owner: Account, ai):
    ai.state["error"] = "The AI declined to write a plan for this profile."
    member = await make_member(client, owner)
    started = await generate(client, owner, member["id"])
    plan = (await client.get(f"/api/ai-plans/{started['id']}", headers=owner.headers)).json()
    assert plan["status"] == "failed" and "declined" in plan["error"]
    assert (
        await client.post(f"/api/ai-plans/{plan['id']}/publish", headers=owner.headers)
    ).status_code == 409


async def test_not_configured(client: AsyncClient, owner: Account, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    member = await make_member(client, owner)
    res = await client.post(f"/api/members/{member['id']}/ai-plans", json={}, headers=owner.headers)
    assert res.status_code == 503
    status = (await client.get("/api/ai/status", headers=owner.headers)).json()
    assert status["configured"] is False


async def test_monthly_limit(client: AsyncClient, owner: Account, ai, monkeypatch):
    monkeypatch.setattr(settings, "ai_monthly_plan_limit", 2)
    member = await make_member(client, owner)
    await generate(client, owner, member["id"])
    await generate(client, owner, member["id"])
    res = await client.post(f"/api/members/{member['id']}/ai-plans", json={}, headers=owner.headers)
    assert res.status_code == 429
    status = (await client.get("/api/ai/status", headers=owner.headers)).json()
    assert status["used_this_month"] == 2 and status["monthly_limit"] == 2


async def test_roles(client: AsyncClient, owner: Account, ai):
    trainer = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    desk = await invite_and_accept(client, owner, "desk@a.com", "front_desk")
    member = await make_member(client, owner)
    plan = await generate(client, trainer, member["id"])
    assert (
        await client.post(f"/api/members/{member['id']}/ai-plans", json={}, headers=desk.headers)
    ).status_code == 403
    assert (
        await client.post(f"/api/ai-plans/{plan['id']}/publish", headers=desk.headers)
    ).status_code == 403
    assert (
        await client.get(f"/api/ai-plans/{plan['id']}", headers=desk.headers)
    ).status_code == 200
    assert (
        await client.post(f"/api/ai-plans/{plan['id']}/publish", headers=trainer.headers)
    ).status_code == 200


async def test_ai_plans_isolated(client: AsyncClient, owner: Account, other_owner: Account, ai):
    member = await make_member(client, owner)
    plan = await generate(client, owner, member["id"])
    h = other_owner.headers
    assert (await client.get(f"/api/members/{member['id']}/ai-plans", headers=h)).status_code == 404
    assert (
        await client.post(f"/api/members/{member['id']}/ai-plans", json={}, headers=h)
    ).status_code == 404
    assert (await client.get(f"/api/ai-plans/{plan['id']}", headers=h)).status_code == 404
    assert (await client.post(f"/api/ai-plans/{plan['id']}/publish", headers=h)).status_code == 404
    assert (await client.delete(f"/api/ai-plans/{plan['id']}", headers=h)).status_code == 404


# --- Public member page -------------------------------------------------------


async def test_public_page(client: AsyncClient, owner: Account, ai):
    gym_plan = await make_plan(client, owner)
    member = await make_member(
        client, owner, name="Asha Rao", email="asha@x.com", membership={"plan_id": gym_plan["id"]}
    )
    token = member["preview_url"].rsplit("/", 1)[-1]
    url = f"/api/public/members/{token}"
    for d, w in (("2026-01-05", 70), ("2026-01-12", 69.2)):
        await client.post(
            f"/api/members/{member['id']}/checkups",
            json={"weight_kg": w, "recorded_on": d},
            headers=owner.headers,
        )

    client.cookies.clear()
    page = await client.get(url)  # no login
    assert page.status_code == 200
    assert page.headers["cache-control"] == "no-store" and "noindex" in page.headers["x-robots-tag"]
    body = page.json()
    assert body["first_name"] == "Asha" and body["gym"]["name"] == "Gym A"
    assert body["membership"]["status"] == "active" and body["membership"]["plan_name"] == "Monthly"
    assert body["plan"] is None  # nothing published yet
    assert body["progress"]["weight_change_kg"] == -0.8
    assert len(body["progress"]["weight_series"]) == 2

    # No internal ids or contact details leak.
    raw = page.text
    for secret in (member["id"], owner.gym_id, "asha@x.com", member["phone"]):
        assert secret not in raw

    plan = await generate(client, owner, member["id"])
    await client.post(f"/api/ai-plans/{plan['id']}/publish", headers=owner.headers)
    client.cookies.clear()
    assert (await client.get(url)).json()["plan"]["summary"] == "A simple full-body start."

    # Disabling or regenerating the link makes the old URL a 404.
    await client.patch(
        f"/api/members/{member['id']}", json={"preview_enabled": False}, headers=owner.headers
    )
    client.cookies.clear()
    assert (await client.get(url)).status_code == 404
    assert (await client.get("/api/public/members/" + "x" * 43)).status_code == 404


async def test_public_page_rate_limited(client: AsyncClient, monkeypatch):
    from app.core.ratelimit import RateLimiter
    from app.modules.public import router as public_router

    limiter = RateLimiter(limit=3, window_seconds=60)
    monkeypatch.setattr(public_router.preview_limiter, "limit", 3)
    monkeypatch.setattr(public_router.preview_limiter, "hits", limiter.hits)
    codes = [(await client.get("/api/public/members/" + "y" * 43)).status_code for _ in range(4)]
    assert codes == [404, 404, 404, 429]


# --- Generator (Claude request & response handling) ---------------------------


class FakeMessages:
    def __init__(self, response=None, error=None):
        self.response, self.error, self.kwargs = response, error, None

    async def parse(self, **kwargs):
        self.kwargs = kwargs
        if self.error:
            raise self.error
        return self.response


def fake_client(monkeypatch, messages: FakeMessages):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    client = SimpleNamespace(beta=SimpleNamespace(messages=messages))
    monkeypatch.setattr(anthropic, "AsyncAnthropic", lambda **_: client)


def response(stop_reason="end_turn", parsed=None):
    return SimpleNamespace(
        stop_reason=stop_reason,
        parsed_output=parsed,
        model="claude-opus-5-5",
        usage=SimpleNamespace(input_tokens=100, output_tokens=200),
    )


async def test_generator_request_shape(monkeypatch):
    messages = FakeMessages(response(parsed=sample_plan()))
    fake_client(monkeypatch, messages)
    result = await generator.generate_plan({"goals": ["strength"]}, {"days_per_week": 3})
    assert result.content.summary == "A simple full-body start."

    kw = messages.kwargs
    assert kw["model"] == settings.ai_model == "claude-opus-5-5"
    assert kw["output_format"] is PlanContent
    assert kw["output_config"] == {"effort": "medium"}
    assert kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"]
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "strength" in kw["messages"][0]["content"]
    assert "temperature" not in kw


async def test_generator_refusal_and_truncation(monkeypatch):
    fake_client(monkeypatch, FakeMessages(response(stop_reason="refusal")))
    with pytest.raises(generator.GenerationError, match="declined"):
        await generator.generate_plan({}, {})
    fake_client(monkeypatch, FakeMessages(response(stop_reason="max_tokens")))
    with pytest.raises(generator.GenerationError, match="incomplete"):
        await generator.generate_plan({}, {})


async def test_generator_api_errors(monkeypatch):
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    err = anthropic.RateLimitError(
        "slow down", response=httpx.Response(429, request=req), body=None
    )
    fake_client(monkeypatch, FakeMessages(error=err))
    with pytest.raises(generator.GenerationError, match="busy"):
        await generator.generate_plan({}, {})
    fake_client(monkeypatch, FakeMessages(error=anthropic.APIConnectionError(request=req)))
    with pytest.raises(generator.GenerationError, match="reach"):
        await generator.generate_plan({}, {})
