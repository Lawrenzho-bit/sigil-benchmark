import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { passwordSchema, hashPassword, isBreached } from '@/lib/password';
import { createSession } from '@/lib/session';
import { audit } from '@/lib/audit';
import { sendWelcomeEmail } from '@/lib/email';
import { clientIp, userAgent } from '@/lib/http';
import { consume } from '@/lib/rate-limit';

const bodySchema = z.object({
  orgName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email().max(254).toLowerCase(),
  password: passwordSchema,
});

/**
 * Self-service signup: creates a new Organization and its first user as OWNER.
 * The org + user + audit entry are written in one transaction so a partial
 * org can never exist.
 */
export const POST = handleRoute(async (req) => {
  const ip = clientIp(req);

  // Rate limit signups per IP to blunt automated abuse.
  const rl = await consume('register', ip, 10, 3600);
  if (!rl.allowed) throw Errors.rateLimited();

  const body = bodySchema.parse(await req.json());

  if (await isBreached(body.password)) {
    throw Errors.badRequest(
      'This password has appeared in a known data breach. Choose another.',
    );
  }

  const existing = await prisma.user.findFirst({
    where: { email: body.email },
    select: { id: true },
  });
  // Generic message — do not reveal whether an email is already registered.
  if (existing) {
    throw Errors.conflict('Could not create account with these details.');
  }

  const passwordHash = await hashPassword(body.password);

  const user = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: body.orgName },
    });
    const created = await tx.user.create({
      data: {
        orgId: org.id,
        email: body.email,
        name: body.name,
        passwordHash,
        role: 'OWNER',
        emailVerifiedAt: new Date(), // self-signup proves control at first login
      },
    });
    await audit(
      {
        orgId: org.id,
        actorId: created.id,
        actorEmail: created.email,
        action: 'organization.created',
        targetType: 'organization',
        targetId: org.id,
        ip,
      },
      tx,
    );
    return created;
  });

  await createSession(user.id, ip, userAgent(req));
  await sendWelcomeEmail(user.email, body.name);

  return NextResponse.json(
    { id: user.id, email: user.email, role: user.role },
    { status: 201 },
  );
});
