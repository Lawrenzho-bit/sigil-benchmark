/**
 * Seeds reference + demo data. Safe to run repeatedly (idempotent upserts).
 *
 * Creates: a baseline set of feature flags, a handful of demo organizations
 * with end users, and — only when AUTH_DEV_MODE=true — a dev SUPER_ADMIN so
 * the tool is usable locally without a real IdP.
 */
import { PrismaClient, AdminRole, SsoProvider, OrgStatus, EndUserStatus } from '@prisma/client';

const prisma = new PrismaClient();

const FLAGS = [
  { key: 'new-billing-ui', description: 'Revamped billing screens.' },
  { key: 'bulk-export-v2', description: 'Streaming CSV export pipeline.' },
  { key: 'ai-suggestions', description: 'In-product AI suggestions.' },
  { key: 'sso-enforcement', description: 'Force SSO for all org members.' },
  { key: 'dark-mode', description: 'Dark theme for the customer app.' },
];

const ORGS = [
  { name: 'Northwind Trading', slug: 'northwind', plan: 'enterprise', status: OrgStatus.ACTIVE, region: 'us-east', seats: 200 },
  { name: 'Globex Corp', slug: 'globex', plan: 'business', status: OrgStatus.ACTIVE, region: 'eu-west', seats: 80 },
  { name: 'Initech', slug: 'initech', plan: 'free', status: OrgStatus.SUSPENDED, region: 'us-west', seats: 5 },
  { name: 'Hooli', slug: 'hooli', plan: 'enterprise', status: OrgStatus.ACTIVE, region: 'us-west', seats: 500 },
  { name: 'Stark Industries', slug: 'stark', plan: 'business', status: OrgStatus.CHURNED, region: 'us-east', seats: 40 },
];

async function main() {
  for (const f of FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: { description: f.description },
      create: f,
    });
  }
  console.log(`seeded ${FLAGS.length} feature flags`);

  for (const o of ORGS) {
    const org = await prisma.organization.upsert({
      where: { slug: o.slug },
      update: { name: o.name, plan: o.plan, status: o.status, region: o.region, seats: o.seats },
      create: o,
    });
    // Three end users per org.
    for (let i = 1; i <= 3; i++) {
      const email = `user${i}@${o.slug}.example.com`;
      await prisma.endUser.upsert({
        where: { orgId_email: { orgId: org.id, email } },
        update: {},
        create: {
          orgId: org.id,
          email,
          name: `${o.name} User ${i}`,
          status: i === 3 ? EndUserStatus.INVITED : EndUserStatus.ACTIVE,
          orgRole: i === 1 ? 'owner' : 'member',
        },
      });
    }
  }
  console.log(`seeded ${ORGS.length} organizations with end users`);

  if (process.env.AUTH_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    const email = (process.env.SUPER_ADMIN_EMAILS || 'dev@example.com').split(',')[0].trim();
    await prisma.adminUser.upsert({
      where: { email },
      update: { role: AdminRole.SUPER_ADMIN, isActive: true },
      create: {
        email,
        name: 'Dev Super Admin',
        role: AdminRole.SUPER_ADMIN,
        ssoProvider: SsoProvider.DEV,
        ssoSubject: `dev|${email}`,
      },
    });
    console.log(`seeded dev SUPER_ADMIN: ${email}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
