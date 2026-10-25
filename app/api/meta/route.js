// Lookup data for forms and filters (buildings, rooms, categories, assets, technicians, parts).
import { ok, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";

export const GET = route(async () => {
  const s = await requireRole();
  const [buildings, rooms, categories, assets] = await Promise.all([
    query(`SELECT building_id, building_code, building_name, building_type, importance_level, total_floors
             FROM buildings ORDER BY building_name`),
    query(`SELECT room_id, building_id, room_number, floor_no, room_type FROM rooms ORDER BY building_id, room_number`),
    query(`SELECT category_id, category_name, default_sla_hours, maintenance_interval_days FROM asset_categories ORDER BY category_name`),
    query(`SELECT asset_id, asset_tag, asset_name, room_id, category_id, status FROM assets
            WHERE status <> 'DECOMMISSIONED' ORDER BY asset_name`),
  ]);
  const result = { buildings, rooms, categories, assets };
  if (s.role !== "STUDENT_STAFF") {
    result.technicians = await query(`
      SELECT w.technician_id, w.full_name, w.employee_code, w.is_available, w.active_jobs, w.max_concurrent_jobs,
             ARRAY(SELECT category_id FROM technician_skills s WHERE s.technician_id = w.technician_id) AS skill_ids
        FROM v_technician_workload w ORDER BY w.full_name`);
    result.parts = await query(
      `SELECT part_id, part_code, part_name, category_id, unit_cost, quantity_in_stock FROM spare_parts ORDER BY part_name`
    );
  }
  return ok(result);
});
