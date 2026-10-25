// =====================================================================
// ResolveX MongoDB (document store) test suite.
// Runs against the database created by `npm run db:setup`, logged in as
// the web app's own MongoDB user (MONGODB_URI), like the app itself.
// Usage:  npm run test:nosql        Results: docs/TEST_RESULTS_NOSQL.md
// =====================================================================
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";
import { MongoClient } from "mongodb";

dotenv.config({ path: ".env.local" });
dotenv.config();

const results = [];
async function test(id, area, name, fn) {
  let pass = false;
  let detail = "";
  try {
    ({ pass, detail } = await fn());
  } catch (e) {
    detail = "error: " + (e.codeName || e.code || "") + " " + e.message;
  }
  results.push({ id, area, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}\n        ${detail}`);
}

// expects MongoDB to reject the write with "Document failed validation" (code 121)
async function rejected(promise) {
  try {
    const r = await promise;
    return { ok: false, why: "accepted " + (r.insertedId || "") };
  } catch (e) {
    return { ok: e.code === 121, why: `code ${e.code} ${e.codeName || ""}`.trim() };
  }
}

async function denied(fn) {
  try {
    await fn();
    return "ALLOWED";
  } catch (e) {
    return e.codeName === "Unauthorized" || e.code === 13 ? "denied" : `error ${e.code}`;
  }
}

function plan(explain) {
  const stages = [];
  const indexes = [];
  (function walk(n) {
    if (!n) return;
    if (n.stage) stages.push(n.stage);
    if (n.indexName) indexes.push(n.indexName);
    walk(n.inputStage);
    (n.inputStages || []).forEach(walk);
  })(explain.queryPlanner.winningPlan.queryPlan || explain.queryPlanner.winningPlan);
  return { stages, indexes, ex: explain.executionStats };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in .env.local");
    process.exit(1);
  }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db();
  const notes = db.collection("incident_notes");
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL });
  await pgc.connect();

  const author = { user_id: 4, name: "Ravi Kumar", role: "TECHNICIAN" };
  const base = { incident_id: 999999, visibility: "STAFF", author, text: "__test__", created_at: new Date() };
  const hvac = { ...base, kind: "INSPECTION", category_key: "HVAC", checklist: [{ item: "Filter clean", ok: false }], verdict: "MONITOR" };

  // ---------------------------------------------------------- schema
  await test("N01", "Collections", "Three collections exist with strict $jsonSchema validators", async () => {
    const list = await db.listCollections().toArray();
    const ours = list.filter((c) => ["incident_notes", "inspection_templates", "search_events"].includes(c.name));
    const strict = ours.filter((c) => c.options?.validator?.$jsonSchema && c.options.validationLevel === "strict" && c.options.validationAction === "error");
    return { pass: strict.length === 3, detail: ours.map((c) => `${c.name} (${c.options.validationLevel}/${c.options.validationAction})`).join(", ") };
  });
  await test("N02", "Indexes", "Compound, multikey, partial, text, unique and TTL indexes exist", async () => {
    const names = [];
    for (const c of ["incident_notes", "inspection_templates", "search_events"]) for (const ix of await db.collection(c).listIndexes().toArray()) names.push(ix.name);
    const need = ["ix_incident_thread", "ix_author", "ix_tags", "ix_inspection_verdict", "tx_note_text", "uq_category_id", "ttl_search_events", "ix_mode_time"];
    const missing = need.filter((n) => !names.includes(n));
    return { pass: !missing.length, detail: missing.length ? "missing " + missing.join(", ") : `${names.length} indexes incl. ${need.join(", ")}` };
  });
  await test("N03", "Data", "Templates, notes and search events are loaded", async () => {
    const [t, n, i, s] = await Promise.all([
      db.collection("inspection_templates").countDocuments(),
      notes.countDocuments({ kind: "COMMENT" }),
      notes.countDocuments({ kind: "INSPECTION" }),
      db.collection("search_events").countDocuments(),
    ]);
    return { pass: t === 9 && n > 50 && i > 50 && s > 100, detail: `${t} templates, ${n} comments, ${i} inspection logs, ${s} search events` };
  });

  // ---------------------------------------------------------- validation
  await test("N04", "Validation", "Document without an author is rejected", async () => {
    const { author: _a, ...doc } = { ...base, kind: "COMMENT", visibility: "PUBLIC" };
    const r = await rejected(notes.insertOne(doc));
    return { pass: r.ok, detail: r.why };
  });
  await test("N05", "Validation", "Unknown kind (enum) is rejected", async () => {
    const r = await rejected(notes.insertOne({ ...base, kind: "RANDOM" }));
    return { pass: r.ok, detail: r.why };
  });
  await test("N06", "Validation", "An HVAC inspection cannot contain an Electrical reading (voltage_v)", async () => {
    const r = await rejected(notes.insertOne({ ...hvac, readings: { voltage_v: 230 } }));
    return { pass: r.ok, detail: r.why + " (readings.additionalProperties: false, generated from the HVAC template)" };
  });
  await test("N07", "Validation", "A reading outside its allowed range is rejected (supply air 99 °C)", async () => {
    const r = await rejected(notes.insertOne({ ...hvac, readings: { supply_air_temp_c: 99 } }));
    return { pass: r.ok, detail: r.why };
  });
  await test("N08", "Validation", "A reading of the wrong type is rejected (compressor_running: \"yes\")", async () => {
    const r = await rejected(notes.insertOne({ ...hvac, readings: { compressor_running: "yes" } }));
    return { pass: r.ok, detail: r.why };
  });
  await test("N09", "Validation", "A student cannot be the author of an inspection log", async () => {
    const r = await rejected(notes.insertOne({ ...hvac, author: { user_id: 11, name: "Aditya Rao", role: "STUDENT_STAFF" }, readings: { room_temp_c: 30 } }));
    return { pass: r.ok, detail: r.why };
  });
  await test("N10", "Validation", "A comment cannot carry readings (oneOf branches)", async () => {
    const r = await rejected(notes.insertOne({ ...base, kind: "COMMENT", readings: { room_temp_c: 30 } }));
    return { pass: r.ok, detail: r.why };
  });
  await test("N11", "Validation", "Tags must be lower-case slugs and unique", async () => {
    const a = await rejected(notes.insertOne({ ...base, kind: "COMMENT", tags: ["Gas Leak"] }));
    const b = await rejected(notes.insertOne({ ...base, kind: "COMMENT", tags: ["leak", "leak"] }));
    return { pass: a.ok && b.ok, detail: `"Gas Leak": ${a.why}; duplicate tag: ${b.why}` };
  });
  await test("N12", "Flexible schema", "Valid inspections of two categories store different reading fields", async () => {
    const a = await notes.insertOne({ ...hvac, readings: { supply_air_temp_c: 22.5, filter_condition: "Blocked" } });
    const b = await notes.insertOne({ ...base, kind: "INSPECTION", category_key: "LIFT", readings: { door_faults_7d: 12, emergency_phone_ok: false }, checklist: [], verdict: "NEEDS_VENDOR" });
    const docs = await notes.find({ _id: { $in: [a.insertedId, b.insertedId] } }).toArray();
    const keys = docs.map((d) => Object.keys(d.readings).join("+"));
    return { pass: docs.length === 2 && keys[0] !== keys[1], detail: `stored: ${keys.join(" | ")} in the same collection` };
  });

  // ---------------------------------------------------------- update / delete
  await test("N13", "UPDATE", "$set + $push edit history in one atomic update", async () => {
    const { insertedId } = await notes.insertOne({ ...base, kind: "COMMENT", visibility: "PUBLIC", text: "__test__ v1" });
    await notes.updateOne({ _id: insertedId }, { $set: { text: "__test__ v2", updated_at: new Date() }, $push: { edits: { text: "__test__ v1", edited_at: new Date() } } });
    const d = await notes.findOne({ _id: insertedId });
    return { pass: d.text === "__test__ v2" && d.edits.length === 1 && d.edits[0].text === "__test__ v1", detail: `text "${d.text}", edits ${JSON.stringify(d.edits.map((e) => e.text))}` };
  });
  await test("N14", "UPDATE", "$addToSet is idempotent and $pull removes a vote", async () => {
    const { insertedId } = await notes.insertOne({ ...base, kind: "COMMENT", visibility: "PUBLIC" });
    await notes.updateOne({ _id: insertedId }, { $addToSet: { helpful: 11 } });
    await notes.updateOne({ _id: insertedId }, { $addToSet: { helpful: 11 } });
    const twice = (await notes.findOne({ _id: insertedId })).helpful.length;
    await notes.updateOne({ _id: insertedId }, { $pull: { helpful: 11 } });
    const after = (await notes.findOne({ _id: insertedId })).helpful.length;
    return { pass: twice === 1 && after === 0, detail: `after adding twice: ${twice} vote, after $pull: ${after}` };
  });
  await test("N15", "UPDATE", "An update that breaks the validator is rejected too", async () => {
    const { insertedId } = await notes.insertOne({ ...hvac, readings: { room_temp_c: 30 } });
    const r = await rejected(notes.updateOne({ _id: insertedId }, { $set: { "readings.room_temp_c": 500 } }));
    return { pass: r.ok, detail: r.why };
  });
  await test("N16", "DELETE", "deleteMany removes the test documents", async () => {
    const before = await notes.countDocuments({ text: /^__test__/ });
    const { deletedCount } = await notes.deleteMany({ text: /^__test__/ });
    return { pass: before > 0 && deletedCount === before, detail: `${deletedCount} of ${before} test documents deleted` };
  });

  // ---------------------------------------------------------- indexes in use
  await test("N17", "Index use", "An incident's thread is read with the compound index, no collection scan", async () => {
    const p = plan(await notes.find({ incident_id: 136 }).sort({ created_at: -1 }).explain("executionStats"));
    return { pass: p.indexes.includes("ix_incident_thread") && !p.stages.includes("COLLSCAN") && p.ex.totalDocsExamined === p.ex.nReturned, detail: `${p.stages.join(" <- ")}; docs examined ${p.ex.totalDocsExamined}, returned ${p.ex.nReturned}` };
  });
  await test("N18", "Index use", "Partial index serves inspection queries by category and verdict", async () => {
    const p = plan(await notes.find({ kind: "INSPECTION", category_key: "HVAC", verdict: "NEEDS_PARTS" }).explain("executionStats"));
    return { pass: p.indexes.includes("ix_inspection_verdict"), detail: `${p.stages.join(" <- ")} via ${p.indexes.join(", ")}; ${p.ex.nReturned} returned` };
  });
  await test("N19", "Index use", "Multikey index on the tags array", async () => {
    const p = plan(await notes.find({ tags: "refrigerant" }).explain("executionStats"));
    return { pass: p.indexes.includes("ix_tags"), detail: `${p.stages.join(" <- ")}; ${p.ex.nReturned} notes tagged refrigerant` };
  });
  await test("N20", "Text search", "$text search ranks the fan-motor note first", async () => {
    const docs = await notes.find({ $text: { $search: "fan motor rattling" } }, { projection: { text: 1, score: { $meta: "textScore" } } }).sort({ score: { $meta: "textScore" } }).limit(3).toArray();
    return { pass: docs.length > 0 && /fan motor/i.test(docs[0].text), detail: docs.length ? `top (${docs[0].score.toFixed(2)}): ${docs[0].text}` : "no results" };
  });
  await test("N21", "TTL", "search_events expire automatically after 90 days (TTL index)", async () => {
    const ix = (await db.collection("search_events").listIndexes().toArray()).find((i) => i.name === "ttl_search_events");
    return { pass: ix?.expireAfterSeconds === 90 * 86400 && ix.key.at === 1, detail: `key ${JSON.stringify(ix?.key)}, expireAfterSeconds ${ix?.expireAfterSeconds}` };
  });

  // ---------------------------------------------------------- aggregation
  await test("N22", "Aggregation", "$unwind/$group failed-check counts match a manual count", async () => {
    const agg = await notes.aggregate([{ $match: { kind: "INSPECTION" } }, { $unwind: "$checklist" }, { $match: { "checklist.ok": false } }, { $count: "n" }]).toArray();
    let manual = 0;
    for (const d of await notes.find({ kind: "INSPECTION" }, { projection: { checklist: 1 } }).toArray()) manual += d.checklist.filter((c) => !c.ok).length;
    return { pass: agg[0]?.n === manual && manual > 0, detail: `pipeline ${agg[0]?.n}, manual ${manual}` };
  });
  await test("N23", "Aggregation", "$lookup + $objectToArray finds readings outside the template's normal range", async () => {
    const rows = await notes
      .aggregate([
        { $match: { kind: "INSPECTION" } },
        { $lookup: { from: "inspection_templates", localField: "category_key", foreignField: "_id", as: "t" } },
        { $unwind: "$t" },
        { $project: { fields: "$t.fields", r: { $objectToArray: "$readings" } } },
        { $unwind: "$r" },
        { $addFields: { f: { $first: { $filter: { input: "$fields", as: "f", cond: { $eq: ["$$f.key", "$r.k"] } } } } } },
        { $match: { "f.type": "number", "f.normal_min": { $type: "number" }, $expr: { $or: [{ $lt: ["$r.v", "$f.normal_min"] }, { $gt: ["$r.v", "$f.normal_max"] }] } } },
        { $project: { _id: 0, key: "$r.k", v: "$r.v", lo: "$f.normal_min", hi: "$f.normal_max" } },
      ])
      .toArray();
    const allOutside = rows.every((x) => x.v < x.lo || x.v > x.hi);
    return { pass: rows.length > 0 && allOutside, detail: `${rows.length} abnormal readings, e.g. ${rows.slice(0, 2).map((x) => `${x.key}=${x.v} (normal ${x.lo}-${x.hi})`).join(", ")}` };
  });

  // ---------------------------------------------------------- security
  await test("N24", "Security", "The app's MongoDB login cannot drop, alter, bypass validation or touch other databases", async () => {
    const checks = {
      "drop collection": () => notes.drop(),
      "delete search log": () => db.collection("search_events").deleteOne({}),
      "change template": () => db.collection("inspection_templates").updateOne({ _id: "HVAC" }, { $set: { x: 1 } }),
      "create index": () => notes.createIndex({ text: 1 }),
      "switch validator off": () => db.command({ collMod: "incident_notes", validationLevel: "off" }),
      "bypass validation": () => notes.insertOne({ junk: 1 }, { bypassDocumentValidation: true }),
      "create user": () => db.command({ createUser: "intruder", pwd: "x", roles: [] }),
      "read admin db": () => client.db("admin").collection("system.users").findOne(),
    };
    const out = {};
    for (const [k, fn] of Object.entries(checks)) out[k] = await denied(fn);
    const allowed = Object.entries(out).filter(([, v]) => v !== "denied");
    return { pass: !allowed.length, detail: allowed.length ? "allowed: " + allowed.map(([k]) => k).join(", ") : Object.keys(out).join(", ") + ": all denied" };
  });

  // ---------------------------------------------------------- cross-database consistency
  await test("N25", "Cross-database", "Every note refers to an incident that exists in PostgreSQL", async () => {
    const ids = await notes.distinct("incident_id");
    const { rows } = await pgc.query("SELECT count(*)::int AS n FROM incidents WHERE incident_id = ANY($1::int[])", [ids]);
    return { pass: rows[0].n === ids.length, detail: `${ids.length} incident ids in MongoDB, ${rows[0].n} found in PostgreSQL` };
  });
  await test("N26", "Cross-database", "Each inspection's category matches its incident's category in PostgreSQL", async () => {
    const tpl = Object.fromEntries((await db.collection("inspection_templates").find().toArray()).map((t) => [t._id, t.category_id]));
    const insp = await notes.find({ kind: "INSPECTION" }, { projection: { incident_id: 1, category_key: 1 } }).toArray();
    const { rows } = await pgc.query("SELECT incident_id, category_id FROM incidents WHERE incident_id = ANY($1::int[])", [insp.map((x) => x.incident_id)]);
    const cat = new Map(rows.map((r) => [r.incident_id, r.category_id]));
    const bad = insp.filter((x) => tpl[x.category_key] !== cat.get(x.incident_id));
    return { pass: !bad.length, detail: `${insp.length} inspection logs checked, ${bad.length} mismatches` };
  });
  await test("N27", "Cross-database", "Seeded inspection authors are technicians with a work order on that incident", async () => {
    const insp = await notes.find({ kind: "INSPECTION", "author.role": "TECHNICIAN" }, { projection: { incident_id: 1, "author.user_id": 1 } }).toArray();
    const { rows } = await pgc.query("SELECT incident_id, technician_id FROM work_orders");
    const pairs = new Set(rows.map((r) => `${r.incident_id}/${r.technician_id}`));
    const bad = insp.filter((x) => !pairs.has(`${x.incident_id}/${x.author.user_id}`));
    return { pass: !bad.length, detail: `${insp.length} checked against work_orders, ${bad.length} without a matching work order` };
  });

  await notes.deleteMany({ text: /^__test__/ }).catch(() => {});
  await client.close();
  await pgc.end();

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  const md = [
    "# MongoDB (document store) test results",
    "",
    `Run on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC with \`npm run test:nosql\`, logged in as the app's MongoDB user.`,
    "",
    `**${passed} of ${results.length} passed.**`,
    "",
    "| ID | Area | Test case | Result | Detail |",
    "|----|------|-----------|--------|--------|",
    ...results.map((r) => `| ${r.id} | ${r.area} | ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${String(r.detail).replace(/\|/g, "/").slice(0, 170)} |`),
    "",
  ].join("\n");
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/TEST_RESULTS_NOSQL.md", md);
  process.exit(passed === results.length ? 0 : 1);
}

main();
