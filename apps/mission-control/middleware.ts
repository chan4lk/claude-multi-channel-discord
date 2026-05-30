import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Public paths — no auth required
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/events"  // Bot authenticates via Bearer API key, validated in route
  ) {
    return NextResponse.next();
  }

  // better-auth prefixes the cookie with __Secure- on HTTPS origins
  const sessionToken =
    request.cookies.get("better-auth.session_token") ||
    request.cookies.get("__Secure-better-auth.session_token");

  if (!sessionToken) {
    // API routes → 401 JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Browser routes → redirect to login
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
