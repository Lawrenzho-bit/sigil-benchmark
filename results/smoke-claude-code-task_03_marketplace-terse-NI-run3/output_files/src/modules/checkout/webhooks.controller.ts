import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { StripeService } from '../stripe/stripe.service';
import { CheckoutService } from './checkout.service';
import { SellersService } from '../sellers/sellers.service';

/**
 * Stripe webhook endpoints. Signatures are verified against the configured
 * signing secrets; `main.ts`/the module registers a raw-body parser for these
 * routes so the payload hash matches.
 */
@ApiExcludeController()
@Controller('webhooks/stripe')
export class StripeWebhooksController {
  constructor(
    private readonly stripe: StripeService,
    private readonly checkout: CheckoutService,
    private readonly sellers: SellersService,
  ) {}

  /** Payment lifecycle events. */
  @Post('payments')
  @HttpCode(200)
  async payments(@Req() req: Request, @Headers('stripe-signature') sig: string) {
    const event = this.verify(req, sig, 'STRIPE_WEBHOOK_SECRET');

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as { id: string };
        await this.checkout.handlePaymentSucceeded(pi.id, event.id);
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as { id: string };
        await this.checkout.handlePaymentFailed(pi.id, event.id);
        break;
      }
    }
    return { received: true };
  }

  /** Connected-account events — drives seller KYC state. */
  @Post('connect')
  @HttpCode(200)
  async connect(@Req() req: Request, @Headers('stripe-signature') sig: string) {
    const event = this.verify(req, sig, 'STRIPE_CONNECT_WEBHOOK_SECRET');

    if (event.type === 'account.updated') {
      await this.sellers.syncFromStripeAccount(event.data.object as any);
    }
    return { received: true };
  }

  private verify(req: Request, sig: string, secretKey: string) {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw || !sig) throw new BadRequestException('Missing webhook signature/body');
    try {
      return this.stripe.constructEvent(raw, sig, secretKey);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }
  }
}
