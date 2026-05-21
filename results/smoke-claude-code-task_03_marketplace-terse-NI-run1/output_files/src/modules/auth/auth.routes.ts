import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assertPasswordStrength,
  issueSession,
  login,
  logout,
  refreshSession,
  register,
} from "./auth.service.js";
import {
  exchangeCode,
  googleAuthorizeUrl,
  loginOrLinkGoogle,
  newState,
} from "./oauth.google.js";
import { badRequest } from "../../lib/errors.js";
import { redis } from "../../lib/redis.js";
import { config } from "../../config.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string(),
        displayName: z.string().min(1).max(120),
      })
      .parse(req.body);
    assertPasswordStrength(body.password);
    const user = await register(body);
    const session = await issueSession(user.id, user.roles, {
      ip: req.ip,
      ua: req.headers["user-agent"],
    });
    return { user: { id: user.id, email: user.email }, ...session };
  });

  app.post("/api/auth/login", async (req) => {
    const { email, password } = z
      .object({ email: z.string().email(), password: z.string() })
      .parse(req.body);
    return login(email, password, { ip: req.ip, ua: req.headers["user-agent"] });
  });

  app.post("/api/auth/refresh", async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    return refreshSession(refreshToken);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    await logout(refreshToken);
    return reply.code(204).send();
  });

  // --- OAuth: Google ---
  app.get("/api/auth/oauth/google/start", async (_req, reply) => {
    const state = newState();
    await redis.setex(`oauth:state:${state}`, 600, "1");
    return reply.redirect(googleAuthorizeUrl(state));
  });

  app.get("/api/auth/oauth/google/callback", async (req) => {
    const q = z
      .object({ code: z.string(), state: z.string() })
      .parse(req.query);
    const ok = await redis.del(`oauth:state:${q.state}`);
    if (!ok) throw badRequest("Invalid OAuth state");
    const info = await exchangeCode(q.code);
    return loginOrLinkGoogle(info, { ip: req.ip, ua: req.headers["user-agent"] });
  });

  app.get("/api/auth/me", { preHandler: app.requireAuth }, async (req) => {
    return { userId: req.auth!.userId, roles: req.auth!.roles };
  });

  // Touch config to silence unused-import warning when COOKIE_DOMAIN is later used by frontend wrapper.
  void config.COOKIE_DOMAIN;
}
