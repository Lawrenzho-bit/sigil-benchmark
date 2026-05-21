/**
 * Development seed: category tree + an admin account.
 * Run with `npm run prisma:seed`.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const CATEGORIES: { slug: string; name: string; children?: { slug: string; name: string }[] }[] = [
  {
    slug: 'electronics',
    name: 'Electronics',
    children: [
      { slug: 'phones', name: 'Phones & Accessories' },
      { slug: 'computers', name: 'Computers & Laptops' },
      { slug: 'audio', name: 'Audio & Headphones' },
    ],
  },
  {
    slug: 'home',
    name: 'Home & Garden',
    children: [
      { slug: 'furniture', name: 'Furniture' },
      { slug: 'kitchen', name: 'Kitchen' },
    ],
  },
  {
    slug: 'fashion',
    name: 'Fashion',
    children: [
      { slug: 'clothing', name: 'Clothing' },
      { slug: 'shoes', name: 'Shoes' },
    ],
  },
  { slug: 'collectibles', name: 'Collectibles & Art' },
];

async function main() {
  for (const top of CATEGORIES) {
    const parent = await prisma.category.upsert({
      where: { slug: top.slug },
      update: {},
      create: { slug: top.slug, name: top.name },
    });
    for (const child of top.children ?? []) {
      await prisma.category.upsert({
        where: { slug: child.slug },
        update: {},
        create: { slug: child.slug, name: child.name, parentId: parent.id },
      });
    }
  }
  console.log(`Seeded ${CATEGORIES.length} top-level categories`);

  const adminEmail = 'admin@marketplace.local';
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      displayName: 'Platform Admin',
      role: 'ADMIN',
      emailVerified: true,
      passwordHash: await argon2.hash('ChangeMe-admin-123', { type: argon2.argon2id }),
    },
  });
  console.log(`Seeded admin account: ${adminEmail} / ChangeMe-admin-123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
