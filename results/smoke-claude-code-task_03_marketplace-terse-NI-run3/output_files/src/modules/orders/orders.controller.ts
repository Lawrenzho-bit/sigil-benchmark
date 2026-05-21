import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class ShipDto {
  @ApiProperty()
  @IsString()
  carrier!: string;

  @ApiProperty()
  @IsString()
  trackingNumber!: string;
}

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Buyer: my checkouts. */
  @Get()
  myOrders(@CurrentUser() user: AuthUser) {
    return this.orders.listForBuyer(user.id);
  }

  /** Seller: orders to fulfil. */
  @Get('seller')
  @UseGuards(RolesGuard)
  @Roles('SELLER')
  sellerOrders(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.orders.listForSeller(user.id, status);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.getOrder(user.id, id);
  }

  @Post(':id/ship')
  @UseGuards(RolesGuard)
  @Roles('SELLER')
  ship(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ShipDto) {
    return this.orders.markShipped(user.id, id, dto.carrier, dto.trackingNumber);
  }

  @Post(':id/confirm-delivery')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.confirmDelivery(user.id, id);
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('SELLER')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.cancel(user.id, id);
  }
}
