// GET  /api/alerts   notifications for the current user (personal + role-wide)
// POST   /api/alerts   { ids?: number[] }  mark as read (all when ids omitted)
// DELETE /api/alerts   delete the current user's notifications that are already read
import { ok, route, body } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";

const VISIBLE = `(target_user_id = $1 OR target_role = $2 OR ($2 = 'ADMIN' AND target_role IS NOT NULL))`;

export const GET = route(async () => {
  const s = await requireRole();
  const alerts = await query(
    `SELECT alert_id, alert_type, alert_level, message, incident_id, part_id, asset_id, is_read, created_at
       FROM alerts WHERE ${VISIBLE} ORDER BY created_at DESC, alert_id DESC LIMIT 60`,
    [s.id, s.role]
  );
  return ok({ alerts });
});

export const POST = route(async (req) => {
  const s = await requireRole();
  const b = await body(req).catch(() => ({}));
  const ids = Array.isArray(b?.ids) ? b.ids.map(Number).filter(Number.isInteger) : null;
  await query(
    `UPDATE alerts SET is_read = TRUE WHERE ${VISIBLE} AND NOT is_read ${ids ? "AND alert_id = ANY($3::BIGINT[])" : ""}`,
    ids ? [s.id, s.role, ids] : [s.id, s.role]
  );
  return ok({ ok: true });
});

export const DELETE = route(async () => {
  const s = await requireRole();
  const r = await query(`DELETE FROM alerts WHERE ${VISIBLE} AND is_read RETURNING alert_id`, [s.id, s.role]);
  return ok({ message: `${r.length} read notification(s) deleted` });
});
