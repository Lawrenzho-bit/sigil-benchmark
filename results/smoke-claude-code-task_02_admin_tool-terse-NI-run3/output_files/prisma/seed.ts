/**
 * Seed script — populates feature flags and a small sample dataset so the
 * tool is browsable immediately after `prisma migrate`. Safe to run repeatedly
 * (uses upserts). It does NOT create admin users: those are provisioned via
 * SSO on first login (see src/auth/provision.ts).
 */
import { PrismaClient, OrgStatus, ManagedUserStatus } from '@prisma/client';

const prisma = new PrismaClient();

const FLAGS = [
  { key: 'new-billing-ui', description: 'Redesigned billing dashboard' },
  { key: 'bulk-export-v2', description: 'Streaming CSV export pipeline' },
  { key: 'ai-assist', description: 'In-app AI assistant' },
  { key: 'audit-retention-extended', description: '24-month audit retention' },
];

const ORGS = [
  { name: 'Acme Corp', slug: 'acme', plan: 'enterprise', status: OrgStatus.ACTIVE, seats: 240, mrrCents: 1_200_00 },
  { name: 'Globex', slug: 'globex', plan: 'pro', status: OrgStatus.ACTIVE, seats: 45, mrrCents: 450_00 },
  { name: 'Initech', slug: 'initech', plan: 'pro', status: OrgStatus.SUSPENDED, seats: 12, mrrCents: 0 },
  { name: 'Umbrella Labs', slug: 'umbrella', plan: 'free', status: OrgStatus.TRIAL, seats: 3, mrrCents: 0 },
];

async function main() {
  for (const flag of FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { description: flag.description },
      create: flag,
    });
  }

  for (const org of ORGS) {
    const created = await prisma.organization.upsert({
      where: { slug: org.slug },
      update: org,
      create: org,
    });

    // A couple of managed users per org.
    for (let i = 1; i <= 3; i++) {
      const email = `user${i}@${org.slug}.example.com`;
      await prisma.managedUser.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: `${org.name} User ${i}`,
          orgId: created.id,
          status: i === 3 ? ManagedUserStatus.SUSPENDED : ManagedUserStatus.ACTIVE,
        },
      });
    }
  }

  console.log('Seed complete:', {
    flags: FLAGS.length,
    orgs: ORGS.length,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
