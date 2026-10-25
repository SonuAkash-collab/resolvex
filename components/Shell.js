"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./ui";

const ROLE_LABEL = {
  STUDENT_STAFF: "Student / Staff",
  TECHNICIAN: "Technician",
  FACILITY_MANAGER: "Facility Manager",
  ADMIN: "Administrator",
};

// Navigation per role: [group, [[href, label], ...]]
const NAV = {
  STUDENT_STAFF: [
    ["Reporting", [["/my", "My reports"], ["/report", "Report a problem"], ["/search", "Search past incidents"]]],
    ["Updates", [["/alerts", "Notifications"]]],
  ],
  TECHNICIAN: [
    ["My work", [["/work-orders", "Work orders"], ["/inventory", "Spare parts"]]],
    ["Incidents", [["/search", "Search past fixes"], ["/report", "Report a problem"], ["/alerts", "Notifications"]]],
  ],
  FACILITY_MANAGER: [
    ["Operations", [["/queue", "Priority queue"], ["/incidents", "All incidents"], ["/search", "Semantic search"]]],
    ["Planning", [["/analytics", "Analytics"], ["/reports", "Reports"], ["/assets", "Asset health"], ["/inventory", "Spare parts"]]],
    ["System", [["/vectors", "Vector store"], ["/nosql", "Document store"], ["/showcase", "DB showcase"], ["/alerts", "Notifications"]]],
  ],
  ADMIN: [
    ["Overview", [["/analytics", "Analytics"], ["/reports", "Reports"], ["/queue", "Priority queue"], ["/incidents", "All incidents"]]],
    ["Manage", [["/admin/users", "Users & roles"], ["/admin/campus", "Campus & SLA"], ["/assets", "Assets"], ["/inventory", "Spare parts"]]],
    ["System", [["/vectors", "Vector store"], ["/nosql", "Document store"], ["/admin/audit", "Audit log"], ["/showcase", "DB showcase"], ["/search", "Semantic search"], ["/alerts", "Notifications"]]],
  ],
};

export default function Shell({ user, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api("/api/auth/me")
      .then((d) => setUnread(d.unreadAlerts))
      .catch(() => {});
  }, [pathname]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <div className="wordmark">
            Resolve<span>X</span>
          </div>
          <div className="rail-sub">Campus infrastructure desk</div>
        </div>
        <nav aria-label="Main">
          {(NAV[user.role] || []).map(([group, links]) => (
            <div key={group}>
              <div className="nav-group">{group}</div>
              {links.map(([href, label]) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link key={href} href={href} className={"nav-link" + (active ? " active" : "")}>
                    {label}
                    {href === "/alerts" && unread > 0 && <span className="nav-count">{unread}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="rail-user">
          <strong>{user.name}</strong>
          {ROLE_LABEL[user.role]}
          <div>
            <button onClick={logout}>Log out</button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
