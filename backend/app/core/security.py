import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

# Staff use "access"/"refresh"; members get their own types, so one can never pass as the other.
TokenType = Literal["access", "refresh", "m_access", "m_refresh"]

_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _password_hash.verify(password, hashed)


def create_token(user_id: uuid.UUID, gym_id: uuid.UUID, token_type: TokenType) -> str:
    now = datetime.now(UTC)
    ttl = (
        timedelta(minutes=settings.access_token_minutes)
        if token_type == "access"
        else timedelta(days=settings.refresh_token_days)
    )
    payload = {
        "sub": str(user_id),
        "gym": str(gym_id),
        "type": token_type,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_member_token(
    member_id: uuid.UUID, gym_id: uuid.UUID, version: int, token_type: TokenType
) -> str:
    """`version` is the account's token_version: bumping it signs the member out everywhere."""
    now = datetime.now(UTC)
    ttl = (
        timedelta(minutes=settings.access_token_minutes)
        if token_type == "m_access"
        else timedelta(days=settings.member_refresh_token_days)
    )
    payload = {
        "sub": str(member_id),
        "gym": str(gym_id),
        "tv": version,
        "type": token_type,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: TokenType) -> dict:
    """Raises jwt.PyJWTError on any invalid, expired or wrong-type token."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def generate_url_token() -> str:
    return secrets.token_urlsafe(32)
