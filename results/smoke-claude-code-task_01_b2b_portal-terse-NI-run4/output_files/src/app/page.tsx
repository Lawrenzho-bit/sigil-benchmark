import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";

// Root route: send authenticated users to the dashboard, others to login.
export default async function Home() {
  const user = await currentUser();
  redirect(user ? "/dashboard" : "/login");
}
