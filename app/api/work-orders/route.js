// GET /api/work-orders   technician: own work orders, manager/admin: all active ones
import { ok, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";

export const GET = route(async (req) => {
  const s = await requireRole("TECHNICIAN", "FACILITY_MANAGER", "ADMIN");
  const scope = req.nextUrl.searchParams.get("scope") || "active";
  const params = [];
  const where = [];
  if (s.role === "TECHNICIAN") {
    params.push(s.id);
    where.push(`w.technician_id = $${params.length}`);
  }
  if (scope === "active") where.push("w.status IN ('ASSIGNED','IN_PROGRESS')");
  else if (scope === "done") where.push("w.status IN ('COMPLETED','CANCELLED')");

  const rows = await query(
    `SELECT w.work_order_id, w.status, w.assigned_at, w.started_at, w.completed_at, w.labour_hours, w.resolution_notes,
            d.incident_id, d.title, d.description, d.status AS incident_status, d.priority_level, d.priority_score,
            d.category_id, d.category_name, d.building_name, d.room_number, d.asset_tag, d.asset_name,
            d.sla_due_at, d.sla_hours_left, d.is_overdue, d.reporter_name, u.full_name AS technician_name,
            m.total_cost
       FROM work_orders w
       JOIN v_incident_details d ON d.incident_id = w.incident_id
       JOIN users u ON u.user_id = w.technician_id
       LEFT JOIN maintenance_records m ON m.work_order_id = w.work_order_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${scope === "done" ? "w.completed_at DESC NULLS LAST" : "d.priority_score DESC, w.assigned_at"}
      LIMIT 100`,
    params
  );
  return ok({ workOrders: rows });
});
