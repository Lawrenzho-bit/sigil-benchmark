/**
 * Seed script — creates a demo organization with one user per role.
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 12);

  const org = await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Inc.",
      slug: "acme",
      plan: "PRO",
      subscriptionStatus: "ACTIVE",
      timezone: "America/New_York",
    },
  });

  const seedUsers = [
    { email: "owner@acme.test", name: "Olivia Owner", role: "OWNER" as const },
    { email: "admin@acme.test", name: "Adam Admin", role: "ADMIN" as const },
    { email: "viewer@acme.test", name: "Vera Viewer", role: "VIEWER" as const },
  ];

  for (const u of seedUsers) {
    await prisma.user.upsert({
      where: { organizationId_email: { organizationId: org.id, email: u.email } },
      update: {},
      create: {
        organizationId: org.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: "ACTIVE",
        passwordHash,
      },
    });
  }

  console.log("Seeded organization 'Acme Inc.' (slug: acme)");
  console.log("Login with owner@acme.test / admin@acme.test / viewer@acme.test");
  console.log("Password for all: Password123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
