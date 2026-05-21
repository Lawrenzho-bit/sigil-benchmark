import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db';
import { parse } from '../../lib/validation';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requireAuth } from '../../auth/middleware';
import { kycProvider } from './kyc';
import { audit } from '../admin/audit';

const onboardSchema = z.object({
  legalName: z.string().min(1).max(120),
  businessName: z.string().max(120).optional(),
});

const bankSchema = z.object({
  // The client tokenizes bank details with the payment provider; the API only
  // ever sees a token and the last 4 digits.
  providerToken: z.string().min(1),
  last4: z.string().length(4),
  bankName: z.string().max(80).optional(),
  currency: z.string().length(3).default('usd'),
});

export async function sellerRoutes(app: FastifyInstance): Promise<void> {
  // Become a seller: creates the SellerProfile and grants the SELLER role.
  app.post('/seller/onboard', async (req) => {
    const auth = requireAuth(req);
    const body = parse(onboardSchema, req.body);

    const existing = await prisma.sellerProfile.findUnique({ where: { userId: auth.id } });
    if (existing) throw conflict('Seller profile already exists');

    const profile = await prisma.$transaction(async (tx) => {
      const created = await tx.sellerProfile.create({
        data: {
          userId: auth.id,
          legalName: body.legalName,
          businessName: body.businessName,
        },
      });
      await tx.user.update({
        where: { id: auth.id },
        data: { roles: { set: ['BUYER', 'SELLER'] } },
      });
      return created;
    });
    await audit(auth.id, 'seller.onboard', 'SellerProfile', profile.id);
    return profile;
  });

  // Start identity verification.
  app.post('/seller/kyc/start', async (req) => {
    const auth = requireAuth(req);
    const profile = await getProfile(auth.id);

    const result = await kycProvider.startVerification({
      sellerProfileId: profile.id,
      legalName: profile.legalName,
    });
    await prisma.kycVerification.upsert({
      where: { sellerProfileId: profile.id },
      create: {
        sellerProfileId: profile.id,
        provider: kycProvider.name,
        providerRef: result.providerRef,
        status: result.status,
      },
      update: { providerRef: result.providerRef, status: result.status },
    });
    await prisma.sellerProfile.update({
      where: { id: profile.id },
      data: { kycStatus: result.status },
    });
    return { status: result.status };
  });

  // Refresh KYC status from the provider. In production a webhook or a
  // scheduled job drives this instead of a client call.
  app.post('/seller/kyc/refresh', async (req) => {
    const auth = requireAuth(req);
    const profile = await getProfile(auth.id);
    const verification = await prisma.kycVerification.findUnique({
      where: { sellerProfileId: profile.id },
    });
    if (!verification?.providerRef) throw badRequest('KYC not started');

    const result = await kycProvider.checkStatus(verification.providerRef);
    const payoutsEnabled = result.status === 'VERIFIED' && Boolean(profile.bankAccount);
    await prisma.$transaction([
      prisma.kycVerification.update({
        where: { sellerProfileId: profile.id },
        data: {
          status: result.status,
          rejectionReason: result.rejectionReason,
          checkedAt: new Date(),
        },
      }),
      prisma.sellerProfile.update({
        where: { id: profile.id },
        data: { kycStatus: result.status, payoutsEnabled },
      }),
    ]);
    await audit(auth.id, 'seller.kyc.status', 'SellerProfile', profile.id, {
      status: result.status,
    });
    return { status: result.status, payoutsEnabled };
  });

  // Attach a payout bank account (token only).
  app.put('/seller/bank-account', async (req) => {
    const auth = requireAuth(req);
    const profile = await getProfile(auth.id);
    const body = parse(bankSchema, req.body);

    await prisma.bankAccount.upsert({
      where: { sellerProfileId: profile.id },
      create: { sellerProfileId: profile.id, ...body },
      update: body,
    });
    const payoutsEnabled = profile.kycStatus === 'VERIFIED';
    await prisma.sellerProfile.update({
      where: { id: profile.id },
      data: { payoutsEnabled },
    });
    return { ok: true, payoutsEnabled };
  });

  app.get('/seller/profile', async (req) => {
    const auth = requireAuth(req);
    return getProfile(auth.id);
  });
}

async function getProfile(userId: string) {
  const profile = await prisma.sellerProfile.findUnique({
    where: { userId },
    include: { bankAccount: true, kycVerification: true },
  });
  if (!profile) throw notFound('Seller profile not found — onboard first');
  return profile;
}
