/**
 * Passport configuration. Two SSO strategies are registered when configured:
 * SAML 2.0 and OIDC. There is deliberately no local-password strategy — the
 * tool is SSO-only.
 *
 * `serializeUser` stores only the AdminUser id in the session. `deserializeUser`
 * reloads the row on every request, so a deactivation or role change takes
 * effect immediately without waiting for the session to expire.
 */
import passport from 'passport';
import { Strategy as SamlStrategy, type Profile } from '@node-saml/passport-saml';
import { Strategy as OidcStrategy } from 'passport-openidconnect';
import { SsoProvider } from '@prisma/client';
import { config } from '../config';
import { logger } from '../logger';
import { prisma } from '../db';
import { provisionFromSso, type SsoIdentity } from './provision';

function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function configurePassport(): void {
  passport.serializeUser<string>((user, done) => {
    done(null, (user as { id: string }).id);
  });

  passport.deserializeUser<string>(async (id, done) => {
    try {
      const user = await prisma.adminUser.findUnique({ where: { id } });
      // A user deactivated mid-session must lose access on the next request.
      if (!user || !user.isActive) {
        done(null, false);
        return;
      }
      done(null, { id: user.id });
    } catch (err) {
      done(err);
    }
  });

  // ─── SAML 2.0 ────────────────────────────────────────────────────────────
  if (config.samlEnabled) {
    const signonVerify = (
      profile: Profile | null,
      done: (err: Error | null, user?: Express.User | false) => void,
    ) => {
      if (!profile) {
        done(new Error('Empty SAML profile'));
        return;
      }
      const attrs = profile as unknown as Record<string, unknown>;
      const identity: SsoIdentity = {
        email: firstString(profile.email, profile.nameID, attrs['mail']),
        name: firstString(
          attrs['displayName'],
          attrs['cn'],
          `${firstString(attrs['givenName'])} ${firstString(attrs['sn'])}`,
        ),
        provider: SsoProvider.SAML,
        subject: firstString(profile.nameID, profile.email),
      };
      provisionFromSso(identity)
        .then((user) => done(null, { id: user.id }))
        .catch((err) => done(err));
    };

    passport.use(
      new SamlStrategy(
        {
          callbackUrl: `${config.APP_BASE_URL}/auth/saml/callback`,
          entryPoint: config.SAML_ENTRY_POINT,
          issuer: config.SAML_ISSUER,
          idpCert: config.SAML_IDP_CERT,
          privateKey: config.SAML_SP_PRIVATE_KEY || undefined,
          signatureAlgorithm: 'sha256',
          wantAssertionsSigned: true,
          wantAuthnResponseSigned: true,
        },
        signonVerify,
        // Logout verify — we have nothing extra to do on SLO.
        (profile, done) => done(null, profile ? { id: profile.nameID } : false),
      ),
    );
    logger.info('SAML strategy enabled');
  }

  // ─── OIDC ────────────────────────────────────────────────────────────────
  if (config.oidcEnabled) {
    passport.use(
      'oidc',
      new OidcStrategy(
        {
          issuer: config.OIDC_ISSUER || config.OIDC_AUTHORIZATION_URL,
          authorizationURL: config.OIDC_AUTHORIZATION_URL,
          tokenURL: config.OIDC_TOKEN_URL,
          userInfoURL: config.OIDC_USERINFO_URL,
          clientID: config.OIDC_CLIENT_ID,
          clientSecret: config.OIDC_CLIENT_SECRET,
          callbackURL: `${config.APP_BASE_URL}/auth/oidc/callback`,
          scope: ['openid', 'profile', 'email'],
        },
        (
          _issuer: string,
          profile: Record<string, unknown>,
          _context: unknown,
          _idToken: unknown,
          _accessToken: unknown,
          _refreshToken: unknown,
          done: (err: Error | null, user?: Express.User | false) => void,
        ) => {
          const emails = profile.emails as Array<{ value: string }> | undefined;
          const name = profile.displayName as string | undefined;
          const identity: SsoIdentity = {
            email: firstString(emails?.[0]?.value, profile.email),
            name: firstString(name, (profile.username as string) ?? ''),
            provider: SsoProvider.OIDC,
            subject: firstString(profile.id, emails?.[0]?.value),
          };
          provisionFromSso(identity)
            .then((user) => done(null, { id: user.id }))
            .catch((err) => done(err));
        },
      ),
    );
    logger.info('OIDC strategy enabled');
  }

  if (!config.samlEnabled && !config.oidcEnabled) {
    logger.warn('No SSO provider configured — interactive login is unavailable');
  }
}

export { passport };
