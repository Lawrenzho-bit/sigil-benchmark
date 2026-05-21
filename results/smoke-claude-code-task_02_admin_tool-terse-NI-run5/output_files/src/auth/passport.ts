/**
 * Passport wiring: session (de)serialization and conditional strategy
 * registration. Only SSO strategies that are explicitly enabled are loaded.
 */
import passport from 'passport';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { buildSamlStrategy } from './saml';
import { buildOidcStrategy } from './oidc';

// Sessions store only the admin user id; the full record is reloaded per
// request so role/active-state changes take effect immediately.
passport.serializeUser((user, done) => {
  done(null, (user as { id: string }).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.adminUser.findUnique({ where: { id } });
    // A deactivated account's live sessions stop working at once.
    if (!user || !user.isActive) return done(null, false);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

/** Register enabled SSO strategies. Returns the list of active provider keys. */
export async function registerStrategies(): Promise<string[]> {
  const active: string[] = [];

  if (config.SAML_ENABLED) {
    passport.use('saml', buildSamlStrategy());
    active.push('saml');
    logger.info('SAML strategy registered');
  }

  if (config.OIDC_ENABLED) {
    passport.use('oidc', await buildOidcStrategy());
    active.push('oidc');
    logger.info('OIDC strategy registered');
  }

  if (active.length === 0 && !config.devModeActive) {
    logger.warn('No SSO strategy enabled and dev mode is off — nobody can log in');
  }
  return active;
}

export { passport };
