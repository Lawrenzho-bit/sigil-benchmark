// Weekly payout worker. Runs as its own container/process and triggers the
// payout cycle once per day; the cycle itself only acts on the configured
// payout day-of-week. Designed to be safe to run more than once per day —
// `runWeeklyPayouts` is idempotent (orders already paid are skipped).
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../db/client.js";
import { runWeeklyPayouts } from "../modules/payouts/payouts.service.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function tick(): Promise<void> {
  const today = new Date().getDay();
  if (today !== env.PAYOUT_DAY_OF_WEEK) {
    logger.debug({ today, payoutDay: env.PAYOUT_DAY_OF_WEEK }, "Not payout day, skipping");
    return;
  }
  logger.info("Starting weekly payout cycle");
  const result = await runWeeklyPayouts();
  logger.info(result, "Weekly payout cycle complete");
}

async function main(): Promise<void> {
  logger.info({ payoutDay: env.PAYOUT_DAY_OF_WEEK }, "Payout worker started");
  // Run immediately on boot, then once per day. In a real deployment this
  // would typically be a Kubernetes CronJob instead of a long-lived loop.
  await tick().catch((err) => logger.error({ err }, "Payout tick failed"));
  setInterval(() => {
    tick().catch((err) => logger.error({ err }, "Payout tick failed"));
  }, ONE_DAY_MS);
}

main().catch(async (err) => {
  logger.error({ err }, "Payout worker crashed");
  await prisma.$disconnect();
  process.exit(1);
});
