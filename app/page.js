import { redirect } from "next/navigation";
import { getSession, homeForRole } from "@/lib/auth";

export default async function Home() {
  const s = await getSession();
  redirect(s ? homeForRole(s.role) : "/login");
}
