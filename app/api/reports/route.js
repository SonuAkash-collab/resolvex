// GET /api/reports                             list of available reports (PostgreSQL and MongoDB)
// GET /api/reports?id=building-cost&days=90    run one report (days omitted = all time)
import { ok, route, fail, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { collection } from "@/lib/mongo";
import { REPORTS } from "@/lib/reports";
import { MONGO_REPORTS, pipelineText, printable } from "@/lib/mongo-reports";

export const GET = route(async (req) => {
  await requireRole("FACILITY_MANAGER", "ADMIN");
  const p = req.nextUrl.searchParams;
  const id = p.get("id");
  if (!id)
    return ok({
      reports: [
        ...REPORTS.map(({ id, title, concepts }) => ({ id, title, concepts, engine: "postgresql" })),
        ...MONGO_REPORTS.map(({ id, title, concepts }) => ({ id, title, concepts, engine: "mongodb" })),
      ],
    });

  const days = v.int(p.get("days"), "Period", { min: 1, max: 3650, optional: true });
  const r = REPORTS.find((x) => x.id === id);
  if (r) {
    const t = Date.now();
    const rows = await query(r.sql, [days]);
    return ok({ ...r, engine: "postgresql", days, ms: Date.now() - t, rows, fields: rows.length ? Object.keys(rows[0]) : [] });
  }

  const m = MONGO_REPORTS.find((x) => x.id === id);
  if (!m) return fail("Unknown report", 404);
  const pipeline = m.pipeline(days ? new Date(Date.now() - days * 86400e3) : null);
  const t = Date.now();
  let rows = await (await collection(m.collection)).aggregate(pipeline, { maxTimeMS: 5000 }).toArray();
  if (m.joinIncidents && rows.length) {
    // application-side join: MongoDB has the counts, PostgreSQL has the incident (RLS applies)
    const incidents = await query("SELECT incident_id, title, status FROM incidents WHERE incident_id = ANY($1::int[])", [rows.map((x) => x.incident_id)]);
    const byId = new Map(incidents.map((x) => [x.incident_id, x]));
    rows = rows.map(({ incident_id, ...rest }) => ({
      incident_id,
      title: byId.get(incident_id)?.title ?? "(missing in PostgreSQL)",
      status: byId.get(incident_id)?.status ?? null,
      ...rest,
    }));
  }
  rows = rows.map((row) => Object.fromEntries(m.columns.map((c) => [c, row[c] ?? null]))); // fixed column order
  return ok({
    id: m.id,
    title: m.title,
    concepts: m.concepts,
    engine: "mongodb",
    days,
    ms: Date.now() - t,
    rows,
    fields: rows.length ? Object.keys(rows[0]) : [],
    sql: pipelineText(m.collection, printable(pipeline)),
  });
});
