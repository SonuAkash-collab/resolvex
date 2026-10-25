// GET /api/search?q=...&mode=hybrid|semantic|keyword
// Semantic search (pgvector cosine similarity), keyword search (PostgreSQL full-text)
// or both fused with Reciprocal Rank Fusion - all inside fn_hybrid_search().
import { ok, route, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { embed, toPgVector } from "@/lib/embeddings";
import { logSearch } from "@/lib/notes";

export const GET = route(async (req) => {
  const s = await requireRole();
  const p = req.nextUrl.searchParams;
  const q = v.str(p.get("q") || "", "Search text", { min: 2, max: 300 });
  const mode = v.oneOf(p.get("mode") || "hybrid", "mode", ["hybrid", "semantic", "keyword"]);

  const t0 = Date.now();
  const vec = mode === "keyword" ? null : toPgVector(await embed(q));
  const t1 = Date.now();
  const results = await query("SELECT * FROM fn_hybrid_search($1, $2::vector, 15, $3)", [q, vec, mode]);
  const searchMs = Date.now() - t1;
  // append to the MongoDB search log (expires after 90 days via a TTL index); role only, no user id
  const topScore = Number(results[0]?.[mode === "keyword" ? "rrf_score" : "similarity"]);
  logSearch({
    q: q.toLowerCase(),
    mode,
    results: results.length,
    top_score: Number.isFinite(topScore) ? Math.round(topScore * 1000) / 1000 : null,
    ms: Math.round(Date.now() - t0),
    role: s.role,
  });
  return ok({ results, mode, timing: { embedMs: t1 - t0, searchMs } });
});
