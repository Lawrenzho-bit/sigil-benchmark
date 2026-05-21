import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class AddItemDto {
  @ApiProperty()
  @IsUUID()
  listingId!: string;

  @ApiProperty({ default: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

class UpdateQtyDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  quantity!: number;
}

@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.cart.getCart(user.id);
  }

  @Post('items')
  add(@CurrentUser() user: AuthUser, @Body() dto: AddItemDto) {
    return this.cart.addItem(user.id, dto.listingId, dto.quantity);
  }

  @Patch('items/:listingId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Body() dto: UpdateQtyDto,
  ) {
    return this.cart.updateQuantity(user.id, listingId, dto.quantity);
  }

  @Delete('items/:listingId')
  remove(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    return this.cart.removeItem(user.id, listingId);
  }

  @Delete()
  clear(@CurrentUser() user: AuthUser) {
    return this.cart.clear(user.id);
  }
}
