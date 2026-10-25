// =====================================================================
// ResolveX - MongoDB live demo for the viva (mongosh)
//
// Open the shell inside the Docker container:
//   docker exec -it resolvex-mongo mongosh -u root -p mongo_dev_only --authenticationDatabase admin resolvex
// (or MongoDB Compass > connect with MONGODB_ADMIN_URI > "Open MongoDB shell")
//
// Paste one section at a time, or run everything:  load("database/mongodb/live_demo.mongosh.js")
// Everything below cleans up after itself; the app's data is not changed.
// =====================================================================
db = db.getSiblingDB("resolvex");
const title = (t) => print("\n==== " + t + " ====");

// ---------------------------------------------------------------- 1. what is stored
title("1. Collections and document counts");
db.getCollectionNames().forEach((c) => print(c.padEnd(22), db.getCollection(c).countDocuments()));

title("1b. One inspection log: readings differ per equipment category");
printjson(db.incident_notes.findOne({ kind: "INSPECTION", category_key: "HVAC" }, { _id: 0, incident_id: 1, author: 1, readings: 1, checklist: 1, verdict: 1 }));
printjson(db.incident_notes.findOne({ kind: "INSPECTION", category_key: "NETWORK" }, { _id: 0, incident_id: 1, readings: 1 }));

title("1c. The validator ($jsonSchema) of incident_notes - top level");
const v = db.getCollectionInfos({ name: "incident_notes" })[0].options;
print("validationLevel:", v.validationLevel, " validationAction:", v.validationAction);
printjson(v.validator.$jsonSchema.required);

// ---------------------------------------------------------------- 2. CREATE (DDL + insert)
title("2. CREATE: a new collection with a validator, then insertOne / insertMany");
db.viva_demo.drop();
db.createCollection("viva_demo", {
  validator: { $jsonSchema: { bsonType: "object", required: ["name", "marks"], properties: { name: { bsonType: "string" }, marks: { bsonType: "int", minimum: 0, maximum: 50 } } } },
  validationAction: "error",
});
db.viva_demo.insertOne({ name: "ER diagram", marks: 2 });
db.viva_demo.insertMany([
  { name: "Vector RUD", marks: 7, tags: ["pgvector"] },
  { name: "Advanced SQL", marks: 6, items: { triggers: 17, procedures: 6 } }, // documents can have different fields
]);
printjson(db.viva_demo.find({}, { _id: 0 }).toArray());
try {
  db.viva_demo.insertOne({ name: "Too many marks", marks: 99 });
} catch (e) {
  print("REJECTED by validator:", e.message);
}

title("2b. The real collection rejects an HVAC log with an Electrical reading");
try {
  db.incident_notes.insertOne({
    incident_id: 168, kind: "INSPECTION", visibility: "STAFF", text: "bad", created_at: new Date(),
    author: { user_id: 4, name: "Ravi Kumar", role: "TECHNICIAN" },
    category_key: "HVAC", readings: { voltage_v: 230 }, checklist: [], verdict: "MONITOR",
  });
} catch (e) {
  print("REJECTED:", e.message);
}

// ---------------------------------------------------------------- 3. READ
title("3. READ: query a nested field that only HVAC documents have");
db.incident_notes.find({ "readings.filter_condition": "Blocked" }, { _id: 0, incident_id: 1, text: 1 }).limit(3).forEach(printjson);

title("3b. Array query with $elemMatch: inspections where 'Drain line clear' failed");
print(db.incident_notes.countDocuments({ checklist: { $elemMatch: { item: "Drain line clear", ok: false } } }), "inspections");

title("3c. Comparison operators: suction pressure below 100 psi (gas leak)");
db.incident_notes.find({ "readings.suction_pressure_psi": { $lt: 100 } }, { _id: 0, incident_id: 1, "readings.suction_pressure_psi": 1 }).sort({ "readings.suction_pressure_psi": 1 }).limit(5).forEach(printjson);

title("3d. Full-text search with the text index, ranked by relevance");
db.incident_notes.find({ $text: { $search: "fan motor noise" } }, { _id: 0, text: 1, score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } }).limit(3).forEach(printjson);

title("3e. distinct: categories that have inspection logs");
printjson(db.incident_notes.distinct("category_key", { kind: "INSPECTION" }));

