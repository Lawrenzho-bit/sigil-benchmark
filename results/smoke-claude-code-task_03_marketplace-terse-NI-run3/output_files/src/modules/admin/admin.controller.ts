import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class ReportDto {
  @ApiProperty()
  @IsString()
  listingId!: string;

  @ApiProperty()
  @IsString()
  @Length(5, 1000)
  reason!: string;
}

class ModerationDecisionDto {
  @ApiProperty({ enum: ['ACTIONED', 'DISMISSED'] })
  @IsIn(['ACTIONED', 'DISMISSED'])
  action!: 'ACTIONED' | 'DISMISSED';

  @ApiProperty({ description: 'DSA Art. 17 statement of reasons' })
  @IsString()
  @Length(5, 4000)
  statementOfReasons!: string;
}

class FraudDecisionDto {
  @ApiProperty({ enum: ['CLEARED', 'CONFIRMED'] })
  @IsIn(['CLEARED', 'CONFIRMED'])
  decision!: 'CLEARED' | 'CONFIRMED';

  @ApiProperty()
  @IsString()
  @Length(1, 2000)
  notes!: string;
}

class SuspendDto {
  @ApiProperty()
  @IsString()
  @Length(5, 1000)
  reason!: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  // --- Moderation ---
  @Get('moderation')
  moderationQueue(@Query('status') status?: string) {
    return this.admin.listModerationQueue(status);
  }

  @Post('moderation/:flagId/decide')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('flagId') flagId: string,
    @Body() dto: ModerationDecisionDto,
  ) {
    return this.admin.decideModeration(user.id, flagId, dto.action, dto.statementOfReasons);
  }

  // --- Fraud ---
  @Get('fraud')
  fraudCases(@Query('status') status?: string) {
    return this.admin.listFraudCases(status);
  }

  @Post('fraud/:caseId/review')
  reviewFraud(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body() dto: FraudDecisionDto,
  ) {
    return this.admin.reviewFraudCase(user.id, caseId, dto.decision, dto.notes);
  }

  // --- Account actions ---
  @Post('sellers/:sellerId/suspend')
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('sellerId') sellerId: string,
    @Body() dto: SuspendDto,
  ) {
    return this.admin.suspendSeller(user.id, sellerId, dto.reason);
  }
}

/** Public endpoint for buyers/sellers to report a listing (DSA notice). */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly admin: AdminService) {}

  @Post()
  report(@CurrentUser() user: AuthUser, @Body() dto: ReportDto) {
    return this.admin.reportListing(user.id, dto.listingId, dto.reason);
  }
}
