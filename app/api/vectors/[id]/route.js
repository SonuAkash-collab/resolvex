// DELETE /api/vectors/:id   VECTOR DELETE (Admin only)
// Removes an incident's embedding from the vector store. The incident row stays,
// but it no longer appears in semantic search or duplicate detection until it is
// re-embedded. RLS policy p_embeddings_delete allows this only for ADMIN.
import { ok, route, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export const DELETE = route(async (req, { params }) => {
  const s = await requireRole("ADMIN");
  const id = v.int((await params).id, "Incident id");
  const r = await withTransaction(s.id, (c) => c.query("DELETE FROM incident_embeddings WHERE incident_id = $1", [id]));
  return ok({
    message: r.rowCount
      ? `Vector of incident #${id} deleted - it is no longer found by meaning until re-embedded`
      : `Incident #${id} had no vector`,
  });
});
