import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { UserRole } from '@prisma/client';

export interface TokenClaims {
  sub: string; // user id
  roles: UserRole[];
}

export function signAccessToken(claims: TokenClaims): string {
  return jwt.sign(claims, config.jwtSecret, {
    expiresIn: config.jwtAccessTtlSeconds,
  });
}

export function verifyAccessToken(token: string): TokenClaims {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded === 'string') throw new Error('Invalid token payload');
  return { sub: decoded.sub as string, roles: (decoded.roles as UserRole[]) ?? [] };
}
