import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";

/**
 * Email/password login. Returns a uniform error for "no such user" and
 * "wrong password" to avoid account enumeration, and runs the password
 * verification even when the user is missing so timing doesn't leak
 * existence.
 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email } });

  // Constant-ish work whether or not the user exists.
  const DUMMY_HASH = "$2a$12$abcdefghijklmnopqrstuuWz3y2m6oQ8m0p4f5l3h2k1j0i9h8g7";
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.passwordHash || !ok || !user.isActive) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
