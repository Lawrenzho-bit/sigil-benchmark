import { PoolClient } from 'pg';
import { pool, query, queryOne, withTransaction } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { audit } from '../lib/audit';
import {
  AuthorType,
  Principal,
  TERMINAL_STATUSES,
  TicketChannel,
  TicketPriority,
  TicketStatus,
} from '../types';
import { applySlaPolicy, recordFirstResponse, recordResolution } from './slaService';

type Executor = Pick<PoolClient, 'query'>;

export interface Ticket {
  id: number;
  public_id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  customer_id: string;
  assignee_id: string | null;
  team_id: string | null;
  merged_into_id: number | null;
  split_from_id: number | null;
  first_response_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TicketMessage {
  id: string;
  ticket_id: number;
  author_type: AuthorType;
  author_id: string | null;
  body: string;
  body_html: string | null;
  is_internal_note: boolean;
  channel: TicketChannel;
  created_at: Date;
}

interface CreateTicketInput {
  subject: string;
  body: string;
  bodyHtml?: string | null;
  customerId: string;
  channel: TicketChannel;
  priority?: TicketPriority;
  teamId?: string | null;
  emailMessageId?: string | null;
  /** Lineage when this ticket is produced by a split. */
  splitFromId?: number | null;
}

/**
 * Create a ticket together with its opening message and SLA target.
 *
 * Runs in one transaction so a ticket never exists without its first message
 * or its SLA row. The opening message author is the customer (the ticket
 * always starts from their side, regardless of channel).
 */
export async function createTicket(
  input: CreateTicketInput,
  actor: Principal | undefined,
  ip?: string,
): Promise<Ticket> {
  if (!input.subject.trim()) throw badRequest('Subject is required');
  if (!input.body.trim()) throw badRequest('Body is required');

  const priority = input.priority ?? 'normal';

  return withTransaction(async (client) => {
    const ticket = (
      await client.query<Ticket>(
        `INSERT INTO tickets (subject, status, priority, channel, customer_id, team_id, split_from_id)
         VALUES ($1, 'new', $2, $3, $4,
                 COALESCE($5, (SELECT id FROM teams ORDER BY created_at LIMIT 1)),
                 $6)
         RETURNING *`,
        [
          input.subject.trim().slice(0, 500),
          priority,
          input.channel,
          input.customerId,
          input.teamId ?? null,
          input.splitFromId ?? null,
        ],
      )
    ).rows[0];

    await client.query(
      `INSERT INTO ticket_messages
         (ticket_id, author_type, author_id, body, body_html, is_internal_note, channel, email_message_id)
       VALUES ($1, 'customer', $2, $3, $4, false, $5, $6)`,
      [
        ticket.id,
        input.customerId,
        input.body,
        input.bodyHtml ?? null,
        input.channel,
        input.emailMessageId ?? null,
      ],
    );

    await applySlaPolicy(ticket.id, priority, client);
    await audit(
      {
        actorType: actor?.kind ?? 'customer',
        actorId: actor?.id ?? input.customerId,
        action: 'ticket.create',
        entityType: 'ticket',
        entityId: String(ticket.id),
        metadata: { channel: input.channel, priority },
        ip,
      },
      client,
    );
    return ticket;
  });
}

export async function getTicket(id: number): Promise<Ticket> {
  const row = await queryOne<Ticket>('SELECT * FROM tickets WHERE id = $1', [id]);
  if (!row) throw notFound('Ticket not found');
  return row;
}

export async function getTicketByPublicId(publicId: string): Promise<Ticket> {
  const row = await queryOne<Ticket>('SELECT * FROM tickets WHERE public_id = $1', [publicId]);
  if (!row) throw notFound('Ticket not found');
  return row;
}

/**
 * List ticket messages.
 *
 * `includeInternal` MUST be false for any customer-facing caller — internal
 * notes are agent-only. The portal routes always pass false.
 */
export async function listMessages(
  ticketId: number,
  includeInternal: boolean,
): Promise<TicketMessage[]> {
  return query<TicketMessage>(
    `SELECT * FROM ticket_messages
      WHERE ticket_id = $1
        AND ($2::boolean OR is_internal_note = false)
      ORDER BY created_at ASC`,
    [ticketId, includeInternal],
  );
}

interface AddMessageInput {
  ticketId: number;
  authorType: AuthorType;
  authorId: string | null;
  body: string;
  bodyHtml?: string | null;
  isInternalNote?: boolean;
  channel?: TicketChannel;
  emailMessageId?: string | null;
  emailInReplyTo?: string | null;
}

/**
 * Append a message to a ticket.
 *
 * Side effects, all inside one transaction:
 *  - a public agent reply records the SLA first-response time (once) and
 *    moves a 'new' ticket to 'open';
 *  - a customer reply re-opens a ticket that was 'pending'/'on_hold';
 *  - internal notes never affect SLA or status.
 */
export async function addMessage(input: AddMessageInput): Promise<TicketMessage> {
  if (!input.body.trim()) throw badRequest('Message body is required');
  const isNote = input.isInternalNote ?? false;
  if (isNote && input.authorType !== 'agent') {
    throw badRequest('Only agents can post internal notes');
  }

  return withTransaction(async (client) => {
    const ticket = (
      await client.query<Ticket>('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [
        input.ticketId,
      ])
    ).rows[0];
    if (!ticket) throw notFound('Ticket not found');
    if (ticket.merged_into_id) {
      throw conflict(`Ticket #${ticket.id} was merged into #${ticket.merged_into_id}`);
    }

    const message = (
      await client.query<TicketMessage>(
        `INSERT INTO ticket_messages
           (ticket_id, author_type, author_id, body, body_html, is_internal_note, channel,
            email_message_id, email_in_reply_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          input.ticketId,
          input.authorType,
          input.authorId,
          input.body,
          input.bodyHtml ?? null,
          isNote,
          input.channel ?? 'web',
          input.emailMessageId ?? null,
          input.emailInReplyTo ?? null,
        ],
      )
    ).rows[0];

    if (!isNote) {
      const now = message.created_at;
      if (input.authorType === 'agent') {
        if (!ticket.first_response_at) {
          await client.query('UPDATE tickets SET first_response_at = $2 WHERE id = $1', [
            ticket.id,
            now,
          ]);
          await recordFirstResponse(ticket.id, now, client);
        }
        if (ticket.status === 'new') {
          await client.query("UPDATE tickets SET status = 'open' WHERE id = $1", [ticket.id]);
        }
      } else if (input.authorType === 'customer') {
        // A customer reply on a paused/resolved ticket re-opens it.
        if (['pending', 'on_hold', 'resolved'].includes(ticket.status)) {
          await client.query("UPDATE tickets SET status = 'open' WHERE id = $1", [ticket.id]);
        }
      }
    }

    await audit(
      {
        actorType: input.authorType,
        actorId: input.authorId,
        action: isNote ? 'ticket.note' : 'ticket.reply',
        entityType: 'ticket',
        entityId: String(input.ticketId),
        metadata: { messageId: message.id },
      },
      client,
    );
    return message;
  });
}

interface UpdateTicketInput {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  teamId?: string | null;
}

/**
 * Update mutable ticket fields. A transition into 'resolved' stamps
 * resolved_at and stops the SLA resolution timer; 'closed' stamps closed_at.
 */
export async function updateTicket(
  ticketId: number,
  changes: UpdateTicketInput,
  actor: Principal,
  ip?: string,
): Promise<Ticket> {
  return withTransaction(async (client) => {
    const ticket = (
      await client.query<Ticket>('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId])
    ).rows[0];
    if (!ticket) throw notFound('Ticket not found');

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };

    if (changes.priority && changes.priority !== ticket.priority) {
      push('priority', changes.priority);
      // Re-baseline SLA targets to the new priority's policy.
      await applySlaPolicy(ticketId, changes.priority, client);
    }
    if (changes.assigneeId !== undefined) push('assignee_id', changes.assigneeId);
    if (changes.teamId !== undefined) push('team_id', changes.teamId);

    if (changes.status && changes.status !== ticket.status) {
      push('status', changes.status);
      const now = new Date();
      if (changes.status === 'resolved' && !ticket.resolved_at) {
        push('resolved_at', now);
        await recordResolution(ticketId, now, client);
      }
      if (changes.status === 'closed') {
        push('closed_at', now);
        if (!ticket.resolved_at) await recordResolution(ticketId, now, client);
      }
      // Re-opening clears the resolution stamp so reporting stays honest.
      if (!TERMINAL_STATUSES.includes(changes.status) && ticket.resolved_at) {
        push('resolved_at', null);
      }
    }

    if (sets.length === 0) return ticket;

    values.push(ticketId);
    const updated = (
      await client.query<Ticket>(
        `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values,
      )
    ).rows[0];

    await audit(
      {
        actorType: 'agent',
        actorId: actor.id,
        action: 'ticket.update',
        entityType: 'ticket',
        entityId: String(ticketId),
        metadata: { changes },
        ip,
      },
      client,
    );
    return updated;
  });
}

