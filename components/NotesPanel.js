"use client";
// Discussion and field inspection logs of one incident, stored in MongoDB (collection incident_notes).
// Inspection forms are built from the category's document in inspection_templates.
import { useState } from "react";
import { api, useApi, fmt } from "./ui";

const ROLE = { STUDENT_STAFF: "Student / Staff", TECHNICIAN: "Technician", FACILITY_MANAGER: "Manager", ADMIN: "Admin" };
const VERDICT = {
  FIXED_ON_SITE: ["Fixed on site", "good"],
  NEEDS_PARTS: ["Needs parts", "warn"],
  NEEDS_VENDOR: ["Needs vendor", "bad"],
  MONITOR: ["Monitor", "warn"],
  NO_FAULT_FOUND: ["No fault found", "good"],
};

function abnormal(f, value) {
  if (value === undefined || value === null) return false;
  if (f.type === "number") return (typeof f.normal_min === "number" && value < f.normal_min) || (typeof f.normal_max === "number" && value > f.normal_max);
  if (f.type === "enum") return Array.isArray(f.normal_values) && !f.normal_values.includes(value);
  if (f.type === "bool") return typeof f.normal_value === "boolean" && value !== f.normal_value;
  return false;
}
const normalHint = (f) =>
  f.type === "number" && typeof f.normal_min === "number" ? `normal ${f.normal_min}–${f.normal_max}${f.unit ? " " + f.unit : ""}` : f.type === "enum" && f.normal_values ? `normal: ${f.normal_values.join(", ")}` : "";
const showValue = (f, v) => (f?.type === "bool" ? (v ? "Yes" : "No") : `${v}${f?.unit ? " " + f.unit : ""}`);

