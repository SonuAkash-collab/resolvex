"use client";
import { useState } from "react";
import { useApi, PageHead, Loading, ErrorNote, fmt } from "@/components/ui";

const show = (v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? fmt.dt(v) : String(v));

/** Shows only the fields that changed between the old and new JSONB snapshot. */
function Diff({ oldData, newData, op }) {
  if (op === "INSERT") return <span className="small muted">created</span>;
  if (op === "DELETE") return <span className="small muted">deleted</span>;
  const keys = Object.keys(newData || {}).filter((k) => JSON.stringify(newData[k]) !== JSON.stringify(oldData?.[k]));
  return (
    <span className="small">
      {keys.map((k) => (
        <div key={k}>
          <span className="faint">{k}:</span> {show(oldData?.[k])} <span className="faint">to</span> <strong style={{ fontWeight: 600 }}>{show(newData[k])}</strong>
        </div>
      ))}
    </span>
  );
}

export default function AuditPage() {
  const [table, setTable] = useState("");
  const { data, error } = useApi(`/api/audit${table ? `?table=${table}` : ""}`);
  return (
    <>
      <PageHead title="Audit log" sub="Every insert, update and delete on sensitive tables is recorded by a generic trigger with before and after snapshots (JSONB). The application role can only append to this table.">
        <select value={table} onChange={(e) => setTable(e.target.value)} style={{ width: "auto" }} aria-label="Table">
          <option value="">All tables</option>
          {(data?.tables || []).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </PageHead>
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : (
        <section className="panel">
          {!data.audit.length && <div className="empty">No changes recorded yet. Assign a technician or restock a part, then come back.</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Table</th>
                  <th>Operation</th>
                  <th>Row</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((a) => (
                  <tr key={a.audit_id}>
                    <td className="small" style={{ whiteSpace: "nowrap" }}>
                      {fmt.dt(a.changed_at)}
                    </td>
                    <td className="small">{a.changed_by}</td>
                    <td className="tag-code">{a.table_name}</td>
                    <td>
                      <span className={"chip " + (a.operation === "DELETE" ? "bad" : a.operation === "INSERT" ? "good" : "")}>{a.operation}</span>
                    </td>
                    <td className="num">{a.row_pk}</td>
                    <td>
                      <Diff oldData={a.old_data} newData={a.new_data} op={a.operation} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
