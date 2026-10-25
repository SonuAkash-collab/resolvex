// =====================================================================
// Vector store API (pgvector table incident_embeddings)
//   GET  /api/vectors?status=&q=        READ   : list vectors + store statistics
//   GET  /api/vectors?id=12             READ   : one vector (first values) + nearest neighbours
//   POST /api/vectors {action}          UPDATE : 'reembed' one incident | 'reembed-stale'
//                                       CREATE : 'create-missing'
// (DELETE is in /api/vectors/[id])
// Facility managers and admins only; Row-Level Security in PostgreSQL
// enforces the same rule again inside the database.
// =====================================================================
import { ok, route, body, v, fail } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { embed, incidentText, toPgVector, EMBEDDING_MODEL, EMBEDDING_DIM } from "@/lib/embeddings";

export const GET = route(async (req) => {
  await requireRole("FACILITY_MANAGER", "ADMIN");
  const p = req.nextUrl.searchParams;

  if (p.get("id")) {
    const id = v.int(p.get("id"), "Incident id");
    const row = await queryOne(
      `SELECT s.*, (SELECT array_to_json((e.embedding::real[])[1:12]) FROM incident_embeddings e
                     WHERE e.incident_id = s.incident_id) AS preview
         FROM v_embedding_status s WHERE s.incident_id = $1`,
      [id]
    );
    if (!row) return fail("Incident not found", 404);
    const neighbours = row.vector_status === "MISSING" ? [] : await query(
      `SELECT n.incident_id, n.title, n.status, n.similarity
         FROM incident_embeddings e, LATERAL fn_similar_incidents(e.embedding, 5, 0.0, e.incident_id) n
        WHERE e.incident_id = $1`,
      [id]
    );
    return ok({ vector: row, neighbours });
  }

  const params = [];
  const where = [];
  const status = p.get("status");
  if (["FRESH", "STALE", "MISSING"].includes(status)) {
    params.push(status);
    where.push(`vector_status = $${params.length}`);
  }
  if (p.get("q")) {
    params.push("%" + p.get("q").slice(0, 100) + "%");
    where.push(`title ILIKE $${params.length}`);
  }

  const [stats, rows] = await Promise.all([
    queryOne(`
      SELECT COUNT(*)::INT                                          AS incidents,
             COUNT(*) FILTER (WHERE vector_status <> 'MISSING')::INT AS vectors,
             COUNT(*) FILTER (WHERE vector_status = 'STALE')::INT   AS stale,
             COUNT(*) FILTER (WHERE vector_status = 'MISSING')::INT AS missing,
             MAX(embedded_at)                                       AS last_embedded,
             (SELECT pg_size_pretty(pg_total_relation_size('incident_embeddings'))) AS table_size,
             (SELECT pg_size_pretty(pg_relation_size('idx_incident_embeddings_hnsw'))) AS index_size
        FROM v_embedding_status`),
    query(
      `SELECT incident_id, title, status, category_name, model_name, dims, norm, embedded_at, vector_status
         FROM v_embedding_status
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY CASE vector_status WHEN 'MISSING' THEN 0 WHEN 'STALE' THEN 1 ELSE 2 END, incident_id DESC
        LIMIT 200`,
      params
    ),
  ]);
  return ok({ stats: { ...stats, model: EMBEDDING_MODEL, dims: EMBEDDING_DIM, metric: "cosine", index: "HNSW (m=16, ef_construction=64)" }, rows });
});

/** Recomputes the embedding of one incident from its CURRENT text and upserts it. */
async function reembed(c, id) {
  const { rows } = await c.query(
    `SELECT i.title, i.description, c.category_name
       FROM incidents i JOIN asset_categories c ON c.category_id = i.category_id WHERE i.incident_id = $1`,
    [id]
  );
  if (!rows.length) throw new HttpError(404, `Incident ${id} not found`);
  const text = incidentText({ title: rows[0].title, description: rows[0].description, category: rows[0].category_name });
  const vec = toPgVector(await embed(text));
  await c.query(
    `INSERT INTO incident_embeddings (incident_id, embedding, model_name, source_text)
     VALUES ($1, $2::vector, $3, $4)
     ON CONFLICT (incident_id) DO UPDATE
        SET embedding = EXCLUDED.embedding, model_name = EXCLUDED.model_name,
            source_text = EXCLUDED.source_text, embedded_at = now()`,
    [id, vec, EMBEDDING_MODEL, text]
  );
}

export const POST = route(async (req) => {
  const s = await requireRole("FACILITY_MANAGER", "ADMIN");
  const b = await body(req);

  if (b.action === "reembed") {
    const id = v.int(b.incident_id, "Incident id");
    await withTransaction(s.id, (c) => reembed(c, id));
    return ok({ message: `Vector of incident #${id} recomputed (UPDATE)` });
  }
  if (b.action === "reembed-stale" || b.action === "create-missing") {
    const wanted = b.action === "reembed-stale" ? "STALE" : "MISSING";
    const ids = (await query("SELECT incident_id FROM v_embedding_status WHERE vector_status = $1", [wanted])).map((r) => r.incident_id);
    await withTransaction(s.id, async (c) => {
      for (const id of ids) await reembed(c, id);
    });
    return ok({
      message: ids.length
        ? `${ids.length} vector(s) ${wanted === "STALE" ? "re-embedded (UPDATE)" : "created (INSERT)"}`
        : `No ${wanted.toLowerCase()} vectors`,
    });
  }
  throw new HttpError(400, "Unknown action");
});
