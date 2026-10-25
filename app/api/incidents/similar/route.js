// POST /api/incidents/similar
// Live duplicate detection while the user types a report.
//   1. embed the draft text (all-MiniLM-L6-v2, 384-d)
//   2. fn_detect_duplicates : ACTIVE incidents, vector similarity + location boost
//   3. fn_similar_incidents : RESOLVED history with the fix that worked
import { ok, route, body, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { embed, incidentText, toPgVector } from "@/lib/embeddings";

export const POST = route(async (req) => {
  await requireRole();
  const b = await body(req);
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 150) : "";
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 4000) : "";
  if ((title + description).length < 8) return ok({ duplicates: [], history: [] });

  const roomId = v.int(b.room_id, "Room", { optional: true });
  const assetId = v.int(b.asset_id, "Asset", { optional: true });
  const categoryId = v.int(b.category_id, "Category", { optional: true });
  const cat = categoryId
    ? await queryOne("SELECT category_name FROM asset_categories WHERE category_id = $1", [categoryId])
    : null;

  const t0 = Date.now();
  const vec = toPgVector(await embed(incidentText({ title, description, category: cat?.category_name })));
  const t1 = Date.now();

  const [duplicates, similar] = await Promise.all([
    roomId
      ? query("SELECT * FROM fn_detect_duplicates($1::vector, $2, $3, 4, 0.55)", [vec, roomId, assetId])
      : Promise.resolve([]),
    query("SELECT * FROM fn_similar_incidents($1::vector, 12, 0.45)", [vec]),
  ]);
  const history = similar.filter((r) => ["RESOLVED", "CLOSED"].includes(r.status) && r.resolution_notes);

  // collapse identical fixes so the user sees distinct solutions
  const seen = new Set();
  const distinct = history.filter((r) => (seen.has(r.resolution_notes) ? false : seen.add(r.resolution_notes))).slice(0, 4);

  return ok({ duplicates, history: distinct, timing: { embedMs: t1 - t0, searchMs: Date.now() - t1 } });
});
