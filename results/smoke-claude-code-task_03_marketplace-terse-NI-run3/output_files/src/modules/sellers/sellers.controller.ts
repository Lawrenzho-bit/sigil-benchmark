import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';
import { SellersService } from './sellers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class StartOnboardingDto {
  @ApiProperty()
  @IsString()
  @Length(2, 120)
  businessName!: string;

  @ApiProperty({ enum: ['individual', 'company'] })
  @IsIn(['individual', 'company'])
  businessType!: string;
}

@ApiTags('sellers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sellers')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  /** Become a seller — creates profile + Stripe Connect account. */
  @Post('onboarding')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartOnboardingDto) {
    return this.sellers.startOnboarding(user.id, dto.businessName, dto.businessType);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.sellers.getMyProfile(user.id);
  }

  /** Re-issue the hosted KYC onboarding link. */
  @Get('me/onboarding/link')
  async link(@CurrentUser() user: AuthUser) {
    const profile = await this.sellers.getMyProfile(user.id);
    return this.sellers.onboardingLink(profile.id);
  }
}
