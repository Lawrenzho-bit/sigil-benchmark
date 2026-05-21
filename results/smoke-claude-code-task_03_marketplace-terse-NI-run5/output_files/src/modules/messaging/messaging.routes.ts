import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import * as messaging from "./messaging.service.js";

export const messagingRouter = Router();

messagingRouter.use(requireAuth);

messagingRouter.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    res.json(await messaging.listConversations(req.auth!.userId));
  }),
);

const openSchema = z.object({
  sellerId: z.string().uuid(),
  listingId: z.string().uuid().optional(),
});

messagingRouter.post(
  "/conversations",
  validateBody(openSchema),
  asyncHandler(async (req, res) => {
    const convo = await messaging.openConversation(
      req.auth!.userId,
      req.body.sellerId,
      req.body.listingId,
    );
    res.status(201).json(convo);
  }),
);

messagingRouter.get(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    res.json(await messaging.getMessages(req.params.id, req.auth!.userId));
  }),
);

const sendSchema = z.object({ body: z.string().min(1).max(5000) });

messagingRouter.post(
  "/conversations/:id/messages",
  validateBody(sendSchema),
  asyncHandler(async (req, res) => {
    const message = await messaging.sendMessage(req.params.id, req.auth!.userId, req.body.body);
    res.status(201).json(message);
  }),
);
