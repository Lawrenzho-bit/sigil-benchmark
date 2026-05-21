import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface IssueContext {
  userId: string;
  email: string;
  role: string;
  userAgent?: string;
  ip?: string;
}

/**
 * Issues short-lived access tokens (JWT) and long-lived refresh tokens.
 * Refresh tokens are opaque random strings; only their SHA-256 hash is
 * persisted, and rotation revokes the previous token (re-use detection).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issuePair(ctx: IssueContext): Promise<TokenPair> {
    const accessTtl = this.config.get<number>('JWT_ACCESS_TTL', 900);
    const refreshTtl = this.config.get<number>('JWT_REFRESH_TTL', 2_592_000);

    const accessToken = await this.jwt.signAsync(
      { sub: ctx.userId, email: ctx.email, role: ctx.role },
      { secret: this.config.get('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: ctx.userId,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
        userAgent: ctx.userAgent,
        ip: ctx.ip,
      },
    });

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  /**
   * Validates a refresh token and rotates it. If a revoked token is presented,
   * the whole token family for that user is revoked (theft mitigation).
   */
  async rotate(refreshToken: string, ctx: Omit<IssueContext, 'email' | 'role'>): Promise<TokenPair> {
    const tokenHash = this.hash(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new Error('INVALID_REFRESH_TOKEN');
    }
    if (record.revokedAt) {
      // Re-use of an already-rotated token => probable theft.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new Error('REFRESH_TOKEN_REUSED');
    }

    const pair = await this.issuePair({
      userId: record.userId,
      email: record.user.email,
      role: record.user.role,
      userAgent: ctx.userAgent,
      ip: ctx.ip,
    });

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedById: this.hash(pair.refreshToken) },
    });

    return pair;
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
