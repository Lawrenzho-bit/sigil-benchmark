/**
 * The complete set of fine-grained permissions in the system. Roles (see
 * roles.ts) are defined purely as sets of these strings, and API token scopes
 * are drawn from the same vocabulary — so there is exactly one authorization
 * primitive to reason about.
 */
export const PERMISSIONS = {
  // User management
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_DEACTIVATE: 'users:deactivate',
  USERS_IMPERSONATE: 'users:impersonate',

  // Customer / organization browser
  ORGS_READ: 'orgs:read',
  ORGS_WRITE: 'orgs:write',

  // Audit log
  AUDIT_READ: 'audit:read',

  // Bulk operations
  BULK_IMPORT: 'bulk:import',
  BULK_EXPORT: 'bulk:export',

  // System health
  HEALTH_READ: 'health:read',

  // Feature flags
  FLAGS_READ: 'flags:read',
  FLAGS_WRITE: 'flags:write',

  // Communications
  COMMS_SEND: 'comms:send',

  // API tokens
  TOKENS_READ: 'tokens:read',
  TOKENS_MANAGE: 'tokens:manage',

  // Admin-user / role administration (this tool's own operators)
  ADMIN_MANAGE: 'admin:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/** Type guard — used when validating user-supplied API token scopes. */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
