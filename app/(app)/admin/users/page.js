"use client";
import { useState } from "react";
import { api, useApi, useToast, PageHead, Loading, ErrorNote, fmt } from "@/components/ui";

const ROLES = [
  ["STUDENT_STAFF", "Student / Staff"],
  ["TECHNICIAN", "Technician"],
  ["FACILITY_MANAGER", "Facility Manager"],
  ["ADMIN", "Administrator"],
];
const EMPTY = { full_name: "", email: "", password: "", role: "STUDENT_STAFF", phone: "", employee_code: "", hourly_rate: "", skills: [] };

export default function UsersPage() {
  const { data, error, reload } = useApi("/api/users");
  const { data: meta } = useApi("/api/meta");
  const [form, setForm] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [toast, notify] = useToast();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e) {
    e.preventDefault();
    setErr("");
    try {
      const d = await api("/api/users", { method: "POST", body: { ...form, skills: form.skills.map(Number) } });
      notify(d.message);
      setForm(EMPTY);
      setShow(false);
      reload();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function patch(u, body, msg) {
    try {
      await api(`/api/users/${u.user_id}`, { method: "PATCH", body });
      notify(msg);
      reload();
    } catch (e) {
      notify(e.message, true);
    }
  }

  const users = data?.users || [];

  return (
    <>
      {toast}
      <PageHead title="Users and roles" sub="Four roles control what each person can see and do. Passwords are stored only as bcrypt hashes; a CHECK constraint rejects anything that is not a hash.">
        <button className="btn signal" onClick={() => setShow((s) => !s)}>
          {show ? "Close" : "Add user"}
        </button>
      </PageHead>
      <ErrorNote error={error} />

      {show && (
        <form className="panel panel-body" style={{ marginBottom: 18 }} onSubmit={create}>
          {err && <div className="notice err">{err}</div>}
          <div className="row">
            <div className="field">
              <label>Full name</label>
              <input type="text" required value={form.full_name} onChange={set("full_name")} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" required value={form.email} onChange={set("email")} />
            </div>
            <div className="field">
              <label>Phone (optional)</label>
              <input type="text" pattern="[6-9][0-9]{9}" title="10-digit Indian mobile number" value={form.phone} onChange={set("phone")} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={set("role")}>
                {ROLES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Temporary password</label>
              <input type="password" required minLength={8} value={form.password} onChange={set("password")} autoComplete="new-password" />
              <span className="hint">8+ characters with upper and lower case, a digit and a symbol</span>
            </div>
          </div>
          {form.role === "TECHNICIAN" && (
            <div className="row">
              <div className="field">
                <label>Employee code</label>
                <input type="text" required placeholder="TECH008" value={form.employee_code} onChange={set("employee_code")} />
              </div>
              <div className="field">
                <label>Hourly rate (₹)</label>
                <input type="number" required min="1" value={form.hourly_rate} onChange={set("hourly_rate")} />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Skills</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                  {meta?.categories.map((c) => (
                    <label key={c.category_id} style={{ fontWeight: 400, fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={form.skills.includes(String(c.category_id))}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            skills: e.target.checked ? [...f.skills, String(c.category_id)] : f.skills.filter((x) => x !== String(c.category_id)),
                          }))
                        }
                      />{" "}
                      {c.category_name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <button className="btn">Create user</button>
        </form>
      )}

      {!data ? (
        <Loading />
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Details</th>
                  <th className="right">Reports</th>
                  <th>Joined</th>
                  <th>Account</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                    <td>
                      <strong style={{ fontWeight: 600 }}>{u.full_name}</strong>
                      <div className="small faint">{u.email}</div>
                    </td>
                    <td className="small">{ROLES.find((r) => r[0] === u.role_name)?.[1]}</td>
                    <td className="small">
                      {u.employee_code ? (
                        <>
                          <span className="tag-code">{u.employee_code}</span> {fmt.money(u.hourly_rate)}/h
                          <div className="faint">{u.skills}</div>
                        </>
                      ) : (
                        u.phone || <span className="faint">-</span>
                      )}
                    </td>
                    <td className="right num">{u.reported}</td>
                    <td className="small muted">{fmt.date(u.created_at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className={"btn small " + (u.is_active ? "danger" : "ghost")} onClick={() => patch(u, { is_active: !u.is_active }, u.is_active ? "Account deactivated" : "Account activated")}>
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
                      {u.employee_code && (
                        <button className="btn small ghost" style={{ marginLeft: 6 }} onClick={() => patch(u, { is_available: !u.is_available }, "Availability updated")}>
                          {u.is_available ? "Mark on leave" : "Mark available"}
                        </button>
                      )}
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
