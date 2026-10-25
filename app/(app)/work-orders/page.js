"use client";
// Technician view: own work orders. Completing one calls sp_complete_work_order, which in a
// single transaction consumes spare parts, deducts stock, records cost and resolves the incident.
import { useState } from "react";
import Link from "next/link";
import { api, useApi, useToast, PageHead, PriorityTag, Status, Loading, ErrorNote, fmt } from "@/components/ui";

function CompleteForm({ wo, parts, onDone, notify }) {
  const [hours, setHours] = useState("1.5");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const relevant = parts.filter((p) => p.category_id === wo.category_id);
  const other = parts.filter((p) => p.category_id !== wo.category_id);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const d = await api(`/api/work-orders/${wo.work_order_id}`, {
        method: "POST",
        body: { action: "complete", labour_hours: Number(hours), notes, parts: lines.filter((l) => l.part_id).map((l) => ({ part_id: Number(l.part_id), quantity: Number(l.quantity) })) },
      });
      notify(d.message);
      onDone();
    } catch (e2) {
      setErr("Transaction rolled back, nothing was saved: " + e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--line)" }}>
      {err && <div className="notice err">{err}</div>}
      <div className="field">
        <label htmlFor={`n${wo.work_order_id}`}>What did you fix?</label>
        <textarea id={`n${wo.work_order_id}`} required minLength={10} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cause found and the repair done. Shown to future technicians as a known fix." />
      </div>
      <div className="field" style={{ maxWidth: 200 }}>
        <label htmlFor={`h${wo.work_order_id}`}>Labour hours</label>
        <input id={`h${wo.work_order_id}`} type="number" step="0.1" min="0.1" max="200" value={hours} onChange={(e) => setHours(e.target.value)} required />
      </div>
      <div className="field">
        <label>Spare parts used</label>
        {lines.map((l, idx) => (
          <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <select value={l.part_id} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === idx ? { ...x, part_id: e.target.value } : x)))} aria-label="Part">
              <option value="">Choose a part</option>
              <optgroup label="For this category">
                {relevant.map((p) => (
                  <option key={p.part_id} value={p.part_id}>
                    {p.part_name} ({p.quantity_in_stock} in stock)
                  </option>
                ))}
              </optgroup>
              <optgroup label="Other parts">
                {other.map((p) => (
                  <option key={p.part_id} value={p.part_id}>
                    {p.part_name} ({p.quantity_in_stock} in stock)
                  </option>
                ))}
              </optgroup>
            </select>
            <input type="number" min="1" value={l.quantity} style={{ width: 90 }} aria-label="Quantity" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)))} />
            <button type="button" className="btn ghost small" onClick={() => setLines((ls) => ls.filter((_, j) => j !== idx))}>
              Remove
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn ghost small" onClick={() => setLines((ls) => [...ls, { part_id: "", quantity: 1 }])}>
            Add a part
          </button>
        </div>
      </div>
      <button className="btn signal" disabled={busy}>
        {busy ? "Saving…" : "Complete work order"}
      </button>
    </form>
  );
}

export default function WorkOrdersPage() {
  const [scope, setScope] = useState("active");
  const { data, error, reload } = useApi(`/api/work-orders?scope=${scope}`);
  const { data: meta, reload: reloadMeta } = useApi("/api/meta");
  const [open, setOpen] = useState(null);
  const [toast, notify] = useToast();

  async function act(id, action) {
    try {
      const d = await api(`/api/work-orders/${id}`, { method: "POST", body: { action } });
      notify(d.message);
      reload();
    } catch (e) {
      notify(e.message, true);
    }
  }

  const list = data?.workOrders || [];

  return (
    <>
      {toast}
      <PageHead title="My work orders" sub="Highest priority first. Start a job when you arrive on site and complete it with the parts you used.">
        <div className="seg">
          <button className={scope === "active" ? "on" : ""} onClick={() => setScope("active")}>
            Active
          </button>
          <button className={scope === "done" ? "on" : ""} onClick={() => setScope("done")}>
            Completed
          </button>
        </div>
      </PageHead>
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : !list.length ? (
        <div className="panel empty">{scope === "active" ? "No open work orders. New assignments also appear in Notifications." : "No completed work orders yet."}</div>
      ) : (
        <div className="stack">
          {list.map((w) => (
            <section className="panel panel-body" key={w.work_order_id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <PriorityTag level={w.priority_level} score={w.priority_score} />
                    <Link href={`/incidents/${w.incident_id}`} style={{ fontWeight: 600, fontSize: 17, textDecoration: "none" }}>
                      {w.title}
                    </Link>
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    Work order #{w.work_order_id}, {w.building_name} room {w.room_number}
                    {w.asset_tag && `, ${w.asset_name} (${w.asset_tag})`}, reported by {w.reporter_name}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <Status value={w.status === "IN_PROGRESS" && w.incident_status === "ON_HOLD" ? "ON_HOLD" : w.status} />
                  <div className="small">{w.status === "COMPLETED" ? fmt.dt(w.completed_at) : fmt.sla(w.sla_hours_left, w.is_overdue)}</div>
                </div>
              </div>
              <p style={{ marginTop: 10, maxWidth: "75ch" }}>{w.description}</p>
              {w.resolution_notes && <div className="fix">{w.resolution_notes}</div>}
              {w.status === "COMPLETED" && w.total_cost != null && <div className="small muted" style={{ marginTop: 6 }}>Recorded cost {fmt.money(w.total_cost)}</div>}

              {["ASSIGNED", "IN_PROGRESS"].includes(w.status) && (
                <div className="actions" style={{ marginTop: 12 }}>
                  {w.status === "ASSIGNED" && (
                    <button className="btn" onClick={() => act(w.work_order_id, "start")}>
                      Start work
                    </button>
                  )}
                  {w.status === "IN_PROGRESS" && w.incident_status !== "ON_HOLD" && (
                    <button className="btn ghost" onClick={() => act(w.work_order_id, "hold")}>
                      Put on hold (waiting for parts)
                    </button>
                  )}
                  {w.incident_status === "ON_HOLD" && (
                    <button className="btn ghost" onClick={() => act(w.work_order_id, "resume")}>
                      Resume work
                    </button>
                  )}
                  <button className="btn signal" onClick={() => setOpen(open === w.work_order_id ? null : w.work_order_id)}>
                    {open === w.work_order_id ? "Close form" : "Complete…"}
                  </button>
                  <Link className="btn ghost" href={`/incidents/${w.incident_id}`}>
                    See similar past fixes
                  </Link>
                </div>
              )}
              {open === w.work_order_id && meta && (
                <CompleteForm
                  wo={w}
                  parts={meta.parts}
                  notify={notify}
                  onDone={() => {
                    setOpen(null);
                    reload();
                    reloadMeta();
                  }}
                />
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
