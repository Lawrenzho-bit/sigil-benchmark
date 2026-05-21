import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { TaxService } from '../tax/tax.service';
import { CartService } from '../cart/cart.service';
import { CheckoutDto } from './dto/checkout.dto';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly tax: TaxService,
    private readonly cart: CartService,
  ) {}

  /**
   * Turns the buyer's cart into one OrderGroup with one Order per seller
   * (so each seller is fulfilled and paid out independently), calculates the
   * marketplace-facilitator tax, and opens a Stripe PaymentIntent.
   *
   * Funds settle to the platform; per-seller proceeds (net of the platform
   * fee) are transferred during the weekly payout run — see PayoutsService.
   */
  async createCheckout(userId: string, dto: CheckoutDto) {
    const { items } = await this.cart.getCart(userId);
    if (items.length === 0) throw new BadRequestException('Cart is empty');

    // Re-validate every line against the live listing before charging.
    const detailed = await Promise.all(
      items.map(async (item) => {
        const listing = await this.prisma.listing.findUnique({
          where: { id: item.listingId },
          include: { seller: true },
        });
        if (!listing || listing.status !== 'ACTIVE') {
          throw new BadRequestException(`Listing ${item.listingId} is no longer available`);
        }
        if (listing.inventory < item.quantity) {
          throw new BadRequestException(`Insufficient stock for "${listing.title}"`);
        }
        return { item, listing };
      }),
    );

    const currency = detailed[0].listing.currency;
    if (detailed.some((d) => d.listing.currency !== currency)) {
      throw new BadRequestException('All items in a checkout must share one currency');
    }

    // Group lines by seller.
    const bySeller = new Map<string, typeof detailed>();
    for (const d of detailed) {
      const key = d.listing.sellerId;
      bySeller.set(key, [...(bySeller.get(key) ?? []), d]);
    }

    const subtotalCents = detailed.reduce(
      (s, d) => s + d.listing.priceCents * d.item.quantity,
      0,
    );
    const taxCalc = this.tax.calculate(dto.billingCountry, subtotalCents);
    const totalCents = subtotalCents + taxCalc.taxCents;

    // Persist the order graph, then create the PaymentIntent.
    const group = await this.prisma.$transaction(async (tx) => {
      const grp = await tx.orderGroup.create({
        data: {
          buyerId: userId,
          paymentStatus: 'PENDING',
          subtotalCents,
          taxCents: taxCalc.taxCents,
          totalCents,
          currency,
          shippingAddress: dto.shippingAddress as object,
          billingCountry: dto.billingCountry,
        },
      });

      for (const [sellerId, lines] of bySeller) {
        const sellerSubtotal = lines.reduce(
          (s, d) => s + d.listing.priceCents * d.item.quantity,
          0,
        );
        const platformFee = this.stripe.computePlatformFee(sellerSubtotal);

        await tx.order.create({
          data: {
            groupId: grp.id,
            sellerId,
            status: 'PENDING_PAYMENT',
            subtotalCents: sellerSubtotal,
            // Tax is held and remitted by the platform as facilitator.
            taxCents: Math.round((taxCalc.taxCents * sellerSubtotal) / subtotalCents),
            platformFeeCents: platformFee,
            sellerNetCents: sellerSubtotal - platformFee,
            currency,
            items: {
              create: lines.map((d) => ({
                listingId: d.listing.id,
                titleSnapshot: d.listing.title,
                unitPriceCents: d.listing.priceCents,
                quantity: d.item.quantity,
              })),
            },
          },
        });
      }

      await tx.taxRecord.create({
        data: {
          groupId: grp.id,
          jurisdiction: taxCalc.jurisdiction,
          taxType: taxCalc.taxType,
          ratePct: taxCalc.ratePct,
          taxableCents: taxCalc.taxableCents,
          taxCents: taxCalc.taxCents,
          facilitatorLiable: taxCalc.facilitatorLiable,
        },
      });

      return grp;
    });

    const intent = await this.stripe.client.paymentIntents.create({
      amount: totalCents,
      currency: currency.toLowerCase(),
      // Links the charge to the order graph for reconciliation + transfers.
      transfer_group: group.id,
      metadata: { orderGroupId: group.id, buyerId: userId },
      automatic_payment_methods: { enabled: true },
    });

    await this.prisma.$transaction([
      this.prisma.orderGroup.update({
        where: { id: group.id },
        data: { stripePaymentIntentId: intent.id },
      }),
      this.prisma.payment.create({
        data: {
          groupId: group.id,
          stripePaymentIntentId: intent.id,
          status: 'PENDING',
          amountCents: totalCents,
          currency,
        },
      }),
    ]);

    return {
      orderGroupId: group.id,
      clientSecret: intent.client_secret,
      subtotalCents,
      taxCents: taxCalc.taxCents,
      totalCents,
      currency,
    };
  }

  /**
   * Stripe `payment_intent.succeeded` handler. Idempotent: a repeated event id
   * is ignored. Confirms payment, decrements inventory, and clears the cart.
   */
  async handlePaymentSucceeded(paymentIntentId: string, eventId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { group: { include: { orders: { include: { items: true } } } } },
    });
    if (!payment) {
      this.logger.warn(`No payment for intent ${paymentIntentId}`);
      return;
    }
    if (payment.lastEventId === eventId || payment.status === 'PAID') return;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'PAID', lastEventId: eventId },
      });
      await tx.orderGroup.update({
        where: { id: payment.groupId },
        data: { paymentStatus: 'PAID' },
      });
      await tx.order.updateMany({
        where: { groupId: payment.groupId },
        data: { status: 'PAID' },
      });
      // Decrement inventory atomically per line.
      for (const order of payment.group.orders) {
        for (const item of order.items) {
          await tx.listing.update({
            where: { id: item.listingId },
            data: { inventory: { decrement: item.quantity } },
          });
        }
      }
      // Empty the buyer's cart.
      const cart = await tx.cart.findFirst({ where: { userId: payment.group.buyerId } });
      if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    });

    this.logger.log(`Order group ${payment.groupId} marked PAID`);
  }

  async handlePaymentFailed(paymentIntentId: string, eventId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (!payment || payment.status === 'PAID') return;

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', lastEventId: eventId },
      }),
      this.prisma.orderGroup.update({
        where: { id: payment.groupId },
        data: { paymentStatus: 'FAILED' },
      }),
    ]);
  }
}
