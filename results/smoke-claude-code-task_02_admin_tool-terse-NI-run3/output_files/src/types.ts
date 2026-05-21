/** Shared application types. */
import type { AdminRole } from '@prisma/client';
import type { Permission } from './rbac/permissions';

/**
 * The authenticated principal behind a request — either an interactive admin
 * (session) or an API token. RBAC checks operate uniformly on `permissions`.
 */
export interface Principal {
  type: 'admin_user' | 'api_token';
  /** AdminUser.id for sessions; ApiToken.id for tokens. */
  id: string;
  /** AdminUser.id of the human ultimately responsible for the request. */
  adminUserId: string;
  email: string;
  role?: AdminRole;
  permissions: Set<Permission>;
  /** Present for token principals — used in audit metadata. */
  tokenName?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      requestId?: string;
    }
    // Passport stores the AdminUser id on the session as `req.user`.
    interface User {
      id: string;
    }
  }
}
