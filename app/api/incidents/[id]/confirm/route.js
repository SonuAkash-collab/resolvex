// POST   /api/incidents/:id/confirm   "I have this problem too"
// DELETE /api/incidents/:id/confirm   withdraw the confirmation (trigger decrements affected_users)
// Inserting into incident_reporters fires trg_incident_reporter_count, which increments
// affected_users, which fires trg_incident_priority -> the priority score is recalculated.
import { ok, route, v } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { queryOne, withTransaction } from "@/lib/db";

export const POST = route(async (req, { params }) => {
  const s = await requireRole();
  const id = v.int((await params).id, "Incident id");
  const before = await queryOne("SELECT priority_score, priority_level, affected_users FROM incidents WHERE incident_id = $1", [id]);
  await withTransaction(s.id, (c) =>
    c.query("INSERT INTO incident_reporters (incident_id, user_id) VALUES ($1, $2)", [id, s.id])
  );
  const after = await queryOne("SELECT priority_score, priority_level, affected_users FROM incidents WHERE incident_id = $1", [id]);
  return ok({ message: "Added your confirmation to this incident", before, after });
});

export const DELETE = route(async (req, { params }) => {
  const s = await requireRole();
  const id = v.int((await params).id, "Incident id");
  const removed = await withTransaction(s.id, (c) =>
    c.query("DELETE FROM incident_reporters WHERE incident_id = $1 AND user_id = $2", [id, s.id])
  );
  return ok({ message: removed.rowCount ? "Your confirmation was removed" : "You had not confirmed this incident" });
});
