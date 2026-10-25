// GET  /api/incidents/:id/notes   the incident's discussion and inspection logs (MongoDB)
// POST /api/incidents/:id/notes   add a COMMENT, or an INSPECTION log (assigned technician / manager)
// The incident is checked in PostgreSQL (RLS) first: MongoDB has no foreign keys.
import { ok, route, body, v } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { collection } from "@/lib/mongo";
import { incidentAccess, visibleFilter, templateFor, cleanTags, cleanReadings, cleanChecklist, present, VERDICTS } from "@/lib/notes";

export const GET = route(async (req, { params }) => {
  const s = await requireRole();
  const id = v.int((await params).id, "Incident id");
  const access = await incidentAccess(s, id);
  const notes = await (await collection("incident_notes"))
    .find({ incident_id: id, ...visibleFilter(s) }) // uses index ix_incident_thread
    .sort({ created_at: 1 })
    .limit(300)
    .toArray();
  return ok({
    notes: notes.map((n) => present(n, s)),
    template: await templateFor(access.incident.category_id),
    canInspect: access.canInspect,
    canPostStaff: access.staff,
  });
});

export const POST = route(async (req, { params }) => {
  const s = await requireRole();
  const id = v.int((await params).id, "Incident id");
  const access = await incidentAccess(s, id);
  const b = await body(req);
  const kind = v.oneOf(b.kind || "COMMENT", "kind", ["COMMENT", "INSPECTION"]);
  if (kind === "INSPECTION" && !access.canInspect) throw new HttpError(403, "Only the technician assigned to this incident, or a manager, can log an inspection");
  const text = v.str(b.text, kind === "INSPECTION" ? "Findings" : "Comment", { min: 2, max: 2000 });
  const visibility = v.oneOf(b.visibility || (kind === "INSPECTION" ? "STAFF" : "PUBLIC"), "visibility", ["PUBLIC", "STAFF"]);
  if (visibility === "STAFF" && !access.staff) throw new HttpError(403, "Only staff can post internal notes");

  const now = new Date();
  const doc = {
    incident_id: id,
    kind,
    visibility,
    author: { user_id: s.id, name: s.name, role: s.role }, // snapshot: keeps the name as it was when written
    text,
    created_at: now,
    updated_at: now,
  };
  const tags = cleanTags(b.tags);
  if (tags.length) doc.tags = tags;

  if (kind === "INSPECTION") {
    const template = await templateFor(access.incident.category_id);
    if (!template) throw new HttpError(400, "No inspection template for this category");
    doc.category_key = template._id;
    doc.readings = cleanReadings(template, b.readings);
    doc.checklist = cleanChecklist(template, b.checklist);
    doc.verdict = v.oneOf(b.verdict, "Verdict", VERDICTS);
  }

  const res = await (await collection("incident_notes")).insertOne(doc);
  return ok({ message: kind === "INSPECTION" ? "Inspection log saved" : "Comment posted", note: present({ ...doc, _id: res.insertedId }, s) }, 201);
});
