/**
 * SAML 2.0 authentication strategy.
 *
 * Activated only when SAML_ENABLED=true and the IdP metadata is configured.
 * The verify callback maps the SAML assertion onto our JIT provisioning logic.
 */
import { Strategy as SamlStrategy, type Profile, type VerifyWithoutRequest } from '@node-saml/passport-saml';
import { config } from '../config';
import { logger } from '../logger';
import { provisionFromSso } from './provisioning';

/** Pull an email out of the assortment of attribute names IdPs use. */
function extractEmail(profile: Profile): string {
  return (
    (profile.email as string) ||
    (profile.mail as string) ||
    (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] as string) ||
    (typeof profile.nameID === 'string' && profile.nameID.includes('@') ? profile.nameID : '') ||
    ''
  );
}

function extractName(profile: Profile, email: string): string {
  return (
    (profile.displayName as string) ||
    (profile.cn as string) ||
    [profile.givenName, profile.sn].filter(Boolean).join(' ') ||
    (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] as string) ||
    email
  );
}

export function buildSamlStrategy(): SamlStrategy {
  if (!config.SAML_ENTRY_POINT || !config.SAML_IDP_CERT) {
    throw new Error('SAML_ENABLED is true but SAML_ENTRY_POINT / SAML_IDP_CERT are missing');
  }

  const verify: VerifyWithoutRequest = async (profile, done) => {
    try {
      if (!profile) return done(new Error('Empty SAML profile'));
      const email = extractEmail(profile);
      const user = await provisionFromSso({
        provider: 'SAML',
        subject: profile.nameID || email,
        email,
        name: extractName(profile, email),
      });
      done(null, user as unknown as Record<string, unknown>);
    } catch (err) {
      logger.warn({ err }, 'SAML login rejected');
      done(err as Error);
    }
  };

  return new SamlStrategy(
    {
      callbackUrl: config.samlCallbackUrl,
      entryPoint: config.SAML_ENTRY_POINT,
      issuer: config.SAML_ISSUER,
      idpCert: config.SAML_IDP_CERT,
      privateKey: config.SAML_SP_PRIVATE_KEY || undefined,
      // Require the IdP to sign assertions; reject unsigned ones.
      wantAssertionsSigned: true,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
      acceptedClockSkewMs: 5000,
    },
    verify,
    // Logout verify — not used; sessions are terminated locally.
    (_profile, done) => done(null, {}),
  );
}
