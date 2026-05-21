import { prisma } from "../../db/client.js";
import { BadRequest, NotFound } from "../../lib/errors.js";
import { publicUrl } from "../../lib/s3.js";

// Returns the user's cart, creating an empty one on first access.
async function ensureCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function getCart(userId: string) {
  const cart = await ensureCart(userId);
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: { listing: { include: { photos: { orderBy: { position: "asc" }, take: 1 } } } },
  });

  const lines = items.map((it) => ({
    id: it.id,
    listingId: it.listingId,
    title: it.listing.title,
    unitPrice: it.listing.priceAmount,
    currency: it.listing.currency,
    quantity: it.quantity,
    lineTotal: it.listing.priceAmount * it.quantity,
    available: it.listing.status === "ACTIVE" && it.listing.inventory >= it.quantity,
    thumbnail: it.listing.photos[0] ? publicUrl(it.listing.photos[0].s3Key) : null,
  }));
  return {
    cartId: cart.id,
    items: lines,
    subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
  };
}

export async function addItem(userId: string, listingId: string, quantity: number) {
  const cart = await ensureCart(userId);
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.status !== "ACTIVE") throw NotFound("Listing not available");
  if (listing.sellerId === userId) throw BadRequest("You cannot buy your own listing");
  if (listing.inventory < quantity) throw BadRequest("Not enough inventory");

  await prisma.cartItem.upsert({
    where: { cartId_listingId: { cartId: cart.id, listingId } },
    update: { quantity },
    create: { cartId: cart.id, listingId, quantity },
  });
  return getCart(userId);
}

export async function updateItem(userId: string, itemId: string, quantity: number) {
  const cart = await ensureCart(userId);
  if (quantity <= 0) {
    await prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
  } else {
    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { listing: true },
    });
    if (!item) throw NotFound("Cart item not found");
    if (item.listing.inventory < quantity) throw BadRequest("Not enough inventory");
    await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
  }
  return getCart(userId);
}

export async function removeItem(userId: string, itemId: string) {
  const cart = await ensureCart(userId);
  await prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
  return getCart(userId);
}

export async function clearCart(userId: string) {
  const cart = await ensureCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}
