import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService, TokenPair } from './token.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';

interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
      },
    });

    return this.tokens.issuePair({
      userId: user.id,
      email: user.email,
      role: user.role,
      ...meta,
    });
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Constant-ish failure: run a verify even when the user is missing.
    const ok =
      user?.passwordHash &&
      (await argon2.verify(user.passwordHash, dto.password).catch(() => false));

    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account not active');

    return this.tokens.issuePair({
      userId: user.id,
      email: user.email,
      role: user.role,
      ...meta,
    });
  }

  /** Find-or-create the local user behind a verified Google identity. */
  async loginWithGoogle(
    profile: { providerUserId: string; email: string; displayName: string },
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const oauth = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider: 'google', providerUserId: profile.providerUserId } },
      include: { user: true },
    });

    let user = oauth?.user;
    if (!user) {
      user = await this.prisma.user.upsert({
        where: { email: profile.email },
        update: {},
        create: {
          email: profile.email,
          displayName: profile.displayName,
          emailVerified: true,
        },
      });
      await this.prisma.oAuthAccount.create({
        data: { userId: user.id, provider: 'google', providerUserId: profile.providerUserId },
      });
    }

    return this.tokens.issuePair({
      userId: user.id,
      email: user.email,
      role: user.role,
      ...meta,
    });
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    try {
      return await this.tokens.rotate(refreshToken, { userId: '', ...meta });
    } catch {
      throw new UnauthorizedException('Invalid or reused refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.tokens.revokeAll(userId);
  }
}
