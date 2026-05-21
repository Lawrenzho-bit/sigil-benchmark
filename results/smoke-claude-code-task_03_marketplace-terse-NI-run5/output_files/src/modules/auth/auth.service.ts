import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { BadRequest, Unauthorized } from "../../lib/errors.js";
import { generateRefreshToken, hashToken, signAccessToken } from "../../lib/jwt.js";

const BCRYPT_ROUNDS = 12;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Issues a fresh access/refresh pair and persists the refresh token hash.
async function issueTokens(user: Pick<User, "id" | "roles">): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub: user.id, roles: user.roles });
  const { token, tokenHash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000),
    },
  });
  return { accessToken, refreshToken: token, expiresIn: env.JWT_ACCESS_TTL };
}

export async function register(input: {
  email: string;
  password: string;
  displayName: string;
  asSeller: boolean;
}): Promise<{ user: User; tokens: TokenPair }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw BadRequest("An account with this email already exists");

  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      displayName: input.displayName,
      // A seller account always retains buyer capabilities too.
      roles: input.asSeller ? ["BUYER", "SELLER"] : ["BUYER"],
    },
  });
  return { user, tokens: await issueTokens(user) };
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Run a hash comparison even when the user is missing to blunt timing attacks.
  const hash = user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv";
  const ok = await bcrypt.compare(password, hash);
  if (!user || !user.passwordHash || !ok) throw Unauthorized("Invalid email or password");
  if (user.status !== "ACTIVE") throw Unauthorized("This account is not active");
  return issueTokens(user);
}

// Rotates a refresh token: the presented token is revoked and a new pair issued.
export async function refresh(rawToken: string): Promise<TokenPair> {
  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw Unauthorized("Invalid or expired refresh token");
  }
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  return issueTokens(stored.user);
}

export async function logout(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Finds or creates a user for an OAuth identity, then issues tokens.
export async function loginWithOAuth(input: {
  provider: string;
  providerUserId: string;
  email: string;
  displayName: string;
}): Promise<TokenPair> {
  const account = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: input.provider,
        providerUserId: input.providerUserId,
      },
    },
    include: { user: true },
  });
  if (account) return issueTokens(account.user);

  // Link to an existing email account or create a new one.
  const user = await prisma.user.upsert({
    where: { email: input.email.toLowerCase() },
    update: {},
    create: {
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      emailVerified: true,
      roles: ["BUYER"],
    },
  });
  await prisma.oAuthAccount.create({
    data: { provider: input.provider, providerUserId: input.providerUserId, userId: user.id },
  });
  return issueTokens(user);
}
