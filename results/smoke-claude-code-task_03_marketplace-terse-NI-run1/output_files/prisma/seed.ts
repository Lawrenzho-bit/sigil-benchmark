import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const TOP_CATEGORIES = [
  { name: "Electronics", slug: "electronics" },
  { name: "Home & Garden", slug: "home-garden" },
  { name: "Fashion", slug: "fashion" },
  { name: "Collectibles", slug: "collectibles" },
  { name: "Books", slug: "books" },
  { name: "Sports & Outdoors", slug: "sports" },
];

async function main() {
  for (const c of TOP_CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
  }

  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@marketplace.local";
  const adminPass = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "change-me-on-first-login";

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      displayName: "Platform Admin",
      passwordHash: await argon2.hash(adminPass),
      roles: ["ADMIN", "BUYER"],
      emailVerifiedAt: new Date(),
    },
  });

  // eslint-disable-next-line no-console
  console.log("Seed complete. Admin:", adminEmail);
}

main().finally(() => prisma.$disconnect());
