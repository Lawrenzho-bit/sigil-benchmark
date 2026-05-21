import { signOut } from "@/auth";

/** Sign-out control backed by a server action — no client JS required. */
export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" className="btn-secondary w-full">
        Sign out
      </button>
    </form>
  );
}
