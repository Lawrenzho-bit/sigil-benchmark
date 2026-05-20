import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: a coarse gate that bounces unauthenticated requests away
 * from app pages to /login. This is defence-in-depth only — it checks the
 * session cookie's presence, not its validity. Real authorization is
 * enforced server-side by getSession()/requirePermission() on every route,
 * because the cookie's presence proves nothing.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/saml"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const hasCookie = req.cookies.has("portal_session");
  if (!hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Exclude Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
