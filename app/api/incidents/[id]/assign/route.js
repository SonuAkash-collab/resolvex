// POST /api/incidents/:id/assign   { technician_id? }   (Facility Manager / Admin)
// Calls stored procedure sp_assign_technician inside a transaction. Without a
// technician_id the procedure auto-selects the best skilled, least loaded technician.
import { ok, route, body, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { queryOne, withTransaction } from "@/lib/db";

export const POST = route(async (req, { params }) => {
  const s = await requireRole("FACILITY_MANAGER", "ADMIN");
  const id = v.int((await params).id, "Incident id");
  const b = await body(req).catch(() => ({}));
  const techId = v.int(b?.technician_id, "Technician", { optional: true });

  const woId = await withTransaction(s.id, async (c) => {
    const { rows } = await c.query("CALL sp_assign_technician($1, $2, $3, NULL)", [id, s.id, techId]);
    return rows[0].p_work_order_id;
  });
  const wo = await queryOne(
    `SELECT w.work_order_id, u.full_name AS technician_name FROM work_orders w
       JOIN users u ON u.user_id = w.technician_id WHERE w.work_order_id = $1`,
    [woId]
  );
  return ok({ message: `Work order #${wo.work_order_id} assigned to ${wo.technician_name}`, workOrder: wo });
});
