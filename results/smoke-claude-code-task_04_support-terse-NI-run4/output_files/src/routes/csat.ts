import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { getSurveyByToken, submitSurvey } from '../services/csatService';

/**
 * CSAT survey API. These endpoints are intentionally unauthenticated — the
 * survey `token` (a 24-byte random string) is the capability. A token only
 * works once: submitting marks it responded.
 */
export const csatRouter = Router();

/** Fetch survey state for the customer-facing rating page. */
csatRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = z.string().min(10).parse(req.params.token);
    const survey = await getSurveyByToken(token);
    res.json({
      ticketId: survey.ticket_id,
      alreadyResponded: survey.responded_at !== null,
      score: survey.score,
    });
  }),
);

/** Submit a rating (1–5) with an optional comment. */
csatRouter.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = z.string().min(10).parse(req.params.token);
    const { score, comment } = z
      .object({ score: z.number().int().min(1).max(5), comment: z.string().max(2000).optional() })
      .parse(req.body);
    const survey = await submitSurvey(token, score, comment ?? null);
    res.json({ ok: true, score: survey.score });
  }),
);

export default csatRouter;
