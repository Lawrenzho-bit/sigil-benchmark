import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { startCheckout } from "./checkout.service.js";

export const checkoutRouter = Router();

checkoutRouter.use(requireAuth);

const checkoutSchema = z.object({
  // Buyer's shipping destination — drives marketplace-facilitator tax.
  shippingCountry: z.string().length(2).toUpperCase(),
});

// Creates a checkout from the current cart and returns a Stripe client secret.
// The client confirms the payment with Stripe.js; the server is notified of
// the outcome via the Stripe webhook (see /webhooks/stripe).
checkoutRouter.post(
  "/",
  validateBody(checkoutSchema),
  asyncHandler(async (req, res) => {
    const result = await startCheckout(req.auth!.userId, req.body.shippingCountry);
    res.status(201).json(result);
  }),
);
