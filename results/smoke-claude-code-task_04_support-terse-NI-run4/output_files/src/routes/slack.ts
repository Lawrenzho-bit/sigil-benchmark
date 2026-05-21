import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, raw } from 'express';
import { config } from '../config';
import { logger } from '../logger';
import { unauthorized } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { findOrCreateCustomer } from '../services/customerService';
import { createTicket } from '../services/ticketService';

/**
 * Optional Slack channel. When SLACK_* env vars are set, this exposes a Slack
 * Events API endpoint: messages posted in the connected channel become
 * tickets. Disabled (404) when Slack is not configured.
 *
 * Requests are verified with Slack's signing-secret HMAC scheme, so the raw
 * body is needed — hence the route-local `raw()` body parser.
 */
export const slackRouter = Router();

/** Verify the `v0` Slack request signature over `timestamp:body`. */
function verifySlackSignature(req: {
  header(name: string): string | undefined;
  body: Buffer;
}): boolean {
  const timestamp = req.header('x-slack-request-timestamp');
  const signature = req.header('x-slack-signature');
  if (!timestamp || !signature) return false;
  // Reject replays older than 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const base = `v0:${timestamp}:${req.body.toString('utf8')}`;
  const expected =
    'v0=' + createHmac('sha256', config.slack.signingSecret).update(base).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

slackRouter.post(
  '/events',
  raw({ type: '*/*' }),
  asyncHandler(async (req, res) => {
    if (!config.slack.enabled) {
      res.status(404).json({ error: { code: 'not_found', message: 'Slack integration disabled' } });
      return;
    }
    if (!verifySlackSignature(req as never)) throw unauthorized('Bad Slack signature');

    const payload = JSON.parse((req.body as Buffer).toString('utf8'));

    // URL verification handshake when configuring the Events API.
    if (payload.type === 'url_verification') {
      res.json({ challenge: payload.challenge });
      return;
    }

    // A user message in the connected channel → new ticket.
    const event = payload.event;
    if (event?.type === 'message' && !event.bot_id && !event.subtype) {
      // Slack only gives us a user id; synthesise a stable pseudo-email.
      const customer = await findOrCreateCustomer(
        `slack-${event.user}@${config.supportDomain}`,
        `Slack user ${event.user}`,
      );
      await createTicket(
        {
          subject: `Slack: ${String(event.text ?? '').slice(0, 80)}`,
          body: event.text ?? '(empty Slack message)',
          customerId: customer.id,
          channel: 'slack',
        },
        { kind: 'customer', id: customer.id },
      );
      logger.info({ slackUser: event.user }, 'created ticket from Slack message');
    }
    // Slack expects a fast 200 ack.
    res.status(200).end();
  }),
);

export default slackRouter;
