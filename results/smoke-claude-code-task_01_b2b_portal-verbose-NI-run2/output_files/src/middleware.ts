import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware applied to every request.
 *
 *  1. Assigns an x-request-id for log correlation.
 *  2. CSRF defense: for state-changing API requests (POST/PUT/PATCH/DELETE)
 *     the Origin header must match the host. Combined with the SameSite=Lax
 *     session cookie this blocks cross-site form/fetch attacks. The Stripe
 *     webhook is exempt — it authenticates via signature, not cookies.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function middleware(req: NextRequest) {
  const requestId = crypto.randomUUID();

  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const isWebhook = req.nextUrl.pathname.startsWith('/api/webhooks/');

  if (isApi && !isWebhook && MUTATING.has(req.method)) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    // Reject when Origin is present and does not match the serving host.
    // (A missing Origin on same-origin requests from older clients is allowed;
    //  tighten to reject-on-missing if your clients always send it.)
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== host) {
        return NextResponse.json(
          { error: 'csrf_rejected', message: 'Cross-origin request rejected' },
          { status: 403 },
        );
      }
    }
  }

  const res = NextResponse.next();
  res.headers.set('x-request-id', requestId);
  return res;
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*'],
};
