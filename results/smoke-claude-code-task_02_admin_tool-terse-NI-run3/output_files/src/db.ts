/** Shared Prisma client. A single instance is reused across the process. */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
