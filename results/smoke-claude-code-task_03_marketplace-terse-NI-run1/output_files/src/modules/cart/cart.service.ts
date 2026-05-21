import { prisma } from "../../lib/db.js";
import { badRequest, notFound } from "../../lib/errors.js";

export async function getOrCreateCart(buyerId: string) {
  const existing = await prisma.cart.findFirst({ where: { buyerId } });
  if (existing) return existing;
  return prisma.cart.create({ data: { buyerId } });
}

export async function addToCart(buyerId: string, listingId: string, quantity: number) {
  if (quantity < 1) throw badRequest("Quantity must be positive");
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.status !== "ACTIVE") throw notFound("Listing not available");
  if (listing.inventory < quantity) throw badRequest("Insufficient inventory");

  const cart = await getOrCreateCart(buyerId);
  const item = await prisma.cartItem.upsert({
    where: { cartId_listingId: { cartId: cart.id, listingId } },
    update: { quantity: { increment: quantity } },
    create: { cartId: cart.id, listingId, quantity },
  });
  return item;
}

export async function setCartItemQuantity(buyerId: string, itemId: string, quantity: number) {
  const item = await prisma.cartItem.findUnique({
    where: { id: itemId },
    include: { cart: true, listing: true },
  });
  if (!item || item.cart.buyerId !== buyerId) throw notFound();
  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: itemId } });
    return null;
  }
  if (item.listing.inventory < quantity) throw badRequest("Insufficient inventory");
  return prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
}

export async function getCart(buyerId: string) {
  const cart = await getOrCreateCart(buyerId);
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: { listing: { include: { store: true } } },
  });
  let subtotalCents = 0;
  for (const i of items) subtotalCents += i.listing.priceCents * i.quantity;
  return { cartId: cart.id, items, subtotalCents, currency: items[0]?.listing.currency ?? "usd" };
}

export async function clearCart(cartId: string) {
  await prisma.cartItem.deleteMany({ where: { cartId } });
}
