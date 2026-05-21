import { query, queryOne } from '../db';
import { Principal } from '../types';
import { getMacro, renderMacro } from './macroService';
import { Ticket, updateTicket } from './ticketService';

/**
 * Apply a macro in the context of an agent reply.
 *
 * Returns the fully-rendered reply body. Any extra text the agent typed
 * (`extraText`) is appended below the canned response. Macro `actions`
 * (status / priority / assignment) are applied to the ticket as a side effect.
 */
export async function applyMacroToReply(
  macroId: string,
  ticket: Ticket,
  agent: Principal,
  extraText: string,
): Promise<string> {
  const macro = await getMacro(macroId);
  const agentRow = await queryOne<{ name: string }>('SELECT name FROM agents WHERE id = $1', [
    agent.id,
  ]);
  const rendered = await renderMacro(macro, ticket, agentRow?.name ?? 'Support');

  // Apply ticket mutations declared by the macro.
  const actions = macro.actions;
  const changes: Parameters<typeof updateTicket>[1] = {};
  if (actions.status) changes.status = actions.status;
  if (actions.priority) changes.priority = actions.priority;
  if (actions.assignToSelf) changes.assigneeId = agent.id;
  if (Object.keys(changes).length > 0) {
    await updateTicket(ticket.id, changes, agent);
  }

  if (actions.addTags?.length) {
    for (const rawName of actions.addTags) {
      const name = rawName.trim().toLowerCase();
      if (!name) continue;
      const tag = await queryOne<{ id: string }>(
        `INSERT INTO tags (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [name],
      );
      await query(
        'INSERT INTO ticket_tags (ticket_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [ticket.id, tag!.id],
      );
    }
  }

  const extra = extraText.trim();
  return extra ? `${rendered}\n\n${extra}` : rendered;
}
