import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { Forbidden, Unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/jwt.js";

// Authenticated principal attached to the request by `requireAuth`.
export interface AuthContext {
  userId: string;
  roles: UserRole[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// Parses the bearer token if present; does not reject anonymous requests.
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      req.auth = { userId: payload.sub, roles: payload.roles };
    } catch {
      // Ignore invalid tokens on optional routes.
    }
  }
  next();
}

// Rejects the request unless a valid access token is present.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(Unauthorized());
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.auth = { userId: payload.sub, roles: payload.roles };
    next();
  } catch {
    next(Unauthorized("Invalid or expired token"));
  }
}

// Requires the authenticated user to hold at least one of the given roles.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(Unauthorized());
    if (!roles.some((r) => req.auth!.roles.includes(r))) {
      return next(Forbidden(`Requires role: ${roles.join(" or ")}`));
    }
    next();
  };
}
