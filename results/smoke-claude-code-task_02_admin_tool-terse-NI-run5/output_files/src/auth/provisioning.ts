/**
 * Just-in-time (JIT) provisioning of admin users from SSO assertions.
 *
 * There are no local accounts: an AdminUser row exists only because someone
 * authenticated through the IdP. First-time logins are provisioned at the
 * lowest privilege (READ_ONLY) unless their email is on the SUPER_ADMIN_EMAILS
 * bootstrap list. Elevating anyone else is a deliberate `admins:manage` action.
 */
import { AdminUser, SsoProvider } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { writeAudit } from '../audit/audit';

export interface SsoProfile {
  provider: SsoProvider;
  /** Stable IdP subject / nameID. */
  subject: string;
  email: string;
  name: string;
}

export class LoginRejectedError extends Error {}

/**
 * Resolve an SSO assertion to an AdminUser, creating it on first sight.
 * Throws LoginRejectedError if the matched account has been deactivated.
 */
export async function provisionFromSso(profile: SsoProfile): Promise<AdminUser> {
  const email = profile.email.trim().toLowerCase();
  if (!email) throw new LoginRejectedError('SSO assertion contained no email address');

  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (existing) {
    if (!existing.isActive) {
      logger.warn({ email }, 'login rejected: deactivated admin account');
      throw new LoginRejectedError('This admin account has been deactivated');
    }
    const updated = await prisma.adminUser.update({
      where: { id: existing.id },
      data: {
        lastLoginAt: new Date(),
        // Keep display name and SSO linkage fresh, but never auto-change role.
        name: profile.name || existing.name,
        ssoProvider: profile.provider,
        ssoSubject: profile.subject,
      },
    });
    return updated;
  }

  const isBootstrapSuperAdmin = config.SUPER_ADMIN_EMAILS.includes(email);
  const created = await prisma.adminUser.create({
    data: {
      email,
      name: profile.name || email,
      role: isBootstrapSuperAdmin ? 'SUPER_ADMIN' : 'READ_ONLY',
      ssoProvider: profile.provider,
      ssoSubject: profile.subject,
      lastLoginAt: new Date(),
    },
  });

  await writeAudit({
    actor: { type: 'SYSTEM', id: null, email: 'system' },
    action: 'admin.provisioned',
    targetType: 'AdminUser',
    targetId: created.id,
    targetLabel: created.email,
    metadata: { role: created.role, provider: profile.provider, bootstrap: isBootstrapSuperAdmin },
  });
  logger.info({ email, role: created.role }, 'provisioned new admin user via SSO');
  return created;
}
