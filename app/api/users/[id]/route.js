// PATCH /api/users/:id  { is_active? , password? , is_available? }   (Admin)
import bcrypt from "bcryptjs";
import { ok, route, body, v, checkPasswordPolicy } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export const PATCH = route(async (req, { params }) => {
  const s = await requireRole("ADMIN");
  const id = v.int((await params).id, "User id");
  const b = await body(req);
  if (id === s.id && b.is_active === false) throw new HttpError(400, "You cannot deactivate your own account");

  await withTransaction(s.id, async (c) => {
    if (typeof b.is_active === "boolean") {
      await c.query("UPDATE users SET is_active = $2 WHERE user_id = $1", [id, b.is_active]);
    }
    if (typeof b.is_available === "boolean") {
      await c.query("UPDATE technicians SET is_available = $2 WHERE technician_id = $1", [id, b.is_available]);
    }
    if (b.password) {
      checkPasswordPolicy(b.password);
      await c.query("UPDATE users SET password_hash = $2 WHERE user_id = $1", [id, await bcrypt.hash(b.password, 10)]);
    }
  });
  return ok({ message: "User updated" });
});
