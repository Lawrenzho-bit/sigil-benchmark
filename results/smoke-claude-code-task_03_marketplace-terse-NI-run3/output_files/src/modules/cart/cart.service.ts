import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the user's cart, creating an empty one on first access. */
  private async ensureCart(userId: string) {
    const existing = await this.prisma.cart.findFirst({ where: { userId } });
    return existing ?? this.prisma.cart.create({ data: { userId } });
  }

  async getCart(userId: string) {
    const cart = await this.ensureCart(userId);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
        listing: {
          select: { id: true, title: true, priceCents: true, currency: true, status: true, inventory: true },
        },
      },
    });

    const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    return { cartId: cart.id, items, subtotalCents };
  }

  async addItem(userId: string, listingId: string, quantity: number) {
    if (quantity < 1) throw new BadRequestException('Quantity must be at least 1');

    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== 'ACTIVE') {
      throw new NotFoundException('Listing not available');
    }
    if (listing.inventory < quantity) {
      throw new BadRequestException('Insufficient inventory');
    }

    const cart = await this.ensureCart(userId);
    // Upsert: adding an existing listing increases its quantity.
    await this.prisma.cartItem.upsert({
      where: { cartId_listingId: { cartId: cart.id, listingId } },
      create: { cartId: cart.id, listingId, quantity, unitPriceCents: listing.priceCents },
      update: { quantity: { increment: quantity }, unitPriceCents: listing.priceCents },
    });
    return this.getCart(userId);
  }

  async updateQuantity(userId: string, listingId: string, quantity: number) {
    const cart = await this.ensureCart(userId);
    if (quantity <= 0) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, listingId } });
    } else {
      await this.prisma.cartItem.update({
        where: { cartId_listingId: { cartId: cart.id, listingId } },
        data: { quantity },
      });
    }
    return this.getCart(userId);
  }

  async removeItem(userId: string, listingId: string) {
    const cart = await this.ensureCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, listingId } });
    return this.getCart(userId);
  }

  async clear(userId: string) {
    const cart = await this.ensureCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.getCart(userId);
  }
}
