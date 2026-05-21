import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import * as disputes from "./disputes.service.js";

export const disputesRouter = Router();

disputesRouter.use(requireAuth);

const openSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(10).max(5000),
});

disputesRouter.post(
  "/",
  validateBody(openSchema),
  asyncHandler(async (req, res) => {
    const dispute = await disputes.openDispute(req.auth!.userId, req.body.orderId, req.body.reason);
    res.status(201).json(dispute);
  }),
);

disputesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await disputes.getDispute(req.params.id, req.auth!.userId));
  }),
);

const messageSchema = z.object({ body: z.string().min(1).max(5000) });

disputesRouter.post(
  "/:id/messages",
  validateBody(messageSchema),
  asyncHandler(async (req, res) => {
    res.json(await disputes.addDisputeMessage(req.params.id, req.auth!.userId, req.body.body));
  }),
);

disputesRouter.post(
  "/:id/escalate",
  asyncHandler(async (req, res) => {
    res.json(await disputes.escalateDispute(req.params.id, req.auth!.userId));
  }),
);
