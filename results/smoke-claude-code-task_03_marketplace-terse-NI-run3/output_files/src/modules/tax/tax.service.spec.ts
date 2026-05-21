import { ConfigService } from '@nestjs/config';
import { TaxService } from './tax.service';

/**
 * Unit tests for the marketplace-facilitator tax calculation. These exercise
 * the static-rate fallback path (Stripe Tax disabled).
 */
describe('TaxService', () => {
  const service = new TaxService(new ConfigService());

  it('applies the destination-country VAT rate', () => {
    const result = service.calculate('DE', 10_000);
    expect(result.taxType).toBe('VAT');
    expect(result.ratePct).toBe(19);
    expect(result.taxCents).toBe(1_900);
    expect(result.facilitatorLiable).toBe(true);
  });

  it('applies GST for non-EU GST jurisdictions', () => {
    const result = service.calculate('au', 20_000);
    expect(result.taxType).toBe('GST');
    expect(result.taxCents).toBe(2_000);
  });

  it('collects nothing for an unknown jurisdiction but stays facilitator-liable', () => {
    const result = service.calculate('XX', 5_000);
    expect(result.taxCents).toBe(0);
    expect(result.facilitatorLiable).toBe(true);
  });

  it('rounds tax to the nearest minor unit', () => {
    // 23% of 1_333 = 306.59 -> 307
    const result = service.calculate('IE', 1_333);
    expect(result.taxCents).toBe(307);
  });
});
