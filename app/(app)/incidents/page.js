"use client";
import { useState } from "react";
import { useApi, PageHead, Loading, ErrorNote } from "@/components/ui";
import IncidentTable from "@/components/IncidentTable";

export default function IncidentsPage() {
  const { data: meta } = useApi("/api/meta");
  const [f, setF] = useState({ status: "", priority: "", building: "", category: "", q: "", sort: "recent" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error, loading } = useApi(`/api/incidents?${qs}&limit=200`);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <>
      <PageHead title="All incidents" sub="Filter by status, priority, building or category. Results come from the v_incident_details view." />
      <div className="filters">
        <input type="search" placeholder="Title or description contains…" value={f.q} onChange={set("q")} aria-label="Text filter" />
        <select value={f.status} onChange={set("status")} aria-label="Status">
          <option value="">Any status</option>
          <option value="ACTIVE">Active (not resolved)</option>
          {["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "DUPLICATE", "CANCELLED"].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select value={f.priority} onChange={set("priority")} aria-label="Priority">
          <option value="">Any priority</option>
          {["P1", "P2", "P3", "P4"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={f.building} onChange={set("building")} aria-label="Building">
          <option value="">All buildings</option>
          {meta?.buildings.map((b) => (
            <option key={b.building_id} value={b.building_id}>
              {b.building_name}
            </option>
          ))}
        </select>
        <select value={f.category} onChange={set("category")} aria-label="Category">
          <option value="">All categories</option>
          {meta?.categories.map((c) => (
            <option key={c.category_id} value={c.category_id}>
              {c.category_name}
            </option>
          ))}
        </select>
        <select value={f.sort} onChange={set("sort")} aria-label="Sort">
          <option value="recent">Newest first</option>
          <option value="priority">Highest priority</option>
          <option value="sla">Earliest deadline</option>
        </select>
      </div>
      <ErrorNote error={error} />
      <section className="panel">
        <div className="panel-head">
          <h2>{data ? `${data.incidents.length} incidents` : "Incidents"}</h2>
          {loading && <span className="small muted">Updating…</span>}
        </div>
        {!data ? <Loading /> : <IncidentTable rows={data.incidents} showReporter />}
      </section>
    </>
  );
}
