"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

/** Email + password sign-in. */
export async function loginWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) redirect("/login?error=missing");

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (err) {
    // signIn throws a redirect on success — let that propagate.
    if (err instanceof AuthError) redirect("/login?error=invalid");
    throw err;
  }
}

/** Complete SSO sign-in using a verified SAML bridge ticket. */
export async function completeSsoLogin(formData: FormData) {
  const ticket = String(formData.get("ticket") ?? "");
  if (!ticket) redirect("/login?error=sso");

  try {
    await signIn("saml", { ticket, redirectTo: "/dashboard" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?error=sso");
    throw err;
  }
}
