import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db';
import { parse } from '../../lib/validation';
import { conflict, notFound, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../auth/password';
import { signAccessToken } from '../../auth/jwt';
import { requireAuth } from '../../auth/middleware';
import { audit } from '../admin/audit';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'password must be at least 10 characters'),
  displayName: z.string().min(1).max(80),
  countryCode: z.string().length(2).default('US'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req) => {
    const body = parse(registerSchema, req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('Email already registered');

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName,
        countryCode: body.countryCode.toUpperCase(),
      },
    });
    await audit(user.id, 'user.register', 'User', user.id);
    return {
      token: signAccessToken({ sub: user.id, roles: user.roles }),
      user: publicUser(user),
    };
  });

  app.post('/auth/login', async (req) => {
    const body = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Constant-ish failure path: same error whether email or password is wrong.
    if (!user || !user.passwordHash) throw unauthorized('Invalid credentials');
    if (user.status !== 'ACTIVE') throw unauthorized('Account is not active');
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      throw unauthorized('Invalid credentials');
    }
    return {
      token: signAccessToken({ sub: user.id, roles: user.roles }),
      user: publicUser(user),
    };
  });

  // OAuth: schema + route placeholder only. A real provider flow (PKCE,
  // state, token exchange) is not implemented — see STATUS.md.
  app.get('/auth/oauth/:provider', async () => {
    return { error: 'OAuth not implemented in this foundation' };
  });

  app.get('/me', async (req) => {
    const auth = requireAuth(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw notFound('User not found');
    return publicUser(user);
  });

  app.patch('/me', async (req) => {
    const auth = requireAuth(req);
    const body = parse(
      z.object({
        displayName: z.string().min(1).max(80).optional(),
        countryCode: z.string().length(2).optional(),
      }),
      req.body,
    );
    const user = await prisma.user.update({
      where: { id: auth.id },
      data: {
        displayName: body.displayName,
        countryCode: body.countryCode?.toUpperCase(),
      },
    });
    return publicUser(user);
  });
}

function publicUser(u: {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  countryCode: string;
  status: string;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    roles: u.roles,
    countryCode: u.countryCode,
    status: u.status,
  };
}
