import { ok, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export const GET = route(async () => {
  const s = await requireRole();
  const unread = await queryOne(
    `SELECT COUNT(*)::INT AS n FROM alerts
      WHERE NOT is_read AND (target_user_id = $1 OR target_role = $2 OR ($2 = 'ADMIN' AND target_role IS NOT NULL))`,
    [s.id, s.role]
  );
  return ok({ user: s, unreadAlerts: unread.n });
});
