"use client";
import { use, useState } from "react";
import Link from "next/link";
import { api, useApi, useToast, PageHead, PriorityTag, Status, Loading, ErrorNote, fmt, SEVERITY } from "@/components/ui";

const ACTIVE = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];

export default function IncidentPage({ params }) {
  const { id } = use(params);
  const { data, error, reload } = useApi(`/api/incidents/${id}`);
  const { data: me } = useApi("/api/auth/me");
  const { data: meta } = useApi("/api/meta");
  const [toast, notify] = useToast();
  const [rating, setRating] = useState(5);
  const [tech, setTech] = useState("");
  const [dupOf, setDupOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { title, description } while the edit form is open

  if (error) return <ErrorNote error={error} />;
  if (!data || !me) return <Loading />;

  const { incident: i, history, workOrders, parts, coReporters, similar, breakdown, isCoReporter, vector } = data;
  const user = me.user;
  const isManager = ["FACILITY_MANAGER", "ADMIN"].includes(user.role);
  const isReporter = i.reporter_id === user.id;
  const active = ACTIVE.includes(i.status);
  const skilled = (meta?.technicians || []).filter((t) => t.skill_ids.includes(i.category_id));
  const canEdit = (isReporter && i.status === "OPEN") || (isManager && active);

  async function saveEdit(e) {
    e.preventDefault();
    await act(`/api/incidents/${i.incident_id}`, { action: "edit", ...editing }, "PATCH");
    setEditing(null);
  }

  async function act(url, body, method = "POST") {
    setBusy(true);
    try {
      const d = await api(url, { method, body });
      notify(d.message || "Done");
      await reload();
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }

  const totalCost = workOrders.reduce((s, w) => s + Number(w.total_cost || 0), 0);

  return (
    <>
      {toast}
      <div className="small muted" style={{ marginBottom: 8 }}>
        <Link href={isManager ? "/incidents" : user.role === "TECHNICIAN" ? "/work-orders" : "/my"}>Back</Link> / Incident #{i.incident_id}
      </div>
      <PageHead title={i.title}>
        <PriorityTag level={i.priority_level} score={i.priority_score} />
        <Status value={i.status} />
      </PageHead>

      <div className="grid split">
        <div className="stack">
          <section className="panel panel-body">
            {editing ? (
              <form onSubmit={saveEdit}>
                <div className="field">
                  <label htmlFor="et">Title</label>
                  <input id="et" type="text" required minLength={5} maxLength={150} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ed">Description</label>
                  <textarea id="ed" required minLength={10} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                  <span className="hint">Saving updates the text and recomputes its vector embedding in the same transaction.</span>
                </div>
                <div className="actions">
                  <button className="btn signal" disabled={busy}>
                    {busy ? "Saving…" : "Save and re-embed"}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p style={{ fontSize: 16, maxWidth: "70ch", whiteSpace: "pre-wrap" }}>{i.description}</p>
                {canEdit && (
                  <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => setEditing({ title: i.title, description: i.description })}>
                    Edit title and description
                  </button>
                )}
              </>
            )}
            <dl className="facts" style={{ marginTop: 18 }}>
              <dt>Location</dt>
              <dd>
                {i.building_name}, room {i.room_number} (floor {i.floor_no})
              </dd>
              <dt>Equipment</dt>
              <dd>{i.asset_tag ? `${i.asset_name} (${i.asset_tag})` : "Not linked to a registered asset"}</dd>
              <dt>Category</dt>
              <dd>{i.category_name}</dd>
              <dt>Reported</dt>
              <dd>
                {fmt.dt(i.reported_at)} by {i.reporter_name}
                {coReporters.length > 0 && `, confirmed by ${coReporters.length} more`}
              </dd>
              <dt>Severity / affected</dt>
              <dd>
                {i.severity} of 5 ({SEVERITY[i.severity - 1].label}), about {i.affected_users} people
              </dd>
              <dt>Fix due</dt>
              <dd>
                {fmt.dt(i.sla_due_at)} {active && <>({fmt.sla(i.sla_hours_left, i.is_overdue)})</>}
                {i.escalation_level > 0 && <span className="chip bad" style={{ marginLeft: 8 }}>escalated x{i.escalation_level}</span>}
              </dd>
              {i.resolved_at && (
                <>
                  <dt>Resolved</dt>
                  <dd>{fmt.dt(i.resolved_at)}</dd>
                </>
              )}
              {i.duplicate_of && (
                <>
                  <dt>Duplicate of</dt>
                  <dd>
                    <Link href={`/incidents/${i.duplicate_of}`}>Incident #{i.duplicate_of}</Link>
                  </dd>
                </>
              )}
              <dt>Vector</dt>
              <dd>
                {vector?.vector_status === "MISSING" ? (
                  <span className="chip bad">no embedding: not searchable by meaning</span>
                ) : (
                  <>
                    <span className={"chip " + (vector?.vector_status === "STALE" ? "warn" : "good")}>{vector?.vector_status === "STALE" ? "stale" : "fresh"}</span>{" "}
                    <span className="small muted">
                      {vector?.dims}-d {vector?.model_name}, embedded {fmt.ago(vector?.embedded_at)}
                    </span>
                  </>
                )}
              </dd>
              {i.feedback_rating && (
                <>
                  <dt>Reporter rating</dt>
                  <dd>{"★".repeat(i.feedback_rating) + "☆".repeat(5 - i.feedback_rating)}</dd>
                </>
              )}
            </dl>
          </section>

          {/* ---------------- actions */}
          <section className="panel">
            <div className="panel-head">
              <h3>Actions</h3>
            </div>
            <div className="panel-body stack" style={{ gap: 14 }}>
              {active && !isReporter && !isCoReporter && (
                <div>
                  <button className="btn" disabled={busy} onClick={() => act(`/api/incidents/${i.incident_id}/confirm`)}>
                    I have this problem too
                  </button>
                  <span className="small muted" style={{ marginLeft: 10 }}>Adds you as an affected person and raises the priority.</span>
                </div>
              )}
              {isCoReporter && (
                <div className="actions">
                  <span className="chip good">You confirmed this problem</span>
                  {active && (
                    <button className="btn small ghost" disabled={busy} onClick={() => act(`/api/incidents/${i.incident_id}/confirm`, undefined, "DELETE")}>
                      I no longer have this problem
                    </button>
                  )}
                </div>
              )}

              {(isReporter || isManager) && i.status === "RESOLVED" && (
                <div className="actions">
                  <select value={rating} onChange={(e) => setRating(e.target.value)} style={{ width: "auto" }} aria-label="Rating">
                    {[5, 4, 3, 2, 1].map((r) => (
                      <option key={r} value={r}>
                        {"★".repeat(r)} ({r})
                      </option>
                    ))}
                  </select>
                  <button className="btn signal" disabled={busy} onClick={() => act(`/api/incidents/${i.incident_id}`, { action: "close", rating: Number(rating) }, "PATCH")}>
                    Confirm fix and close
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={() => act(`/api/incidents/${i.incident_id}`, { action: "reopen" }, "PATCH")}>
                    Problem is back, reopen
                  </button>
                </div>
              )}
              {isReporter && i.status === "CLOSED" && !i.feedback_rating && (
                <div className="actions">
                  <select value={rating} onChange={(e) => setRating(e.target.value)} style={{ width: "auto" }} aria-label="Rating">
                    {[5, 4, 3, 2, 1].map((r) => (
                      <option key={r} value={r}>
                        {"★".repeat(r)} ({r})
                      </option>
                    ))}
                  </select>
                  <button className="btn" disabled={busy} onClick={() => act(`/api/incidents/${i.incident_id}`, { action: "feedback", rating: Number(rating) }, "PATCH")}>
                    Rate the fix
                  </button>
                </div>
              )}

              {isManager && i.status === "OPEN" && (
                <>
                  <div className="actions">
                    <button className="btn signal" disabled={busy} onClick={() => act(`/api/incidents/${i.incident_id}/assign`, {})}>
                      Auto-assign best technician
                    </button>
                    <select value={tech} onChange={(e) => setTech(e.target.value)} style={{ width: "auto" }} aria-label="Technician">
                      <option value="">or choose a technician</option>
                      {skilled.map((t) => (
                        <option key={t.technician_id} value={t.technician_id} disabled={!t.is_available || t.active_jobs >= t.max_concurrent_jobs}>
                          {t.full_name} ({t.active_jobs}/{t.max_concurrent_jobs} jobs)
                        </option>
                      ))}
                    </select>
                    <button className="btn ghost" disabled={busy || !tech} onClick={() => act(`/api/incidents/${i.incident_id}/assign`, { technician_id: Number(tech) })}>
                      Assign
                    </button>
                  </div>
                  <div className="actions">
                    <input type="number" placeholder="Original incident #" value={dupOf} onChange={(e) => setDupOf(e.target.value)} style={{ width: 190 }} aria-label="Original incident number" />
                    <button className="btn ghost" disabled={busy || !dupOf} onClick={() => act(`/api/incidents/${i.incident_id}/duplicate`, { original_id: Number(dupOf) })}>
                      Merge as duplicate
                    </button>
                    {similar.filter((s) => ACTIVE.includes(s.status)).slice(0, 2).map((s) => (
                      <button key={s.incident_id} className="chip" style={{ border: 0, cursor: "pointer" }} onClick={() => setDupOf(String(s.incident_id))}>
                        #{s.incident_id} ({(s.similarity * 100).toFixed(0)}% similar)
                      </button>
                    ))}
                  </div>
                </>
              )}
              {isManager && active && (
                <div className="actions">
                  <span className="small muted">Re-classify severity:</span>
                  {SEVERITY.map((s) => (
                    <button key={s.v} className={"btn small " + (s.v === i.severity ? "" : "ghost")} disabled={busy || s.v === i.severity} onClick={() => act(`/api/incidents/${i.incident_id}`, { action: "update", severity: s.v }, "PATCH")}>
                      {s.v}
                    </button>
                  ))}
                  <button className="btn small danger" disabled={busy} onClick={() => act(`/api/incidents/${i.incident_id}`, { action: "cancel" }, "PATCH")}>
                    Cancel incident
                  </button>
                </div>
              )}
              {isReporter && i.status === "OPEN" && !isManager && (
                <div>
                  <button className="btn small danger" disabled={busy} onClick={() => act(`/api/incidents/${i.incident_id}`, { action: "cancel" }, "PATCH")}>
                    Withdraw my report
                  </button>
                </div>
              )}
              {!active && i.status !== "RESOLVED" && !(isReporter && i.status === "CLOSED" && !i.feedback_rating) && (
                <span className="small muted">No actions available for a {i.status.toLowerCase()} incident.</span>
              )}
            </div>
          </section>

          {/* ---------------- work orders */}
          <section className="panel">
            <div className="panel-head">
              <h3>Work orders</h3>
              {totalCost > 0 && <span className="small muted">Total cost {fmt.money(totalCost)}</span>}
            </div>
            {!workOrders.length && <div className="empty">No technician assigned yet.</div>}
            {workOrders.map((w) => (
              <div className="panel-body" key={w.work_order_id} style={{ borderTop: "1px solid var(--line-2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <strong>
                    #{w.work_order_id} {w.technician_name} <span className="tag-code">{w.employee_code}</span>
                  </strong>
                  <Status value={w.status} />
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  Assigned {fmt.dt(w.assigned_at)} by {w.assigned_by || "system"}
                  {w.started_at && `, started ${fmt.dt(w.started_at)}`}
                  {w.completed_at && `, completed ${fmt.dt(w.completed_at)}`}
                </div>
                {w.resolution_notes && <div className="fix">{w.resolution_notes}</div>}
                {parts.filter((p) => p.work_order_id === w.work_order_id).length > 0 && (
                  <table style={{ marginTop: 10 }}>
                    <thead>
                      <tr>
                        <th>Part used</th>
                        <th className="right">Qty</th>
                        <th className="right">Unit cost</th>
                        <th className="right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parts
                        .filter((p) => p.work_order_id === w.work_order_id)
                        .map((p) => (
                          <tr key={p.part_code}>
                            <td>
                              {p.part_name} <span className="tag-code">{p.part_code}</span>
                            </td>
                            <td className="right num">{p.quantity_used}</td>
                            <td className="right num">{fmt.money(p.unit_cost_at_use)}</td>
                            <td className="right num">{fmt.money(p.line_total)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
                {w.total_cost != null && (
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Labour {w.labour_hours} h = {fmt.money(w.labour_cost)}, parts {fmt.money(w.parts_cost)}, total <strong>{fmt.money(w.total_cost)}</strong>
                  </div>
                )}
              </div>
            ))}
          </section>
        </div>

        <aside className="stack">
          <section className="panel">
            <div className="panel-head">
              <h3>Why this priority</h3>
              <span className="num" style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 22 }}>
                {Number(i.priority_score).toFixed(0)}
                <span className="faint" style={{ fontSize: 15 }}> / 100</span>
              </span>
            </div>
            <div className="panel-body">
              <div className="hbars">
                {breakdown.map((b) => (
                  <div key={b.factor} title={b.detail}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                      <span>{b.factor}</span>
                      <span className="num muted">
                        {Number(b.points).toFixed(1)} / {Number(b.max_points)}
                      </span>
                    </div>
                    <div className="simbar" style={{ margin: "4px 0 2px" }}>
                      <i style={{ width: `${(b.points / b.max_points) * 100}%` }} />
                    </div>
                    <div className="small faint">{b.detail}</div>
                  </div>
                ))}
              </div>
              <p className="small muted" style={{ marginTop: 12 }}>
                Calculated inside PostgreSQL by fn_priority_breakdown and kept current by a trigger whenever severity, affected people or escalation change.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Timeline</h3>
            </div>
            <div className="panel-body">
              <ul className="timeline">
                {history.map((h, idx) => (
                  <li key={idx}>
                    <div>
                      {h.old_status ? (
                        <>
                          <Status value={h.old_status} /> to <Status value={h.new_status} />
                        </>
                      ) : (
                        <>Reported</>
                      )}
                    </div>
                    <div className="when">
                      {fmt.dt(h.changed_at)}
                      {h.changed_by ? `, ${h.changed_by}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Similar incidents</h3>
            </div>
            <div className="panel-body">
              {!similar.length && <p className="small muted">No incident with a similar description.</p>}
              {similar.map((s) => (
                <div className="match" key={s.incident_id}>
                  <div className="match-head">
                    <Link className="match-title" href={`/incidents/${s.incident_id}`}>
                      #{s.incident_id} {s.title}
                    </Link>
                    <span className="small num faint">{(s.similarity * 100).toFixed(0)}%</span>
                  </div>
                  <div className="small muted">
                    {s.building_name} {s.room_number}, <Status value={s.status} />
                  </div>
                  {s.resolution_notes && <div className="fix">{s.resolution_notes}</div>}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
