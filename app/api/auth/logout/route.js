import { cookies } from "next/headers";
import { ok, route } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth";

export const POST = route(async () => {
  (await cookies()).delete(SESSION_COOKIE);
  return ok({ ok: true });
});
