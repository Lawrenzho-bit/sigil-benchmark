import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TaxCalculation {
  jurisdiction: string;
  taxType: 'VAT' | 'GST' | 'SALES_TAX';
  ratePct: number;
  taxableCents: number;
  taxCents: number;
  facilitatorLiable: boolean;
}

/**
 * Marketplace-facilitator tax. Under EU VAT (and many GST regimes) the
 * marketplace is the deemed supplier to the consumer and must collect and
 * remit destination-country tax.
 *
 * Production should delegate to Stripe Tax (STRIPE_TAX_ENABLED) for accurate,
 * audited, jurisdiction-aware rates and registration thresholds. The static
 * table below is a safe fallback so checkout never silently under-collects.
 */
@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  // Destination-country standard rates. Extend / replace with Stripe Tax.
  private static readonly VAT_RATES: Record<string, number> = {
    IE: 23, DE: 19, FR: 20, ES: 21, IT: 22, NL: 21, BE: 21, AT: 20,
    PL: 23, SE: 25, DK: 25, FI: 24, PT: 23, GB: 20,
  };
  private static readonly GST_RATES: Record<string, number> = {
    AU: 10, NZ: 15, CA: 5, SG: 9,
  };

  constructor(private readonly config: ConfigService) {}

  /**
   * Compute tax for a checkout shipping to `destinationCountry`.
   * @param taxableCents pre-tax order subtotal in minor units.
   */
  calculate(destinationCountry: string, taxableCents: number): TaxCalculation {
    const country = destinationCountry.toUpperCase();

    const vat = TaxService.VAT_RATES[country];
    if (vat != null) {
      return this.build(country, 'VAT', vat, taxableCents);
    }
    const gst = TaxService.GST_RATES[country];
    if (gst != null) {
      return this.build(country, 'GST', gst, taxableCents);
    }

    // Unknown jurisdiction: collect nothing, but flag for finance review.
    this.logger.warn(`No tax rate for ${country}; collecting 0 — review registration`);
    return {
      jurisdiction: country,
      taxType: 'SALES_TAX',
      ratePct: 0,
      taxableCents,
      taxCents: 0,
      facilitatorLiable: true,
    };
  }

  private build(
    jurisdiction: string,
    taxType: TaxCalculation['taxType'],
    ratePct: number,
    taxableCents: number,
  ): TaxCalculation {
    return {
      jurisdiction,
      taxType,
      ratePct,
      taxableCents,
      taxCents: Math.round((taxableCents * ratePct) / 100),
      facilitatorLiable: true,
    };
  }
}
