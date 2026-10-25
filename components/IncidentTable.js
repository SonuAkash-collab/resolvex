"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PriorityTag, Status, fmt } from "./ui";

/** Table of incidents (rows from v_incident_details). */
export default function IncidentTable({ rows, showReporter = false, showTech = true, empty = "No incidents to show." }) {
  const router = useRouter();
  if (!rows?.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Incident</th>
            <th>Priority</th>
            <th>Status</th>
            {showReporter && <th>Reported by</th>}
            {showTech && <th>Technician</th>}
            <th>Reported</th>
            <th>SLA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.incident_id} className="link-row" onClick={() => router.push(`/incidents/${r.incident_id}`)}>
              <td className="num faint">{r.incident_id}</td>
              <td className="title-cell">
                <Link href={`/incidents/${r.incident_id}`} onClick={(e) => e.stopPropagation()}>
                  {r.title}
                </Link>
                <div className="sub">
                  {r.building_name}, {r.room_number}
                  {r.asset_tag ? `, ${r.asset_tag}` : ""} ({r.category_name})
                  {r.co_reporters > 0 ? `, +${r.co_reporters} confirmed` : ""}
                </div>
              </td>
              <td>
                <PriorityTag level={r.priority_level} score={r.priority_score} />
              </td>
              <td>
                <Status value={r.status} />
              </td>
              {showReporter && <td>{r.reporter_name}</td>}
              {showTech && <td>{r.technician_name || <span className="faint">-</span>}</td>}
              <td className="small muted" style={{ whiteSpace: "nowrap" }}>
                {fmt.ago(r.reported_at)}
              </td>
              <td className="small" style={{ whiteSpace: "nowrap" }}>
                {["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(r.status) ? fmt.sla(r.sla_hours_left, r.is_overdue) : <span className="faint">-</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
