import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from '../logger';
import { replyAddress, subjectTag } from './parser';

/**
 * Outbound mail. SPF/DKIM/DMARC are enforced at the SMTP relay configured via
 * SMTP_* — this module just hands well-formed messages to that relay.
 */
let transporter: Transporter | null = null;

function getTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

interface OutboundReply {
  ticketId: number;
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  /** Message-Id of the customer mail we're replying to, for threading. */
  inReplyTo?: string | null;
}

/**
 * Send an agent reply as an email.
 *
 * The From/Reply-To uses plus-addressing (`support+<id>@`) and the subject
 * carries a `[#id]` tag, so the customer's reply is routed back to the same
 * ticket by src/email/parser.ts → extractTicketRef.
 */
export async function sendTicketReply(reply: OutboundReply): Promise<void> {
  const from = replyAddress(reply.ticketId);
  const subject = reply.subject.includes(subjectTag(reply.ticketId))
    ? reply.subject
    : `${reply.subject} ${subjectTag(reply.ticketId)}`;

  try {
    await getTransport().sendMail({
      from: `Support <${from}>`,
      replyTo: from,
      to: reply.to,
      subject,
      text: reply.text,
      html: reply.html ?? undefined,
      inReplyTo: reply.inReplyTo ?? undefined,
      references: reply.inReplyTo ?? undefined,
    });
    logger.info({ ticketId: reply.ticketId, to: reply.to }, 'ticket reply sent');
  } catch (err) {
    // Surface to the caller — a failed customer reply must not be silent.
    logger.error({ err, ticketId: reply.ticketId }, 'failed to send ticket reply');
    throw err;
  }
}

/** Email the CSAT survey link to the customer after resolution. */
export async function sendCsatEmail(to: string, ticketId: number, url: string): Promise<void> {
  try {
    await getTransport().sendMail({
      from: `Support <${config.supportFromAddress}>`,
      to,
      subject: `How did we do? ${subjectTag(ticketId)}`,
      text: `Your support ticket #${ticketId} was resolved.\n\nWe'd love your feedback — rate your experience here:\n${url}\n\nThank you.`,
    });
  } catch (err) {
    logger.error({ err, ticketId }, 'failed to send CSAT email');
  }
}

/** Notify an agent (or a fallback inbox) that a ticket has breached SLA. */
export async function sendBreachAlert(
  to: string,
  ticketId: number,
  kind: 'first_response' | 'resolution',
): Promise<void> {
  try {
    await getTransport().sendMail({
      from: `Support Alerts <${config.supportFromAddress}>`,
      to,
      subject: `[SLA BREACH] Ticket #${ticketId} — ${kind.replace('_', ' ')}`,
      text: `Ticket #${ticketId} has breached its ${kind.replace('_', ' ')} SLA target.\n\nOpen it: ${config.publicBaseUrl}/agent/tickets/${ticketId}`,
    });
  } catch (err) {
    logger.error({ err, ticketId }, 'failed to send SLA breach alert');
  }
}
