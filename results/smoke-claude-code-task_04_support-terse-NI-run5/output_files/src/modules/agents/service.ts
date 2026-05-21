/** Agent (staff) accounts and teams. */
import { query, queryOne } from '../../db/pool';
import { conflict, notFound, unauthorized } from '../../http/errors';
import { audit } from '../../audit/audit';
import type { Principal } from '../../auth/tokens';
import { hashPassword, verifyPassword } from '../../auth/tokens';

export type AgentRole = 'admin' | 'manager' | 'agent' | 'read_only';

export interface Agent {
  id: number;
  email: string;
  name: string;
  role: AgentRole;
  team_id: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, email, name, role, team_id, is_active, created_at, updated_at';

export async function listAgents(): Promise<Agent[]> {
  return query<Agent>(`SELECT ${COLUMNS} FROM agents ORDER BY name ASC`);
}

export async function getAgent(id: number): Promise<Agent> {
  const row = await queryOne<Agent>(`SELECT ${COLUMNS} FROM agents WHERE id = $1`, [id]);
  if (!row) throw notFound('Agent not found');
  return row;
}

export interface CreateAgentInput {
  email: string;
  name: string;
  password: string;
  role?: AgentRole;
  teamId?: number | null;
}

export async function createAgent(input: CreateAgentInput, actor: Principal): Promise<Agent> {
  const email = input.email.trim().toLowerCase();
  if (await queryOne(`SELECT 1 FROM agents WHERE email = $1`, [email])) {
    throw conflict('An agent with this email already exists');
  }
  const row = await queryOne<Agent>(
    `INSERT INTO agents (email, name, password_hash, role, team_id)
     VALUES ($1, $2, $3, coalesce($4, 'agent'), $5) RETURNING ${COLUMNS}`,
    [email, input.name, await hashPassword(input.password), input.role ?? null, input.teamId ?? null],
  );
  await audit({ actor, action: 'agent.create', entityType: 'agent', entityId: row!.id });
  return row!;
}

export interface UpdateAgentInput {
  name?: string;
  role?: AgentRole;
  teamId?: number | null;
  isActive?: boolean;
  password?: string;
}

export async function updateAgent(
  id: number,
  patch: UpdateAgentInput,
  actor: Principal,
): Promise<Agent> {
  await getAgent(id);
  const sets: string[] = [];
  const args: unknown[] = [];
  const assign = (col: string, val: unknown) => {
    args.push(val);
    sets.push(`${col} = $${args.length}`);
  };
  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.role !== undefined) assign('role', patch.role);
  if (patch.teamId !== undefined) assign('team_id', patch.teamId);
  if (patch.isActive !== undefined) assign('is_active', patch.isActive);
  if (patch.password) assign('password_hash', await hashPassword(patch.password));
  if (sets.length === 0) return getAgent(id);

  args.push(id);
  const row = await queryOne<Agent>(
    `UPDATE agents SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $${args.length} RETURNING ${COLUMNS}`,
    args,
  );
  await audit({ actor, action: 'agent.update', entityType: 'agent', entityId: id });
  return row!;
}

/** Verify agent credentials for login. Inactive accounts are rejected. */
export async function authenticateAgent(email: string, password: string): Promise<Agent> {
  const row = await queryOne<Agent & { password_hash: string }>(
    `SELECT ${COLUMNS}, password_hash FROM agents WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  if (!row || !row.is_active || !(await verifyPassword(password, row.password_hash))) {
    throw unauthorized('Invalid credentials');
  }
  const { password_hash: _ignored, ...agent } = row;
  return agent;
}

export async function listTeams(): Promise<Array<{ id: number; name: string }>> {
  return query(`SELECT id, name FROM teams ORDER BY name ASC`);
}

export async function createTeam(name: string, actor: Principal): Promise<{ id: number; name: string }> {
  const existing = await queryOne(`SELECT id FROM teams WHERE name = $1`, [name]);
  if (existing) throw conflict('A team with this name already exists');
  const row = await queryOne<{ id: number; name: string }>(
    `INSERT INTO teams (name) VALUES ($1) RETURNING id, name`,
    [name],
  );
  await audit({ actor, action: 'team.create', entityType: 'team', entityId: row!.id });
  return row!;
}
