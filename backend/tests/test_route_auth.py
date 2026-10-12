"""Every API route must require a logged-in caller unless it is deliberately public.

Catches a new endpoint that forgets its auth dependency, which would otherwise be a silent
cross-tenant data leak. Add genuinely public routes to PUBLIC below, with care.
"""

from fastapi.routing import APIRoute

from app.core.deps import get_tenant_context
from app.main import app

# Callers that count as authenticated. Member and device auth join this set when they exist.
AUTH_DEPENDENCIES = {get_tenant_context}

PUBLIC = {
    ("GET", "/api/health"),
    ("GET", "/api/health/ready"),
    ("POST", "/api/auth/signup"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/refresh"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/invites/{token}"),
    ("POST", "/api/auth/invites/{token}/accept"),
    ("GET", "/api/public/members/{token}"),
    ("GET", "/api/public/lead-forms/{token}"),
    ("POST", "/api/public/lead-forms/{token}"),
}


def _api_routes(router, outer: str = ""):
    """(full path, route) for every APIRoute, walking routers included into routers."""
    for route in router.routes:
        if isinstance(route, APIRoute):
            yield outer + route.path, route
        elif hasattr(route, "original_router"):  # FastAPI's lazily included router
            yield from _api_routes(route.original_router, outer + router.prefix)


def _calls(dependant) -> set:
    found = {dependant.call}
    for dep in dependant.dependencies:
        found |= _calls(dep)
    return found


def test_every_route_requires_auth_or_is_listed_public():
    seen = set()
    unprotected = []
    for path, route in _api_routes(app.router):
        for method in route.methods - {"HEAD", "OPTIONS"}:
            seen.add((method, path))
            if (method, path) not in PUBLIC and not (_calls(route.dependant) & AUTH_DEPENDENCIES):
                unprotected.append(f"{method} {path}")
    assert len(seen) > 50, "route discovery found too few routes; the walker is broken"
    assert not unprotected, f"routes without an auth dependency: {unprotected}"
    stale = PUBLIC - seen
    assert not stale, f"PUBLIC lists routes that no longer exist: {stale}"
