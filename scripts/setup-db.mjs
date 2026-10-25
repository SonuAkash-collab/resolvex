// =====================================================================
// ResolveX database setup
//   1. creates the database if it does not exist
//   2. runs database/00_drop.sql ... 08_seed.sql in order
//   3. creates the least-privilege application login (APP_DB_USER)
//   4. sets up MongoDB (document store): app login, collections with
//      validators, indexes and data (scripts/setup-mongo.mjs)
//   5. generates embeddings for every incident (pgvector)
// Usage:  npm run db:setup          (add --skip-embed to skip step 5)
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) {
  console.error("Set DATABASE_ADMIN_URL (or DATABASE_URL) in .env.local first.");
  process.exit(1);
}

const SQL_FILES = [
  "00_drop.sql",
  "01_schema.sql",
  "02_alter.sql",
  "03_indexes.sql",
  "04_functions_procedures.sql",
  "05_triggers.sql",
  "06_views.sql",
  "07_security.sql",
  "08_seed.sql",
];

async function ensureDatabase() {
  const url = new URL(adminUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
      console.log(`created database ${dbName}`);
    }
  } catch (e) {
    console.warn(`(could not check/create database automatically: ${e.message})`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  await ensureDatabase();
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  client.on("notice", () => {});

  for (const file of SQL_FILES) {
    const sql = fs.readFileSync(path.join(root, "database", file), "utf8");
    process.stdout.write(`running ${file.padEnd(32)}`);
    const t = Date.now();
    await client.query(sql);
    console.log(`ok (${Date.now() - t} ms)`);
  }

  const appUser = process.env.APP_DB_USER;
  const appPass = process.env.APP_DB_PASSWORD;
  if (appUser && appPass) {
    if (!/^[a-z_][a-z0-9_]{2,30}$/.test(appUser)) throw new Error("APP_DB_USER must be a simple lowercase identifier");
    const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appUser]);
    const pw = appPass.replace(/'/g, "''");
    await client.query(
      rowCount
        ? `ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${pw}'`
        : `CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${pw}'`
    );
    await client.query(`GRANT resolvex_app TO ${appUser}`);
    console.log(`application login '${appUser}' ready (member of resolvex_app)`);
  }
  await client.end();

  let mongoOk = true;
  try {
    const { setupMongo } = await import("./setup-mongo.mjs");
    console.log("");
    await setupMongo({ pgUrl: adminUrl });
  } catch (e) {
    mongoOk = false;
    console.error(`\nMongoDB setup failed: ${e.message}`);
    console.error("Is MongoDB running (docker compose up -d) and are MONGODB_ADMIN_URI / MONGODB_URI in .env.local correct?");
    console.error("PostgreSQL is ready; re-run only the MongoDB part later with:  npm run db:mongo\n");
  }

  if (!process.argv.includes("--skip-embed")) {
    const { embedAll } = await import("./embed-incidents.mjs");
    await embedAll(adminUrl);
  }
  console.log(mongoOk ? "\nDatabases are ready. Start the app with:  npm run dev" : "\nPostgreSQL is ready, MongoDB is NOT (see the message above).");
}

main().catch((e) => {
  console.error("\nSETUP FAILED:", e.message);
  process.exit(1);
});
