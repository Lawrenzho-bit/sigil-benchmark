import argon2 from "argon2";
import { prisma } from "../../lib/db.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "../../lib/tokens.js";
import { badRequest, conflict, unauthorized } from "../../lib/errors.js";
import { config } from "../../config.js";

export async function register(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict("Email already registered");
  const passwordHash = await argon2.hash(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      passwordHash,
    },
  });
  return user;
}

export async function login(email: string, password: string, ctx: { ip?: string; ua?: string }) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user?.passwordHash) throw unauthorized("Invalid credentials");
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) throw unauthorized("Invalid credentials");
  if (user.status !== "ACTIVE") throw unauthorized(`Account ${user.status.toLowerCase()}`);
  return issueSession(user.id, user.roles, ctx);
}

export async function issueSession(
  userId: string,
  roles: ("BUYER" | "SELLER" | "ADMIN")[],
  ctx: { ip?: string; ua?: string },
) {
  const accessToken = signAccessToken({ sub: userId, roles });
  const refresh = generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SECONDS * 1000);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: refresh.hash,
      ip: ctx.ip,
      userAgent: ctx.ua,
      expiresAt,
    },
  });
  return {
    accessToken,
    refreshToken: refresh.plaintext,
    accessTokenExpiresIn: config.JWT_ACCESS_TTL_SECONDS,
  };
}

export async function refreshSession(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw unauthorized("Refresh token invalid");
  }
  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user || user.status !== "ACTIVE") throw unauthorized();
  // Rotate
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });
  return issueSession(user.id, user.roles, { ip: record.ip ?? undefined, ua: record.userAgent ?? undefined });
}

export async function logout(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function verifyEmail(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
}

export function assertPasswordStrength(pw: string) {
  if (pw.length < 10) throw badRequest("Password must be at least 10 characters");
}
