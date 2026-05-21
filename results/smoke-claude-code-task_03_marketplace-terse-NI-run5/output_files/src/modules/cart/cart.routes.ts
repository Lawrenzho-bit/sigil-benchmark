import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import * as cart from "./cart.service.js";

export const cartRouter = Router();

cartRouter.use(requireAuth);

cartRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await cart.getCart(req.auth!.userId));
  }),
);

const addSchema = z.object({
  listingId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999).default(1),
});

cartRouter.post(
  "/items",
  validateBody(addSchema),
  asyncHandler(async (req, res) => {
    res.json(await cart.addItem(req.auth!.userId, req.body.listingId, req.body.quantity));
  }),
);

const updateSchema = z.object({ quantity: z.number().int().min(0).max(999) });

cartRouter.patch(
  "/items/:itemId",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    res.json(await cart.updateItem(req.auth!.userId, req.params.itemId, req.body.quantity));
  }),
);

cartRouter.delete(
  "/items/:itemId",
  asyncHandler(async (req, res) => {
    res.json(await cart.removeItem(req.auth!.userId, req.params.itemId));
  }),
);

cartRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    await cart.clearCart(req.auth!.userId);
    res.status(204).end();
  }),
);
