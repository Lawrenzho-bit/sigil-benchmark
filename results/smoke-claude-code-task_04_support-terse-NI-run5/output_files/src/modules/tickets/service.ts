/**
 * Ticket domain: creation, the agent inbox (filter/sort/assign/prioritize),
 * public replies + internal notes, and merge/split.
 *
 * Email side effects (sending an agent reply) happen AFTER the database
 * transaction commits: the message is durable first, delivery is best-effort.
 */
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../db/pool';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors';
import { audit } from '../../audit/audit';
import type { Principal } from '../../auth/tokens';
import { findOrCreateByEmail } from '../customers/service';
import { applyStatusTransition, attachSla, markFirstResponse, markResolution, repriceSla } from '../sla/service';
import { sendReply } from '../../email/sender';
import { logger } from '../../logger';

export type TicketStatus = 'new' | 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ChannelType = 'email' | 'web' | 'slack' | 'api';

export interface Ticket {
  id: number;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: ChannelType;
  requester_id: number;
  assignee_id: number | null;
  team_id: number | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  merged_into_id: number | null;
  split_from_id: number | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketMessage {
  id: number;
  ticket_id: number;
  direction: 'inbound' | 'outbound';
  channel: ChannelType;
  visibility: 'public' | 'internal';
  author_agent_id: number | null;
  author_customer_id: number | null;
  body_text: string;
  body_html: string | null;
  created_at: string;
}

const TICKET_COLUMNS = `id, number, subject, status, priority, channel, requester_id,
  assignee_id, team_id, tags, custom_fields, merged_into_id, split_from_id,
  first_response_at, resolved_at, closed_at, created_at, updated_at`;

const TERMINAL_STATUSES: TicketStatus[] = ['resolved', 'closed'];

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/** Customers may only touch their own tickets; agents may touch all. */
function assertAccess(ticket: Ticket, principal: Principal): void {
  if (principal.type === 'customer' && ticket.requester_id !== principal.id) {
    throw forbidden('You do not have access to this ticket');
  }
}

async function loadTicket(id: number): Promise<Ticket> {
  const row = await queryOne<Ticket>(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1`, [id]);
  if (!row) throw notFound('Ticket not found');
  return row;
}

export async function getTicket(id: number, principal: Principal): Promise<Ticket> {
  const ticket = await loadTicket(id);
  assertAccess(ticket, principal);
  return ticket;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateTicketInput {
  subject: string;
  body: string;
  priority?: TicketPriority;
  channel?: ChannelType;
  /** Exactly one requester identifier. */
  requesterId?: number;
  requesterEmail?: string;
  requesterName?: string | null;
  assigneeId?: number | null;
  teamId?: number | null;
  tags?: string[];
}

/**
 * Create a ticket with its opening message and SLA row, in one transaction.
 * The opening message is inbound (it came FROM the requester).
 */
export async function createTicket(input: CreateTicketInput, actor: Principal): Promise<Ticket> {
  if (!input.subject.trim()) throw badRequest('Subject is required');
  if (!input.body.trim()) throw badRequest('Body is required');

  return withTransaction(async (client) => {
    const requesterId = await resolveRequester(client, input, actor);
    const priority = input.priority ?? 'normal';
    const channel = input.channel ?? 'web';

    const ticket = (
      await client.query<Ticket>(
        `INSERT INTO tickets (subject, status, priority, channel, requester_id, assignee_id, team_id, tags)
         VALUES ($1, 'new', $2, $3, $4, $5, $6, $7)
         RETURNING ${TICKET_COLUMNS}`,
        [
          input.subject.trim(),
          priority,
          channel,
          requesterId,
          input.assigneeId ?? null,
          input.teamId ?? null,
          input.tags ?? [],
        ],
      )
    ).rows[0]!;

    await client.query(
      `INSERT INTO ticket_messages
         (ticket_id, direction, channel, visibility, author_customer_id, body_text)
       VALUES ($1, 'inbound', $2, 'public', $3, $4)`,
      [ticket.id, channel, requesterId, input.body],
    );

    await attachSla(client, ticket.id, priority, new Date(ticket.created_at));
    await audit(
      { actor, action: 'ticket.create', entityType: 'ticket', entityId: ticket.id, metadata: { number: ticket.number, channel } },
      client,
    );
    return ticket;
  });
}

/** Resolve the requester for a new ticket, honouring who is creating it. */
async function resolveRequester(
  client: PoolClient,
  input: CreateTicketInput,
  actor: Principal,
): Promise<number> {
  // A customer creating via the portal is always the requester of their ticket.
  if (actor.type === 'customer') return actor.id;

  if (input.requesterId) return input.requesterId;
  if (input.requesterEmail) {
    const customer = await findOrCreateByEmail(client, input.requesterEmail, input.requesterName);
    return customer.id;
  }
  throw badRequest('requesterId or requesterEmail is required');
}

// ---------------------------------------------------------------------------
// Inbox: list with filter / sort / pagination
// ---------------------------------------------------------------------------

export interface ListTicketsParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: number;
  teamId?: number;
  tag?: string;
  requesterId?: number;
  /** Full-text query over the subject. */
  q?: string;
  sort: 'created_at' | 'updated_at' | 'priority';
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export async function listTickets(
  params: ListTicketsParams,
  principal: Principal,
): Promise<{ items: Ticket[]; total: number }> {
  const where: string[] = ['merged_into_id IS NULL'];
  const args: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    args.push(value);
    where.push(clause.replace('$?', `$${args.length}`));
  };

  // Customers are hard-scoped to their own tickets regardless of query params.
  if (principal.type === 'customer') {
    add('requester_id = $?', principal.id);
  } else if (params.requesterId !== undefined) {
    add('requester_id = $?', params.requesterId);
  }

  if (params.status) add('status = $?', params.status);
  if (params.priority) add('priority = $?', params.priority);
  if (params.assigneeId !== undefined) add('assignee_id = $?', params.assigneeId);
  if (params.teamId !== undefined) add('team_id = $?', params.teamId);
  if (params.tag) add('$? = ANY(tags)', params.tag);
  if (params.q) add('search_vector @@ websearch_to_tsquery($?)', params.q);

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = Number(
    (await queryOne<{ count: string }>(`SELECT count(*)::text AS count FROM tickets ${whereSql}`, args))
      ?.count ?? 0,
  );

  // priority sort uses the enum's natural order (low < normal < high < urgent).
  const sortExpr =
    params.sort === 'priority' ? 'priority' : params.sort === 'created_at' ? 'created_at' : 'updated_at';
  args.push(params.limit, params.offset);
  const items = await query<Ticket>(
    `SELECT ${TICKET_COLUMNS} FROM tickets ${whereSql}
     ORDER BY ${sortExpr} ${params.order === 'asc' ? 'ASC' : 'DESC'}
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  return { items, total };
}

// ---------------------------------------------------------------------------
// Updates: assign / prioritize / status / tags
// ---------------------------------------------------------------------------

export interface UpdateTicketInput {
  subject?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: number | null;
  teamId?: number | null;
  tags?: string[];
}

/** Patch a ticket. Agents only. Recomputes SLA on priority/status changes. */
export async function updateTicket(
  id: number,
  patch: UpdateTicketInput,
  actor: Principal,
): Promise<Ticket> {
  if (actor.type !== 'agent') throw forbidden('Only agents can modify tickets');

  return withTransaction(async (client) => {
    const before = (
      await client.query<Ticket>(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 FOR UPDATE`, [id])
    ).rows[0];
    if (!before) throw notFound('Ticket not found');
    if (before.merged_into_id) throw conflict('Cannot modify a merged ticket');

    const sets: string[] = [];
    const args: unknown[] = [];
    const assign = (col: string, value: unknown) => {
      args.push(value);
      sets.push(`${col} = $${args.length}`);
    };

    if (patch.subject !== undefined) assign('subject', patch.subject.trim());
    if (patch.priority !== undefined) assign('priority', patch.priority);
    if (patch.assigneeId !== undefined) assign('assignee_id', patch.assigneeId);
    if (patch.teamId !== undefined) assign('team_id', patch.teamId);
    if (patch.tags !== undefined) assign('tags', patch.tags);

    if (patch.status !== undefined && patch.status !== before.status) {
      assign('status', patch.status);
      // Stamp lifecycle timestamps on entering terminal states.
      if (patch.status === 'resolved' && !before.resolved_at) assign('resolved_at', new Date());
      if (patch.status === 'closed' && !before.closed_at) assign('closed_at', new Date());
    }

    if (sets.length === 0) return before;

    const updated = (
      await client.query<Ticket>(
        `UPDATE tickets SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${args.length + 1} RETURNING ${TICKET_COLUMNS}`,
        [...args, id],
      )
    ).rows[0]!;

    // --- SLA reconciliation ---
    if (patch.priority !== undefined && patch.priority !== before.priority) {
      await repriceSla(client, id, patch.priority, new Date(before.created_at));
    }
    if (patch.status !== undefined && patch.status !== before.status) {
      await applyStatusTransition(client, id, before.status, patch.status);
      if (patch.status === 'resolved' && !before.resolved_at) {
        await markResolution(client, id);
      }
    }

    await audit(
      {
        actor,
        action: 'ticket.update',
        entityType: 'ticket',
        entityId: id,
        metadata: diffSummary(before, patch),
      },
      client,
    );
    return updated;
  });
}

function diffSummary(before: Ticket, patch: UpdateTicketInput): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of ['subject', 'status', 'priority', 'assigneeId', 'teamId', 'tags'] as const) {
    if (patch[key] !== undefined) changes[key] = patch[key];
  }
  changes.previousStatus = before.status;
  return changes;
}

// ---------------------------------------------------------------------------
// Messages: public replies, internal notes
// ---------------------------------------------------------------------------

export interface AppendMessageInput {
  body: string;
  bodyHtml?: string | null;
  visibility: 'public' | 'internal';
  channel?: ChannelType;
  /** Skip outbound email (used by the inbound worker, which already has the email). */
  suppressEmail?: boolean;
  emailMessageId?: number | null;
}

/**
 * Append a message to a ticket. Direction is derived from the actor:
 * agent → outbound, customer → inbound. A public outbound agent message
 * triggers an email to the requester (unless suppressed) and records the
 * SLA first-response if it is the first one.
 */
export async function appendMessage(
  ticketId: number,
  input: AppendMessageInput,
  actor: Principal,
): Promise<TicketMessage> {
  if (!input.body.trim()) throw badRequest('Message body is required');
  if (input.visibility === 'internal' && actor.type !== 'agent') {
    throw forbidden('Only agents can add internal notes');
  }

  const direction = actor.type === 'agent' ? 'outbound' : 'inbound';

  const { message, ticket, isFirstResponse } = await withTransaction(async (client) => {
    const t = (
      await client.query<Ticket>(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 FOR UPDATE`, [
        ticketId,
      ])
    ).rows[0];
    if (!t) throw notFound('Ticket not found');
    assertAccess(t, actor);
    if (t.merged_into_id) throw conflict('Cannot add messages to a merged ticket');

    const channel = input.channel ?? t.channel;
    const msg = (
      await client.query<TicketMessage>(
        `INSERT INTO ticket_messages
           (ticket_id, direction, channel, visibility, author_agent_id, author_customer_id,
            body_text, body_html, email_message_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, ticket_id, direction, channel, visibility, author_agent_id,
                   author_customer_id, body_text, body_html, created_at`,
        [
          ticketId,
          direction,
          channel,
          input.visibility,
          actor.type === 'agent' ? actor.id : null,
          actor.type === 'customer' ? actor.id : null,
          input.body,
          input.bodyHtml ?? null,
          input.emailMessageId ?? null,
        ],
      )
    ).rows[0]!;

    // First public agent reply: record SLA first-response and open a 'new' ticket.
    const firstResponse =
      direction === 'outbound' && input.visibility === 'public' && !t.first_response_at;
    if (firstResponse) {
      await client.query(`UPDATE tickets SET first_response_at = now() WHERE id = $1`, [ticketId]);
      await markFirstResponse(client, ticketId);
    }

    // A customer reply to a resolved ticket reopens it.
    let nextStatus = t.status;
    if (firstResponse && t.status === 'new') nextStatus = 'open';
    if (direction === 'inbound' && TERMINAL_STATUSES.includes(t.status)) nextStatus = 'open';
    if (nextStatus !== t.status) {
      await client.query(`UPDATE tickets SET status = $2 WHERE id = $1`, [ticketId, nextStatus]);
      await applyStatusTransition(client, ticketId, t.status, nextStatus);
    }

    await client.query(`UPDATE tickets SET updated_at = now() WHERE id = $1`, [ticketId]);
    await audit(
      {
        actor,
        action: input.visibility === 'internal' ? 'ticket.note' : 'ticket.reply',
        entityType: 'ticket',
        entityId: ticketId,
        metadata: { messageId: msg.id, direction },
      },
      client,
    );
    return { message: msg, ticket: t, isFirstResponse: firstResponse };
  });

  // Outbound delivery happens post-commit: the message is already durable.
  if (direction === 'outbound' && input.visibility === 'public' && !input.suppressEmail) {
    await deliverReply(ticket, message).catch((err) => {
      logger.error({ err, ticketId }, 'outbound reply delivery failed; message stored');
    });
  }
  void isFirstResponse;
  return message;
}

/** Send a public agent reply by email and link the resulting email_messages row. */
async function deliverReply(ticket: Ticket, message: TicketMessage): Promise<void> {
  const requester = await queryOne<{ email: string }>(
    `SELECT email FROM customers WHERE id = $1`,
    [ticket.requester_id],
  );
  if (!requester) return;

  const priorInbound = await queryOne<{ message_id_header: string | null }>(
    `SELECT message_id_header FROM email_messages
      WHERE ticket_id = $1 AND direction = 'inbound'
      ORDER BY received_at DESC LIMIT 1`,
    [ticket.id],
  );

  const sent = await sendReply({
    ticketNumber: ticket.number,
    to: requester.email,
    subject: ticket.subject,
    bodyText: message.body_text,
    bodyHtml: message.body_html,
    inReplyTo: priorInbound?.message_id_header ?? null,
  });

  const emailRow = await queryOne<{ id: number }>(
    `INSERT INTO email_messages
       (direction, message_id_header, references_ids, from_addr, to_addrs, subject, ticket_id, proc_status, processed_at)
     VALUES ('outbound', $1, $2, $3, $4, $5, $6, 'processed', now())
     RETURNING id`,
    [
      sent.messageId,
      sent.references,
      `${ticket.number}@outbound`,
      [requester.email],
      ticket.subject,
      ticket.id,
    ],
  );
  if (emailRow) {
    await query(`UPDATE ticket_messages SET email_message_id = $1 WHERE id = $2`, [
      emailRow.id,
      message.id,
    ]);
  }
}

/** List a ticket's messages. Customers never see internal notes. */
export async function listMessages(
  ticketId: number,
  principal: Principal,
): Promise<TicketMessage[]> {
  const ticket = await getTicket(ticketId, principal); // enforces access
  const visibilityFilter = principal.type === 'customer' ? `AND visibility = 'public'` : '';
  return query<TicketMessage>(
    `SELECT id, ticket_id, direction, channel, visibility, author_agent_id,
            author_customer_id, body_text, body_html, created_at
       FROM ticket_messages
      WHERE ticket_id = $1 ${visibilityFilter}
      ORDER BY created_at ASC`,
    [ticket.id],
  );
}

// ---------------------------------------------------------------------------
// Merge / split
// ---------------------------------------------------------------------------

/**
 * Merge `sourceId` into `targetId`: all messages and attachments move to the
 * target, the source is closed and stamped with merged_into_id. Reversible only
 * by re-pointing rows manually — merges are intentionally one-way.
 */
export async function mergeTicket(
  sourceId: number,
  targetId: number,
  actor: Principal,
): Promise<Ticket> {
  if (actor.type !== 'agent') throw forbidden('Only agents can merge tickets');
  if (sourceId === targetId) throw badRequest('Cannot merge a ticket into itself');

  return withTransaction(async (client) => {
    const source = (
      await client.query<Ticket>(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 FOR UPDATE`, [
        sourceId,
      ])
    ).rows[0];
    const target = (
      await client.query<Ticket>(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 FOR UPDATE`, [
        targetId,
      ])
    ).rows[0];
    if (!source) throw notFound('Source ticket not found');
    if (!target) throw notFound('Target ticket not found');
    if (source.merged_into_id) throw conflict('Source ticket is already merged');
    if (target.merged_into_id) throw conflict('Target ticket is itself merged');

    await client.query(
      `UPDATE ticket_messages SET ticket_id = $1 WHERE ticket_id = $2`,
      [targetId, sourceId],
    );
    await client.query(`UPDATE attachments SET ticket_id = $1 WHERE ticket_id = $2`, [
      targetId,
      sourceId,
    ]);
    await client.query(`UPDATE email_messages SET ticket_id = $1 WHERE ticket_id = $2`, [
      targetId,
      sourceId,
    ]);
    await client.query(
      `UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()),
                          merged_into_id = $1, updated_at = now()
        WHERE id = $2`,
      [targetId, sourceId],
    );

    // Trail on the target so agents see where the merged content came from.
    await client.query(
      `INSERT INTO ticket_messages (ticket_id, direction, channel, visibility, author_agent_id, body_text)
       VALUES ($1, 'outbound', 'web', 'internal', $2, $3)`,
      [targetId, actor.id, `Ticket #${source.number} was merged into this ticket.`],
    );
    await client.query(`UPDATE tickets SET updated_at = now() WHERE id = $1`, [targetId]);

    await audit(
      { actor, action: 'ticket.merge', entityType: 'ticket', entityId: sourceId, metadata: { into: targetId } },
      client,
    );
    return (
      await client.query<Ticket>(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1`, [targetId])
    ).rows[0]!;
  });
}

/**
 * Split selected messages out of a ticket into a brand-new ticket. The new
 * ticket inherits requester/priority and is linked back via split_from_id.
 */
export async function splitTicket(
  sourceId: number,
  messageIds: number[],
  newSubject: string,
  actor: Principal,
): Promise<Ticket> {
  if (actor.type !== 'agent') throw forbidden('Only agents can split tickets');
  if (messageIds.length === 0) throw badRequest('Select at least one message to split');

  return withTransaction(async (client) => {
    const source = (
      await client.query<Ticket>(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 FOR UPDATE`, [
        sourceId,
      ])
    ).rows[0];
    if (!source) throw notFound('Source ticket not found');

    // Every selected message must belong to the source ticket.
    const owned = await client.query<{ id: number }>(
      `SELECT id FROM ticket_messages WHERE ticket_id = $1 AND id = ANY($2::bigint[])`,
      [sourceId, messageIds],
    );
    if (owned.rows.length !== messageIds.length) {
      throw badRequest('One or more messages do not belong to this ticket');
    }

    const created = (
      await client.query<Ticket>(
        `INSERT INTO tickets (subject, status, priority, channel, requester_id, split_from_id)
         VALUES ($1, 'open', $2, $3, $4, $5)
         RETURNING ${TICKET_COLUMNS}`,
        [newSubject.trim() || `Split of #${source.number}`, source.priority, source.channel, source.requester_id, sourceId],
      )
    ).rows[0]!;

    await client.query(
      `UPDATE ticket_messages SET ticket_id = $1 WHERE id = ANY($2::bigint[])`,
      [created.id, messageIds],
    );
    await client.query(
      `UPDATE attachments SET ticket_id = $1
        WHERE message_id = ANY($2::bigint[])`,
      [created.id, messageIds],
    );
    await attachSla(client, created.id, source.priority, new Date(created.created_at));

    await audit(
      { actor, action: 'ticket.split', entityType: 'ticket', entityId: sourceId, metadata: { newTicketId: created.id, messageIds } },
      client,
    );
    return created;
  });
}
