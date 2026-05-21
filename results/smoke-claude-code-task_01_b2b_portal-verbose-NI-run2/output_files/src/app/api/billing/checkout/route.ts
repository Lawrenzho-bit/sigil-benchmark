import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { authorize } from '@/lib/authz';
import { stripe, PLANS } from '@/lib/stripe';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { clientIp } from '@/lib/http';

const bodySchema = z.object({ plan: z.enum(['STARTER', 'PRO']) });

/**
 * POST /api/billing/checkout — starts a Stripe Checkout session for a new or
 * changed subscription. Owner-only (billing.manage). The actual plan change is
 * applied by the webhook on `customer.subscription.*`, keeping our DB in sync
 * with Stripe as the source of truth. ENTERPRISE is sales-assisted, not here.
 */
export const POST = handleRoute(async (req) => {
  const session = await authorize('billing.manage');
  const { plan } = bodySchema.parse(await req.json());

  const priceId = PLANS[plan].priceId;
  if (!priceId) throw Errors.badRequest(`No Stripe price configured for ${plan}.`);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.orgId },
  });

  // Reuse the org's Stripe customer, creating one on first checkout.
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.email,
      name: org.name,
      metadata: { orgId: org.id },
    });
    customerId = customer.id;
    await prisma.organization.update({
      where: { id: org.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // Proration on plan changes is handled automatically for existing subs.
    success_url: `${env.APP_URL}/dashboard/billing?status=success`,
    cancel_url: `${env.APP_URL}/dashboard/billing?status=cancelled`,
    client_reference_id: org.id,
  });

  await audit({
    orgId: org.id,
    actorId: session.userId,
    actorEmail: session.email,
    action: 'billing.checkout_started',
    targetType: 'organization',
    targetId: org.id,
    ip: clientIp(req),
    metadata: { plan },
  });

  return NextResponse.json({ url: checkout.url });
});
