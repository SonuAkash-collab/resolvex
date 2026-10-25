// POST /api/work-orders/:id   { action: start | hold | resume | complete | cancel }
//   start / hold / resume : technician who owns the work order
//   complete              : CALL sp_complete_work_order (parts, stock, costs) - ONE transaction
//   cancel                : manager / admin (trigger puts the incident back to OPEN)
import { ok, route, body, v, fail } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { queryOne, withTransaction } from "@/lib/db";

export const POST = route(async (req, { params }) => {
  const s = await requireRole("TECHNICIAN", "FACILITY_MANAGER", "ADMIN");
  const id = v.int((await params).id, "Work order id");
  const b = await body(req);
  const wo = await queryOne("SELECT work_order_id, technician_id, incident_id, status FROM work_orders WHERE work_order_id = $1", [id]);
  if (!wo) return fail("Work order not found", 404);

  const owner = s.role === "TECHNICIAN" && wo.technician_id === s.id;
  const manager = ["FACILITY_MANAGER", "ADMIN"].includes(s.role);
  if (b.action !== "cancel" && !owner) throw new HttpError(403, "This work order is not assigned to you");
  if (b.action === "cancel" && !manager) throw new HttpError(403, "Only managers can cancel work orders");

  const message = await withTransaction(s.id, async (c) => {
    switch (b.action) {
      case "start": {
        const r = await c.query(
          "UPDATE work_orders SET status = 'IN_PROGRESS', started_at = now() WHERE work_order_id = $1 AND status = 'ASSIGNED'",
          [id]
        );
        if (!r.rowCount) throw new HttpError(409, "Work order is not in ASSIGNED state");
        return "Work started - incident and asset status updated by trigger";
      }
      case "hold":
        await c.query("UPDATE incidents SET status = 'ON_HOLD' WHERE incident_id = $1", [wo.incident_id]);
        return "Incident put on hold";
      case "resume":
        await c.query("UPDATE incidents SET status = 'IN_PROGRESS' WHERE incident_id = $1", [wo.incident_id]);
        return "Work resumed";
      case "complete": {
        const hours = v.num(b.labour_hours, "Labour hours", { min: 0.1, max: 200 });
        const notes = v.str(b.notes, "Resolution notes", { min: 10, max: 2000 });
        const parts = Array.isArray(b.parts) ? b.parts : [];
        const clean = parts.map((p) => ({
          part_id: v.int(p.part_id, "Part"),
          quantity: v.int(p.quantity, "Quantity", { min: 1, max: 1000 }),
        }));
        await c.query("CALL sp_complete_work_order($1, $2, $3, $4, $5::jsonb)", [id, s.id, hours, notes, JSON.stringify(clean)]);
        return "Work order completed - stock deducted, cost recorded, incident resolved";
      }
      case "cancel":
        await c.query("UPDATE work_orders SET status = 'CANCELLED' WHERE work_order_id = $1 AND status IN ('ASSIGNED','IN_PROGRESS')", [id]);
        return "Work order cancelled - incident returned to the queue";
      default:
        throw new HttpError(400, "Unknown action");
    }
  });
  return ok({ message });
});
