// GET /api/reports                       list of available reports
// GET /api/reports?id=building-cost&days=90   run one report (days omitted = all time)
import { ok, route, fail, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { REPORTS } from "@/lib/reports";

export const GET = route(async (req) => {
  await requireRole("FACILITY_MANAGER", "ADMIN");
  const p = req.nextUrl.searchParams;
  const id = p.get("id");
  if (!id) return ok({ reports: REPORTS.map(({ id, title, concepts }) => ({ id, title, concepts })) });

  const r = REPORTS.find((x) => x.id === id);
  if (!r) return fail("Unknown report", 404);
  const days = v.int(p.get("days"), "Period", { min: 1, max: 3650, optional: true });
  const t = Date.now();
  const rows = await query(r.sql, [days]);
  return ok({ ...r, days, ms: Date.now() - t, rows, fields: rows.length ? Object.keys(rows[0]) : [] });
});
