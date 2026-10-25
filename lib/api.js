// Small helpers shared by all Route Handlers.
import { NextResponse } from "next/server";
import { HttpError } from "./auth";
import { dbErrorMessage } from "./db";

export const ok = (data, status = 200) => NextResponse.json(data, { status });
export const fail = (message, status = 400) => NextResponse.json({ error: message }, { status });

/** Wraps a handler: converts thrown errors into JSON responses. */
export function route(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.message, err.status);
      if (err?.code) return fail(dbErrorMessage(err), 400); // PostgreSQL error (constraint, trigger, procedure)
      console.error(err);
      return fail("Internal server error", 500);
    }
  };
}

/** Reads a JSON body safely. */
export async function body(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

/** Basic server side input validation helpers (the database validates again). */
export const v = {
  int(value, name, { min = 1, max = 2147483647, optional = false } = {}) {
    if (optional && (value === undefined || value === null || value === "")) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}`);
    return n;
  },
  num(value, name, { min = 0, max = 1e9 } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}`);
    return n;
  },
  str(value, name, { min = 1, max = 1000, optional = false } = {}) {
    if (optional && (value === undefined || value === null || String(value).trim() === "")) return null;
    if (typeof value !== "string") throw new HttpError(400, `${name} is required`);
    const s = value.trim();
    if (s.length < min || s.length > max) throw new HttpError(400, `${name} must be ${min}-${max} characters`);
    return s;
  },
  oneOf(value, name, options) {
    if (!options.includes(value)) throw new HttpError(400, `${name} must be one of: ${options.join(", ")}`);
    return value;
  },
};

/** Password policy for accounts created by the admin. */
export function checkPasswordPolicy(pw) {
  if (typeof pw !== "string" || pw.length < 8 || pw.length > 72) throw new HttpError(400, "Password must be 8-72 characters");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
    throw new HttpError(400, "Password needs upper case, lower case, a digit and a symbol");
  }
}

