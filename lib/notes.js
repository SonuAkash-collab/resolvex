// =====================================================================
// Incident notes (MongoDB collection incident_notes)
//   COMMENT     discussion between reporters, technicians and managers
//   INSPECTION  a technician's field log: readings whose fields depend on
//               the equipment category (from inspection_templates),
//               a checklist and a verdict
//
// Cross-database rules (MongoDB has no foreign keys and no RLS):
//   * the incident is looked up in PostgreSQL first, under RLS, so a note
//     can only be attached to an incident that exists and the user may see
//   * students only see PUBLIC notes; STAFF notes are for staff
//   * only the author edits a note; the author or a manager deletes it
// =====================================================================
import { HttpError } from "./auth";
import { queryOne } from "./db";
import { collection } from "./mongo";

export const STAFF_ROLES = ["TECHNICIAN", "FACILITY_MANAGER", "ADMIN"];
export const MANAGER_ROLES = ["FACILITY_MANAGER", "ADMIN"];
export const VERDICTS = ["FIXED_ON_SITE", "NEEDS_PARTS", "NEEDS_VENDOR", "MONITOR", "NO_FAULT_FOUND"];

/** The incident as PostgreSQL (RLS) shows it to this user, plus what they may do. */
export async function incidentAccess(session, incidentId) {
  const inc = await queryOne(
    `SELECT i.incident_id, i.status, i.category_id, i.reported_by,
            EXISTS (SELECT 1 FROM work_orders w WHERE w.incident_id = i.incident_id AND w.technician_id = $2) AS my_job
       FROM incidents i WHERE i.incident_id = $1`,
    [incidentId, session.id]
  );
  if (!inc) throw new HttpError(404, "Incident not found");
  const staff = STAFF_ROLES.includes(session.role);
  return {
    incident: inc,
    staff,
    canInspect: MANAGER_ROLES.includes(session.role) || (session.role === "TECHNICIAN" && inc.my_job),
  };
}

/** Filter that limits what this user may read. */
export const visibleFilter = (session) => (STAFF_ROLES.includes(session.role) ? {} : { visibility: "PUBLIC" });

export function cleanTags(input) {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const tags = raw
    .filter((t) => typeof t === "string")
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
    .filter((t) => t.length >= 2 && t.length <= 24);
  return [...new Set(tags)].slice(0, 8);
}

/** Validates inspection readings against the category's template (MongoDB validates again). */
export function cleanReadings(template, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Readings are required");
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const f = template.fields.find((x) => x.key === key);
    if (!f) throw new HttpError(400, `"${key}" is not a reading of ${template.category_name}`);
    if (value === "" || value === null || value === undefined) continue;
    if (f.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < f.min || n > f.max) throw new HttpError(400, `${f.label} must be between ${f.min} and ${f.max} ${f.unit || ""}`.trim());
      out[key] = n;
    } else if (f.type === "enum") {
      if (!f.options.includes(value)) throw new HttpError(400, `${f.label} must be one of: ${f.options.join(", ")}`);
      out[key] = value;
    } else if (f.type === "bool") {
      if (typeof value !== "boolean") throw new HttpError(400, `${f.label} must be yes or no`);
      out[key] = value;
    } else {
      if (typeof value !== "string" || value.length > (f.max_length || 40)) throw new HttpError(400, `${f.label} is too long`);
      out[key] = value.trim();
    }
  }
  if (!Object.keys(out).length) throw new HttpError(400, "Enter at least one reading");
  return out;
}

export function cleanChecklist(template, input) {
  const given = new Map((Array.isArray(input) ? input : []).filter((c) => c && typeof c.item === "string").map((c) => [c.item, c.ok === true]));
  for (const item of given.keys()) if (!template.checks.includes(item)) throw new HttpError(400, `Unknown check "${item}"`);
  return template.checks.map((item) => ({ item, ok: given.has(item) ? given.get(item) : true }));
}

export async function templateFor(categoryId) {
  return (await collection("inspection_templates")).findOne({ category_id: categoryId });
}

/** Shapes a stored note for the browser (no list of voter ids). */
export function present(n, session) {
  const { helpful = [], edits = [], ...rest } = n;
  return {
    ...rest,
    _id: String(n._id),
    helpful_count: helpful.length,
    i_found_helpful: helpful.includes(session.id),
    edit_count: edits.length,
    previous_text: edits.length ? edits[edits.length - 1].text : null,
    mine: n.author.user_id === session.id,
    can_delete: n.author.user_id === session.id || MANAGER_ROLES.includes(session.role),
  };
}

/** Fire-and-forget: append one event to the search log (never breaks the search itself). */
export function logSearch(event) {
  collection("search_events")
    .then((c) => c.insertOne({ at: new Date(), ...event }))
    .catch(() => {});
}
