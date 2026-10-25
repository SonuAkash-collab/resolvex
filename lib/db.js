// =====================================================================
// PostgreSQL access layer (node-postgres connection pool).
// Credentials come ONLY from environment variables (.env.local), never
// from source code. All queries are parameterised ($1, $2 ...) which
// prevents SQL injection.
// =====================================================================
import pg from "pg";
import { currentSession } from "./context";

const { Pool, types } = pg;
// return NUMERIC / BIGINT / COUNT(*) as JavaScript numbers instead of strings
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

const pool =
  globalThis.__resolvexPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
globalThis.__resolvexPool = pool;

/**
 * Runs fn(client) inside ONE transaction that carries the acting user:
 *   BEGIN -> set_config('app.current_user_id', id, true) -> fn -> COMMIT
 * The setting is read by Row-Level Security policies (who may see / change
 * which rows) and by the audit and history triggers (who made a change).
 * Any error -> ROLLBACK (all-or-nothing).
 */
async function inUserTransaction(userId, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(userId ?? "")]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Parameterised query. Inside an API request it runs as the logged-in user
 * (so RLS applies); without a session (e.g. before login) it runs with no
 * user, and RLS returns no rows from protected tables.
 */
export async function query(text, params = []) {
  const session = currentSession();
  if (!session) {
    const res = await pool.query(text, params);
    return res.rows;
  }
  return inUserTransaction(session.id, async (c) => (await c.query(text, params)).rows);
}

export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/** Several statements in ONE transaction, as the given (or current) user. */
export async function withTransaction(userId, fn) {
  return inUserTransaction(userId ?? currentSession()?.id, fn);
}

/** Converts a PostgreSQL error into a short, user friendly message. */
export function dbErrorMessage(err) {
  if (!err) return "Unknown error";
  switch (err.code) {
    case "23505":
      return "Duplicate value: " + (err.detail || err.constraint || "already exists");
    case "23503":
      return /still referenced/.test(err.detail || "")
        ? "Cannot delete: other records still refer to it (" + (err.constraint || "foreign key") + ")"
        : "Referenced record does not exist (" + (err.constraint || "foreign key") + ")";
    case "23514":
      return err.constraint ? `Validation failed (${err.constraint})${err.message && !err.message.startsWith("new row") ? ": " + err.message : ""}` : err.message;
    case "23502":
      return `Missing required value: ${err.column}`;
    case "22P02":
      return "Invalid input format";
    case "P0001":
      return err.message;
    case "42501":
      return /row-level security/.test(err.message || "")
        ? "Not allowed: the database's access rules (row-level security) block this for your role"
        : "Not allowed: the database denied permission for this action";
    default:
      return err.message || "Database error";
  }
}

export default pool;
