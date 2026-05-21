import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addToCart, getCart, setCartItemQuantity } from "./cart.service.js";
import { startCheckout } from "../checkout/checkout.service.js";

export async function cartRoutes(app: FastifyInstance) {
  app.get("/api/cart", { preHandler: app.requireAuth }, async (req) =>
    getCart(req.auth!.userId),
  );

  app.post("/api/cart/items", { preHandler: app.requireAuth }, async (req) => {
    const { listingId, quantity } = z
      .object({ listingId: z.string(), quantity: z.number().int().positive() })
      .parse(req.body);
    return addToCart(req.auth!.userId, listingId, quantity);
  });

  app.patch(
    "/api/cart/items/:itemId",
    { preHandler: app.requireAuth },
    async (req) => {
      const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
      const { quantity } = z
        .object({ quantity: z.number().int().min(0) })
        .parse(req.body);
      return setCartItemQuantity(req.auth!.userId, itemId, quantity);
    },
  );

  app.post(
    "/api/checkout",
    { preHandler: app.requireAuth },
    async (req) => {
      const body = z.object({ shippingAddressId: z.string() }).parse(req.body);
      return startCheckout(req.auth!.userId, body);
    },
  );
}
