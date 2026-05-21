import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 12);

  const org = await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: { name: "Acme Inc", slug: "acme", plan: "STARTER" },
  });

  const seedUsers: Array<{ email: string; name: string; role: Role }> = [
    { email: "owner@acme.test", name: "Olivia Owner", role: "OWNER" },
    { email: "admin@acme.test", name: "Adam Admin", role: "ADMIN" },
    { email: "viewer@acme.test", name: "Vera Viewer", role: "VIEWER" },
  ];

  for (const u of seedUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
        emailVerified: new Date(),
        orgId: org.id,
      },
    });
  }

  console.log("Seed complete.");
  console.log("  Org:    Acme Inc (slug: acme)");
  console.log("  Logins (password for all): Password123!");
  for (const u of seedUsers) console.log(`    ${u.role.padEnd(7)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
