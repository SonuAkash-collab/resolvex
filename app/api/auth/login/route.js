import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { queryOne } from "@/lib/db";
import { route, body, ok, fail } from "@/lib/api";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE, homeForRole } from "@/lib/auth";

// very small in-memory brute force protection: 5 failed attempts / 10 minutes per email
const attempts = globalThis.__rxLoginAttempts || new Map();
globalThis.__rxLoginAttempts = attempts;

export const POST = route(async (req) => {
  const { email, password } = await body(req);
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return fail("Email and password are required", 400);
  }
  const key = email.trim().toLowerCase();
  const rec = attempts.get(key);
  if (rec && rec.count >= 5 && Date.now() - rec.first < 10 * 60 * 1000) {
    return fail("Too many failed attempts. Try again in 10 minutes.", 429);
  }

  // The app's DB role cannot read password hashes directly (column privilege);
  // this SECURITY DEFINER function returns the one hash needed to check the login.
  // Parameterised - no SQL injection possible.
  const user = await queryOne("SELECT * FROM fn_login_lookup($1)", [key]);

  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!valid) {
    const r = rec && Date.now() - rec.first < 10 * 60 * 1000 ? rec : { count: 0, first: Date.now() };
    r.count += 1;
    attempts.set(key, r);
    return fail("Incorrect email or password", 401);
  }
  if (!user.is_active) return fail("This account has been deactivated. Contact the administrator.", 403);

  attempts.delete(key);
  const token = await createSessionToken(user);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  return ok({
    user: { id: user.user_id, name: user.full_name, role: user.role_name, email: user.email },
    home: homeForRole(user.role_name),
  });
});
