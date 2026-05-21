import { Controller, Get } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness probe. */
  @Get()
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  /** Readiness probe — verifies the database is reachable. */
  @Get('ready')
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
