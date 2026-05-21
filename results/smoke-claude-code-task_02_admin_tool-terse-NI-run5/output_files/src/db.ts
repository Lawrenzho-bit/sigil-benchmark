import { PrismaClient } from '@prisma/client';
import { config } from './config';

// Single shared Prisma client for the process.
export const prisma = new PrismaClient({
  log: config.isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
