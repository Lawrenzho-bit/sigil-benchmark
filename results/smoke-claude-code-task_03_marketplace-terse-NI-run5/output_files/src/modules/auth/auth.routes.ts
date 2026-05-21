import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../lib/http.js";
import { BadRequest } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import * as authService from "./auth.service.js";
import { exchangeGoogleCode, googleAuthUrl } from "./oauth.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  displayName: z.string().min(1).max(120),
  asSeller: z.boolean().default(false),
});

authRouter.post(
  "/register",
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { user, tokens } = await authService.register(req.body);
    res.status(201).json({
      user: { id: user.id, email: user.email, displayName: user.displayName, roles: user.roles },
      ...tokens,
    });
  }),
);

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    res.json(await authService.login(req.body.email, req.body.password));
  }),
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post(
  "/refresh",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    res.json(await authService.refresh(req.body.refreshToken));
  }),
);

authRouter.post(
  "/logout",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    await authService.logout(req.body.refreshToken);
    res.status(204).end();
  }),
);

// ---- OAuth (Google) ----

authRouter.get(
  "/oauth/google",
  asyncHandler(async (_req, res) => {
    // `state` should be persisted (e.g. signed cookie) and checked on callback;
    // kept inline here for brevity.
    const state = crypto.randomBytes(16).toString("hex");
    res.json({ authUrl: googleAuthUrl(state), state });
  }),
);

authRouter.get(
  "/oauth/google/callback",
  asyncHandler(async (req, res) => {
    const code = req.query.code;
    if (typeof code !== "string") throw BadRequest("Missing authorization code");
    const profile = await exchangeGoogleCode(code);
    const tokens = await authService.loginWithOAuth({
      provider: "google",
      providerUserId: profile.sub,
      email: profile.email,
      displayName: profile.name ?? profile.email,
    });
    // Hand the tokens back to the SPA via a redirect fragment.
    res.redirect(`${env.WEB_URL}/auth/callback#accessToken=${tokens.accessToken}`);
  }),
);
