// POST /api/incidents/:id/duplicate  { original_id }   (Facility Manager / Admin)
// Calls sp_mark_duplicate: marks this report as DUPLICATE, links it to the root original
// (recursive CTE) and adds the reporter as a co-reporter of the original.
import { ok, route, body, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export const POST = route(async (req, { params }) => {
  const s = await requireRole("FACILITY_MANAGER", "ADMIN");
  const id = v.int((await params).id, "Incident id");
  const b = await body(req);
  const originalId = v.int(b.original_id, "Original incident");
  await withTransaction(s.id, (c) => c.query("CALL sp_mark_duplicate($1, $2, $3)", [id, originalId, s.id]));
  return ok({ message: `Incident #${id} merged into #${originalId}` });
});