// ---------------------------------------------------------------- 4. UPDATE
title("4. UPDATE: $set, $push (edit history), $addToSet / $pull (votes), $inc");
const id = db.incident_notes.insertOne({
  incident_id: 168, kind: "COMMENT", visibility: "PUBLIC", text: "viva demo comment", created_at: new Date(),
  author: { user_id: 11, name: "Aditya Rao", role: "STUDENT_STAFF" },
}).insertedId;
db.incident_notes.updateOne({ _id: id }, { $set: { text: "viva demo comment (edited)", updated_at: new Date() }, $push: { edits: { text: "viva demo comment", edited_at: new Date() } } });
db.incident_notes.updateOne({ _id: id }, { $addToSet: { helpful: 4 } });
db.incident_notes.updateOne({ _id: id }, { $addToSet: { helpful: 4 } }); // no duplicate
printjson(db.incident_notes.findOne({ _id: id }, { _id: 0, text: 1, edits: 1, helpful: 1 }));
db.incident_notes.updateOne({ _id: id }, { $pull: { helpful: 4 } });
db.viva_demo.updateMany({}, { $inc: { marks: 1 } });
printjson(db.viva_demo.find({}, { _id: 0, name: 1, marks: 1 }).toArray());

// ---------------------------------------------------------------- 5. DELETE
title("5. DELETE: deleteOne / deleteMany");
printjson(db.incident_notes.deleteOne({ _id: id }));
printjson(db.viva_demo.deleteMany({ marks: { $lt: 5 } }));

// ---------------------------------------------------------------- 6. indexes
title("6. Indexes and explain(): the thread of one incident uses the compound index");
db.incident_notes.getIndexes().forEach((ix) => print(ix.name.padEnd(24), JSON.stringify(ix.key), ix.partialFilterExpression ? "partial" : "", ix.weights ? "text" : ""));
const ex = db.incident_notes.find({ incident_id: 136 }).sort({ created_at: -1 }).explain("executionStats");
print("plan:", ex.queryPlanner.winningPlan.inputStage?.stage || ex.queryPlanner.winningPlan.stage, ex.queryPlanner.winningPlan.inputStage?.indexName || "", " docsExamined:", ex.executionStats.totalDocsExamined, " returned:", ex.executionStats.nReturned);
print("TTL on search_events:", JSON.stringify(db.search_events.getIndexes().find((i) => i.expireAfterSeconds)));

// ---------------------------------------------------------------- 7. aggregation
title("7. Aggregation: most failed checks per category ($unwind, $group, $sort)");
db.incident_notes.aggregate([
  { $match: { kind: "INSPECTION" } },
  { $unwind: "$checklist" },
  { $match: { "checklist.ok": false } },
  { $group: { _id: { category: "$category_key", check: "$checklist.item" }, failed: { $sum: 1 } } },
  { $sort: { failed: -1 } },
  { $limit: 5 },
]).forEach(printjson);

title("7b. Aggregation with $lookup: average reading per HVAC field");
db.incident_notes.aggregate([
  { $match: { kind: "INSPECTION", category_key: "HVAC" } },
  { $project: { r: { $objectToArray: "$readings" } } },
  { $unwind: "$r" },
  { $match: { "r.v": { $type: "number" } } },
  { $group: { _id: "$r.k", avg: { $avg: "$r.v" }, n: { $sum: 1 } } },
  { $lookup: { from: "inspection_templates", pipeline: [{ $match: { _id: "HVAC" } }, { $project: { fields: 1 } }], as: "t" } },
  { $project: { _id: 0, field: "$_id", avg: { $round: ["$avg", 1] }, n: 1, normal: { $first: { $filter: { input: { $first: "$t.fields" }, as: "f", cond: { $eq: ["$$f.key", "$_id"] } } } } } },
  { $project: { field: 1, avg: 1, n: 1, normal_min: "$normal.normal_min", normal_max: "$normal.normal_max" } },
]).forEach(printjson);

title("7c. Search log: top search terms");
db.search_events.aggregate([{ $group: { _id: "$q", n: { $sum: 1 }, zero: { $sum: { $cond: [{ $eq: ["$results", 0] }, 1, 0] } } } }, { $sort: { n: -1 } }, { $limit: 5 }]).forEach(printjson);

// ---------------------------------------------------------------- 8. security
title("8. The app's own login cannot drop collections (least privilege)");
print("roles of resolvex_app:", JSON.stringify(db.getUser("resolvex_app")?.roles));
printjson(db.getRole("resolvexAppRole", { showPrivileges: true })?.privileges.map((p) => [p.resource.collection || "(all)", p.actions.join(",")]));
print("(log in as resolvex_app and try db.incident_notes.drop() -> MongoServerError: not authorized)");

// ---------------------------------------------------------------- 9. clean up
db.viva_demo.drop();
title("Done: viva_demo dropped, demo note deleted");
