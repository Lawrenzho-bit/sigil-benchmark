import { PrismaClient, Role, BillingPlan, SubscriptionStatus } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = 'owner@example.com';
  const password = 'ChangeMe123!';

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const org = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: {},
    create: {
      name: 'Acme, Inc.',
      slug: 'acme',
      plan: BillingPlan.STARTER,
      subscriptionStatus: SubscriptionStatus.TRIALING,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: {
      email,
      name: 'Demo Owner',
      passwordHash,
      emailVerified: new Date(),
    },
  });

  await prisma.membership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: { role: Role.OWNER },
    create: { organizationId: org.id, userId: user.id, role: Role.OWNER },
  });

  console.log(`Seeded org "${org.slug}" with owner ${email} (password: ${password})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
