import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.modules.gyms.models import Role
from app.modules.gyms.schemas import GymOut


def _normalize_email(v: str) -> str:
    return v.strip().lower()


class SignupIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    gym_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(None, max_length=30)

    _email = field_validator("email")(_normalize_email)


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    gym_id: uuid.UUID | None = None

    _email = field_validator("email")(_normalize_email)


class RefreshIn(BaseModel):
    refresh_token: str | None = None


class SwitchGymIn(BaseModel):
    gym_id: uuid.UUID


class AcceptInviteIn(BaseModel):
    # Name is only needed when the invitee doesn't have an account yet.
    name: str | None = Field(None, min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    phone: str | None = None


class UpdateMeIn(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    phone: str | None = Field(None, max_length=30)


class GymMembershipOut(BaseModel):
    gym_id: uuid.UUID
    gym_name: str
    role: Role


class MeOut(BaseModel):
    user: UserOut
    gym: GymOut
    role: Role
    branch_id: uuid.UUID | None = None
    # What this person may do here (see core/permissions.py); the app shows or hides by these.
    capabilities: list[str] = []
    gyms: list[GymMembershipOut]


class AuthOut(MeOut):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class InvitePreviewOut(BaseModel):
    gym_name: str
    email: str
    role: Role
    existing_user: bool
