/**
 * Role definitions. Each of the five admin roles maps to an explicit set of
 * permissions. Authorization is allow-list only: a request is permitted iff
 * the principal's permission set contains the required permission.
 */
import { AdminRole } from '@prisma/client';
import { PERMISSIONS, ALL_PERMISSIONS, type Permission } from './permissions';

const P = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  // Full control, including managing this tool's own operators and roles.
  SUPER_ADMIN: [...ALL_PERMISSIONS],

  // Day-to-day account operations. Cannot manage other admin operators.
  ACCOUNT_ADMIN: [
    P.USERS_READ,
    P.USERS_WRITE,
    P.USERS_DEACTIVATE,
    P.USERS_IMPERSONATE,
    P.ORGS_READ,
    P.ORGS_WRITE,
    P.AUDIT_READ,
    P.BULK_IMPORT,
    P.BULK_EXPORT,
    P.HEALTH_READ,
    P.FLAGS_READ,
    P.FLAGS_WRITE,
    P.COMMS_SEND,
    P.TOKENS_READ,
    P.TOKENS_MANAGE,
  ],

  // Front-line support: read users/orgs and impersonate to reproduce issues.
  SUPPORT: [
    P.USERS_READ,
    P.USERS_IMPERSONATE,
    P.ORGS_READ,
    P.AUDIT_READ,
    P.HEALTH_READ,
    P.FLAGS_READ,
    P.TOKENS_READ,
  ],

  // Finance: read access to orgs/users/billing-adjacent data, no mutations.
  FINANCE: [
    P.USERS_READ,
    P.ORGS_READ,
    P.AUDIT_READ,
    P.HEALTH_READ,
    P.BULK_EXPORT,
    P.TOKENS_READ,
  ],

  // Read-only auditor. Can see everything, change nothing.
  READ_ONLY: [
    P.USERS_READ,
    P.ORGS_READ,
    P.AUDIT_READ,
    P.HEALTH_READ,
    P.FLAGS_READ,
    P.TOKENS_READ,
  ],
};

/** Resolve a role to its permission set. */
export function permissionsForRole(role: AdminRole): Set<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export const ALL_ROLES = Object.values(AdminRole);
