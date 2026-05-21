import { Router } from "express";
import { prisma } from "../../db/client.js";
import { asyncHandler } from "../../lib/http.js";

export const categoriesRouter = Router();

// Full category tree for browse navigation.
categoriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const all = await prisma.category.findMany({ orderBy: { name: "asc" } });
    // Assemble a parent → children tree from the flat list.
    const byId = new Map(all.map((c) => [c.id, { ...c, children: [] as unknown[] }]));
    const roots: unknown[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        (byId.get(node.parentId)!.children as unknown[]).push(node);
      } else {
        roots.push(node);
      }
    }
    res.json({ categories: roots });
  }),
);
