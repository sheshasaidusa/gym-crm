"""Small in-memory rate limiter for unauthenticated endpoints.

Per process: with several API instances each enforces its own window, which is still an
effective brake on password and token guessing. Swap for Redis if you need a global limit.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.core.config import settings


def client_ip(request: Request) -> str:
    """The caller's IP. Proxies append to X-Forwarded-For, so only entries added by our own
    proxies can be trusted: count TRUSTED_PROXY_HOPS from the right. Anything further
    left was sent by the client and could be made up."""
    hops = settings.trusted_proxy_hops
    forwarded = request.headers.get("x-forwarded-for")
    if hops > 0 and forwarded:
        chain = [p.strip() for p in forwarded.split(",") if p.strip()]
        if chain:
            return chain[-min(hops, len(chain))]
    return request.client.host if request.client else "unknown"


class RateLimiter:
    _instances: list["RateLimiter"] = []

    def __init__(self, limit: int, window_seconds: float, message: str | None = None):
        self.limit = limit
        self.window = window_seconds
        self.message = message or "Too many requests. Please wait a minute."
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        RateLimiter._instances.append(self)

    def __call__(self, request: Request) -> None:
        """As a FastAPI dependency: limit by caller IP."""
        self.check(client_ip(request))

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                self.message,
                headers={"Retry-After": str(int(q[0] + self.window - now) + 1)},
            )
        q.append(now)
        if len(self.hits) > 10_000:  # keep memory bounded
            for k in [k for k, v in self.hits.items() if not v]:
                del self.hits[k]

    @classmethod
    def reset_all(cls) -> None:
        for limiter in cls._instances:
            limiter.hits.clear()
