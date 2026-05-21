/**
 * The authoritative authorization model.
 *
 * Permissions are fine-grained `resource:action` strings. Roles map to a fixed
 * set of permissions. API tokens carry their own scope list; a token's
 * effective permissions are the INTERSECTION of its creator's role permissions
 * and its declared scopes (a token can never exceed its creator's authority).
 *
 * This file is the single source of truth — changing access means changing the
 * matrix here, and the rbac test locks the matrix against accidental drift.
 */
import { AdminRole } from '@prisma/client';

export const ALL_PERMISSIONS = [
  // Customer end users
  'users:read',
  'users:write',
  'users:deactivate',
  'users:impersonate',
  // Customer organizations
  'orgs:read',
  'orgs:write',
  // Audit log
  'audit:read',
  // Bulk import/export
  'bulk:import',
  'bulk:export',
  // System health
  'health:read',
  // Feature flags
  'flags:read',
  'flags:write',
  // Broadcast communications
  'comms:read',
  'comms:send',
  // API tokens
  'tokens:read',
  'tokens:write',
  // Managing admin users & their roles (the keys to the kingdom)
  'admins:read',
  'admins:manage',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

// Every read-only permission, used to build the READ_ONLY role.
const READ_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.endsWith(':read')) as Permission[];

/**
 * Role → permission matrix. Explicit and intentionally verbose: authorization
 * should be auditable by reading, not by deduction.
 */
export const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<Permission>> = {
  // Unrestricted. The only role that can manage other admins.
  SUPER_ADMIN: new Set<Permission>(ALL_PERMISSIONS),

  // Day-to-day operations across users, orgs, flags and comms — but cannot
  // manage admin accounts or roles.
  ACCOUNT_ADMIN: new Set<Permission>([
    'users:read',
    'users:write',
    'users:deactivate',
    'users:impersonate',
    'orgs:read',
    'orgs:write',
    'audit:read',
    'bulk:import',
    'bulk:export',
    'health:read',
    'flags:read',
    'flags:write',
    'comms:read',
    'comms:send',
    'tokens:read',
    'tokens:write',
    'admins:read',
  ]),

  // Customer-facing support: can fix and impersonate users, but not delete
  // orgs, run imports, or change flags.
  SUPPORT: new Set<Permission>([
    'users:read',
    'users:write',
    'users:impersonate',
    'orgs:read',
    'audit:read',
    'health:read',
    'flags:read',
    'comms:read',
    'comms:send',
    'tokens:read',
  ]),

  // Billing/finance: read-heavy, plus export and token management for
  // reconciliation integrations.
  FINANCE: new Set<Permission>([
    'users:read',
    'orgs:read',
    'audit:read',
    'bulk:export',
    'health:read',
    'flags:read',
    'comms:read',
    'tokens:read',
    'tokens:write',
  ]),

  // Can see everything, change nothing.
  READ_ONLY: new Set<Permission>(READ_PERMISSIONS),
};

export function permissionsForRole(role: AdminRole): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}

/**
 * Effective permissions for an API token: the token's creator's role
 * permissions, narrowed to the token's declared scopes.
 */
export function effectiveTokenPermissions(role: AdminRole, scopes: string[]): Set<Permission> {
  const rolePerms = ROLE_PERMISSIONS[role];
  const result = new Set<Permission>();
  for (const scope of scopes) {
    if (isPermission(scope) && rolePerms.has(scope)) result.add(scope);
  }
  return result;
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ACCOUNT_ADMIN: 'Account Admin',
  SUPPORT: 'Support',
  FINANCE: 'Finance',
  READ_ONLY: 'Read-Only',
};
