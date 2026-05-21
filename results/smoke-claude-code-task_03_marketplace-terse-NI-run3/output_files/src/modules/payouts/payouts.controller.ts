import { Controller, Get, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payouts')
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Seller: my payout history. */
  @Get()
  @UseGuards(RolesGuard)
  @Roles('SELLER')
  async mine(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.sellerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new NotFoundException('Not a seller');
    return this.payouts.listForSeller(profile.id);
  }

  /** Admin: trigger the weekly payout run on demand. */
  @Post('run')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  run() {
    return this.payouts.runWeeklyPayouts();
  }
}
