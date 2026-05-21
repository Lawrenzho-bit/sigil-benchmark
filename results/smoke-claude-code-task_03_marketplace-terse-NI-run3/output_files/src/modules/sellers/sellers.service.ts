import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class SellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Promotes a buyer to a seller: creates the SellerProfile, a Stripe Connect
   * Express account, and the empty KYC record. KYC (identity + bank account)
   * is then completed through the returned hosted onboarding link.
   */
  async startOnboarding(userId: string, businessName: string, businessType: string) {
    const existing = await this.prisma.sellerProfile.findUnique({ where: { userId } });
    if (existing) throw new ConflictException('Seller profile already exists');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const country = user.countryCode ?? this.config.get('PLATFORM_TAX_COUNTRY', 'IE');
    const account = await this.stripe.createConnectAccount(user.email, country);

    const profile = await this.prisma.sellerProfile.create({
      data: {
        userId,
        businessName,
        businessType,
        stripeAccountId: account.id,
        kycVerification: { create: { provider: 'stripe' } },
      },
    });
    // Buyers who onboard as sellers keep BUYER role visibility but gain SELLER.
    await this.prisma.user.update({ where: { id: userId }, data: { role: 'SELLER' } });

    return { sellerId: profile.id, onboarding: await this.onboardingLink(profile.id) };
  }

  /** Fresh hosted onboarding/KYC link for a seller. */
  async onboardingLink(sellerId: string) {
    const profile = await this.prisma.sellerProfile.findUnique({ where: { id: sellerId } });
    if (!profile?.stripeAccountId) throw new NotFoundException('Seller not found');

    const appUrl = this.config.get<string>('APP_URL');
    const link = await this.stripe.createAccountOnboardingLink(
      profile.stripeAccountId,
      `${appUrl}/api/v1/sellers/me/onboarding/refresh`,
      `${appUrl}/api/v1/sellers/me/onboarding/complete`,
    );
    return { url: link.url, expiresAt: link.expires_at };
  }

  async getMyProfile(userId: string) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
      include: { kycVerification: true, bankAccounts: true },
    });
    if (!profile) throw new NotFoundException('Not a seller');
    return profile;
  }

  /**
   * Applies Stripe `account.updated` webhook state to the local profile.
   * Drives the seller from PENDING_ONBOARDING -> ACTIVE once KYC clears.
   */
  async syncFromStripeAccount(account: {
    id: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    requirements?: { currently_due?: string[]; disabled_reason?: string | null };
  }) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { stripeAccountId: account.id },
    });
    if (!profile) return;

    const due = account.requirements?.currently_due ?? [];
    const kycVerified = account.details_submitted && account.payouts_enabled && due.length === 0;

    await this.prisma.$transaction([
      this.prisma.sellerProfile.update({
        where: { id: profile.id },
        data: {
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          kycStatus: kycVerified ? 'VERIFIED' : 'IN_PROGRESS',
          dsaTraderVerified: kycVerified,
          status: kycVerified ? 'ACTIVE' : profile.status,
        },
      }),
      this.prisma.kycVerification.update({
        where: { sellerId: profile.id },
        data: {
          identityVerified: account.details_submitted,
          bankVerified: account.payouts_enabled,
          pendingRequirements: due,
          lastCheckedAt: new Date(),
        },
      }),
    ]);
  }

  /** Guard helper: a seller may only list once KYC/DSA verification passes. */
  async assertCanList(userId: string): Promise<string> {
    const profile = await this.prisma.sellerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Not a seller');
    if (profile.status !== 'ACTIVE' || !profile.dsaTraderVerified) {
      throw new BadRequestException('Complete KYC verification before creating listings');
    }
    return profile.id;
  }
}
