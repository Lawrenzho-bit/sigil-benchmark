/**
 * Seed a demo org with one owner. Idempotent: re-running updates the
 * password rather than erroring. Intended for local/dev only.
 *
 *   SEED_OWNER_EMAIL=you@example.com SEED_OWNER_PASSWORD=... npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const email = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com")
    .trim()
    .toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error(
      "Set SEED_OWNER_PASSWORD to at least 12 characters before seeding.",
    );
  }

  const org = await db.organization.upsert({
    where: { id: "seed-org" },
    create: { id: "seed-org", name: "Demo Org" },
    update: {},
  });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.upsert({
    where: { email },
    create: { email, passwordHash, name: "Owner" },
    update: { passwordHash, isActive: true },
  });

  await db.membership.upsert({
    where: { userId: user.id },
    create: { userId: user.id, orgId: org.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded org "${org.name}" with owner ${email}`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
