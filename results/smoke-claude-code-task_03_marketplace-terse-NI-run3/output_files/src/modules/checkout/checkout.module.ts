import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { StripeWebhooksController } from './webhooks.controller';
import { CheckoutService } from './checkout.service';
import { TaxModule } from '../tax/tax.module';
import { CartModule } from '../cart/cart.module';
import { SellersModule } from '../sellers/sellers.module';

@Module({
  imports: [TaxModule, CartModule, SellersModule],
  controllers: [CheckoutController, StripeWebhooksController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
