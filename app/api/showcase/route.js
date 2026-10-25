// GET /api/showcase          list of documented queries (database/09_queries.sql)
// GET /api/showcase?id=q05   run one of them inside a READ ONLY transaction
import { ok, route, fail } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import pool from "@/lib/db";
import { loadShowcaseQueries } from "@/lib/showcase";

export const GET = route(async (req) => {
  const session = await requireRole("FACILITY_MANAGER", "ADMIN");
  const queries = loadShowcaseQueries();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return ok({ queries });

  const q = queries.find((x) => x.id === id);
  if (!q) return fail("Unknown query", 404);

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY"); // even a modified file could not change data
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(session.id)]); // RLS applies
    const t = Date.now();
    const res = await client.query(q.sql);
    const ms = Date.now() - t;
    await client.query("ROLLBACK");
    return ok({ ...q, ms, rowCount: res.rowCount, fields: res.fields.map((f) => f.name), rows: res.rows.slice(0, 50) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
