// =====================================================================
// Reports computed by MongoDB aggregation pipelines (the document-store
// equivalent of GROUP BY reports). Each pipeline gets `since` (a Date, or
// null for all time) and returns flat rows for the table / CSV.
// =====================================================================
const period = (field, since) => (since ? [{ $match: { [field]: { $gte: since } } }] : []);

export const MONGO_REPORTS = [
  {
    id: "mongo-failed-checks",
    columns: ["category", "check", "failed", "inspections", "failure_pct"],
    title: "Most failed inspection checks by equipment category",
    concepts: "$match, $unwind (array), $group, $cond, $sort, $limit",
    collection: "incident_notes",
    pipeline: (since) => [
      { $match: { kind: "INSPECTION" } },
      ...period("created_at", since),
      { $unwind: "$checklist" },
      {
        $group: {
          _id: { category: "$category_key", check: "$checklist.item" },
          inspections: { $sum: 1 },
          failed: { $sum: { $cond: ["$checklist.ok", 0, 1] } },
        },
      },
      { $match: { failed: { $gt: 0 } } },
      {
        $project: {
          _id: 0,
          category: "$_id.category",
          check: "$_id.check",
          failed: 1,
          inspections: 1,
          failure_pct: { $round: [{ $multiply: [{ $divide: ["$failed", "$inspections"] }, 100] }, 1] },
        },
      },
      { $sort: { failed: -1, failure_pct: -1 } },
      { $limit: 15 },
    ],
  },
  {
    id: "mongo-abnormal-readings",
    columns: ["category", "reading", "normal_range", "abnormal_count", "avg_value", "worst_low", "worst_high"],
    title: "Abnormal readings found during inspections",
    concepts: "$lookup (join to templates), $objectToArray, $unwind, $filter, $expr, $group, $avg",
    collection: "incident_notes",
    pipeline: (since) => [
      { $match: { kind: "INSPECTION" } },
      ...period("created_at", since),
      { $lookup: { from: "inspection_templates", localField: "category_key", foreignField: "_id", as: "tpl" } },
      { $unwind: "$tpl" },
      // readings { supply_air_temp_c: 24 } -> [{ k: "supply_air_temp_c", v: 24 }]
      { $project: { category: "$tpl.category_name", fields: "$tpl.fields", reading: { $objectToArray: "$readings" } } },
      { $unwind: "$reading" },
      {
        $addFields: {
          field: { $first: { $filter: { input: "$fields", as: "f", cond: { $eq: ["$$f.key", "$reading.k"] } } } },
        },
      },
      {
        $match: {
          "field.type": "number",
          "field.normal_min": { $type: "number" }, // only fields that define a healthy range
          $expr: { $or: [{ $lt: ["$reading.v", "$field.normal_min"] }, { $gt: ["$reading.v", "$field.normal_max"] }] },
        },
      },
      {
        $group: {
          _id: { category: "$category", reading: "$field.label", unit: "$field.unit", lo: "$field.normal_min", hi: "$field.normal_max" },
          abnormal_count: { $sum: 1 },
          avg_value: { $avg: "$reading.v" },
          worst_low: { $min: "$reading.v" },
          worst_high: { $max: "$reading.v" },
        },
      },
      {
        $project: {
          _id: 0,
          category: "$_id.category",
          reading: "$_id.reading",
          normal_range: { $concat: [{ $toString: "$_id.lo" }, " to ", { $toString: "$_id.hi" }, " ", "$_id.unit"] },
          abnormal_count: 1,
          avg_value: { $round: ["$avg_value", 1] },
          worst_low: 1,
          worst_high: 1,
        },
      },
      { $sort: { abnormal_count: -1 } },
    ],
  },
  {
    id: "mongo-verdicts",
    columns: ["category", "inspections", "fixed_on_site", "needs_parts", "needs_vendor", "monitor", "no_fault_found", "first_visit_fix_pct"],
    title: "Inspection verdicts per category",
    concepts: "$group with conditional $sum (pivot), $round",
    collection: "incident_notes",
    pipeline: (since) => [
      { $match: { kind: "INSPECTION" } },
      ...period("created_at", since),
      {
        $group: {
          _id: "$category_key",
          inspections: { $sum: 1 },
          fixed_on_site: { $sum: { $cond: [{ $eq: ["$verdict", "FIXED_ON_SITE"] }, 1, 0] } },
          needs_parts: { $sum: { $cond: [{ $eq: ["$verdict", "NEEDS_PARTS"] }, 1, 0] } },
          needs_vendor: { $sum: { $cond: [{ $eq: ["$verdict", "NEEDS_VENDOR"] }, 1, 0] } },
          monitor: { $sum: { $cond: [{ $eq: ["$verdict", "MONITOR"] }, 1, 0] } },
          no_fault_found: { $sum: { $cond: [{ $eq: ["$verdict", "NO_FAULT_FOUND"] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          category: "$_id",
          inspections: 1,
          fixed_on_site: 1,
          needs_parts: 1,
          needs_vendor: 1,
          monitor: 1,
          no_fault_found: 1,
          first_visit_fix_pct: { $round: [{ $multiply: [{ $divide: ["$fixed_on_site", "$inspections"] }, 100] }, 1] },
        },
      },
      { $sort: { inspections: -1 } },
    ],
  },
  {
    id: "mongo-discussed",
    columns: ["incident_id", "title", "status", "notes", "comments", "inspection_logs", "participants", "last_activity"],
    title: "Most discussed incidents (joined with PostgreSQL)",
    concepts: "$group, $addToSet, $size, $max; titles fetched from PostgreSQL by incident_id (application-side join)",
    collection: "incident_notes",
    joinIncidents: true,
    pipeline: (since) => [
      ...period("created_at", since),
      {
        $group: {
          _id: "$incident_id",
          notes: { $sum: 1 },
          comments: { $sum: { $cond: [{ $eq: ["$kind", "COMMENT"] }, 1, 0] } },
          inspection_logs: { $sum: { $cond: [{ $eq: ["$kind", "INSPECTION"] }, 1, 0] } },
          people: { $addToSet: "$author.user_id" },
          last_activity: { $max: "$created_at" },
        },
      },
      { $project: { _id: 0, incident_id: "$_id", notes: 1, comments: 1, inspection_logs: 1, participants: { $size: "$people" }, last_activity: 1 } },
      { $sort: { notes: -1, last_activity: -1 } },
      { $limit: 15 },
    ],
  },
  {
    id: "mongo-technician-activity",
    columns: ["technician", "inspection_logs", "comments", "incidents_worked_on", "helpful_votes"],
    title: "Technician field activity",
    concepts: "$match on an embedded field, $group, $size (array length), $sum",
    collection: "incident_notes",
    pipeline: (since) => [
      { $match: { "author.role": "TECHNICIAN" } },
      ...period("created_at", since),
      {
        $group: {
          _id: "$author.name",
          inspection_logs: { $sum: { $cond: [{ $eq: ["$kind", "INSPECTION"] }, 1, 0] } },
          comments: { $sum: { $cond: [{ $eq: ["$kind", "COMMENT"] }, 1, 0] } },
          helpful_votes: { $sum: { $size: { $ifNull: ["$helpful", []] } } },
          incidents: { $addToSet: "$incident_id" },
        },
      },
      { $project: { _id: 0, technician: "$_id", inspection_logs: 1, comments: 1, incidents_worked_on: { $size: "$incidents" }, helpful_votes: 1 } },
      { $sort: { inspection_logs: -1 } },
    ],
  },
  {
    id: "mongo-search-terms",
    columns: ["search_text", "searches", "no_results", "avg_results", "avg_top_score", "avg_ms"],
    title: "What people search for (and searches that find nothing)",
    concepts: "search_events log: $group, $avg, conditional $sum; TTL index expires old events",
    collection: "search_events",
    pipeline: (since) => [
      ...period("at", since),
      {
        $group: {
          _id: "$q",
          searches: { $sum: 1 },
          no_results: { $sum: { $cond: [{ $eq: ["$results", 0] }, 1, 0] } },
          avg_results: { $avg: "$results" },
          avg_top_score: { $avg: "$top_score" },
          avg_ms: { $avg: "$ms" },
        },
      },
      {
        $project: {
          _id: 0,
          search_text: "$_id",
          searches: 1,
          no_results: 1,
          avg_results: { $round: ["$avg_results", 1] },
          avg_top_score: { $round: ["$avg_top_score", 2] },
          avg_ms: { $round: ["$avg_ms", 0] },
        },
      },
      { $sort: { searches: -1 } },
      { $limit: 20 },
    ],
  },
  {
    id: "mongo-search-modes",
    columns: ["mode", "role", "searches", "avg_results", "avg_ms"],
    title: "Search usage by mode and role",
    concepts: "$group on two keys, $avg, $sort",
    collection: "search_events",
    pipeline: (since) => [
      ...period("at", since),
      { $group: { _id: { mode: "$mode", role: "$role" }, searches: { $sum: 1 }, avg_results: { $avg: "$results" }, avg_ms: { $avg: "$ms" } } },
      { $project: { _id: 0, mode: "$_id.mode", role: "$_id.role", searches: 1, avg_results: { $round: ["$avg_results", 1] }, avg_ms: { $round: ["$avg_ms", 0] } } },
      { $sort: { mode: 1, searches: -1 } },
    ],
  },
];

/** mongosh-style text of a pipeline, shown under "Show the pipeline". */
export function pipelineText(collection, pipeline) {
  const json = JSON.stringify(pipeline, (k, v) => v, 2).replace(/"__DATE__(.+?)"/g, 'ISODate("$1")');
  return `db.${collection}.aggregate(${json})`;
}

/** Same pipeline with Date objects replaced by a marker so pipelineText can print ISODate(...). */
export function printable(pipeline) {
  return JSON.parse(JSON.stringify(pipeline, function (k, v) {
    const raw = this[k];
    return raw instanceof Date ? "__DATE__" + raw.toISOString() : v;
  }));
}
