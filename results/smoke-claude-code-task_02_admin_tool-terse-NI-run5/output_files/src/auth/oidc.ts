/**
 * OpenID Connect authentication strategy (Authorization Code + PKCE).
 *
 * Activated only when OIDC_ENABLED=true. The issuer is discovered at startup
 * via the IdP's /.well-known/openid-configuration document.
 */
import { Issuer, Strategy as OidcStrategy, type TokenSet, type UserinfoResponse } from 'openid-client';
import { config } from '../config';
import { logger } from '../logger';
import { provisionFromSso } from './provisioning';

export async function buildOidcStrategy(): Promise<OidcStrategy<Record<string, unknown>>> {
  if (!config.OIDC_ISSUER_URL || !config.OIDC_CLIENT_ID || !config.OIDC_CLIENT_SECRET) {
    throw new Error('OIDC_ENABLED is true but OIDC_ISSUER_URL / CLIENT_ID / CLIENT_SECRET are missing');
  }

  const issuer = await Issuer.discover(config.OIDC_ISSUER_URL);
  logger.info({ issuer: issuer.metadata.issuer }, 'OIDC issuer discovered');

  const client = new issuer.Client({
    client_id: config.OIDC_CLIENT_ID,
    client_secret: config.OIDC_CLIENT_SECRET,
    redirect_uris: [config.oidcCallbackUrl],
    response_types: ['code'],
  });

  const verify = async (
    tokenSet: TokenSet,
    userinfo: UserinfoResponse,
    done: (err: unknown, user?: Record<string, unknown>) => void,
  ) => {
    try {
      const claims = { ...tokenSet.claims(), ...userinfo };
      const email = String(claims.email ?? '');
      const user = await provisionFromSso({
        provider: 'OIDC',
        subject: String(claims.sub ?? email),
        email,
        name: String(claims.name ?? claims.preferred_username ?? email),
      });
      done(null, user as unknown as Record<string, unknown>);
    } catch (err) {
      logger.warn({ err }, 'OIDC login rejected');
      done(err);
    }
  };

  return new OidcStrategy(
    {
      client,
      params: { scope: config.OIDC_SCOPE },
      usePKCE: true,
    },
    verify,
  );
}
