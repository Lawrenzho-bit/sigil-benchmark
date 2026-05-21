/** Liveness + readiness probe. Used by the Docker HEALTHCHECK and load balancers. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // A trivial query confirms the DB connection pool is alive.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up", ts: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "down", ts: new Date().toISOString() },
      { status: 503 },
    );
  }
}
