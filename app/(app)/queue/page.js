"use client";
// Facility manager's priority queue: active incidents ordered by the DB-computed score,
// with one-click auto assignment (stored procedure) and SLA / preventive maintenance runs.
import { useState } from "react";
import Link from "next/link";
import { api, useApi, useToast, PageHead, PriorityTag, Status, Loading, ErrorNote, fmt } from "@/components/ui";

export default function QueuePage() {
  const { data, error, reload } = useApi("/api/incidents?status=ACTIVE&sort=priority&limit=200");
  const { data: wl, reload: reloadWl } = useApi("/api/analytics");
  const [toast, notify] = useToast();
  const [busy, setBusy] = useState(null);

  async function run(key, url, body) {
    setBusy(key);
    try {
      const d = await api(url, { method: "POST", body });
      notify(d.message);
      await Promise.all([reload(), reloadWl()]);
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.incidents || [];
  const open = rows.filter((r) => r.status === "OPEN");
  const working = rows.filter((r) => r.status !== "OPEN");
  const k = wl?.kpi;

  return (
    <>
      {toast}
      <PageHead title="Priority queue" sub="Active incidents ranked by the priority score PostgreSQL computes from severity, people affected, asset criticality, location, repeat failures and SLA.">
        <button className="btn ghost" disabled={!!busy} onClick={() => run("esc", "/api/maintenance", { action: "escalate" })}>
          {busy === "esc" ? "Checking…" : "Escalate SLA breaches"}
        </button>
        <button className="btn ghost" disabled={!!busy} onClick={() => run("prev", "/api/maintenance", { action: "preventive", threshold: 75 })}>
          {busy === "prev" ? "Scanning…" : "Plan preventive maintenance"}
        </button>
      </PageHead>

      {k && (
        <div className="kpis">
          <div className="kpi">
            <div className="v num">{open.length}</div>
            <div className="l">Waiting for a technician</div>
          </div>
          <div className="kpi">
            <div className="v num">{working.length}</div>
            <div className="l">Being worked on</div>
          </div>
          <div className={"kpi" + (k.overdue ? " alert" : "")}>
            <div className="v num">{k.overdue}</div>
            <div className="l">Past SLA deadline</div>
          </div>
          <div className="kpi">
            <div className="v num">{k.sla_pct}%</div>
            <div className="l">Resolved within SLA</div>
          </div>
          <div className="kpi">
            <div className="v num">{k.duplicates_caught}</div>
            <div className="l">Duplicate reports merged</div>
          </div>
        </div>
      )}

      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="grid split">
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <h2>Needs assignment</h2>
                <span className="small muted">{open.length}</span>
              </div>
              {!open.length && <div className="empty">Every active incident has a technician.</div>}
              {open.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Priority</th>
                        <th>Incident</th>
                        <th>SLA</th>
                        <th className="right">Assign</th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.map((r) => (
                        <tr key={r.incident_id}>
                          <td>
                            <PriorityTag level={r.priority_level} score={r.priority_score} />
                          </td>
                          <td className="title-cell">
                            <Link href={`/incidents/${r.incident_id}`}>
                              #{r.incident_id} {r.title}
                            </Link>
                            <div className="sub">
                              {r.building_name}, {r.room_number} ({r.category_name}), {r.affected_users} affected, {fmt.ago(r.reported_at)}
                            </div>
                          </td>
                          <td className="small" style={{ whiteSpace: "nowrap" }}>
                            {fmt.sla(r.sla_hours_left, r.is_overdue)}
                          </td>
                          <td className="right">
                            <button className="btn small signal" disabled={!!busy} onClick={() => run("a" + r.incident_id, `/api/incidents/${r.incident_id}/assign`, {})}>
                              {busy === "a" + r.incident_id ? "Assigning…" : "Auto-assign"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>In progress</h2>
                <span className="small muted">{working.length}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Priority</th>
                      <th>Incident</th>
                      <th>Status</th>
                      <th>Technician</th>
                      <th>SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {working.map((r) => (
                      <tr key={r.incident_id}>
                        <td>
                          <PriorityTag level={r.priority_level} score={r.priority_score} />
                        </td>
                        <td className="title-cell">
                          <Link href={`/incidents/${r.incident_id}`}>
                            #{r.incident_id} {r.title}
                          </Link>
                          <div className="sub">
                            {r.building_name}, {r.room_number}
                          </div>
                        </td>
                        <td>
                          <Status value={r.status} />
                        </td>
                        <td>{r.technician_name}</td>
                        <td className="small" style={{ whiteSpace: "nowrap" }}>
                          {fmt.sla(r.sla_hours_left, r.is_overdue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="panel">
            <div className="panel-head">
              <h3>Technician load</h3>
              <span className="small muted">v_technician_workload</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Technician</th>
                    <th className="right">Active</th>
                    <th className="right">Done 30 d</th>
                  </tr>
                </thead>
                <tbody>
                  {(wl?.workload || []).map((t) => (
                    <tr key={t.technician_id}>
                      <td>
                        <strong style={{ fontWeight: 600 }}>{t.full_name}</strong>
                        <div className="small faint">{t.skills}</div>
                      </td>
                      <td className="right num">
                        {t.active_jobs} / {t.max_concurrent_jobs}
                      </td>
                      <td className="right num">{t.completed_30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted panel-body">
              Auto-assign calls <span className="tag-code">sp_assign_technician</span>: it picks an available technician with the matching skill and the fewest
              active jobs, locks the row and creates the work order in one transaction.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
