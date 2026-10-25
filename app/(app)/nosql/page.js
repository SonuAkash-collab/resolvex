"use client";
// Document store (MongoDB): collections, $jsonSchema validators, indexes, sample documents,
// a read-only query console with explain(), and the cross-database consistency check.
import { useState } from "react";
import Link from "next/link";
import { api, useApi, useToast, PageHead, Loading, ErrorNote } from "@/components/ui";

const kb = (b) => (b == null ? "-" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} kB` : `${(b / 1048576).toFixed(1)} MB`);
const pretty = (x) => JSON.stringify(x, null, 2);
const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();

const PRESETS = [
  {
    label: "HVAC inspections with a blocked filter (a field only HVAC documents have; partial index)",
    collection: "incident_notes",
    filter: { kind: "INSPECTION", category_key: "HVAC", "readings.filter_condition": "Blocked" },
    projection: { _id: 0, incident_id: 1, category_key: 1, readings: 1, verdict: 1 },
  },
  {
    label: "Low suction pressure under 100 psi (no index on readings: COLLSCAN)",
    collection: "incident_notes",
    filter: { "readings.suction_pressure_psi": { $lt: 100 } },
    projection: { _id: 0, incident_id: 1, text: 1, "readings.suction_pressure_psi": 1 },
    sort: { "readings.suction_pressure_psi": 1 },
  },
  {
    label: "Inspections where the check 'Drain line clear' failed ($elemMatch on an array)",
    collection: "incident_notes",
    filter: { checklist: { $elemMatch: { item: "Drain line clear", ok: false } } },
    projection: { _id: 0, incident_id: 1, text: 1, checklist: 1 },
  },
  {
    label: "Notes tagged 'leak' (multikey index on tags)",
    collection: "incident_notes",
    filter: { tags: "leak" },
    projection: { _id: 0, incident_id: 1, kind: 1, text: 1, tags: 1 },
  },
  {
    label: "Full-text search 'fan motor noise' ($text index, ranked)",
    collection: "incident_notes",
    filter: { $text: { $search: "fan motor noise" } },
    projection: { _id: 0, incident_id: 1, text: 1, score: { $meta: "textScore" } },
    sort: { score: { $meta: "textScore" } },
  },
  {
    label: "Thread of incident #168, newest first (compound index)",
    collection: "incident_notes",
    filter: { incident_id: 168 },
    sort: { created_at: -1 },
  },
  {
    label: "Notes with 2 or more helpful votes ($expr + $size)",
    collection: "incident_notes",
    filter: { $expr: { $gte: [{ $size: { $ifNull: ["$helpful", []] } }, 2] } },
    projection: { _id: 0, incident_id: 1, "author.name": 1, text: 1, helpful: 1 },
  },
  {
    label: "Edited comments with their history (edits array exists)",
    collection: "incident_notes",
    filter: { "edits.0": { $exists: true } },
    projection: { _id: 0, incident_id: 1, text: 1, edits: 1 },
  },
  {
    label: "The HVAC inspection template",
    collection: "inspection_templates",
    filter: { _id: "HVAC" },
  },
  {
    label: "Searches in the last 30 days that found nothing",
    collection: "search_events",
    filter: () => ({ results: 0, at: { $gte: { $date: daysAgo(30) } } }),
    sort: { at: -1 },
  },
];

function IndexType({ ix }) {
  const chips = [];
  if (ix.name === "_id_") chips.push(["primary key", ""]);
  if (ix.unique) chips.push(["unique", "good"]);
  if (ix.text) chips.push(["text", "warn"]);
  if (ix.partial) chips.push(["partial", "warn"]);
  if (ix.ttlSeconds != null) chips.push([`TTL ${Math.round(ix.ttlSeconds / 86400)} days`, "bad"]);
  if (Object.keys(ix.keys).length > 1 && !ix.text) chips.push(["compound", ""]);
  return chips.map(([l, c]) => (
    <span key={l} className={"chip " + c} style={{ marginRight: 4 }}>
      {l}
    </span>
  ));
}

export default function NoSqlPage() {
  const { data, error } = useApi("/api/nosql");
  const { data: me } = useApi("/api/auth/me");
  const [toast, notify] = useToast();
  const [tab, setTab] = useState("incident_notes");
  const [showValidator, setShowValidator] = useState(false);
  const [q, setQ] = useState({ collection: "incident_notes", filter: pretty(PRESETS[0].filter), projection: pretty(PRESETS[0].projection), sort: "", limit: 10 });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [check, setCheck] = useState(null);

  function preset(i) {
    const p = PRESETS[i];
    const filter = typeof p.filter === "function" ? p.filter() : p.filter;
    setQ({ collection: p.collection, filter: pretty(filter), projection: p.projection ? pretty(p.projection) : "", sort: p.sort ? pretty(p.sort) : "", limit: 10 });
    setResult(null);
  }

  async function run(e) {
    e?.preventDefault();
    setRunning(true);
    try {
      setResult(await api("/api/nosql", { method: "POST", body: { action: "find", ...q } }));
    } catch (err) {
      setResult(null);
      notify(err.message, true);
    } finally {
      setRunning(false);
    }
  }

  async function consistency(action) {
    try {
      const d = await api("/api/nosql", { method: "POST", body: { action } });
      if (d.message) notify(d.message);
      setCheck(action === "orphans" ? d : await api("/api/nosql", { method: "POST", body: { action: "orphans" } }));
    } catch (err) {
      notify(err.message, true);
    }
  }

  if (error)
    return (
      <>
        <PageHead title="Document store" />
        <ErrorNote error={error} />
      </>
    );
  if (!data) return <Loading what="Reading MongoDB" />;
  const { server, collections } = data;
  const col = collections.find((c) => c.name === tab) || collections[0];

  return (
    <>
      {toast}
      <PageHead
        title="Document store"
        sub="MongoDB holds the data with no fixed shape: incident discussions and inspection logs whose readings differ for every equipment category, and a search log that deletes itself after 90 days. PostgreSQL keeps incidents, work orders, stock and money."
      />

      <div className="kpis">
        <div className="kpi">
          <div className="v num">{server.version}</div>
          <div className="l">MongoDB version, database {server.database}</div>
        </div>
        <div className="kpi">
          <div className="v num">{server.collections}</div>
          <div className="l">Collections</div>
        </div>
        <div className="kpi">
          <div className="v num">{server.objects}</div>
          <div className="l">Documents</div>
        </div>
        <div className="kpi">
          <div className="v num">{kb(server.dataBytes)}</div>
          <div className="l">Data ({kb(server.indexBytes)} indexes)</div>
        </div>
      </div>

      <div className="grid split" style={{ marginBottom: 18 }}>
        <section className="panel">
          <div className="panel-head">
            <div className="seg" role="group" aria-label="Collection">
              {collections.map((c) => (
                <button key={c.name} className={tab === c.name ? "on" : ""} onClick={() => setTab(c.name)}>
                  {c.name}
                </button>
              ))}
            </div>
            <span className="small muted">
              {col.count} documents, avg {kb(col.avgDocBytes)}
            </span>
          </div>
          {col.missing ? (
            <div className="empty">Collection missing: run npm run db:setup.</div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Index</th>
                      <th>Keys</th>
                      <th>Type</th>
                      <th className="right">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {col.indexes.map((ix) => (
                      <tr key={ix.name}>
                        <td className="tag-code">{ix.name}</td>
                        <td>
                          <code className="small">{JSON.stringify(ix.weights || ix.keys)}</code>
                          {ix.partial && <div className="small muted">only where {JSON.stringify(ix.partial)}</div>}
                        </td>
                        <td>
                          <IndexType ix={ix} />
                        </td>
                        <td className="right num small">{kb(ix.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel-body" style={{ borderTop: "1px solid var(--line-2)" }}>
                <div className="actions">
                  <span className="small">
                    Validation: <span className="chip good">{col.validationLevel}</span> <span className="chip bad">{col.validationAction} on invalid documents</span>
                  </span>
                  <button className="btn small ghost" onClick={() => setShowValidator((x) => !x)}>
                    {showValidator ? "Hide $jsonSchema validator" : "Show $jsonSchema validator"}
                  </button>
                </div>
                {showValidator && <pre className="json" style={{ marginTop: 10 }}>{pretty(col.validator)}</pre>}
              </div>
            </>
          )}
        </section>

        <aside className="panel">
          <div className="panel-head">
            <h3>Sample document{col.samples?.length > 1 ? "s" : ""}</h3>
            <span className="small muted">Extended JSON (shows BSON types)</span>
          </div>
          <div className="panel-body stack" style={{ gap: 10 }}>
            {(col.samples || []).map((d, i) => (
              <pre key={i} className="json">
                {pretty(d)}
              </pre>
            ))}
          </div>
        </aside>
      </div>

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <h3>Query the documents</h3>
          <span className="small muted">read-only: find() with explain(); $where, $function, $out and $merge are rejected</span>
        </div>
        <form className="panel-body" onSubmit={run}>
          <div className="field">
            <label htmlFor="preset">Example queries</label>
            <select id="preset" onChange={(e) => e.target.value !== "" && preset(Number(e.target.value))} defaultValue="0">
              {PRESETS.map((p, i) => (
                <option key={i} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
            <div className="field">
              <label htmlFor="qf">Filter</label>
              <textarea id="qf" className="code" value={q.filter} onChange={(e) => setQ({ ...q, filter: e.target.value })} spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="qp">Projection (optional)</label>
              <textarea id="qp" className="code" value={q.projection} onChange={(e) => setQ({ ...q, projection: e.target.value })} spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="qs">Sort (optional)</label>
              <textarea id="qs" className="code" value={q.sort} onChange={(e) => setQ({ ...q, sort: e.target.value })} spellCheck={false} />
            </div>
          </div>
          <div className="actions">
            <select value={q.collection} onChange={(e) => setQ({ ...q, collection: e.target.value })} style={{ width: "auto" }} aria-label="Collection">
              {collections.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
            <input type="number" min={1} max={50} value={q.limit} onChange={(e) => setQ({ ...q, limit: Number(e.target.value) })} style={{ width: 90 }} aria-label="Limit" />
            <button className="btn signal" disabled={running}>
              {running ? "Running…" : "Run find()"}
            </button>
          </div>
        </form>
        {result && (
          <div className="panel-body" style={{ borderTop: "1px solid var(--line-2)" }}>
            <pre className="sql">{result.shell}</pre>
            <div className="actions" style={{ margin: "10px 0" }}>
              <span className={"chip " + (result.plan.usesIndex ? "good" : "warn")}>
                {result.plan.usesIndex ? `index used: ${result.plan.indexes.join(", ") || result.plan.stages}` : "COLLSCAN: no index, every document read"}
              </span>
              <span className="small muted">
                plan {result.plan.stages}; keys examined {result.plan.keysExamined}, documents examined {result.plan.docsExamined}, {result.matching} match, {result.docs.length} shown, {result.ms} ms
              </span>
            </div>
            {!result.docs.length ? <div className="empty">No document matches.</div> : <pre className="json">{pretty(result.docs)}</pre>}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Cross-database consistency</h3>
          <span className="small muted">no foreign keys between MongoDB and PostgreSQL, so the app checks references</span>
        </div>
        <div className="panel-body">
          <p className="small muted" style={{ marginBottom: 12 }}>
            Every note stores the <span className="tag-code">incident_id</span> of a PostgreSQL incident. The API checks that the incident exists (under row-level security) before it writes a note. This check finds
            notes whose incident no longer exists, for example after an incident was deleted directly in psql.
          </p>
          <div className="actions">
            <button className="btn" onClick={() => consistency("orphans")}>
              Check references
            </button>
            {me?.user.role === "ADMIN" && check?.orphans.length > 0 && (
              <button className="btn danger" onClick={() => consistency("cleanup-orphans")}>
                Delete orphaned notes
              </button>
            )}
          </div>
          {check && (
            <div className={"notice " + (check.orphans.length ? "err" : "ok")} style={{ marginTop: 12, marginBottom: 0 }}>
              {check.incidentsWithNotes} incidents have notes.{" "}
              {check.orphans.length
                ? `${check.orphans.length} incident id(s) are missing in PostgreSQL: ${check.orphans.map((o) => `#${o.incident_id} (${o.notes} notes)`).join(", ")}.`
                : "Every note refers to an existing incident."}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 14 }}>
            Aggregation pipeline reports ($group, $unwind, $lookup) are on the <Link href="/reports">Reports</Link> page under MongoDB.
          </p>
        </div>
      </section>
    </>
  );
}
