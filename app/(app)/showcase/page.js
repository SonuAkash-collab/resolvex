"use client";
// DB showcase: lists every query in database/09_queries.sql and runs it live (read-only).
import { useState } from "react";
import { api, useApi, PageHead, Loading, ErrorNote } from "@/components/ui";

function cell(v) {
  if (v === null || v === undefined) return <span className="faint">null</span>;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return new Date(v).toLocaleString("en-IN");
  return String(v);
}

export default function ShowcasePage() {
  const { data, error } = useApi("/api/showcase");
  const [result, setResult] = useState(null);
  const [active, setActive] = useState(null);
  const [err, setErr] = useState("");

  async function run(id) {
    setActive(id);
    setErr("");
    setResult(null);
    try {
      setResult(await api(`/api/showcase?id=${id}`));
    } catch (e) {
      setErr(e.message);
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead
        title="Database showcase"
        sub="The important queries from database/09_queries.sql, run live against PostgreSQL inside a read-only transaction. Use this page in the demo to show each SQL concept with real output."
      />
      <div className="grid" style={{ gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)", alignItems: "start" }}>
        <nav className="panel" aria-label="Queries">
          {data.queries.map((q) => (
            <button
              key={q.id}
              onClick={() => run(q.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                border: 0,
                borderBottom: "1px solid var(--line-2)",
                borderLeft: `4px solid ${active === q.id ? "var(--signal)" : "transparent"}`,
                background: active === q.id ? "#fbf7e6" : "transparent",
                cursor: "pointer",
              }}
            >
              <span className="faint small num">{q.id.toUpperCase()}</span> <strong style={{ fontWeight: 600 }}>{q.title}</strong>
              <div className="small muted">{q.concepts.join(", ")}</div>
            </button>
          ))}
        </nav>
        <div className="stack">
          {!active && <div className="panel empty">Pick a query on the left to see its SQL and live result.</div>}
          {err && <div className="notice err">{err}</div>}
          {active && !result && !err && <Loading what="Running" />}
          {result && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <h3>{result.title}</h3>
                  <span className="small muted">
                    {result.rowCount} row(s) in {result.ms} ms
                  </span>
                </div>
                <div className="panel-body">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {result.concepts.map((c) => (
                      <span key={c} className="chip">
                        {c}
                      </span>
                    ))}
                  </div>
                  <pre className="sql">{result.sql}</pre>
                </div>
              </section>
              <section className="panel">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {result.fields.map((f) => (
                          <th key={f}>{f}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr key={i}>
                          {result.fields.map((f) => (
                            <td key={f} className="small" style={{ maxWidth: 420, wordBreak: "break-word" }}>
                              {cell(r[f])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