function Readings({ note, template }) {
  const fields = template?._id === note.category_key ? template.fields : [];
  return (
    <div className="readings">
      {Object.entries(note.readings || {}).map(([k, val]) => {
        const f = fields.find((x) => x.key === k);
        const bad = f && abnormal(f, val);
        return (
          <div key={k} className={"reading" + (bad ? " abn" : "")} title={f ? normalHint(f) : ""}>
            <span>{f?.label || k}</span>
            <strong className="num">{showValue(f, val)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function InspectionForm({ template, busy, onSubmit }) {
  const [readings, setReadings] = useState({});
  const [checks, setChecks] = useState(Object.fromEntries(template.checks.map((c) => [c, true])));
  const [verdict, setVerdict] = useState("FIXED_ON_SITE");
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("STAFF");
  const set = (k, val) => setReadings((r) => ({ ...r, [k]: val }));

  function submit(e) {
    e.preventDefault();
    const clean = Object.fromEntries(
      Object.entries(readings)
        .filter(([, v]) => v !== "" && v !== undefined)
        .map(([k, v]) => {
          const f = template.fields.find((x) => x.key === k);
          return [k, f.type === "number" ? Number(v) : f.type === "bool" ? v === "yes" : v];
        })
    );
    onSubmit({
      kind: "INSPECTION",
      text,
      tags,
      visibility,
      verdict,
      readings: clean,
      checklist: Object.entries(checks).map(([item, ok]) => ({ item, ok })),
    }).then((done) => done && (setReadings({}), setText(""), setTags("")));
  }

  return (
    <form onSubmit={submit}>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Fields come from the <span className="tag-code">{template._id}</span> document in <span className="tag-code">inspection_templates</span>: every equipment category records different readings.
      </p>
      <div className="form-grid">
        {template.fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={"r-" + f.key}>
              {f.label}
              {f.unit ? ` (${f.unit})` : ""}
            </label>
            {f.type === "number" && (
              <input id={"r-" + f.key} type="number" step="any" min={f.min} max={f.max} value={readings[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            )}
            {f.type === "enum" && (
              <select id={"r-" + f.key} value={readings[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">not checked</option>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            )}
            {f.type === "bool" && (
              <select id={"r-" + f.key} value={readings[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">not checked</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            )}
            {f.type === "text" && <input id={"r-" + f.key} type="text" maxLength={f.max_length || 40} value={readings[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />}
            {normalHint(f) && <span className="hint">{normalHint(f)}</span>}
          </div>
        ))}
      </div>
      <div className="field">
        <label>Checks (tick the ones that passed)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
          {template.checks.map((c) => (
            <label key={c} style={{ fontWeight: 400, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={checks[c]} onChange={(e) => setChecks({ ...checks, [c]: e.target.checked })} /> {c}
            </label>
          ))}
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="iv">Verdict</label>
          <select id="iv" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
            {Object.entries(VERDICT).map(([k, [l]]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ivis">Visible to</label>
          <select id="ivis" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="STAFF">Staff only</option>
            <option value="PUBLIC">Everyone, including the reporter</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="it">Findings</label>
        <textarea id="it" required minLength={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What you found and what you did" />
      </div>
      <div className="field">
        <label htmlFor="itg">Tags</label>
        <input id="itg" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. compressor, gas-leak" />
      </div>
      <button className="btn signal" disabled={busy}>
        {busy ? "Saving…" : "Save inspection log"}
      </button>
    </form>
  );
}

export default function NotesPanel({ incidentId, onNotify }) {
  const { data, error, reload } = useApi(`/api/incidents/${incidentId}/notes`);
  const [mode, setMode] = useState("comment");
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, text }

  async function call(url, options) {
    setBusy(true);
    try {
      const d = await api(url, options);
      onNotify(d.message || "Done");
      await reload();
      return true;
    } catch (e) {
      onNotify(e.message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const post = (payload) => call(`/api/incidents/${incidentId}/notes`, { method: "POST", body: payload });

  async function postComment(e) {
    e.preventDefault();
    if (await post({ kind: "COMMENT", text, tags, visibility })) {
      setText("");
      setTags("");
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (await call(`/api/notes/${editing.id}`, { method: "PATCH", body: { action: "edit", text: editing.text } })) setEditing(null);
  }

  const head = (
    <div className="panel-head">
      <h3>Discussion and field logs</h3>
      <span className="chip" title="Stored as documents in the MongoDB collection incident_notes">
        MongoDB · incident_notes
      </span>
    </div>
  );

  if (error)
    return (
      <section className="panel">
        {head}
        <div className="panel-body">
          <div className="notice info" style={{ margin: 0 }}>
            {error.message || String(error)} The rest of the incident (PostgreSQL) still works.
          </div>
        </div>
      </section>
    );
  if (!data)
    return (
      <section className="panel">
        {head}
        <div className="empty">Loading notes…</div>
      </section>
    );

  const { notes, template, canInspect, canPostStaff } = data;
  return (
    <section className="panel">
      {head}
      {!notes.length && <div className="empty">No comments or inspection logs yet.</div>}
      {notes.map((n) => (
        <div key={n._id} className={"note" + (n.kind === "INSPECTION" ? " inspection" : "")}>
          <div className="note-head">
            <strong>{n.author.name}</strong>
            <span className="small muted">{ROLE[n.author.role]}</span>
            {n.kind === "INSPECTION" && <span className="chip">Inspection log</span>}
            {n.verdict && <span className={"chip " + VERDICT[n.verdict][1]}>{VERDICT[n.verdict][0]}</span>}
            {n.visibility === "STAFF" && (
              <span className="chip warn" title="Hidden from students">
                staff only
              </span>
            )}
            <span className="small faint" style={{ marginLeft: "auto" }} title={fmt.dt(n.created_at)}>
              {fmt.ago(n.created_at)}
              {n.edit_count > 0 && (
                <span title={`Edited ${n.edit_count}x. Previous version: "${n.previous_text}"`}>, edited</span>
              )}
            </span>
          </div>
          {editing?.id === n._id ? (
            <form onSubmit={saveEdit} style={{ marginTop: 8 }}>
              <textarea required minLength={2} maxLength={2000} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
              <div className="actions" style={{ marginTop: 8 }}>
                <button className="btn small signal" disabled={busy}>
                  Save
                </button>
                <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{n.text}</p>
          )}
          {n.kind === "INSPECTION" && (
            <>
              <Readings note={n} template={template} />
              {n.checklist?.length > 0 && (
                <div className="small" style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6 }}>
                  {n.checklist.map((c) => (
                    <span key={c.item} style={{ color: c.ok ? "var(--ink-2)" : "#8f1f17" }}>
                      {c.ok ? "✓" : "✗"} {c.item}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="note-foot">
            {n.tags?.map((t) => (
              <span key={t} className="small muted">
                #{t}
              </span>
            ))}
            <span style={{ marginLeft: "auto" }} />
            {!n.mine ? (
              <button className={"btn small " + (n.i_found_helpful ? "" : "ghost")} disabled={busy} onClick={() => call(`/api/notes/${n._id}`, { method: "PATCH", body: { action: "helpful" } })}>
                Helpful{n.helpful_count ? ` (${n.helpful_count})` : ""}
              </button>
            ) : (
              n.helpful_count > 0 && <span className="small muted">{n.helpful_count} found this helpful</span>
            )}
            {n.mine && n.kind === "COMMENT" && editing?.id !== n._id && (
              <button className="btn small ghost" disabled={busy} onClick={() => setEditing({ id: n._id, text: n.text })}>
                Edit
              </button>
            )}
            {n.can_delete && (
              <button className="btn small ghost" disabled={busy} onClick={() => call(`/api/notes/${n._id}`, { method: "DELETE" })}>
                Delete
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="panel-body" style={{ borderTop: "1px solid var(--line-2)" }}>
        {canInspect && template && (
          <div className="seg" role="group" aria-label="Note type" style={{ marginBottom: 12 }}>
            <button className={mode === "comment" ? "on" : ""} onClick={() => setMode("comment")}>
              Comment
            </button>
            <button className={mode === "inspection" ? "on" : ""} onClick={() => setMode("inspection")}>
              Inspection log
            </button>
          </div>
        )}
        {mode === "inspection" && canInspect && template ? (
          <InspectionForm template={template} busy={busy} onSubmit={post} />
        ) : (
          <form onSubmit={postComment}>
            <div className="field">
              <label htmlFor="nc">Add a comment</label>
              <textarea id="nc" required minLength={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="An update, a question, or more details" />
            </div>
            <div className="actions">
              <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (optional), e.g. urgent, exam" style={{ maxWidth: 260 }} aria-label="Tags" />
              {canPostStaff && (
                <select value={visibility} onChange={(e) => setVisibility(e.target.value)} style={{ width: "auto" }} aria-label="Visible to">
                  <option value="PUBLIC">Visible to everyone</option>
                  <option value="STAFF">Staff only (internal)</option>
                </select>
              )}
              <button className="btn" disabled={busy}>
                {busy ? "Posting…" : "Post comment"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
