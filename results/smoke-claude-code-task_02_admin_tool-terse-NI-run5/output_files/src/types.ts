import { AdminRole } from '@prisma/client';
import type { Permission } from './rbac/permissions';

/**
 * The authenticated principal behind a request. Built once per request by the
 * authentication middleware and consulted by every authorization check.
 */
export interface Actor {
  /** How the request authenticated. */
  type: 'ADMIN_USER' | 'API_TOKEN';
  /** The admin user — directly, or the creator of the API token. */
  adminUserId: string;
  email: string;
  name: string;
  role: AdminRole;
  /** Effective permissions after role + (for tokens) scope intersection. */
  permissions: ReadonlySet<Permission>;
  /** Present only for API_TOKEN requests. */
  tokenId?: string;
  /** If set, the actor may only touch data belonging to this organization. */
  orgScopeId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}
