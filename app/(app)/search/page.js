"use client";
// Search across all incidents: semantic (pgvector), keyword (full-text) or hybrid (RRF).
import { useState } from "react";
import Link from "next/link";
import { api, PageHead, PriorityTag, Status, fmt } from "@/components/ui";

const MODES = [
  ["hybrid", "Hybrid"],
  ["semantic", "Meaning only"],
  ["keyword", "Exact words"],
];
const EXAMPLES = ["room is too hot", "no internet in the hostel", "burning smell from socket", "projector picture not clear", "bathroom water is cold"];

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("hybrid");
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(text = q, m = mode) {
    if (text.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      setRes(await api(`/api/search?q=${encodeURIComponent(text)}&mode=${m}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Search past incidents"
        sub="Search by meaning, not just by words. “Room is too hot” finds “AC blowing warm air” even though they share no keywords."
      />
      <form
        className="panel panel-body"
        style={{ marginBottom: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input type="search" aria-label="Search text" placeholder="Describe the problem…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 320px" }} />
          <div className="seg" role="group" aria-label="Search mode">
            {MODES.map(([m, label]) => (
              <button
                type="button"
                key={m}
                className={mode === m ? "on" : ""}
                onClick={() => {
                  setMode(m);
                  if (q) run(q, m);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="btn signal" disabled={busy}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          Try:
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              style={{ border: 0, cursor: "pointer" }}
              onClick={() => {
                setQ(ex);
                run(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      {error && <div className="notice err">{error}</div>}
      {res && (
        <section className="panel">
          <div className="panel-head">
            <h2>{res.results.length} results</h2>
            <span className="small muted">
              {res.mode === "keyword" ? "PostgreSQL full-text search (GIN index)" : `embedding ${res.timing.embedMs} ms, search ${res.timing.searchMs} ms`}
            </span>
          </div>
          {!res.results.length && (
            <div className="empty">
              Nothing matched. {res.mode === "keyword" ? "Exact-word search misses synonyms; switch to Hybrid or Meaning only." : "Try describing the symptom differently."}
            </div>
          )}
          {res.results.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th className="right">Meaning match</th>
                    <th className="right">Rank (meaning / words)</th>
                    <th className="right">Fused score</th>
                  </tr>
                </thead>
                <tbody>
                  {res.results.map((r) => (
                    <tr key={r.incident_id}>
                      <td className="title-cell">
                        <Link href={`/incidents/${r.incident_id}`}>
                          #{r.incident_id} {r.title}
                        </Link>
                        <div className="sub">
                          {r.building_name} {r.room_number}, {r.category_name}, {fmt.date(r.reported_at)}
                        </div>
                      </td>
                      <td>
                        <PriorityTag level={r.priority_level} />
                      </td>
                      <td>
                        <Status value={r.status} />
                      </td>
                      <td className="right num">{r.similarity != null ? `${(r.similarity * 100).toFixed(0)}%` : <span className="faint">-</span>}</td>
                      <td className="right num small">
                        {r.semantic_rank ?? "-"} / {r.keyword_rank ?? "-"}
                      </td>
                      <td className="right num">{Number(r.rrf_score).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
