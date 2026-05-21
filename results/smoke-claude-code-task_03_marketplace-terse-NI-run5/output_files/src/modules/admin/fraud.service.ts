import { prisma } from "../../db/client.js";
import { NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

// Lightweight rule-based risk scoring. A production system would augment this
// with device fingerprinting, velocity checks and an ML model; the rules below
// give a deterministic baseline and a clear extension point.
interface RiskInput {
  accountAgeDays: number;
  checkoutAmount: number;
  ordersLast24h: number;
  buyerCountryMismatch: boolean;
}

export function scoreCheckoutRisk(input: RiskInput): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  if (input.accountAgeDays < 1) {
    score += 30;
    signals.push("account_under_24h");
  }
  if (input.checkoutAmount > 100000) {
    score += 25;
    signals.push("high_value_checkout");
  }
  if (input.ordersLast24h > 10) {
    score += 30;
    signals.push("order_velocity");
  }
  if (input.buyerCountryMismatch) {
    score += 15;
    signals.push("country_mismatch");
  }
  return { score: Math.min(100, score), signals };
}

// Raises a fraud review when the risk score crosses the threshold.
export async function flagIfRisky(
  subjectType: string,
  subjectId: string,
  input: RiskInput,
): Promise<void> {
  const { score, signals } = scoreCheckoutRisk(input);
  if (score < 50) return;
  await prisma.fraudReview.create({
    data: { subjectType, subjectId, riskScore: score, signals, status: "OPEN" },
  });
  logger.warn({ subjectType, subjectId, score, signals }, "Fraud review raised");
}

export async function listOpenFraudReviews() {
  return prisma.fraudReview.findMany({
    where: { status: "OPEN" },
    orderBy: { riskScore: "desc" },
  });
}

export async function resolveFraudReview(input: {
  adminId: string;
  reviewId: string;
  confirmed: boolean;
  resolution: string;
}) {
  const review = await prisma.fraudReview.findUnique({ where: { id: input.reviewId } });
  if (!review) throw NotFound("Fraud review not found");

  const updated = await prisma.fraudReview.update({
    where: { id: input.reviewId },
    data: {
      status: input.confirmed ? "CONFIRMED_FRAUD" : "CLEARED",
      resolution: input.resolution,
      resolvedAt: new Date(),
    },
  });
  await prisma.adminAction.create({
    data: {
      actorId: input.adminId,
      type: "RESOLVE_FRAUD",
      targetId: input.reviewId,
      note: input.resolution,
    },
  });
  return updated;
}
