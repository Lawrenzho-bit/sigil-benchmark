/**
 * JWT issuing and verification. Agents and customers are separate principal
 * types signed with separate secrets so a customer token can never be
 * presented to an agent-only endpoint (and vice versa).
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { queryOne } from '../db';

export type Role = 'admin' | 'agent' | 'read_only';

export interface AgentPrincipal {
  kind: 'agent';
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface CustomerPrincipal {
  kind: 'customer';
  id: string;
  email: string;
  name: string | null;
}

export type Principal = AgentPrincipal | CustomerPrincipal;

interface AgentClaims {
  sub: string;
  email: string;
  name: string;
  role: Role;
  jti: string;
}
interface CustomerClaims {
  sub: string;
  email: string;
  name: string | null;
  jti: string;
}

export function signAgentToken(p: Omit<AgentPrincipal, 'kind'>): string {
  const claims: AgentClaims = {
    sub: p.id,
    email: p.email,
    name: p.name,
    role: p.role,
    jti: crypto.randomUUID(),
  };
  return jwt.sign(claims, config.jwt.agentSecret, { expiresIn: config.jwt.expiresIn });
}

export function signCustomerToken(p: Omit<CustomerPrincipal, 'kind'>): string {
  const claims: CustomerClaims = {
    sub: p.id,
    email: p.email,
    name: p.name,
    jti: crypto.randomUUID(),
  };
  return jwt.sign(claims, config.jwt.customerSecret, { expiresIn: config.jwt.expiresIn });
}

async function isRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  const row = await queryOne('SELECT 1 FROM revoked_tokens WHERE jti = $1', [jti]);
  return Boolean(row);
}

export async function verifyAgentToken(token: string): Promise<AgentPrincipal> {
  const decoded = jwt.verify(token, config.jwt.agentSecret) as AgentClaims;
  if (await isRevoked(decoded.jti)) throw new Error('token revoked');
  return {
    kind: 'agent',
    id: decoded.sub,
    email: decoded.email,
    name: decoded.name,
    role: decoded.role,
  };
}

export async function verifyCustomerToken(token: string): Promise<CustomerPrincipal> {
  const decoded = jwt.verify(token, config.jwt.customerSecret) as CustomerClaims;
  if (await isRevoked(decoded.jti)) throw new Error('token revoked');
  return {
    kind: 'customer',
    id: decoded.sub,
    email: decoded.email,
    name: decoded.name,
  };
}

/** Revoke a token by its jti (used by logout / forced revocation). */
export async function revokeToken(jti: string, expiresAt: Date): Promise<void> {
  const { pool } = await import('../db');
  await pool.query(
    `INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1,$2)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, expiresAt],
  );
}

/** Decode without verifying — used only to extract jti/exp for revocation. */
export function decodeUnsafe(token: string): { jti?: string; exp?: number } {
  const d = jwt.decode(token);
  return (d && typeof d === 'object') ? (d as { jti?: string; exp?: number }) : {};
}
