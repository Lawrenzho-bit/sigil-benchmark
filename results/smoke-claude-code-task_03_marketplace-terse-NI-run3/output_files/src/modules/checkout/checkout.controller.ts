import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('checkout')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * Creates the orders and returns a Stripe PaymentIntent client secret.
   * The client confirms payment with Stripe.js (card data never hits our API
   * — PCI DSS SAQ-A).
   */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.checkout.createCheckout(user.id, dto);
  }
}
