// GET   /api/incidents/:id   full incident record (timeline, work orders, parts, similar incidents)
// PATCH /api/incidents/:id   status actions: close, reopen, cancel, feedback, update severity
import { ok, route, body, v, fail } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { query, queryOne, withTransaction } from "@/lib/db";

export const GET = route(async (req, { params }) => {
  const s = await requireRole();
  const id = v.int((await params).id, "Incident id");
  const incident = await queryOne("SELECT * FROM v_incident_details WHERE incident_id = $1", [id]);
  if (!incident) return fail("Incident not found", 404);

  const [history, workOrders, parts, coReporters, similar, isCoReporter, breakdown] = await Promise.all([
    query(
      `SELECT h.old_status, h.new_status, h.changed_at, u.full_name AS changed_by
         FROM incident_status_history h LEFT JOIN users u ON u.user_id = h.changed_by
        WHERE h.incident_id = $1 ORDER BY h.changed_at, h.history_id`,
      [id]
    ),
    query(
      `SELECT w.work_order_id, w.status, w.assigned_at, w.started_at, w.completed_at, w.labour_hours,
              w.resolution_notes, u.full_name AS technician_name, t.employee_code, a.full_name AS assigned_by,
              m.labour_cost, m.parts_cost, m.total_cost
         FROM work_orders w
         JOIN users u ON u.user_id = w.technician_id
         JOIN technicians t ON t.technician_id = w.technician_id
         LEFT JOIN users a ON a.user_id = w.assigned_by
         LEFT JOIN maintenance_records m ON m.work_order_id = w.work_order_id
        WHERE w.incident_id = $1 ORDER BY w.assigned_at`,
      [id]
    ),
    query(
      `SELECT wp.work_order_id, p.part_code, p.part_name, wp.quantity_used, wp.unit_cost_at_use,
              wp.quantity_used * wp.unit_cost_at_use AS line_total
         FROM work_order_parts wp JOIN spare_parts p ON p.part_id = wp.part_id
         JOIN work_orders w ON w.work_order_id = wp.work_order_id
        WHERE w.incident_id = $1`,
      [id]
    ),
    query(
      `SELECT u.full_name, ir.joined_at FROM incident_reporters ir JOIN users u ON u.user_id = ir.user_id
        WHERE ir.incident_id = $1 ORDER BY ir.joined_at`,
      [id]
    ),
    query(
      `SELECT s.incident_id, s.title, s.status, s.building_name, s.room_number, s.similarity, s.resolution_notes
         FROM incident_embeddings e,
              LATERAL fn_similar_incidents(e.embedding, 15, 0.5, e.incident_id) s
        WHERE e.incident_id = $1`,
      [id]
    ),
    queryOne("SELECT 1 AS yes FROM incident_reporters WHERE incident_id = $1 AND user_id = $2", [id, s.id]),
    query(
      `SELECT b.* FROM incidents i,
              LATERAL fn_priority_breakdown(i.severity, i.affected_users, i.asset_id, i.room_id, i.category_id,
                                            i.escalation_level, i.reported_at, i.incident_id) b
        WHERE i.incident_id = $1`,
      [id]
    ),
  ]);

  // keep one example per distinct fix so the list shows different solutions
  const seen = new Set();
  const distinctSimilar = similar
    .filter((r) => {
      const key = r.resolution_notes || "#" + r.incident_id;
      return seen.has(key) ? false : seen.add(key);
    })
    .slice(0, 5);

  // phone numbers / emails of reporters are never sent to the browser
  return ok({ incident, history, workOrders, parts, coReporters, similar: distinctSimilar, breakdown, isCoReporter: !!isCoReporter });
});

export const PATCH = route(async (req, { params }) => {
  const s = await requireRole();
  const id = v.int((await params).id, "Incident id");
  const b = await body(req);
  const inc = await queryOne("SELECT incident_id, reported_by, status FROM incidents WHERE incident_id = $1", [id]);
  if (!inc) return fail("Incident not found", 404);

  const isManager = ["FACILITY_MANAGER", "ADMIN"].includes(s.role);
  const isReporter = inc.reported_by === s.id;

  const result = await withTransaction(s.id, async (c) => {
    switch (b.action) {
      case "close": {
        if (!isReporter && !isManager) throw new HttpError(403, "Only the reporter or a manager can close this incident");
        const rating = v.int(b.rating, "Rating", { min: 1, max: 5, optional: true });
        // the state-machine trigger rejects anything except RESOLVED -> CLOSED
        await c.query("UPDATE incidents SET status = 'CLOSED', feedback_rating = COALESCE($2, feedback_rating) WHERE incident_id = $1", [id, rating]);
        return "Incident closed";
      }
      case "reopen": {
        if (!isReporter && !isManager) throw new HttpError(403, "Only the reporter or a manager can reopen this incident");
        await c.query("UPDATE incidents SET status = 'OPEN' WHERE incident_id = $1", [id]);
        return "Incident reopened";
      }
      case "cancel": {
        if (!isManager && !(isReporter && inc.status === "OPEN")) throw new HttpError(403, "You can only withdraw your own OPEN reports");
        await c.query("UPDATE work_orders SET status = 'CANCELLED' WHERE incident_id = $1 AND status IN ('ASSIGNED','IN_PROGRESS')", [id]);
        await c.query("UPDATE incidents SET status = 'CANCELLED' WHERE incident_id = $1", [id]);
        return "Incident cancelled";
      }
      case "feedback": {
        if (!isReporter) throw new HttpError(403, "Only the reporter can rate the resolution");
        const rating = v.int(b.rating, "Rating", { min: 1, max: 5 });
        await c.query("UPDATE incidents SET feedback_rating = $2 WHERE incident_id = $1", [id, rating]);
        return "Thanks for the feedback";
      }
      case "update": {
        if (!isManager) throw new HttpError(403, "Only managers can re-classify incidents");
        const severity = v.int(b.severity, "Severity", { min: 1, max: 5 });
        // trg_incident_priority recomputes priority_score, priority_level and sla_due_at
        await c.query("UPDATE incidents SET severity = $2 WHERE incident_id = $1", [id, severity]);
        return "Severity updated and priority recalculated";
      }
      default:
        throw new HttpError(400, "Unknown action");
    }
  });
  const incident = await queryOne("SELECT * FROM v_incident_details WHERE incident_id = $1", [id]);
  return ok({ message: result, incident });
});
