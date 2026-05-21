/** JWT issuing/verification and password hashing. */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { unauthorized } from '../http/errors';

export type Principal =
  | { type: 'agent'; id: number; role: 'admin' | 'manager' | 'agent' | 'read_only' }
  | { type: 'customer'; id: number };

interface AgentClaims {
  sub: string;
  kind: 'agent';
  role: 'admin' | 'manager' | 'agent' | 'read_only';
}
interface CustomerClaims {
  sub: string;
  kind: 'customer';
}
type Claims = AgentClaims | CustomerClaims;

export function signAgentToken(id: number, role: AgentClaims['role']): string {
  const claims: AgentClaims = { sub: String(id), kind: 'agent', role };
  return jwt.sign(claims, config.JWT_SECRET, { expiresIn: config.JWT_TTL_SECONDS });
}

export function signCustomerToken(id: number): string {
  const claims: CustomerClaims = { sub: String(id), kind: 'customer' };
  return jwt.sign(claims, config.JWT_SECRET, { expiresIn: config.PORTAL_JWT_TTL_SECONDS });
}

/** Verify a bearer token and resolve it to a Principal, or throw 401. */
export function verifyToken(token: string): Principal {
  let decoded: Claims;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET) as Claims;
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const id = Number(decoded.sub);
  if (!Number.isInteger(id) || id <= 0) throw unauthorized('Malformed token subject');

  if (decoded.kind === 'agent') return { type: 'agent', id, role: decoded.role };
  if (decoded.kind === 'customer') return { type: 'customer', id };
  throw unauthorized('Unknown token kind');
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
