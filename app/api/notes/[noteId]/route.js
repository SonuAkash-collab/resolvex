// PATCH  /api/notes/:noteId  { action: "edit", text }  author only; old text kept in edits[] ($push)
//                            { action: "helpful" }     toggle a vote ($addToSet / $pull)
// DELETE /api/notes/:noteId  the author, or a facility manager / admin
import { ok, route, body, v } from "@/lib/api";
import { requireRole, HttpError } from "@/lib/auth";
import { collection, objectId } from "@/lib/mongo";
import { incidentAccess, visibleFilter, present, MANAGER_ROLES } from "@/lib/notes";

async function loadNote(s, noteId) {
  const notes = await collection("incident_notes");
  const note = await notes.findOne({ _id: objectId(noteId), ...visibleFilter(s) });
  if (!note) throw new HttpError(404, "Note not found");
  await incidentAccess(s, note.incident_id); // the incident must still exist and be visible (PostgreSQL + RLS)
  return { notes, note };
}

export const PATCH = route(async (req, { params }) => {
  const s = await requireRole();
  const { notes, note } = await loadNote(s, (await params).noteId);
  const b = await body(req);
  const action = v.oneOf(b.action, "action", ["edit", "helpful"]);
  const now = new Date();

  if (action === "edit") {
    if (note.author.user_id !== s.id) throw new HttpError(403, "You can only edit your own notes");
    const text = v.str(b.text, "Text", { min: 2, max: 2000 });
    if (text === note.text) throw new HttpError(400, "Nothing changed");
    // one atomic single-document update: new text + previous version appended to the history
    const updated = await notes.findOneAndUpdate(
      { _id: note._id, "author.user_id": s.id },
      { $set: { text, updated_at: now }, $push: { edits: { $each: [{ text: note.text, edited_at: now }], $slice: -50 } } },
      { returnDocument: "after" }
    );
    return ok({ message: "Note updated (previous version kept in its edit history)", note: present(updated, s) });
  }

  if (note.author.user_id === s.id) throw new HttpError(400, "You cannot vote on your own note");
  const voted = (note.helpful || []).includes(s.id);
  const updated = await notes.findOneAndUpdate({ _id: note._id }, voted ? { $pull: { helpful: s.id } } : { $addToSet: { helpful: s.id } }, { returnDocument: "after" });
  return ok({ message: voted ? "Vote removed" : "Marked as helpful", note: present(updated, s) });
});

export const DELETE = route(async (req, { params }) => {
  const s = await requireRole();
  const { notes, note } = await loadNote(s, (await params).noteId);
  if (note.author.user_id !== s.id && !MANAGER_ROLES.includes(s.role)) throw new HttpError(403, "Only the author or a manager can delete this note");
  const { deletedCount } = await notes.deleteOne({ _id: note._id });
  return ok({ message: deletedCount ? "Note deleted" : "Note was already deleted" });
});
