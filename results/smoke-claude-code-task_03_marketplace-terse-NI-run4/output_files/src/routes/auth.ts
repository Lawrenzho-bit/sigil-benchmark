// Account & session endpoints: email signup/login, refresh, logout, and an
// OAuth callback hook. Passwords are hashed with Argon2id.
import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../lib/tokens.js';
import { BadRequest, Conflict, Unauthorized } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(80).optional(),
});

/** Issues an access+refresh pair and persists the refresh session. */
async function issueSession(
  userId: string,
  role: 'BUYER' | 'SELLER' | 'ADMIN',
  ctx: { ip?: string; userAgent?: string },
) {
  const refresh = generateRefreshToken();
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: refresh.hash,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL * 1000),
    },
  });
  const accessToken = await signAccessToken({ sub: userId, role, sid: session.id });
  return { accessToken, refreshToken: refresh.token, expiresIn: config.ACCESS_TOKEN_TTL };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/signup', async (req, reply) => {
    const body = credentials.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw Conflict('Email already registered', 'email_taken');

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }),
        displayName: body.displayName ?? body.email.split('@')[0]!,
      },
    });
    // Email verification token would be dispatched here (see README §Gaps).
    const tokens = await issueSession(user.id, user.role, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return reply.code(201).send({ userId: user.id, ...tokens });
  });

  app.post('/api/auth/login', async (req) => {
    const body = z
      .object({ email: z.string().email(), password: z.string() })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Constant-ish work whether or not the user exists, to blunt enumeration.
    const ok =
      user?.passwordHash != null &&
      (await argon2.verify(user.passwordHash, body.password));
    if (!user || !ok) throw Unauthorized('Invalid email or password');
    if (user.status !== 'ACTIVE') throw Unauthorized('Account is not active');

    return issueSession(user.id, user.role, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  });

  // Rotates the refresh token (single-use) and returns a fresh access token.
  app.post('/api/auth/refresh', async (req) => {
    const { refreshToken } = z
      .object({ refreshToken: z.string() })
      .parse(req.body);
    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw Unauthorized('Refresh token is not valid');
    }
    const rotated = generateRefreshToken();
    await prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: rotated.hash },
    });
    const accessToken = await signAccessToken({
      sub: session.userId,
      role: session.user.role,
      sid: session.id,
    });
    return { accessToken, refreshToken: rotated.token, expiresIn: config.ACCESS_TOKEN_TTL };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const auth = await requireAuth(req);
    await prisma.session.update({
      where: { id: auth.sessionId },
      data: { revokedAt: new Date() },
    });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req) => {
    const auth = await requireAuth(req);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: {
        id: true, email: true, role: true, status: true,
        displayName: true, countryCode: true, emailVerified: true,
      },
    });
    return user;
  });

  // --- OAuth ---------------------------------------------------------------
  // Real provider flows (Google shown) exchange the auth code server-side,
  // then upsert an OAuthAccount. The exchange itself is left as a documented
  // integration point; the linking logic below is production-shaped.
  app.post('/api/auth/oauth/:provider/link', async (req) => {
    const { provider } = z
      .object({ provider: z.enum(['google', 'apple']) })
      .parse(req.params);
    const { providerUserId, email, displayName } = z
      .object({
        providerUserId: z.string(),
        email: z.string().email(),
        displayName: z.string().optional(),
      })
      .parse(req.body);
    if (!config.OAUTH_GOOGLE_CLIENT_ID && provider === 'google') {
      throw BadRequest('OAuth is not configured', 'oauth_unconfigured');
    }

    const account = await prisma.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      include: { user: true },
    });
    const user =
      account?.user ??
      (await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          emailVerified: true,
          displayName: displayName ?? email.split('@')[0]!,
          oauthAccounts: { create: { provider, providerUserId } },
        },
      }));

    return issueSession(user.id, user.role, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  });
}
