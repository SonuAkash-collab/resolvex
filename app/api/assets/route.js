// GET  /api/assets   asset health (v_asset_health: risk score, MTBF, predicted next failure)
// POST /api/assets   register a new asset (Admin)
import { ok, route, body, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";

export const GET = route(async () => {
  await requireRole("FACILITY_MANAGER", "ADMIN");
  const assets = await query(`
    SELECT h.*, a.manufacturer, a.category_id, a.room_id
      FROM v_asset_health h JOIN assets a ON a.asset_id = h.asset_id
     ORDER BY h.risk_score DESC`);
  return ok({ assets });
});

export const POST = route(async (req) => {
  const s = await requireRole("ADMIN");
  const b = await body(req);
  const asset = await withTransaction(s.id, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO assets (asset_tag, asset_name, category_id, room_id, manufacturer, install_date, criticality)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        v.str(b.asset_tag, "Asset tag", { min: 6, max: 20 }).toUpperCase(),
        v.str(b.asset_name, "Asset name", { min: 3, max: 100 }),
        v.int(b.category_id, "Category"),
        v.int(b.room_id, "Room"),
        v.str(b.manufacturer, "Manufacturer", { max: 60, optional: true }),
        v.str(b.install_date, "Install date", { min: 10, max: 10 }),
        v.int(b.criticality, "Criticality", { min: 1, max: 5 }),
      ]
    );
    return rows[0];
  });
  return ok({ asset, message: `Asset ${asset.asset_tag} registered` }, 201);
});
