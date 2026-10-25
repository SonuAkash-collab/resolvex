// GET  /api/incidents   list with filters (status, priority, building, category, mine, text)
// POST /api/incidents   report a new incident (+ store its embedding) in ONE transaction
import { ok, route, body, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { embed, incidentText, toPgVector, EMBEDDING_MODEL } from "@/lib/embeddings";

const STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "DUPLICATE", "CANCELLED"];

export const GET = route(async (req) => {
  const s = await requireRole();
  const p = req.nextUrl.searchParams;
  const where = [];
  const params = [];
  const add = (sql, val) => {
    params.push(val);
    where.push(sql.replace("$?", "$" + params.length));
  };

  if (p.get("mine") === "1") {
    params.push(s.id);
    const n = params.length;
    where.push(`(reporter_id = $${n} OR incident_id IN (SELECT incident_id FROM incident_reporters WHERE user_id = $${n}))`);
  }
  if (p.get("status") === "ACTIVE") where.push("status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')");
  else if (p.get("status") && STATUSES.includes(p.get("status"))) add("status = $?", p.get("status"));
  if (["P1", "P2", "P3", "P4"].includes(p.get("priority"))) add("priority_level = $?", p.get("priority"));
  if (p.get("building")) add("building_id = $?", v.int(p.get("building"), "building"));
  if (p.get("category")) add("category_id = $?", v.int(p.get("category"), "category"));
  if (p.get("overdue") === "1") where.push("is_overdue");
  if (p.get("q")) {
    params.push("%" + p.get("q").slice(0, 100) + "%");
    const n = params.length;
    where.push(`(title ILIKE $${n} OR description ILIKE $${n})`);
  }

  const sort = { priority: "priority_score DESC, reported_at", recent: "reported_at DESC", sla: "sla_due_at ASC NULLS LAST" }[p.get("sort")] || "reported_at DESC";
  const limit = Math.min(Number(p.get("limit")) || 100, 300);

  const rows = await query(
    `SELECT incident_id, title, status, priority_level, priority_score, severity, affected_users, category_name,
            building_name, room_number, asset_tag, reporter_name, technician_name, reported_at, sla_due_at,
            sla_hours_left, is_overdue, incident_type, duplicate_of, co_reporters, feedback_rating
       FROM v_incident_details
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${sort}
      LIMIT ${limit}`,
    params
  );
  return ok({ incidents: rows });
});

export const POST = route(async (req) => {
  const s = await requireRole();
  const b = await body(req);
  const title = v.str(b.title, "Title", { min: 5, max: 150 });
  const description = v.str(b.description, "Description", { min: 10, max: 4000 });
  const roomId = v.int(b.room_id, "Room");
  const categoryId = v.int(b.category_id, "Category");
  const assetId = v.int(b.asset_id, "Asset", { optional: true });
  const severity = v.int(b.severity, "Severity", { min: 1, max: 5 });
  const affected = v.int(b.affected_users ?? 1, "Affected users", { min: 1, max: 5000 });

  const cat = await queryOne("SELECT category_name FROM asset_categories WHERE category_id = $1", [categoryId]);
  const text = incidentText({ title, description, category: cat?.category_name });
  const vector = toPgVector(await embed(text)); // computed before the transaction to keep it short

  const incident = await withTransaction(s.id, async (c) => {
    // BEFORE INSERT triggers validate the asset/room/category and compute priority + SLA
    const { rows } = await c.query(
      `INSERT INTO incidents (title, description, reported_by, room_id, asset_id, category_id, severity, affected_users)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING incident_id, priority_score, priority_level, sla_due_at, status`,
      [title, description, s.id, roomId, assetId, categoryId, severity, affected]
    );
    await c.query(
      `INSERT INTO incident_embeddings (incident_id, embedding, model_name, source_text) VALUES ($1, $2::vector, $3, $4)`,
      [rows[0].incident_id, vector, EMBEDDING_MODEL, text]
    );
    return rows[0];
  });
  return ok({ incident }, 201);
});