/**
 * Merge `sourceId` into `targetId`: move all messages to the target, then
 * close the source with a merged_into pointer. The source's customer must
 * match the target's — merging across customers would leak history.
 */
export async function mergeTickets(
  sourceId: number,
  targetId: number,
  actor: Principal,
  ip?: string,
): Promise<Ticket> {
  if (sourceId === targetId) throw badRequest('Cannot merge a ticket into itself');

  return withTransaction(async (client) => {
    // Lock both rows in a stable order to avoid deadlocks.
    const [lo, hi] = [Math.min(sourceId, targetId), Math.max(sourceId, targetId)];
    await client.query('SELECT id FROM tickets WHERE id IN ($1, $2) ORDER BY id FOR UPDATE', [
      lo,
      hi,
    ]);

    const source = (await client.query<Ticket>('SELECT * FROM tickets WHERE id = $1', [sourceId]))
      .rows[0];
    const target = (await client.query<Ticket>('SELECT * FROM tickets WHERE id = $1', [targetId]))
      .rows[0];
    if (!source) throw notFound(`Source ticket #${sourceId} not found`);
    if (!target) throw notFound(`Target ticket #${targetId} not found`);
    if (source.merged_into_id) throw conflict(`Ticket #${sourceId} is already merged`);
    if (target.merged_into_id) throw conflict(`Target #${targetId} is itself merged`);
    if (source.customer_id !== target.customer_id) {
      throw conflict('Tickets belong to different customers');
    }

    await client.query('UPDATE ticket_messages SET ticket_id = $1 WHERE ticket_id = $2', [
      targetId,
      sourceId,
    ]);
    await client.query(
      `INSERT INTO ticket_messages (ticket_id, author_type, author_id, body, channel)
       VALUES ($1, 'system', NULL, $2, 'api')`,
      [targetId, `Ticket #${sourceId} was merged into this ticket.`],
    );
    await client.query(
      `UPDATE tickets
          SET status = 'closed', closed_at = now(), merged_into_id = $1
        WHERE id = $2`,
      [targetId, sourceId],
    );

    await audit(
      {
        actorType: 'agent',
        actorId: actor.id,
        action: 'ticket.merge',
        entityType: 'ticket',
        entityId: String(sourceId),
        metadata: { targetId },
        ip,
      },
      client,
    );
    return (await client.query<Ticket>('SELECT * FROM tickets WHERE id = $1', [targetId])).rows[0];
  });
}

