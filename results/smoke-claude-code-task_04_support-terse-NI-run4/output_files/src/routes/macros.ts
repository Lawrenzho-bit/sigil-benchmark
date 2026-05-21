import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAgent } from '../middleware/auth';
import { createMacro, deleteMacro, listMacros } from '../services/macroService';

/** Macros / canned responses — agent only. */
export const macrosRouter = Router();
macrosRouter.use(requireAgent);

/** List macros visible to the calling agent (their team + global). */
macrosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ macros: await listMacros(req.principal!.teamId) });
  }),
);

const macroInput = z.object({
  name: z.string().min(1).max(120),
  body: z.string().min(1).max(20_000),
  actions: z
    .object({
      status: z.enum(['new', 'open', 'pending', 'on_hold', 'resolved', 'closed']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      assignToSelf: z.boolean().optional(),
      addTags: z.array(z.string().min(1).max(50)).optional(),
    })
    .optional(),
  teamId: z.string().uuid().nullable().optional(),
});

macrosRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = macroInput.parse(req.body);
    const macro = await createMacro(input, req.principal!);
    res.status(201).json({ macro });
  }),
);

macrosRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteMacro(z.string().uuid().parse(req.params.id));
    res.json({ ok: true });
  }),
);

export default macrosRouter;
