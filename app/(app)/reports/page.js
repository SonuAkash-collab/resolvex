"use client";
// Management reports with a period filter and CSV download.
import { useEffect, useState } from "react";
import { api, useApi, PageHead, Loading, ErrorNote } from "@/components/ui";

const PERIODS = [
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["180", "Last 180 days"],
  ["", "All time"],
];

const heading = (f) =>
  f.replace(/_inr$/, " (₹)").replace(/_pct$/, " (%)").replace(/_/g, " ").replace(/\bsla\b/i, "SLA").replace(/^./, (c) => c.toUpperCase());

function cell(v, f) {
  if (v === null || v === undefined) return <span className="faint">-</span>;
  if (typeof v === "number") return f.endsWith("_inr") ? "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : v.toLocaleString("en-IN");
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return new Date(v).toLocaleDateString("en-IN");
  return String(v);
}

function toCsv(fields, rows) {
  const esc = (x) => (x === null || x === undefined ? "" : /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
  return [fields.join(","), ...rows.map((r) => fields.map((f) => esc(r[f])).join(","))].join("\n");
}

export default function ReportsPage() {
  const { data, error } = useApi("/api/reports");
  const [id, setId] = useState(null);
  const [days, setDays] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    if (data && !id) setId(data.reports[0].id);
  }, [data, id]);

  useEffect(() => {
    if (!id) return;
    setRes(null);
    setErr("");
    api(`/api/reports?id=${id}${days ? `&days=${days}` : ""}`)
      .then(setRes)
      .catch((e) => setErr(e.message));
  }, [id, days]);

  function download() {
    const blob = new Blob([toCsv(res.fields, res.rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `resolvex-${res.id}${days ? `-${days}d` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead title="Reports" sub="Management reports computed live: aggregate SQL in PostgreSQL (JOIN, GROUP BY, HAVING, AVG, SUM) and aggregation pipelines in MongoDB ($match, $unwind, $group, $lookup). Pick a report and a period; download any of them as CSV.">
        <select value={days} onChange={(e) => setDays(e.target.value)} style={{ width: "auto" }} aria-label="Period">
          {PERIODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn ghost" disabled={!res?.rows.length} onClick={download}>
          Download CSV
        </button>
      </PageHead>

      <div className="grid" style={{ gridTemplateColumns: "minmax(240px, 320px) minmax(0, 1fr)", alignItems: "start" }}>
        <nav className="panel" aria-label="Reports">
          {[
            ["postgresql", "PostgreSQL · SQL"],
            ["mongodb", "MongoDB · aggregation pipeline"],
          ].map(([engine, label]) => (
            <div key={engine}>
              <div className="small" style={{ color: "var(--ink-3)", fontWeight: 600, padding: "12px 14px 6px", borderBottom: "1px solid var(--line-2)", background: "var(--surface-2)" }}>
                {label}
              </div>
              {data.reports
                .filter((r) => r.engine === engine)
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setId(r.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "11px 14px",
                      border: 0,
                      borderBottom: "1px solid var(--line-2)",
                      borderLeft: `4px solid ${id === r.id ? "var(--signal)" : "transparent"}`,
                      background: id === r.id ? "#fbf7e6" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <strong style={{ fontWeight: 600 }}>{r.title}</strong>
                    <div className="small muted">{r.concepts}</div>
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <section className="panel">
          {err && <div className="notice err" style={{ margin: 16 }}>{err}</div>}
          {!res && !err && <Loading what="Running report" />}
          {res && (
            <>
              <div className="panel-head">
                <h2>{res.title}</h2>
                <span className="small muted">
                  {res.engine === "mongodb" ? "MongoDB" : "PostgreSQL"}, {res.rows.length} row(s), {res.ms} ms, {days ? `last ${days} days` : "all time"}
                </span>
              </div>
              {!res.rows.length && <div className="empty">No data in this period. Try a longer period.</div>}
              {res.rows.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {res.fields.map((f) => (
                          <th key={f} className={typeof res.rows[0][f] === "number" ? "right" : ""}>
                            {heading(f)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {res.rows.map((r, i) => (
                        <tr key={i}>
                          {res.fields.map((f) => (
                            <td key={f} className={typeof r[f] === "number" ? "right num" : ""}>
                              {cell(r[f], f)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="panel-body" style={{ borderTop: "1px solid var(--line-2)" }}>
                <button className="btn small ghost" onClick={() => setShowSql((x) => !x)}>
                  {showSql ? (res.engine === "mongodb" ? "Hide pipeline" : "Hide SQL") : res.engine === "mongodb" ? "Show the pipeline" : "Show the SQL"}
                </button>
                {showSql && (
                  <pre className="sql" style={{ marginTop: 10 }}>
                    {res.sql}
                  </pre>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
