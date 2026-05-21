import type { TaxKind } from "@prisma/client";
import { prisma } from "../../db/client.js";

export interface TaxLine {
  taxRateBps: number;
  taxAmount: number;
  kind: TaxKind | null;
}

// Resolves the tax rate for a (destination country, category) pair.
// The platform is the marketplace facilitator: it must charge the buyer's
// destination-country VAT/GST and is liable for remitting it.
export async function resolveTaxRate(
  country: string,
  categoryId: string,
  at: Date = new Date(),
): Promise<{ rateBps: number; kind: TaxKind | null }> {
  const rate = await prisma.taxRate.findFirst({
    where: {
      country,
      // A category-specific rate wins over the country default.
      OR: [{ categoryId }, { categoryId: null }],
      effectiveFrom: { lte: at },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] }],
    },
    // Category-specific rows first.
    orderBy: { categoryId: { sort: "asc", nulls: "last" } },
  });
  return rate ? { rateBps: rate.rateBps, kind: rate.kind } : { rateBps: 0, kind: null };
}

// Computes tax on a taxable amount (minor units), rounded to the nearest unit.
export function applyTax(taxableAmount: number, rateBps: number): number {
  return Math.round((taxableAmount * rateBps) / 10000);
}

// Persists an immutable tax record for facilitator remittance reporting.
export async function recordTax(input: {
  checkoutId: string;
  country: string;
  kind: TaxKind;
  taxableAmount: number;
  taxAmount: number;
  currency: string;
}): Promise<void> {
  if (input.taxAmount <= 0) return;
  await prisma.taxRecord.create({ data: input });
}

// Remittance report: tax collected per country over a period, not yet remitted.
export async function remittanceReport(periodStart: Date, periodEnd: Date) {
  const records = await prisma.taxRecord.findMany({
    where: { createdAt: { gte: periodStart, lte: periodEnd }, remittedAt: null },
  });
  const byCountry = new Map<string, { kind: TaxKind; taxableAmount: number; taxAmount: number }>();
  for (const r of records) {
    const entry = byCountry.get(r.country) ?? { kind: r.kind, taxableAmount: 0, taxAmount: 0 };
    entry.taxableAmount += r.taxableAmount;
    entry.taxAmount += r.taxAmount;
    byCountry.set(r.country, entry);
  }
  return {
    periodStart,
    periodEnd,
    countries: [...byCountry.entries()].map(([country, v]) => ({ country, ...v })),
  };
}
