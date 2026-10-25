// GET  /api/users   list users with roles (Admin)
// POST /api/users   create a user; for technicians also creates the technicians row
//                   and skills - all in ONE transaction. Password is bcrypt-hashed.
import bcrypt from "bcryptjs";
import { ok, route, body, v, checkPasswordPolicy } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";

const ROLE_NAMES = ["STUDENT_STAFF", "TECHNICIAN", "FACILITY_MANAGER", "ADMIN"];

export const GET = route(async () => {
  await requireRole("ADMIN");
  const users = await query(`
    SELECT u.user_id, u.full_name, u.email, u.phone, u.is_active, u.created_at, r.role_name,
           t.employee_code, t.hourly_rate, t.is_available,
           (SELECT string_agg(c.category_name, ', ' ORDER BY c.category_name)
              FROM technician_skills s JOIN asset_categories c ON c.category_id = s.category_id
             WHERE s.technician_id = u.user_id) AS skills,
           (SELECT COUNT(*) FROM incidents i WHERE i.reported_by = u.user_id)::INT AS reported
      FROM users u
      JOIN roles r ON r.role_id = u.role_id
      LEFT JOIN technicians t ON t.technician_id = u.user_id
     ORDER BY r.role_id DESC, u.full_name`);
  return ok({ users });
});

export const POST = route(async (req) => {
  const s = await requireRole("ADMIN");
  const b = await body(req);
  const role = v.oneOf(b.role, "Role", ROLE_NAMES);
  checkPasswordPolicy(b.password);
  const hash = await bcrypt.hash(b.password, 10); // never store plain text

  const user = await withTransaction(s.id, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (full_name, email, password_hash, role_id, phone)
       VALUES ($1, lower($2), $3, (SELECT role_id FROM roles WHERE role_name = $4), $5)
       RETURNING user_id, full_name, email`,
      [
        v.str(b.full_name, "Full name", { min: 3, max: 100 }),
        v.str(b.email, "Email", { min: 5, max: 120 }),
        hash,
        role,
        v.str(b.phone, "Phone", { min: 10, max: 10, optional: true }),
      ]
    );
    const u = rows[0];
    if (role === "TECHNICIAN") {
      await c.query(
        "INSERT INTO technicians (technician_id, employee_code, hourly_rate, max_concurrent_jobs) VALUES ($1, $2, $3, $4)",
        [u.user_id, v.str(b.employee_code, "Employee code", { min: 7, max: 12 }).toUpperCase(),
         v.num(b.hourly_rate, "Hourly rate", { min: 1, max: 5000 }), v.int(b.max_concurrent_jobs ?? 4, "Max jobs", { min: 1, max: 10 })]
      );
      const skills = Array.isArray(b.skills) ? b.skills : [];
      if (!skills.length) throw new HttpError(400, "Pick at least one skill for a technician");
      for (const cat of skills) {
        await c.query("INSERT INTO technician_skills (technician_id, category_id, skill_level) VALUES ($1, $2, 3)", [u.user_id, v.int(cat, "Skill")]);
      }
    }
    return u;
  });
  return ok({ user, message: `User ${user.email} created` }, 201);
});
