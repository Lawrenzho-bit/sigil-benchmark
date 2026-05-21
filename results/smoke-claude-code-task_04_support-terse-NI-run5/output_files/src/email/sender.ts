/**
 * Outbound email. Sends agent replies and notifications via SMTP.
 *
 * Threading: every outbound reply uses a plus-addressed Reply-To
 * (support+<number>@domain) and embeds [#<number>] in the subject, so a
 * customer's reply is reliably routed back to the originating ticket. SPF/DKIM/
 * DMARC are DNS/relay concerns and assumed configured for EMAIL_DOMAIN.
 */
import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from '../logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export interface OutboundReply {
  ticketNumber: number;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  /** Message-ID of the email being replied to, for In-Reply-To/References. */
  inReplyTo?: string | null;
  references?: string[];
}

export interface SentEmail {
  messageId: string;
  references: string[];
}

/** The plus-addressed inbound address that routes replies back to a ticket. */
export function replyAddressFor(ticketNumber: number): string {
  return `${config.INBOUND_ADDRESS_LOCALPART}+${ticketNumber}@${config.EMAIL_DOMAIN}`;
}

/** Ensure the subject carries the [#number] threading tag exactly once. */
export function taggedSubject(subject: string, ticketNumber: number): string {
  const tag = `[#${ticketNumber}]`;
  return subject.includes(tag) ? subject : `${subject} ${tag}`;
}

/** Send an outbound ticket reply. Returns the headers needed to store threading state. */
export async function sendReply(reply: OutboundReply): Promise<SentEmail> {
  const replyTo = replyAddressFor(reply.ticketNumber);
  const references = [...(reply.references ?? []), reply.inReplyTo].filter(
    (r): r is string => Boolean(r),
  );

  const info = await getTransporter().sendMail({
    from: `"${config.EMAIL_FROM_NAME}" <${replyTo}>`,
    to: reply.to,
    replyTo,
    subject: taggedSubject(reply.subject, reply.ticketNumber),
    text: reply.bodyText,
    html: reply.bodyHtml ?? undefined,
    inReplyTo: reply.inReplyTo ?? undefined,
    references: references.length ? references : undefined,
  });

  logger.info({ ticketNumber: reply.ticketNumber, messageId: info.messageId }, 'outbound email sent');
  return { messageId: info.messageId, references: [...references, info.messageId] };
}
