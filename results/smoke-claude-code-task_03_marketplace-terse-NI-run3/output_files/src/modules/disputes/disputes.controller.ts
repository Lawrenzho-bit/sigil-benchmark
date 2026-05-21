import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { DisputesService } from './disputes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class OpenDisputeDto {
  @ApiProperty()
  @IsString()
  orderId!: string;

  @ApiProperty()
  @IsString()
  @Length(5, 1000)
  reason!: string;
}

class DisputeEventDto {
  @ApiProperty({ enum: ['comment', 'evidence'] })
  @IsIn(['comment', 'evidence'])
  type!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 4000)
  body!: string;
}

class ResolveDto {
  @ApiProperty({ enum: ['RESOLVED_REFUND', 'RESOLVED_RELEASE', 'RESOLVED_PARTIAL'] })
  @IsIn(['RESOLVED_REFUND', 'RESOLVED_RELEASE', 'RESOLVED_PARTIAL'])
  outcome!: 'RESOLVED_REFUND' | 'RESOLVED_RELEASE' | 'RESOLVED_PARTIAL';

  @ApiProperty()
  @IsString()
  @Length(1, 2000)
  note!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  refundAmountCents?: number;
}

@ApiTags('disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenDisputeDto) {
    return this.disputes.openDispute(user.id, dto.orderId, dto.reason);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.getDispute(user.id, id);
  }

  @Post(':id/events')
  addEvent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DisputeEventDto) {
    return this.disputes.addEvent(user.id, id, dto.type, dto.body);
  }

  @Post(':id/escalate')
  escalate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.escalate(user.id, id);
  }

  /** Admin-only final resolution. */
  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ResolveDto) {
    return this.disputes.resolve(user.id, id, dto.outcome, dto.note, dto.refundAmountCents);
  }
}