/**
 * Split selected messages off `sourceId` into a brand-new ticket. Useful when
 * a customer raises a second, unrelated issue inside an existing thread.
 * The selected messages are *copied* (originals stay for thread integrity).
 */
export async function splitTicket(
  sourceId: number,
  messageIds: string[],
  newSubject: string,
  actor: Principal,
  ip?: string,
): Promise<Ticket> {
  if (messageIds.length === 0) throw badRequest('Select at least one message to split');

  return withTransaction(async (client) => {
    const source = (
      await client.query<Ticket>('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [sourceId])
    ).rows[0];
    if (!source) throw notFound('Source ticket not found');

    const messages = (
      await client.query<TicketMessage>(
        'SELECT * FROM ticket_messages WHERE id = ANY($1) AND ticket_id = $2 ORDER BY created_at',
        [messageIds, sourceId],
      )
    ).rows;
    if (messages.length !== messageIds.length) {
      throw badRequest('Some selected messages do not belong to this ticket');
    }

    const newTicket = (
      await client.query<Ticket>(
        `INSERT INTO tickets (subject, status, priority, channel, customer_id, team_id, split_from_id)
         VALUES ($1, 'open', $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          newSubject.trim().slice(0, 500),
          source.priority,
          source.channel,
          source.customer_id,
          source.team_id,
          sourceId,
        ],
      )
    ).rows[0];

    for (const m of messages) {
      await client.query(
        `INSERT INTO ticket_messages
           (ticket_id, author_type, author_id, body, body_html, is_internal_note, channel)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newTicket.id, m.author_type, m.author_id, m.body, m.body_html, m.is_internal_note, m.channel],
      );
    }
    await applySlaPolicy(newTicket.id, source.priority, client);

    await audit(
      {
        actorType: 'agent',
        actorId: actor.id,
        action: 'ticket.split',
        entityType: 'ticket',
        entityId: String(sourceId),
        metadata: { newTicketId: newTicket.id, messageCount: messages.length },
        ip,
      },
      client,
    );
    return newTicket;
  });
}
