import { queryOne } from '../db';
import { logger } from '../logger';
import { findOrCreateCustomer } from '../services/customerService';
import { addMessage, createTicket, getTicket, Ticket } from '../services/ticketService';
import { ParsedInbound } from './parser';

export interface InboundResult {
  ticket: Ticket;
  created: boolean;
  /** True when the message was a duplicate delivery and was ignored. */
  duplicate: boolean;
}

/**
 * Turn a parsed inbound email into a ticket action.
 *
 *  - If it references an existing open ticket → append a customer reply.
 *  - Otherwise → open a new ticket.
 *
 * De-duplication: mail providers re-deliver, so a message whose RFC822
 * Message-Id we've already stored is silently skipped (the unique index on
 * ticket_messages.email_message_id is the backstop).
 */
export async function handleInboundEmail(parsed: ParsedInbound): Promise<InboundResult> {
  // 1. Duplicate delivery?
  if (parsed.messageId) {
    const seen = await queryOne<{ ticket_id: number }>(
      'SELECT ticket_id FROM ticket_messages WHERE email_message_id = $1',
      [parsed.messageId],
    );
    if (seen) {
      logger.info({ messageId: parsed.messageId }, 'inbound email already processed — skipping');
      return { ticket: await getTicket(seen.ticket_id), created: false, duplicate: true };
    }
  }

  const customer = await findOrCreateCustomer(parsed.fromEmail, parsed.fromName);

  // 2. Reply to an existing ticket?
  if (parsed.ticketRef) {
    const existing = await queryOne<Ticket>('SELECT * FROM tickets WHERE id = $1', [
      parsed.ticketRef,
    ]);
    if (existing) {
      // Follow a merge pointer so replies land on the surviving ticket.
      const targetId = existing.merged_into_id ?? existing.id;
      await addMessage({
        ticketId: targetId,
        authorType: 'customer',
        authorId: customer.id,
        body: parsed.cleanText,
        bodyHtml: parsed.html,
        channel: 'email',
        emailMessageId: parsed.messageId,
        emailInReplyTo: parsed.inReplyTo,
      });
      logger.info({ ticketId: targetId }, 'inbound email appended to existing ticket');
      return { ticket: await getTicket(targetId), created: false, duplicate: false };
    }
    logger.warn(
      { ticketRef: parsed.ticketRef },
      'inbound email referenced unknown ticket — opening a new one',
    );
  }

  // 3. New ticket.
  const ticket = await createTicket(
    {
      subject: parsed.subject,
      body: parsed.cleanText,
      bodyHtml: parsed.html,
      customerId: customer.id,
      channel: 'email',
      emailMessageId: parsed.messageId,
    },
    { kind: 'customer', id: customer.id },
  );
  logger.info({ ticketId: ticket.id }, 'inbound email opened a new ticket');
  return { ticket, created: true, duplicate: false };
}
