import { Router } from "express";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import * as payouts from "./payouts.service.js";

export const payoutsRouter = Router();

payoutsRouter.use(requireAuth, requireRole("SELLER"));

// Seller's payout history.
payoutsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await payouts.listSellerPayouts(req.auth!.userId));
  }),
);

// Seller's available + pending balance.
payoutsRouter.get(
  "/balance",
  asyncHandler(async (req, res) => {
    res.json(await payouts.sellerBalance(req.auth!.userId));
  }),
);
