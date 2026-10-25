"use client";
import { useState } from "react";
import Link from "next/link";
import { api, useApi, useToast, PageHead, PriorityTag, Loading, ErrorNote, HBars, RiskMeter, Status, fmt } from "@/components/ui";

function MonthlyChart({ data }) {
  if (!data?.length) return <div className="empty">No data</div>;
  const W = 560, H = 210, pad = { l: 34, r: 8, t: 14, b: 40 };
  const max = Math.max(...data.map((d) => d.incidents), 1);
  const step = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(46, step * 0.62);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Incidents per month, with critical incidents highlighted">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e7e9e4" />
          <text x={pad.l - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="#7a8582">
            {t}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.l + i * step + (step - bw) / 2;
        return (
          <g key={d.month}>
            <title>{`${d.label}: ${d.incidents} incidents, ${d.p1} critical, avg ${d.avg_hours ?? "-"} h to resolve`}</title>
            <rect x={x} y={y(d.incidents)} width={bw} height={y(0) - y(d.incidents)} fill="#3e5a57" rx="2" />
            <rect x={x} y={y(d.p1)} width={bw} height={y(0) - y(d.p1)} fill="#c0362c" />
            <text x={x + bw / 2} y={y(d.incidents) - 4} fontSize="12" textAnchor="middle" fill="#1b2422" fontWeight="600">
              {d.incidents}
            </text>
            <text x={x + bw / 2} y={H - pad.b + 16} fontSize="12" textAnchor="middle" fill="#4e5a57">
              {d.label}
            </text>
            <text x={x + bw / 2} y={H - pad.b + 31} fontSize="10.5" textAnchor="middle" fill="#7a8582">
              {d.avg_hours != null ? `${Math.round(d.avg_hours)} h` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AnalyticsPage() {
  const { data, error, reload } = useApi("/api/analytics");
  const [toast, notify] = useToast();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const d = await api("/api/maintenance", { method: "POST", body: { action: "refresh-stats" } });
      notify(d.message);
      reload();
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const k = data.kpi;

  return (
    <>
      {toast}
      <PageHead title="Analytics" sub="Everything on this page is read from SQL views and a materialized view, so the numbers are always consistent with the data.">
        <button className="btn ghost" onClick={refresh} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh monthly statistics"}
        </button>
      </PageHead>

      <div className="kpis">
        <div className="kpi">
          <div className="v num">{k.active}</div>
          <div className="l">Active incidents</div>
        </div>
        <div className={"kpi" + (k.overdue ? " alert" : "")}>
          <div className="v num">{k.overdue}</div>
          <div className="l">Past SLA deadline</div>
        </div>
        <div className="kpi">
          <div className="v num">{k.resolved_30d}</div>
          <div className="l">Resolved in 30 days</div>
        </div>
        <div className="kpi">
          <div className="v num">{k.mttr_hours ?? "-"} h</div>
          <div className="l">Mean time to resolve (30 d)</div>
        </div>
        <div className="kpi">
          <div className="v num">{k.sla_pct}%</div>
          <div className="l">Within SLA (all time)</div>
        </div>
        <div className="kpi">
          <div className="v num">{fmt.money(k.cost_30d)}</div>
          <div className="l">Maintenance spend (30 d)</div>
        </div>
        <div className="kpi">
          <div className="v num">{k.avg_rating ?? "-"}</div>
          <div className="l">Average reporter rating</div>
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 18 }}>
        <section className="panel">
          <div className="panel-head">
            <h3>Incidents per month</h3>
            <span className="small muted">
              <span style={{ display: "inline-block", width: 10, height: 10, background: "#c0362c", marginRight: 5, verticalAlign: "middle" }} />
              critical (P1) share, average hours to resolve below
            </span>
          </div>
          <div className="panel-body">
            <MonthlyChart data={data.monthly} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>SLA compliance by priority</h3>
            <span className="small muted">v_sla_compliance</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th className="right">Target</th>
                  <th className="right">Resolved</th>
                  <th className="right">Within SLA</th>
                  <th className="right">Avg time</th>
                </tr>
              </thead>
              <tbody>
                {data.sla.map((s) => (
                  <tr key={s.priority_level}>
                    <td>
                      <PriorityTag level={s.priority_level} />
                    </td>
                    <td className="right num">{s.target_hours} h</td>
                    <td className="right num">{s.resolved_count}</td>
                    <td className="right num">
                      <span className={"chip " + (s.compliance_pct >= 85 ? "good" : s.compliance_pct >= 70 ? "warn" : "bad")}>{s.compliance_pct}%</span>
                    </td>
                    <td className="right num">{s.avg_resolution_hours} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid g3" style={{ marginBottom: 18 }}>
        <section className="panel">
          <div className="panel-head">
            <h3>Incidents by building</h3>
            <span className="small muted">180 days</span>
          </div>
          <div className="panel-body">
            <HBars items={data.byBuilding} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Incidents by category</h3>
            <span className="small muted">180 days</span>
          </div>
          <div className="panel-body">
            <HBars items={data.byCategory} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Maintenance cost by category</h3>
          </div>
          <div className="panel-body">
            <HBars items={data.costByCategory} format={(v) => fmt.money(v)} />
          </div>
        </section>
      </div>

      <div className="grid g2">
        <section className="panel">
          <div className="panel-head">
            <h3>Assets most likely to fail next</h3>
            <Link className="small" href="/assets">
              All assets
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="right">Failures 180 d</th>
                  <th className="right">MTBF</th>
                  <th>Next failure (est.)</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {data.risk.map((a) => (
                  <tr key={a.asset_id}>
                    <td>
                      <strong style={{ fontWeight: 600 }}>{a.asset_name}</strong>
                      <div className="small faint">
                        <span className="tag-code">{a.asset_tag}</span> {a.building_name}
                      </div>
                    </td>
                    <td className="right num">{a.failures_180d}</td>
                    <td className="right num">{a.mtbf_days ? `${Math.round(a.mtbf_days)} d` : "-"}</td>
                    <td className="small">{fmt.due(a.predicted_next_failure)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <RiskMeter score={a.risk_score} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h3>Critical right now</h3>
              <span className="small muted">v_critical_incidents</span>
            </div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {data.critical.map((c) => (
                    <tr key={c.incident_id}>
                      <td>
                        <PriorityTag level={c.priority_level} />
                      </td>
                      <td className="title-cell">
                        <Link href={`/incidents/${c.incident_id}`}>{c.title}</Link>
                        <div className="sub">{c.building_name}</div>
                      </td>
                      <td>
                        <Status value={c.status} />
                      </td>
                      <td className="small" style={{ whiteSpace: "nowrap" }}>
                        {fmt.sla(c.sla_hours_left, c.is_overdue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h3>Parts to reorder</h3>
              <Link className="small" href="/inventory">
                Inventory
              </Link>
            </div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {data.lowStock.map((p) => (
                    <tr key={p.part_id}>
                      <td>
                        {p.part_name} <span className="tag-code">{p.part_code}</span>
                      </td>
                      <td className="right num">
                        <span className={"chip " + (p.quantity_in_stock === 0 ? "bad" : "warn")}>
                          {p.quantity_in_stock} left / reorder at {p.reorder_level}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
