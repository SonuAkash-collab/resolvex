"use client";
import Link from "next/link";
import { useApi, PageHead, Loading, ErrorNote } from "@/components/ui";
import IncidentTable from "@/components/IncidentTable";

export default function MyReportsPage() {
  const { data, error } = useApi("/api/incidents?mine=1&sort=recent");
  const rows = data?.incidents || [];
  const active = rows.filter((r) => ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(r.status));
  const awaiting = rows.filter((r) => r.status === "RESOLVED");
  const done = rows.filter((r) => !["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "RESOLVED"].includes(r.status));

  return (
    <>
      <PageHead title="My reports" sub="Problems you reported or confirmed, and where each one stands.">
        <Link className="btn signal" href="/report">
          Report a problem
        </Link>
      </PageHead>
      <ErrorNote error={error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="stack">
          {awaiting.length > 0 && (
            <div className="notice info">
              {awaiting.length === 1 ? "One of your incidents is" : `${awaiting.length} of your incidents are`} marked resolved. Open each one to confirm the fix
              and close it, or reopen it if the problem is back.
            </div>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>In progress</h2>
              <span className="small muted">{active.length}</span>
            </div>
            <IncidentTable rows={active} empty="Nothing open right now." />
          </section>
          {awaiting.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>Waiting for your confirmation</h2>
              </div>
              <IncidentTable rows={awaiting} />
            </section>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>History</h2>
              <span className="small muted">{done.length}</span>
            </div>
            <IncidentTable rows={done} showTech={false} empty="No closed reports yet." />
          </section>
        </div>
      )}
    </>
  );
}
