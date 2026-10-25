// =====================================================================
// PostgreSQL access layer (node-postgres connection pool).
// Credentials come ONLY from environment variables (.env.local), never
// from source code. All queries are parameterised ($1, $2 ...) which
// prevents SQL injection.
// =====================================================================
import pg from "pg";

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

/** Simple parameterised query. */
export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/**
 * Runs fn(client) inside ONE database transaction.
 *   BEGIN -> set app.current_user_id (read by audit/history triggers)
 *         -> fn(client)
 *   COMMIT on success, ROLLBACK on any error (all-or-nothing).
 */
export async function withTransaction(userId, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(userId ?? "")]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
    default:
      return err.message || "Database error";
  }
}

export default pool;
