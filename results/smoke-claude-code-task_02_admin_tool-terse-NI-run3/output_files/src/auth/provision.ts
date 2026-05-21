/**
 * Just-in-time (JIT) provisioning of admin users from an SSO assertion.
 *
 * Security rules enforced here:
 *  - Identity is keyed on the (lower-cased) email from the IdP.
 *  - Deactivated users are refused login even if the IdP still authenticates
 *    them — deactivation in this tool is authoritative.
 *  - Unknown users only get an account when ALLOW_JIT_PROVISIONING is on, and
 *    then only at the least-privileged READ_ONLY role.
 *  - Emails listed in BOOTSTRAP_SUPER_ADMINS get SUPER_ADMIN on first login.
 *    This is the only way to create the first operator; it never downgrades
 *    or escalates an existing account.
 */
import { AdminRole, SsoProvider, type AdminUser } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';

export interface SsoIdentity {
  email: string;
  name: string;
  provider: SsoProvider;
  subject: string;
}

export class LoginDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginDeniedError';
  }
}

export async function provisionFromSso(identity: SsoIdentity): Promise<AdminUser> {
  const email = identity.email.trim().toLowerCase();
  if (!email) {
    throw new LoginDeniedError('SSO assertion did not include an email address');
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (existing) {
    if (!existing.isActive) {
      throw new LoginDeniedError('This account has been deactivated');
    }
    return prisma.adminUser.update({
      where: { id: existing.id },
      data: {
        lastLoginAt: new Date(),
        ssoProvider: identity.provider,
        ssoSubject: identity.subject,
        // Keep the display name fresh from the IdP, but never the role.
        name: identity.name || existing.name,
      },
    });
  }

  const isBootstrapAdmin = config.BOOTSTRAP_SUPER_ADMINS.includes(email);
  if (!isBootstrapAdmin && !config.ALLOW_JIT_PROVISIONING) {
    throw new LoginDeniedError(
      'No admin account exists for this user and JIT provisioning is disabled',
    );
  }

  const role = isBootstrapAdmin ? AdminRole.SUPER_ADMIN : AdminRole.READ_ONLY;
  const created = await prisma.adminUser.create({
    data: {
      email,
      name: identity.name || email,
      role,
      isActive: true,
      ssoProvider: identity.provider,
      ssoSubject: identity.subject,
      lastLoginAt: new Date(),
    },
  });

  logger.info({ email, role, bootstrap: isBootstrapAdmin }, 'Provisioned new admin user');
  return created;
}
