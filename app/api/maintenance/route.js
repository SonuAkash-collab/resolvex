// POST /api/maintenance  { action: 'escalate' | 'preventive' | 'refresh-stats', threshold? }
//   escalate      -> CALL sp_escalate_overdue          (SLA breach escalation)
//   preventive    -> CALL sp_schedule_preventive_maintenance (risk based)
//   refresh-stats -> SELECT fn_refresh_monthly_stats()  (SECURITY DEFINER, refreshes materialized view)
import { ok, route, body, v } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { embedMissingIncidents } from "@/lib/incidents";

export const POST = route(async (req) => {
  const s = await requireRole("FACILITY_MANAGER", "ADMIN");
  const b = await body(req);

  if (b.action === "escalate") {
    const n = await withTransaction(s.id, async (c) => (await c.query("CALL sp_escalate_overdue(NULL)")).rows[0].p_escalated);
    return ok({ message: n ? `${n} overdue incident(s) escalated` : "No new SLA breaches to escalate", count: n });
  }
  if (b.action === "preventive") {
    const threshold = v.num(b.threshold ?? 75, "Threshold", { min: 1, max: 100 });
    const n = await withTransaction(s.id, async (c) =>
      (await c.query("CALL sp_schedule_preventive_maintenance($1, $2, NULL)", [s.id, threshold])).rows[0].p_created
    );
    if (n) await embedMissingIncidents();
    return ok({ message: n ? `${n} preventive incident(s) created for high-risk assets` : "No asset above the risk threshold needs work", count: n });
  }
  if (b.action === "refresh-stats") {
    await query("SELECT fn_refresh_monthly_stats()");
    return ok({ message: "Monthly statistics refreshed" });
  }
  throw new HttpError(400, "Unknown action");
});
