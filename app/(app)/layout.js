// Layout for every logged-in page: reads the session on the server and renders the role-aware shell.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Shell from "@/components/Shell";

export default async function AppLayout({ children }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Shell user={session}>{children}</Shell>;
}
