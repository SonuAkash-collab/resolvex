// PATCH /api/assets/:id  { status?, criticality? }  (Admin)
import { ok, route, body, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export const PATCH = route(async (req, { params }) => {
  const s = await requireRole("ADMIN");
  const id = v.int((await params).id, "Asset id");
  const b = await body(req);
  const status = b.status ? v.oneOf(b.status, "Status", ["OPERATIONAL", "UNDER_REPAIR", "DECOMMISSIONED"]) : null;
  const crit = v.int(b.criticality, "Criticality", { min: 1, max: 5, optional: true });
  await withTransaction(s.id, (c) =>
    c.query(
      `UPDATE assets SET status = COALESCE($2, status), criticality = COALESCE($3, criticality),
              risk_score = fn_asset_risk_score(asset_id)
        WHERE asset_id = $1`,
      [id, status, crit]
    )
  );
  return ok({ message: "Asset updated" });
});
