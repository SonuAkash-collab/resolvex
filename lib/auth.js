// =====================================================================
// Authentication & authorisation helpers.
//  * Passwords are verified with bcrypt (hashes stored in users.password_hash)
//  * A signed JWT (HS256, secret from env JWT_SECRET) is stored in an
//    httpOnly cookie, so JavaScript in the browser can never read it.
//  * requireRole() enforces role based access inside every API route.
// =====================================================================
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { setCurrentSession } from "./context";

export const SESSION_COOKIE = "rx_session";
const SESSION_HOURS = 8;

export const ROLES = {
  STUDENT_STAFF: "STUDENT_STAFF",
  TECHNICIAN: "TECHNICIAN",
  FACILITY_MANAGER: "FACILITY_MANAGER",
  ADMIN: "ADMIN",
};

export const ROLE_LABELS = {
  STUDENT_STAFF: "Student / Staff",
  TECHNICIAN: "Technician",
  FACILITY_MANAGER: "Facility Manager",
  ADMIN: "Administrator",
};

function secretKey() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET must be set (32+ characters) in .env.local");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(user) {
  return new SignJWT({ name: user.full_name, role: user.role_name, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.user_id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return { id: Number(payload.sub), name: payload.name, role: payload.role, email: payload.email };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    // Secure (HTTPS only) in production; override with COOKIE_SECURE=false for a plain-HTTP LAN demo
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  };
}

/** Session of the current request (null when not logged in). */
export async function getSession() {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Throws 401/403 unless the user is logged in with one of the roles. */
export async function requireRole(...roles) {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Please log in");
  if (roles.length && !roles.includes(session.role)) {
    throw new HttpError(403, "Your role is not allowed to do this");
  }
  setCurrentSession(session); // every later SQL statement in this request runs as this user (RLS)
  return session;
}

export const homeForRole = (role) =>
  ({
    STUDENT_STAFF: "/my",
    TECHNICIAN: "/work-orders",
    FACILITY_MANAGER: "/queue",
    ADMIN: "/analytics",
  })[role] || "/login";
