// DELETE /api/parts/:id   (Admin) remove a spare part that was never used.
// A part referenced by work_order_parts cannot be deleted: the foreign key
// (no ON DELETE CASCADE) protects the repair history.
import { ok, route, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export const DELETE = route(async (req, { params }) => {
  const s = await requireRole("ADMIN");
  const id = v.int((await params).id, "Part id");
  const r = await withTransaction(s.id, (c) => c.query("DELETE FROM spare_parts WHERE part_id = $1 RETURNING part_code", [id]));
  return ok({ message: r.rowCount ? `Part ${r.rows[0].part_code} deleted` : "Part not found" });
});
