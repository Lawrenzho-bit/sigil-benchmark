import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { authorize } from '@/lib/authz';
import { stripe } from '@/lib/stripe';
import { env } from '@/lib/env';

/**
 * POST /api/billing/portal — returns a Stripe Billing Portal URL where Owners
 * manage payment methods, view invoices, change or cancel the plan, and handle
 * refunds. Owner-only (billing.manage).
 */
export const POST = handleRoute(async () => {
  const session = await authorize('billing.manage');

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.orgId },
  });
  if (!org.stripeCustomerId) {
    throw Errors.badRequest('No billing account yet. Start a subscription first.');
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${env.APP_URL}/dashboard/billing`,
  });

  return NextResponse.json({ url: portal.url });
});
