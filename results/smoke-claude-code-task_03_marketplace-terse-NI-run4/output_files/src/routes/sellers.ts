// Seller onboarding: create a seller profile, run KYC, attach a bank account
// via Stripe Connect, and surface onboarding status.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireSeller } from '../middleware/auth.js';
import { BadRequest, Conflict, NotFound } from '../lib/errors.js';
import { createConnectedAccount, createOnboardingLink } from '../lib/stripe.js';
import { kyc } from '../lib/kyc.js';

export async function sellerRoutes(app: FastifyInstance): Promise<void> {
  // Become a seller. Creates the profile + Stripe Express account and kicks
  // off KYC. The user's role is upgraded to SELLER only once KYC passes.
  app.post('/api/sellers', async (req) => {
    const auth = await requireAuth(req);
    const body = z
      .object({
        legalName: z.string().min(1).max(160),
        businessType: z.enum(['individual', 'company']).default('individual'),
      })
      .parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const existing = await prisma.sellerProfile.findUnique({
      where: { userId: auth.userId },
    });
    if (existing) throw Conflict('Seller profile already exists');

    const stripeAccountId = await createConnectedAccount({
      email: user.email,
      countryCode: user.countryCode,
      businessType: body.businessType,
    });
    const kycSession = await kyc.startVerification({
      sellerId: auth.userId,
      email: user.email,
    });

    const profile = await prisma.sellerProfile.create({
      data: {
        userId: auth.userId,
        legalName: body.legalName,
        businessType: body.businessType,
        stripeAccountId,
        kyc: {
          create: {
            status: 'PENDING',
            provider: 'stripe_identity',
            providerRef: kycSession.providerRef,
          },
        },
      },
      include: { kyc: true },
    });

    return {
      sellerId: profile.id,
      status: profile.status,
      onboardingUrl: await createOnboardingLink(stripeAccountId),
      kycRedirectUrl: kycSession.redirectUrl ?? null,
    };
  });

  // Onboarding status — buyers building a seller dashboard poll this.
  app.get('/api/sellers/me', async (req) => {
    const auth = await requireAuth(req);
    const profile = await prisma.sellerProfile.findUnique({
      where: { userId: auth.userId },
      include: { kyc: true, bankAccount: true },
    });
    if (!profile) throw NotFound('No seller profile');
    return profile;
  });

  // Attach a tokenised bank account. The raw account number is collected by
  // Stripe on the client; we receive only a token + display metadata.
  app.post('/api/sellers/me/bank-account', async (req) => {
    const auth = await requireSeller(req);
    const body = z
      .object({
        stripeBankToken: z.string().min(1),
        last4: z.string().length(4),
        bankName: z.string().optional(),
        countryCode: z.string().length(2),
        currency: z.string().length(3),
      })
      .parse(req.body);

    const profile = await prisma.sellerProfile.findUnique({
      where: { userId: auth.userId },
    });
    if (!profile) throw NotFound('No seller profile');

    const bank = await prisma.bankAccount.upsert({
      where: { sellerId: profile.id },
      update: { ...body },
      create: { sellerId: profile.id, ...body },
    });
    return { bankAccountId: bank.id, last4: bank.last4 };
  });

  // KYC status callback used by the mock provider and manual re-checks.
  // The Stripe webhook path (webhooks.ts) is authoritative in production.
  app.post('/api/sellers/me/kyc/sync', async (req) => {
    const auth = await requireAuth(req);
    const { providerStatus } = z
      .object({ providerStatus: z.string() })
      .parse(req.body);
    const profile = await prisma.sellerProfile.findUnique({
      where: { userId: auth.userId },
      include: { kyc: true, bankAccount: true },
    });
    if (!profile?.kyc) throw NotFound('No KYC verification in progress');

    const mapped = kyc.interpretStatus(providerStatus);
    await prisma.kycVerification.update({
      where: { id: profile.kyc.id },
      data: {
        status: mapped,
        verifiedAt: mapped === 'VERIFIED' ? new Date() : null,
      },
    });

    // Activate the seller once KYC passes and a bank account is on file.
    if (mapped === 'VERIFIED' && profile.bankAccount) {
      await prisma.$transaction([
        prisma.sellerProfile.update({
          where: { id: profile.id },
          data: { status: 'ACTIVE', payoutsEnabled: true },
        }),
        prisma.user.update({
          where: { id: auth.userId },
          data: { role: 'SELLER' },
        }),
      ]);
    }
    return { kycStatus: mapped };
  });
}
