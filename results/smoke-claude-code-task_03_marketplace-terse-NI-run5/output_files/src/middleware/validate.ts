import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";

// Validates and replaces a request segment with the parsed (typed) value.
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data as z.infer<T>;
    next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    // Express 4 query is read-only on some setups; stash the parsed copy.
    (req as Request & { validatedQuery: unknown }).validatedQuery = result.data;
    next();
  };
}
