// Single shared PrismaClient. Prisma pools connections internally; one client
// per process is the documented pattern.
import { PrismaClient } from '@prisma/client';
import { isProd } from './config.js';

export const prisma = new PrismaClient({
  log: isProd ? ['warn', 'error'] : ['query', 'warn', 'error'],
});

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
