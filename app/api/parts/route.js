// GET  /api/parts   spare parts inventory with usage statistics
// POST /api/parts   add a new spare part (Admin)
import { ok, route, body, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";

export const GET = route(async () => {
  await requireRole("TECHNICIAN", "FACILITY_MANAGER", "ADMIN");
  const parts = await query(`
    SELECT p.part_id, p.part_code, p.part_name, c.category_name, p.category_id, p.unit_cost,
           p.quantity_in_stock, p.reorder_level,
           COALESCE(SUM(wp.quantity_used), 0)::INT AS used_total,
           COALESCE(SUM(wp.quantity_used) FILTER (WHERE w.completed_at >= now() - INTERVAL '30 days'), 0)::INT AS used_30d,
           (p.quantity_in_stock <= p.reorder_level) AS low_stock
      FROM spare_parts p
      JOIN asset_categories c ON c.category_id = p.category_id
      LEFT JOIN work_order_parts wp ON wp.part_id = p.part_id
      LEFT JOIN work_orders w ON w.work_order_id = wp.work_order_id
     GROUP BY p.part_id, c.category_name
     ORDER BY low_stock DESC, c.category_name, p.part_name`);
  return ok({ parts });
});

export const POST = route(async (req) => {
  const s = await requireRole("ADMIN");
  const b = await body(req);
  const part = await withTransaction(s.id, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO spare_parts (part_code, part_name, category_id, unit_cost, quantity_in_stock, reorder_level)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        v.str(b.part_code, "Part code", { min: 3, max: 20 }).toUpperCase(),
        v.str(b.part_name, "Part name", { min: 3, max: 100 }),
        v.int(b.category_id, "Category"),
        v.num(b.unit_cost, "Unit cost", { min: 0.01, max: 1e7 }),
        v.int(b.quantity_in_stock ?? 0, "Stock", { min: 0, max: 100000 }),
        v.int(b.reorder_level ?? 10, "Reorder level", { min: 0, max: 100000 }),
      ]
    );
    return rows[0];
  });
  return ok({ part, message: `Part ${part.part_code} added` }, 201);
});
