import crypto from "node:crypto";
import { prisma } from "../../lib/db.js";
import { config } from "../../config.js";
import { badRequest } from "../../lib/errors.js";
import { issueSession } from "./auth.service.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function googleAuthorizeUrl(state: string) {
  if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_OAUTH_REDIRECT_URI) {
    throw badRequest("Google OAuth not configured");
  }
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", config.GOOGLE_OAUTH_CLIENT_ID);
  u.searchParams.set("redirect_uri", config.GOOGLE_OAUTH_REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  return u.toString();
}

export function newState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export async function exchangeCode(code: string): Promise<GoogleUserInfo> {
  if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw badRequest("Google OAuth not configured");
  }
  const body = new URLSearchParams({
    code,
    client_id: config.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI!,
    grant_type: "authorization_code",
  });
  const tokRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokRes.ok) throw badRequest("OAuth token exchange failed");
  const tok = (await tokRes.json()) as { access_token: string };
  const uiRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!uiRes.ok) throw badRequest("OAuth userinfo failed");
  return (await uiRes.json()) as GoogleUserInfo;
}

export async function loginOrLinkGoogle(
  info: GoogleUserInfo,
  ctx: { ip?: string; ua?: string },
) {
  if (!info.email || !info.email_verified) throw badRequest("Google account email not verified");

  const existing = await prisma.oAuthIdentity.findUnique({
    where: { provider_providerSub: { provider: "google", providerSub: info.sub } },
    include: { user: true },
  });
  if (existing) {
    return issueSession(existing.userId, existing.user.roles, ctx);
  }
  // Link to existing email user, or create new.
  let user = await prisma.user.findUnique({ where: { email: info.email.toLowerCase() } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: info.email.toLowerCase(),
        displayName: info.name ?? info.email,
        emailVerifiedAt: new Date(),
      },
    });
  }
  await prisma.oAuthIdentity.create({
    data: { userId: user.id, provider: "google", providerSub: info.sub },
  });
  return issueSession(user.id, user.roles, ctx);
}
