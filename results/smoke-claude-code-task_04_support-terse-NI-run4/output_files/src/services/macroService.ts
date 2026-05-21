import { query, queryOne } from '../db';
import { badRequest, notFound } from '../errors';
import { Principal, TicketPriority, TicketStatus } from '../types';
import { Ticket } from './ticketService';
import { getCustomer } from './customerService';

/**
 * A macro bundles a canned reply body with optional ticket mutations
 * (status / priority / assignment) applied in the same action.
 */
export interface Macro {
  id: string;
  name: string;
  body: string;
  actions: MacroActions;
  team_id: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface MacroActions {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignToSelf?: boolean;
  addTags?: string[];
}

export async function createMacro(
  input: { name: string; body: string; actions?: MacroActions; teamId?: string | null },
  author: Principal,
): Promise<Macro> {
  if (!input.name.trim()) throw badRequest('Macro name is required');
  if (!input.body.trim()) throw badRequest('Macro body is required');
  const macro = await queryOne<Macro>(
    `INSERT INTO macros (name, body, actions, team_id, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.name.trim(), input.body, input.actions ?? {}, input.teamId ?? null, author.id],
  );
  return macro!;
}

/** Macros visible to an agent: their team's macros plus global ones. */
export async function listMacros(teamId: string | null | undefined): Promise<Macro[]> {
  return query<Macro>(
    'SELECT * FROM macros WHERE team_id IS NULL OR team_id = $1 ORDER BY name',
    [teamId ?? null],
  );
}

export async function getMacro(id: string): Promise<Macro> {
  const macro = await queryOne<Macro>('SELECT * FROM macros WHERE id = $1', [id]);
  if (!macro) throw notFound('Macro not found');
  return macro;
}

export async function deleteMacro(id: string): Promise<void> {
  const deleted = await query('DELETE FROM macros WHERE id = $1 RETURNING id', [id]);
  if (deleted.length === 0) throw notFound('Macro not found');
}

/**
 * Render a macro body for a specific ticket, expanding `{{...}}` placeholders.
 *
 * Supported tokens: `{{customer.name}}`, `{{customer.email}}`,
 * `{{ticket.id}}`, `{{ticket.subject}}`, `{{agent.name}}`. Unknown tokens are
 * left untouched so a typo is visible rather than silently blanked.
 */
export async function renderMacro(
  macro: Macro,
  ticket: Ticket,
  agentName: string,
): Promise<string> {
  const customer = await getCustomer(ticket.customer_id);
  const vars: Record<string, string> = {
    'customer.name': customer.name ?? 'there',
    'customer.email': customer.email,
    'ticket.id': String(ticket.id),
    'ticket.subject': ticket.subject,
    'agent.name': agentName,
  };
  return macro.body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) =>
    key in vars ? vars[key] : whole,
  );
}
