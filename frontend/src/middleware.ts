import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/onboarding", "/login", "/signup", "/invite", "/p/", "/join/"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
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
