// GET  /api/nosql                                   collections, validators, indexes, sizes, sample documents
// POST /api/nosql { action: "find", collection, filter, projection, sort, limit }   read-only query console + explain
// POST /api/nosql { action: "orphans" }             cross-database check: notes whose incident is not in PostgreSQL
// POST /api/nosql { action: "cleanup-orphans" }     admin: delete those notes
import { BSON } from "mongodb";
import { ok, route, body, v } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { query } from "@/lib/db";
import { mongoDb } from "@/lib/mongo";

const { EJSON } = BSON;
const COLLECTIONS = ["incident_notes", "inspection_templates", "search_events"];
// operators that run JavaScript on the server or write data are never accepted from the console
const FORBIDDEN = new Set(["$where", "$function", "$accumulator", "$out", "$merge"]);
const show = (doc) => EJSON.serialize(doc, { relaxed: true }); // shows BSON types: {"$oid": ...}, {"$date": ...}

function parseJson(text, name, fallback) {
  if (text === undefined || text === null || String(text).trim() === "") return fallback;
  if (typeof text !== "string" || text.length > 3000) throw new HttpError(400, `${name} must be JSON text (max 3000 characters)`);
  let value;
  try {
    value = EJSON.parse(text, { relaxed: true }); // accepts {"$date": "..."} and {"$oid": "..."}
  } catch (e) {
    throw new HttpError(400, `${name} is not valid JSON: ${e.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, `${name} must be a JSON object`);
  (function walk(x, depth) {
    if (depth > 12) throw new HttpError(400, `${name} is nested too deeply`);
    if (x && typeof x === "object" && !(x instanceof Date) && !(x?._bsontype)) {
      for (const [k, val] of Object.entries(x)) {
        if (FORBIDDEN.has(k)) throw new HttpError(400, `${k} is not allowed here (it runs code or writes data)`);
        walk(val, depth + 1);
      }
    }
  })(value, 0);
  return value;
}

function planSummary(explain) {
  const qp = explain.queryPlanner;
  const root = qp?.winningPlan?.queryPlan || qp?.winningPlan;
  const stages = [];
  const indexes = new Set();
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.stage) stages.push(n.stage);
    if (n.indexName) indexes.add(n.indexName);
    walk(n.inputStage);
    (n.inputStages || []).forEach(walk);
  })(root);
  const ex = explain.executionStats || {};
  return {
    stages: stages.join(" ← "),
    indexes: [...indexes],
    usesIndex: indexes.size > 0 || stages.some((s) => /IXSCAN|TEXT|IDHACK|EXPRESS/.test(s)),
    keysExamined: ex.totalKeysExamined,
    docsExamined: ex.totalDocsExamined,
    returned: ex.nReturned,
    ms: ex.executionTimeMillis,
  };
}

async function findOrphans(db) {
  const ids = await db.collection("incident_notes").distinct("incident_id");
  if (!ids.length) return { incidentsWithNotes: 0, orphans: [] };
  const found = await query("SELECT incident_id FROM incidents WHERE incident_id = ANY($1::int[])", [ids]);
  const existing = new Set(found.map((r) => r.incident_id));
  const missing = ids.filter((id) => !existing.has(id));
  const orphans = missing.length
    ? await db
        .collection("incident_notes")
        .aggregate([{ $match: { incident_id: { $in: missing } } }, { $group: { _id: "$incident_id", notes: { $sum: 1 } } }, { $project: { _id: 0, incident_id: "$_id", notes: 1 } }, { $sort: { incident_id: 1 } }])
        .toArray()
    : [];
  return { incidentsWithNotes: ids.length, orphans };
}

export const GET = route(async () => {
  await requireRole("FACILITY_MANAGER", "ADMIN");
  const db = await mongoDb();
  const [build, stats, listed] = await Promise.all([
    db.admin().command({ buildInfo: 1 }).catch(() => ({})),
    db.command({ dbStats: 1 }),
    db.listCollections().toArray(),
  ]);
  const collections = [];
  for (const name of COLLECTIONS) {
    const c = db.collection(name);
    const meta = listed.find((x) => x.name === name);
    if (!meta) {
      collections.push({ name, missing: true });
      continue;
    }
    const [count, indexes, storage, samples] = await Promise.all([
      c.estimatedDocumentCount(),
      c.listIndexes().toArray(),
      c.aggregate([{ $collStats: { storageStats: {} } }]).toArray().catch(() => []),
      name === "incident_notes"
        ? Promise.all([c.findOne({ kind: "INSPECTION" }, { sort: { created_at: -1 } }), c.findOne({ kind: "COMMENT", edits: { $exists: true } }, { sort: { created_at: -1 } })])
        : c.find({}, { sort: { _id: -1 } }).limit(1).toArray(),
    ]);
    const s = storage[0]?.storageStats || {};
    collections.push({
      name,
      count,
      validator: meta.options?.validator || null,
      validationLevel: meta.options?.validationLevel || "strict",
      validationAction: meta.options?.validationAction || "error",
      dataBytes: s.size ?? null,
      avgDocBytes: s.avgObjSize ?? null,
      indexBytes: s.totalIndexSize ?? null,
      indexes: indexes.map((ix) => ({
        name: ix.name,
        keys: ix.key,
        unique: !!ix.unique,
        partial: ix.partialFilterExpression || null,
        ttlSeconds: ix.expireAfterSeconds ?? null,
        text: !!ix.weights,
        weights: ix.weights || null,
        bytes: s.indexSizes?.[ix.name] ?? null,
      })),
      samples: samples.filter(Boolean).map(show),
    });
  }
  return ok({
    server: { version: build.version || "?", database: db.databaseName, collections: stats.collections, objects: stats.objects, dataBytes: stats.dataSize, indexBytes: stats.indexSize },
    collections,
  });
});

export const POST = route(async (req) => {
  const s = await requireRole("FACILITY_MANAGER", "ADMIN");
  const b = await body(req);
  const action = v.oneOf(b.action, "action", ["find", "orphans", "cleanup-orphans"]);
  const db = await mongoDb();

  if (action === "orphans") return ok(await findOrphans(db));

  if (action === "cleanup-orphans") {
    if (s.role !== "ADMIN") throw new HttpError(403, "Only an admin can delete documents in bulk");
    const { orphans } = await findOrphans(db);
    if (!orphans.length) return ok({ message: "Nothing to clean up: every note refers to an existing incident", deleted: 0 });
    const { deletedCount } = await db.collection("incident_notes").deleteMany({ incident_id: { $in: orphans.map((o) => o.incident_id) } });
    return ok({ message: `Deleted ${deletedCount} orphaned note(s) (deleteMany)`, deleted: deletedCount });
  }

  // read-only query console
  const name = v.oneOf(b.collection, "collection", COLLECTIONS);
  const filter = parseJson(b.filter, "Filter", {});
  const projection = parseJson(b.projection, "Projection", undefined);
  const sort = parseJson(b.sort, "Sort", undefined);
  const limit = v.int(b.limit ?? 10, "Limit", { min: 1, max: 50 });
  const c = db.collection(name);
  const cursorOpts = { projection, sort, limit, maxTimeMS: 3000 };
  const t = Date.now();
  const [docs, matching, explain] = await Promise.all([
    c.find(filter, cursorOpts).toArray(),
    c.countDocuments(filter, { maxTimeMS: 3000 }),
    c.find(filter, cursorOpts).explain("executionStats"),
  ]);
  const j = (x) => EJSON.stringify(x, { relaxed: true });
  const shell = `db.${name}.find(${j(filter)}${projection ? ", " + j(projection) : ""})${sort ? `.sort(${j(sort)})` : ""}.limit(${limit})`;
  return ok({ shell, ms: Date.now() - t, matching, docs: docs.map(show), plan: planSummary(explain) });
});
