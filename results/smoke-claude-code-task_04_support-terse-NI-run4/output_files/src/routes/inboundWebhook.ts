import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';
import { unauthorized } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { handleInboundEmail } from '../email/inbound';
import { fromWebhookPayload, parseRawEmail } from '../email/parser';

/**
 * Inbound email webhook. The mail provider (SES/SendGrid/Postmark/…) posts
 * here after it has received a message and verified SPF/DKIM/DMARC.
 */
export const inboundWebhookRouter = Router();

/** Constant-time shared-secret check on the webhook token. */
function validSecret(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(config.inboundWebhookSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const jsonPayload = z.object({
  from: z.string().email(),
  fromName: z.string().optional(),
  to: z.array(z.string()).optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  messageId: z.string().optional(),
  inReplyTo: z.string().optional(),
});

/**
 * Accepts either a parsed JSON payload (Content-Type: application/json) or a
 * raw RFC822 message (Content-Type: message/rfc822 or text/plain).
 */
inboundWebhookRouter.post(
  '/inbound-email',
  asyncHandler(async (req, res) => {
    if (!validSecret(req.header('x-webhook-secret'))) {
      throw unauthorized('Invalid webhook secret');
    }

    const contentType = req.header('content-type') ?? '';
    const parsed =
      contentType.includes('rfc822') || Buffer.isBuffer(req.body)
        ? await parseRawEmail(req.body as Buffer)
        : fromWebhookPayload(jsonPayload.parse(req.body));

    const result = await handleInboundEmail(parsed);
    res.status(result.created ? 201 : 200).json({
      ticketId: result.ticket.id,
      created: result.created,
      duplicate: result.duplicate,
    });
  }),
);

export default inboundWebhookRouter;
