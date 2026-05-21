import { Router } from "express";
import { z } from "zod";
import type { OrderStatus } from "@prisma/client";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import * as orders from "./orders.service.js";

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

// Buyer's purchase history.
ordersRouter.get(
  "/buying",
  asyncHandler(async (req, res) => {
    res.json(await orders.listBuyerOrders(req.auth!.userId));
  }),
);

// Seller's sales queue, optionally filtered by status.
ordersRouter.get(
  "/selling",
  asyncHandler(async (req, res) => {
    const status = req.query.status as OrderStatus | undefined;
    res.json(await orders.listSellerOrders(req.auth!.userId, status));
  }),
);

ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await orders.getOrderForParty(req.params.id, req.auth!.userId));
  }),
);

const shipSchema = z.object({ trackingCode: z.string().max(120).optional() });

ordersRouter.post(
  "/:id/ship",
  validateBody(shipSchema),
  asyncHandler(async (req, res) => {
    res.json(await orders.markShipped(req.params.id, req.auth!.userId, req.body.trackingCode));
  }),
);

ordersRouter.post(
  "/:id/confirm-delivery",
  asyncHandler(async (req, res) => {
    res.json(await orders.confirmDelivery(req.params.id, req.auth!.userId));
  }),
);

ordersRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    res.json(await orders.cancelOrder(req.params.id, req.auth!.userId));
  }),
);
