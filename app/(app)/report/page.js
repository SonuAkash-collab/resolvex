"use client";
// Report a problem. While the user types, the draft is embedded and compared (pgvector)
// against active incidents (possible duplicates) and resolved history (known fixes).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, useApi, useToast, PageHead, PriorityTag, Status, SEVERITY, fmt, Loading } from "@/components/ui";

const EMPTY = { building_id: "", room_id: "", category_id: "", asset_id: "", title: "", description: "", severity: 3, affected_users: 1 };

export default function ReportPage() {
  const { data: meta } = useApi("/api/meta");
  const [form, setForm] = useState(EMPTY);
  const [similar, setSimilar] = useState(null);
  const [checking, setChecking] = useState(false);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, notify] = useToast();
  const timer = useRef();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const rooms = useMemo(() => (meta?.rooms || []).filter((r) => String(r.building_id) === String(form.building_id)), [meta, form.building_id]);
  const assets = useMemo(
    () =>
      (meta?.assets || []).filter(
        (a) => String(a.room_id) === String(form.room_id) && (!form.category_id || String(a.category_id) === String(form.category_id))
      ),
    [meta, form.room_id, form.category_id]
  );

  // debounced semantic check
  useEffect(() => {
    clearTimeout(timer.current);
    const text = (form.title + " " + form.description).trim();
    if (text.length < 8) {
      setSimilar(null);
      return;
    }
    timer.current = setTimeout(async () => {
      setChecking(true);
      try {
        const d = await api("/api/incidents/similar", {
          method: "POST",
          body: { title: form.title, description: form.description, room_id: form.room_id || null, asset_id: form.asset_id || null, category_id: form.category_id || null },
        });
        setSimilar(d);
      } catch {
        /* the form still works without suggestions */
      } finally {
        setChecking(false);
      }
    }, 650);
    return () => clearTimeout(timer.current);
  }, [form.title, form.description, form.room_id, form.asset_id, form.category_id]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api("/api/incidents", {
        method: "POST",
        body: { ...form, asset_id: form.asset_id || null, severity: Number(form.severity), affected_users: Number(form.affected_users) },
      });
      setCreated(d.incident);
      setForm(EMPTY);
      setSimilar(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id) {
    try {
      const d = await api(`/api/incidents/${id}/confirm`, { method: "POST" });
      notify(
        `Added you to incident #${id}. Affected users ${d.before.affected_users} → ${d.after.affected_users}, priority score ${Number(d.before.priority_score).toFixed(1)} → ${Number(d.after.priority_score).toFixed(1)} (recalculated by trigger).`
      );
      setSimilar((s) => ({ ...s, duplicates: s.duplicates.map((x) => (x.incident_id === id ? { ...x, confirmed: true } : x)) }));
    } catch (err) {
      notify(err.message, true);
    }
  }

  if (!meta) return <Loading />;

  if (created) {
    return (
      <>
        <PageHead title="Report received" />
        <div className="panel panel-body" style={{ maxWidth: 640 }}>
          <p style={{ fontSize: 17 }}>
            Incident <strong>#{created.incident_id}</strong> was logged.
          </p>
          <dl className="facts" style={{ margin: "16px 0 20px" }}>
            <dt>Priority (set by the database)</dt>
            <dd>
              <PriorityTag level={created.priority_level} score={created.priority_score} />
            </dd>
            <dt>Fix due by</dt>
            <dd>{fmt.dt(created.sla_due_at)}</dd>
            <dt>Status</dt>
            <dd>
              <Status value={created.status} />
            </dd>
          </dl>
          <div className="actions">
            <Link className="btn" href={`/incidents/${created.incident_id}`}>
              Open incident
            </Link>
            <button className="btn ghost" onClick={() => setCreated(null)}>
              Report another problem
            </button>
          </div>
        </div>
      </>
    );
  }

  const dups = similar?.duplicates || [];
  const fixes = similar?.history || [];

  return (
    <>
      {toast}
      <PageHead
        title="Report a problem"
        sub="Describe it in your own words. Similar reports appear on the right as you type, so you can join an existing one instead of filing it twice."
      />
      <div className="grid split">
        <form className="panel panel-body" onSubmit={submit}>
          {error && <div className="notice err">{error}</div>}
          <div className="row">
            <div className="field">
              <label htmlFor="b">Building</label>
              <select id="b" required value={form.building_id} onChange={(e) => setForm((f) => ({ ...f, building_id: e.target.value, room_id: "", asset_id: "" }))}>
                <option value="">Choose a building</option>
                {meta.buildings.map((b) => (
                  <option key={b.building_id} value={b.building_id}>
                    {b.building_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="r">Room or area</label>
              <select id="r" required value={form.room_id} disabled={!form.building_id} onChange={(e) => setForm((f) => ({ ...f, room_id: e.target.value, asset_id: "" }))}>
                <option value="">Choose a room</option>
                {rooms.map((r) => (
                  <option key={r.room_id} value={r.room_id}>
                    {r.room_number} ({r.room_type.replace("_", " ").toLowerCase()}, floor {r.floor_no})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="c">Type of problem</label>
              <select id="c" required value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value, asset_id: "" }))}>
                <option value="">Choose a category</option>
                {meta.categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="a">Equipment (optional)</label>
              <select id="a" value={form.asset_id} disabled={!assets.length} onChange={set("asset_id")}>
                <option value="">{assets.length ? "Not sure / not listed" : "No registered equipment here"}</option>
                {assets.map((a) => (
                  <option key={a.asset_id} value={a.asset_id}>
                    {a.asset_name} ({a.asset_tag})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="t">Short title</label>
            <input id="t" type="text" required minLength={5} maxLength={150} placeholder="e.g. AC blowing warm air" value={form.title} onChange={set("title")} />
          </div>
          <div className="field">
            <label htmlFor="d">What is happening?</label>
            <textarea id="d" required minLength={10} maxLength={4000} placeholder="What you noticed, since when, and how it affects people." value={form.description} onChange={set("description")} />
          </div>
          <div className="field">
            <label>How serious is it?</label>
            <div className="sev" role="radiogroup">
              {SEVERITY.map((s) => (
                <button type="button" role="radio" aria-checked={Number(form.severity) === s.v} key={s.v} className={Number(form.severity) === s.v ? "on" : ""} onClick={() => setForm((f) => ({ ...f, severity: s.v }))}>
                  <strong>{s.v}</strong>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            <span className="hint">Use 5 only when people could get hurt (sparks, gas or chemical smell, someone stuck in a lift).</span>
          </div>
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="u">People affected (estimate)</label>
            <input id="u" type="number" min={1} max={5000} value={form.affected_users} onChange={set("affected_users")} />
          </div>
          <button className="btn signal" disabled={busy}>
            {busy ? "Submitting…" : "Submit report"}
          </button>
        </form>

        <aside className="stack">
          <section className="panel">
            <div className="panel-head">
              <h3>Already reported?</h3>
              {checking && (
                <span className="small muted">
                  <span className="pulse" />
                  Comparing meaning
                </span>
              )}
            </div>
            <div className="panel-body">
              {!similar && <p className="muted small">Start typing a title or description. Open incidents with a similar meaning nearby will show here.</p>}
              {similar && !dups.length && <p className="muted small">No open incident looks like this one. Go ahead and submit it.</p>}
              {dups.map((d) => (
                <div className="match" key={d.incident_id}>
                  <div className="match-head">
                    <Link className="match-title" href={`/incidents/${d.incident_id}`}>
                      #{d.incident_id} {d.title}
                    </Link>
                    <PriorityTag level={d.priority_level} />
                  </div>
                  <div className={"simbar" + (d.match_score >= 0.75 ? " hot" : "")}>
                    <i style={{ width: `${Math.min(100, d.match_score * 100)}%` }} />
                  </div>
                  <div className="small muted">
                    {(d.similarity * 100).toFixed(0)}% similar in meaning, {d.location_match.replace("_", " ").toLowerCase()} ({d.building_name} {d.room_number}). <Status value={d.status} />, {d.affected_users} affected.
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {d.confirmed ? (
                      <span className="chip good">You were added to this incident</span>
                    ) : (
                      <button className="btn small" type="button" onClick={() => confirm(d.incident_id)}>
                        I have this problem too
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>How it was fixed before</h3>
            </div>
            <div className="panel-body">
              {!fixes.length && <p className="muted small">Fixes from resolved incidents with a similar description will appear here.</p>}
              {fixes.map((h) => (
                <div className="match" key={h.incident_id}>
                  <div className="match-head">
                    <Link className="match-title" href={`/incidents/${h.incident_id}`}>
                      {h.title}
                    </Link>
                    <span className="small faint num">{(h.similarity * 100).toFixed(0)}%</span>
                  </div>
                  <div className="small muted">
                    {h.building_name} {h.room_number}, {fmt.date(h.reported_at)}
                  </div>
                  <div className="fix">{h.resolution_notes}</div>
                </div>
              ))}
              {similar?.timing && (
                <p className="small faint" style={{ marginTop: 10 }}>
                  Embedding {similar.timing.embedMs} ms, vector search {similar.timing.searchMs} ms (all-MiniLM-L6-v2, cosine similarity, HNSW index)
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
