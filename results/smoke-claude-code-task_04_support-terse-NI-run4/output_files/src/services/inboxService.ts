import { query, queryOne } from '../db';
import { TicketPriority, TicketStatus } from '../types';

export interface InboxFilters {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  assigneeId?: string;
  teamId?: string;
  /** 'me' resolves against the requesting agent; 'unassigned' = no assignee. */
  assignment?: 'me' | 'unassigned' | 'any';
  tag?: string;
  /** Free-text match against subject + customer email. */
  search?: string;
  /** Only tickets currently breaching or about to breach SLA. */
  slaBreached?: boolean;
}

export type InboxSort =
  | 'updated_desc'
  | 'created_desc'
  | 'created_asc'
  | 'priority_desc'
  | 'sla_due_asc';

const SORT_SQL: Record<InboxSort, string> = {
  updated_desc: 't.updated_at DESC',
  created_desc: 't.created_at DESC',
  created_asc: 't.created_at ASC',
  // urgent → low via the enum's declared order
  priority_desc: "array_position(ARRAY['urgent','high','normal','low']::ticket_priority[], t.priority) ASC, t.updated_at DESC",
  sla_due_asc: 's.resolution_due ASC NULLS LAST',
};

export interface InboxPage {
  tickets: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

/**
 * The agent inbox query: filter, sort, paginate.
 *
 * All filter values are bound as parameters — never interpolated — so the
 * dynamic WHERE clause is injection-safe. `requestingAgentId` resolves the
 * `assignment: 'me'` shortcut.
 */
export async function queryInbox(
  filters: InboxFilters,
  sort: InboxSort,
  limit: number,
  offset: number,
  requestingAgentId: string,
): Promise<InboxPage> {
  const where: string[] = ['t.merged_into_id IS NULL'];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.status?.length) where.push(`t.status = ANY(${bind(filters.status)})`);
  if (filters.priority?.length) where.push(`t.priority = ANY(${bind(filters.priority)})`);
  if (filters.teamId) where.push(`t.team_id = ${bind(filters.teamId)}`);

  if (filters.assignment === 'me') {
    where.push(`t.assignee_id = ${bind(requestingAgentId)}`);
  } else if (filters.assignment === 'unassigned') {
    where.push('t.assignee_id IS NULL');
  } else if (filters.assigneeId) {
    where.push(`t.assignee_id = ${bind(filters.assigneeId)}`);
  }

  if (filters.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id
               WHERE tt.ticket_id = t.id AND g.name = ${bind(filters.tag)})`,
    );
  }
  if (filters.search) {
    const term = bind(`%${filters.search}%`);
    where.push(`(t.subject ILIKE ${term} OR c.email::text ILIKE ${term})`);
  }
  if (filters.slaBreached) {
    where.push(
      `(s.first_response_breached OR s.resolution_breached
        OR (s.resolution_met_at IS NULL AND s.resolution_due < now()))`,
    );
  }

  const whereSql = where.join(' AND ');
  const base = `
    FROM tickets t
    JOIN customers c ON c.id = t.customer_id
    LEFT JOIN ticket_sla s ON s.ticket_id = t.id
    WHERE ${whereSql}`;

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::int AS count ${base}`,
    params,
  );

  const rows = await query(
    `SELECT t.id, t.subject, t.status, t.priority, t.channel,
            t.assignee_id, t.team_id, t.created_at, t.updated_at,
            c.email AS customer_email, c.name AS customer_name,
            s.first_response_due, s.resolution_due,
            s.first_response_breached, s.resolution_breached
     ${base}
     ORDER BY ${SORT_SQL[sort]}
     LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
    params,
  );

  return {
    tickets: rows,
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  };
}
