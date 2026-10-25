// GET  /api/campus   buildings (+ room / asset / incident counts) and SLA policies
// POST /api/campus   { type: 'building' | 'room' | 'sla', ... }   (Admin)
import { ok, route, body, v } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";

export const GET = route(async () => {
  await requireRole("ADMIN", "FACILITY_MANAGER");
  const [buildings, sla] = await Promise.all([
    query(`
      SELECT b.*,
             COUNT(DISTINCT r.room_id)::INT  AS rooms,
             COUNT(DISTINCT a.asset_id)::INT AS assets,
             (SELECT COUNT(*) FROM incidents i JOIN rooms r2 ON r2.room_id = i.room_id
               WHERE r2.building_id = b.building_id
                 AND i.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD'))::INT AS active_incidents
        FROM buildings b
        LEFT JOIN rooms r  ON r.building_id = b.building_id
        LEFT JOIN assets a ON a.room_id = r.room_id
       GROUP BY b.building_id
       ORDER BY b.building_name`),
    query("SELECT * FROM sla_policies ORDER BY priority_level"),
  ]);
  return ok({ buildings, sla });
});

export const POST = route(async (req) => {
  const s = await requireRole("ADMIN");
  const b = await body(req);
  const message = await withTransaction(s.id, async (c) => {
    if (b.type === "building") {
      await c.query(
        `INSERT INTO buildings (building_code, building_name, building_type, importance_level, total_floors)
         VALUES ($1, $2, $3, $4, $5)`,
        [v.str(b.building_code, "Code", { min: 2, max: 10 }).toUpperCase(), v.str(b.building_name, "Name", { min: 3, max: 100 }),
         b.building_type, v.int(b.importance_level, "Importance", { min: 1, max: 5 }), v.int(b.total_floors, "Floors", { min: 1, max: 30 })]
      );
      return "Building added";
    }
    if (b.type === "room") {
      await c.query(
        "INSERT INTO rooms (building_id, room_number, floor_no, room_type, capacity) VALUES ($1, $2, $3, $4, $5)",
        [v.int(b.building_id, "Building"), v.str(b.room_number, "Room number", { max: 10 }).toUpperCase(),
         v.int(b.floor_no, "Floor", { min: 0, max: 30 }), b.room_type, v.int(b.capacity ?? 0, "Capacity", { min: 0, max: 5000 })]
      );
      return "Room added";
    }
    if (b.type === "sla") {
      await c.query(
        "UPDATE sla_policies SET response_hours = $2, resolution_hours = $3 WHERE priority_level = $1",
        [v.oneOf(b.priority_level, "Priority", ["P1", "P2", "P3", "P4"]),
         v.int(b.response_hours, "Response hours", { min: 1, max: 720 }), v.int(b.resolution_hours, "Resolution hours", { min: 1, max: 2000 })]
      );
      return `SLA for ${b.priority_level} updated`;
    }
    throw new HttpError(400, "Unknown type");
  });
  return ok({ message }, 201);
});
