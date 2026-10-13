import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/onboarding", "/login", "/signup", "/invite", "/p/", "/join/"];
// The member app has its own login and its own cookies; staff cookies don't count there.
const MEMBER_PUBLIC = ["/m/login", "/m/activate/", "/m/offline"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/m" || pathname.startsWith("/m/")) {
    const signedIn = request.cookies.has("m_access") || request.cookies.has("m_refresh");
    if (!signedIn && !MEMBER_PUBLIC.some((p) => pathname.startsWith(p))) {
      const url = new URL("/m/login", request.url);
      if (pathname !== "/m") url.searchParams.set("next", pathname + search);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const hasSession =
    request.cookies.has("access_token") || request.cookies.has("refresh_token");
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!hasSession && !isPublic) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  // No "already logged in" redirect away from /login: a stale cookie would cause a redirect loop.
  return NextResponse.next();
}

export const config = {
  // Skip API proxy, Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
