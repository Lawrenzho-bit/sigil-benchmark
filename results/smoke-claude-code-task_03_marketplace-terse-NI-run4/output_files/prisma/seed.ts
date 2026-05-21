// Development seed: a category tree and an admin account. Run: npm run seed
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const CATEGORIES = [
  { slug: 'electronics', name: 'Electronics' },
  { slug: 'home-garden', name: 'Home & Garden' },
  { slug: 'fashion', name: 'Fashion' },
  { slug: 'collectibles', name: 'Collectibles' },
  { slug: 'sports', name: 'Sports & Outdoors' },
  { slug: 'books-media', name: 'Books & Media' },
];

async function main() {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
  }

  const adminEmail = 'admin@marketplace.local';
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'ADMIN' },
    create: {
      email: adminEmail,
      passwordHash: await argon2.hash('admin-change-me-now', { type: argon2.argon2id }),
      displayName: 'Platform Admin',
      role: 'ADMIN',
      emailVerified: true,
    },
  });

  console.log(`Seeded ${CATEGORIES.length} categories and 1 admin (${adminEmail}).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
