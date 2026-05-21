import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buyerConfirmDelivery,
  getOrderForUser,
  listBuyerOrders,
  listSellerSubOrders,
  markSubOrderDelivered,
  markSubOrderShipped,
} from "./orders.service.js";

export async function orderRoutes(app: FastifyInstance) {
  app.get("/api/orders", { preHandler: app.requireAuth }, async (req) => {
    const q = z
      .object({ cursor: z.string().optional(), limit: z.coerce.number().int().max(50).optional() })
      .parse(req.query);
    return listBuyerOrders(req.auth!.userId, q.cursor, q.limit);
  });

  app.get("/api/orders/:id", { preHandler: app.requireAuth }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return getOrderForUser(id, req.auth!.userId);
  });

  app.get(
    "/api/seller/sub-orders",
    { preHandler: app.requireAuth },
    async (req) => {
      const q = z
        .object({
          status: z
            .enum([
              "PENDING_PAYMENT",
              "PAID",
              "FULFILLING",
              "SHIPPED",
              "DELIVERED",
              "COMPLETED",
              "CANCELLED",
              "REFUNDED",
              "DISPUTED",
            ])
            .optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().int().max(50).optional(),
        })
        .parse(req.query);
      return listSellerSubOrders(req.auth!.userId, q.status, q.cursor, q.limit);
    },
  );

  app.post(
    "/api/seller/sub-orders/:id/ship",
    { preHandler: app.requireAuth },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({ carrier: z.string().optional(), tracking: z.string().optional() })
        .parse(req.body);
      return markSubOrderShipped(req.auth!.userId, id, body);
    },
  );

  app.post(
    "/api/seller/sub-orders/:id/deliver",
    { preHandler: app.requireAuth },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return markSubOrderDelivered(req.auth!.userId, id);
    },
  );

  app.post(
    "/api/orders/sub/:id/confirm-delivery",
    { preHandler: app.requireAuth },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return buyerConfirmDelivery(req.auth!.userId, id);
    },
  );
}
