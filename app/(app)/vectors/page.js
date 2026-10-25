"use client";
// Vector store: READ, UPDATE (re-embed), DELETE and CREATE on the pgvector data.
import { useState } from "react";
import Link from "next/link";
import { api, useApi, useToast, PageHead, Loading, ErrorNote, Status, fmt } from "@/components/ui";

const CHIP = { FRESH: "good", STALE: "warn", MISSING: "bad" };
const LABEL = { FRESH: "fresh", STALE: "stale (text changed)", MISSING: "missing" };

export default function VectorsPage() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const qs = new URLSearchParams(Object.entries({ status, q }).filter(([, v]) => v)).toString();
  const { data, error, reload } = useApi(`/api/vectors?${qs}`);
  const { data: me } = useApi("/api/auth/me");
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(null);
  const [toast, notify] = useToast();
  const isAdmin = me?.user.role === "ADMIN";

  async function view(id) {
    setSel(id);
    setDetail(null);
    try {
      setDetail(await api(`/api/vectors?id=${id}`));
    } catch (e) {
      notify(e.message, true);
    }
  }

  async function run(key, url, options) {
    setBusy(key);
    try {
      const d = await api(url, options);
      notify(d.message);
      await reload();
      if (sel) view(sel);
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorNote error={error} />;
  const st = data?.stats;

  return (
    <>
      {toast}
      <PageHead
        title="Vector store"
        sub="Every incident's description is stored as a 384-number embedding in the pgvector table incident_embeddings. Read the vectors, update them when text changes, delete them, and create missing ones."
      >
        <button className="btn ghost" disabled={!!busy || !st?.stale} onClick={() => run("stale", "/api/vectors", { method: "POST", body: { action: "reembed-stale" } })}>
          {busy === "stale" ? "Re-embedding…" : `Re-embed stale (${st?.stale ?? 0})`}
        </button>
        <button className="btn signal" disabled={!!busy || !st?.missing} onClick={() => run("missing", "/api/vectors", { method: "POST", body: { action: "create-missing" } })}>
          {busy === "missing" ? "Embedding…" : `Create missing (${st?.missing ?? 0})`}
        </button>
      </PageHead>

      {st && (
        <div className="kpis">
          <div className="kpi">
            <div className="v num">{st.vectors}</div>
            <div className="l">Vectors stored ({st.incidents} incidents)</div>
          </div>
          <div className={"kpi" + (st.stale ? " alert" : "")}>
            <div className="v num">{st.stale}</div>
            <div className="l">Stale: text changed after embedding</div>
          </div>
          <div className={"kpi" + (st.missing ? " alert" : "")}>
            <div className="v num">{st.missing}</div>
            <div className="l">Missing: not searchable by meaning</div>
          </div>
          <div className="kpi">
            <div className="v num">{st.dims}</div>
            <div className="l">Dimensions, {st.metric} similarity</div>
          </div>
          <div className="kpi">
            <div className="v num">{st.index_size}</div>
            <div className="l">HNSW index (table {st.table_size})</div>
          </div>
        </div>
      )}

      <div className="filters">
        <input type="search" placeholder="Incident title contains…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search titles" />
        <div className="seg" role="group" aria-label="Vector status">
          {[["", "All"], ["FRESH", "Fresh"], ["STALE", "Stale"], ["MISSING", "Missing"]].map(([v, l]) => (
            <button key={v} className={status === v ? "on" : ""} onClick={() => setStatus(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <Loading />
      ) : (
        <div className="grid split">
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Vector</th>
                    <th className="right">Dims</th>
                    <th className="right">Norm</th>
                    <th>Embedded</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.incident_id} style={sel === r.incident_id ? { background: "#fbf7e6" } : undefined}>
                      <td className="title-cell">
                        <Link href={`/incidents/${r.incident_id}`}>
                          #{r.incident_id} {r.title}
                        </Link>
                        <div className="sub">
                          {r.category_name}, <Status value={r.status} />
                        </div>
                      </td>
                      <td>
                        <span className={"chip " + CHIP[r.vector_status]}>{LABEL[r.vector_status]}</span>
                      </td>
                      <td className="right num">{r.dims ?? "-"}</td>
                      <td className="right num">{r.norm != null ? Number(r.norm).toFixed(3) : "-"}</td>
                      <td className="small muted" style={{ whiteSpace: "nowrap" }}>
                        {r.embedded_at ? fmt.ago(r.embedded_at) : "-"}
                      </td>
                      <td className="right" style={{ whiteSpace: "nowrap" }}>
                        <button className="btn small ghost" onClick={() => view(r.incident_id)}>
                          View
                        </button>{" "}
                        <button
                          className="btn small ghost"
                          disabled={!!busy}
                          onClick={() => run("re" + r.incident_id, "/api/vectors", { method: "POST", body: { action: "reembed", incident_id: r.incident_id } })}
                        >
                          {r.vector_status === "MISSING" ? "Create" : "Re-embed"}
                        </button>{" "}
                        {isAdmin && r.vector_status !== "MISSING" && (
                          <button className="btn small danger" disabled={!!busy} onClick={() => run("del" + r.incident_id, `/api/vectors/${r.incident_id}`, { method: "DELETE" })}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="panel">
            <div className="panel-head">
              <h3>{sel ? `Vector of incident #${sel}` : "Vector details"}</h3>
            </div>
            <div className="panel-body">
              {!sel && <p className="small muted">Click View on a row to read its stored vector and its nearest neighbours.</p>}
              {sel && !detail && <Loading />}
              {detail && (
                <>
                  <dl className="facts">
                    <dt>Status</dt>
                    <dd>
                      <span className={"chip " + CHIP[detail.vector.vector_status]}>{LABEL[detail.vector.vector_status]}</span>
                    </dd>
                    <dt>Model</dt>
                    <dd>{detail.vector.model_name || "-"}</dd>
                    <dt>Dimensions</dt>
                    <dd>{detail.vector.dims ?? "-"}</dd>
                    <dt>Embedded</dt>
                    <dd>{fmt.dt(detail.vector.embedded_at)}</dd>
                  </dl>
                  {detail.vector.preview && (
                    <>
                      <div className="small muted" style={{ margin: "14px 0 6px" }}>
                        First 12 of {detail.vector.dims} values
                      </div>
                      <pre className="sql" style={{ whiteSpace: "pre-wrap" }}>
                        [{detail.vector.preview.map((x) => Number(x).toFixed(4)).join(", ")}, …]
                      </pre>
                    </>
                  )}
                  {detail.vector.source_text && (
                    <>
                      <div className="small muted" style={{ margin: "14px 0 6px" }}>
                        Text that was embedded
                      </div>
                      <div className="fix" style={{ borderLeftColor: "var(--ink)" }}>
                        {detail.vector.source_text}
                      </div>
                    </>
                  )}
                  <div className="small muted" style={{ margin: "14px 0 6px" }}>
                    Nearest neighbours (cosine similarity)
                  </div>
                  {!detail.neighbours.length && <p className="small muted">No vector, so no neighbours.</p>}
                  {detail.neighbours.map((n) => (
                    <div className="match" key={n.incident_id}>
                      <div className="match-head">
                        <Link className="match-title" href={`/incidents/${n.incident_id}`}>
                          #{n.incident_id} {n.title}
                        </Link>
                        <span className="small num faint">{(n.similarity * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
