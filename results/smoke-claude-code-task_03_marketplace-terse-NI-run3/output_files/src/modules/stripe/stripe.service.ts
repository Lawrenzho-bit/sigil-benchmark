import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Thin wrapper around the Stripe SDK. Centralising it keeps PCI scope minimal:
 * the platform is SAQ-A — card data is entered directly into Stripe.js /
 * Stripe Checkout and never transits or rests on our infrastructure.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  readonly client: Stripe;
  readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.enabled = !!key;
    // A dummy key keeps DI happy in dev/test; calls will fail loudly if used.
    this.client = new Stripe(key || 'sk_test_disabled', { apiVersion: '2024-04-10' });
    if (!this.enabled) this.logger.warn('Stripe not configured — payment paths disabled');
  }

  platformFeeBps(): number {
    return this.config.get<number>('PLATFORM_FEE_BPS', 1000);
  }

  /** Commission the platform takes on a gross amount, in minor units. */
  computePlatformFee(grossCents: number): number {
    return Math.round((grossCents * this.platformFeeBps()) / 10_000);
  }

  /** Create an Express Connect account for seller onboarding/KYC. */
  createConnectAccount(email: string, country: string) {
    return this.client.accounts.create({
      type: 'express',
      email,
      country,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
  }

  /** Hosted onboarding link — collects identity + bank details (KYC). */
  createAccountOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string) {
    return this.client.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
  }

  /** Verify a webhook signature against the configured signing secret. */
  constructEvent(rawBody: Buffer, signature: string, secretKey: string): Stripe.Event {
    const secret = this.config.get<string>(secretKey)!;
    return this.client.webhooks.constructEvent(rawBody, signature, secret);
  }
}
