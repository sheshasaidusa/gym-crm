"""What the owner tells us about the gym during onboarding (stored as JSON on the gym).

Every field is optional so each wizard step can save on its own. The drawing in the
onboarding wizard is generated from this profile, so the ids below are shared with the web app.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator

Size = Literal["small", "medium", "large"]
Zone = Literal["cardio", "weights", "machines", "functional", "studio"]
Facility = Literal["lockers", "showers", "parking"]
Hours = Literal["standard", "early", "24_7"]
Speciality = Literal["weights", "cardio", "machines", "functional", "studio", "general"]
# Roles the owner can invite during onboarding (owners are added later from Settings).
TeamRole = Literal["manager", "trainer", "front_desk"]

# Canonical order, so the same selection always gives the same drawing.
ZONE_ORDER: tuple[str, ...] = ("cardio", "weights", "machines", "functional", "studio")
FACILITY_ORDER: tuple[str, ...] = ("lockers", "showers", "parking")


def _canonical(values: list[str] | None, order: tuple[str, ...]) -> list[str] | None:
    if values is None:
        return None
    return [v for v in order if v in set(values)]


class TrainerDraft(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    email: EmailStr
    role: TeamRole = "trainer"
    # Only meaningful for trainers; other roles are drawn at reception.
    speciality: Speciality = "general"

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


class GymProfile(BaseModel):
    city: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    size: Size | None = None
    floors: int | None = Field(None, ge=1, le=3)
    staff_count: int | None = Field(None, ge=1, le=99)
    zones: list[Zone] | None = None
    facilities: list[Facility] | None = None
    hours: Hours | None = None
    trainers: list[TrainerDraft] | None = Field(None, max_length=12)
    # Last wizard step the owner reached (1 account, 2 space, 3 equipment, 4 trainers, 5 done).
    last_step: int | None = Field(None, ge=1, le=5)
    skipped_steps: list[Literal[2, 3, 4]] | None = None

    @field_validator("zones")
    @classmethod
    def _zones(cls, v: list[str] | None) -> list[str] | None:
        return _canonical(v, ZONE_ORDER)

    @field_validator("facilities")
    @classmethod
    def _facilities(cls, v: list[str] | None) -> list[str] | None:
        return _canonical(v, FACILITY_ORDER)

    @field_validator("skipped_steps")
    @classmethod
    def _skipped(cls, v: list[int] | None) -> list[int] | None:
        return None if v is None else sorted(set(v))


def merge_profile(current: dict | None, patch: GymProfile) -> dict:
    """Applies a partial update to the stored profile.

    Only the fields the client sent change. Lists are replaced as a whole and an explicit null
    clears a field. The result is validated again so stored data is always well formed.
    """
    merged = GymProfile.model_validate(current or {}).model_dump(mode="json")
    merged.update(patch.model_dump(mode="json", exclude_unset=True))
    return GymProfile.model_validate(merged).model_dump(mode="json")
