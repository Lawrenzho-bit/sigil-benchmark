/**
 * Macros / canned responses. A macro carries a reply body plus optional ticket
 * "actions" (status/priority/tag changes) applied in one step when invoked.
 */
import { query, queryOne } from '../../db/pool';
import { badRequest, notFound } from '../../http/errors';
import { audit } from '../../audit/audit';
import type { Principal } from '../../auth/tokens';
import {
  appendMessage,
  getTicket,
  updateTicket,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
} from '../tickets/service';

export interface MacroActions {
  status?: TicketStatus;
  priority?: TicketPriority;
  addTags?: string[];
}

export interface Macro {
  id: number;
  name: string;
  body: string;
  actions: MacroActions;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, name, body, actions, is_active, created_by, created_at, updated_at';

export async function listMacros(includeInactive = false): Promise<Macro[]> {
  return query<Macro>(
    `SELECT ${COLUMNS} FROM macros ${includeInactive ? '' : 'WHERE is_active = true'}
     ORDER BY name ASC`,
  );
}

export async function getMacro(id: number): Promise<Macro> {
  const row = await queryOne<Macro>(`SELECT ${COLUMNS} FROM macros WHERE id = $1`, [id]);
  if (!row) throw notFound('Macro not found');
  return row;
}

export interface MacroInput {
  name: string;
  body: string;
  actions?: MacroActions;
  is_active?: boolean;
}

export async function createMacro(input: MacroInput, actor: Principal): Promise<Macro> {
  if (actor.type !== 'agent') throw badRequest('Only agents can create macros');
  const row = await queryOne<Macro>(
    `INSERT INTO macros (name, body, actions, is_active, created_by)
     VALUES ($1, $2, $3, coalesce($4, true), $5) RETURNING ${COLUMNS}`,
    [input.name, input.body, JSON.stringify(input.actions ?? {}), input.is_active ?? null, actor.id],
  );
  await audit({ actor, action: 'macro.create', entityType: 'macro', entityId: row!.id });
  return row!;
}

export async function updateMacro(
  id: number,
  patch: Partial<MacroInput>,
  actor: Principal,
): Promise<Macro> {
  await getMacro(id);
  const sets: string[] = [];
  const args: unknown[] = [];
  const assign = (col: string, val: unknown) => {
    args.push(val);
    sets.push(`${col} = $${args.length}`);
  };
  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.body !== undefined) assign('body', patch.body);
  if (patch.actions !== undefined) assign('actions', JSON.stringify(patch.actions));
  if (patch.is_active !== undefined) assign('is_active', patch.is_active);
  if (sets.length === 0) return getMacro(id);

  args.push(id);
  const row = await queryOne<Macro>(
    `UPDATE macros SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $${args.length} RETURNING ${COLUMNS}`,
    args,
  );
  await audit({ actor, action: 'macro.update', entityType: 'macro', entityId: id });
  return row!;
}

export async function deleteMacro(id: number, actor: Principal): Promise<void> {
  await getMacro(id);
  await query(`DELETE FROM macros WHERE id = $1`, [id]);
  await audit({ actor, action: 'macro.delete', entityType: 'macro', entityId: id });
}

/** Substitute {{ticket.*}} placeholders in a macro body. */
function renderBody(body: string, ticket: Ticket): string {
  return body
    .replace(/\{\{\s*ticket\.number\s*\}\}/g, String(ticket.number))
    .replace(/\{\{\s*ticket\.subject\s*\}\}/g, ticket.subject);
}

/**
 * Apply a macro to a ticket: post its (rendered) body as a public reply, then
 * apply its actions. Returns the resulting ticket state.
 */
export async function applyMacro(
  ticketId: number,
  macroId: number,
  actor: Principal,
): Promise<Ticket> {
  if (actor.type !== 'agent') throw badRequest('Only agents can apply macros');
  const macro = await getMacro(macroId);
  if (!macro.is_active) throw badRequest('Macro is inactive');

  const ticket = await getTicket(ticketId, actor);

  if (macro.body.trim()) {
    await appendMessage(ticketId, { body: renderBody(macro.body, ticket), visibility: 'public' }, actor);
  }

  const actions = macro.actions ?? {};
  const hasActions =
    actions.status !== undefined || actions.priority !== undefined || (actions.addTags?.length ?? 0) > 0;
  let result = await getTicket(ticketId, actor);

  if (hasActions) {
    const mergedTags = actions.addTags
      ? Array.from(new Set([...result.tags, ...actions.addTags]))
      : undefined;
    result = await updateTicket(
      ticketId,
      { status: actions.status, priority: actions.priority, tags: mergedTags },
      actor,
    );
  }

  await audit({ actor, action: 'macro.apply', entityType: 'ticket', entityId: ticketId, metadata: { macroId } });
  return result;
}
