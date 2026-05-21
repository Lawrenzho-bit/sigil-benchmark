/**
 * Development seed. Creates one demo organization with an Owner, Admin and
 * Viewer so you can exercise every role immediately after `db:migrate:dev`.
 *
 *   npm run db:seed
 *
 * Do NOT run this against production.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash('demo-password-1234', {
    type: argon2.argon2id,
  });

  const org = await prisma.organization.upsert({
    where: { domain: 'demo.example.com' },
    update: {},
    create: {
      name: 'Demo Corporation',
      domain: 'demo.example.com',
      plan: 'PRO',
      subscriptionStatus: 'ACTIVE',
    },
  });

  const people = [
    { email: 'owner@demo.example.com', name: 'Olivia Owner', role: 'OWNER' as const },
    { email: 'admin@demo.example.com', name: 'Adam Admin', role: 'ADMIN' as const },
    { email: 'viewer@demo.example.com', name: 'Vera Viewer', role: 'VIEWER' as const },
  ];

  for (const p of people) {
    await prisma.user.upsert({
      where: { orgId_email: { orgId: org.id, email: p.email } },
      update: {},
      create: {
        orgId: org.id,
        email: p.email,
        name: p.name,
        role: p.role,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
  }

  console.log('Seed complete. All demo users share password: demo-password-1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
