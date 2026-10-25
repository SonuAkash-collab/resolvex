"use client";
import Link from "next/link";
import { api, useApi, PageHead, Loading, ErrorNote, fmt } from "@/components/ui";

const LEVEL = { CRITICAL: "bad", WARNING: "warn", INFO: "" };
const TYPE = {
  LOW_STOCK: "Low stock",
  SLA_BREACH: "SLA breach",
  STATUS_CHANGE: "Status change",
  ASSIGNMENT: "New assignment",
  HIGH_RISK_ASSET: "High-risk asset",
  DUPLICATE: "Merged report",
};

export default function AlertsPage() {
  const { data, error, reload } = useApi("/api/alerts");
  const alerts = data?.alerts || [];
  const unread = alerts.filter((a) => !a.is_read).length;

  async function markAll() {
    await api("/api/alerts", { method: "POST", body: {} });
    reload();
  }

  async function clearRead() {
    await api("/api/alerts", { method: "DELETE" });
    reload();
  }

  return (
    <>
      <PageHead title="Notifications" sub="Created automatically by database triggers and procedures: status changes, assignments, low stock, SLA breaches and risk warnings.">
        {unread > 0 && (
          <button className="btn ghost" onClick={markAll}>
            Mark all {unread} as read
          </button>
        )}
        {alerts.length > unread && (
          <button className="btn ghost" onClick={clearRead}>
            Delete read notifications
          </button>
        )}
      </PageHead>
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : (
        <section className="panel">
          {!alerts.length && <div className="empty">No notifications yet.</div>}
          <div className="table-wrap">
            <table>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.alert_id} style={{ fontWeight: a.is_read ? 400 : 600 }}>
                    <td style={{ width: 150 }}>
                      <span className={"chip " + LEVEL[a.alert_level]}>{TYPE[a.alert_type]}</span>
                    </td>
                    <td>
                      {a.message}
                      {a.incident_id && (
                        <>
                          {" "}
                          <Link href={`/incidents/${a.incident_id}`} className="small">
                            Open incident #{a.incident_id}
                          </Link>
                        </>
                      )}
                    </td>
                    <td className="small muted" style={{ whiteSpace: "nowrap", width: 120 }}>
                      {fmt.ago(a.created_at)}
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
