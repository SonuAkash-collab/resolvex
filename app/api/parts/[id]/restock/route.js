// POST /api/parts/:id/restock  { quantity }   (Admin / Facility Manager) -> CALL sp_restock_part
import { ok, route, body, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export const POST = route(async (req, { params }) => {
  const s = await requireRole("ADMIN", "FACILITY_MANAGER");
  const id = v.int((await params).id, "Part id");
  const b = await body(req);
  const qty = v.int(b.quantity, "Quantity", { min: 1, max: 10000 });
  await withTransaction(s.id, (c) => c.query("CALL sp_restock_part($1, $2)", [id, qty]));
  return ok({ message: `Added ${qty} unit(s) to stock` });
});
