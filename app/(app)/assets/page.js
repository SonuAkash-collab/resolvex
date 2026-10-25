"use client";
import { useMemo, useState } from "react";
import { api, useApi, useToast, PageHead, Loading, ErrorNote, RiskMeter, Status, fmt } from "@/components/ui";

const EMPTY = { asset_tag: "", asset_name: "", category_id: "", building_id: "", room_id: "", manufacturer: "", install_date: "", criticality: 3 };

export default function AssetsPage() {
  const { data, error, reload } = useApi("/api/assets");
  const { data: meta } = useApi("/api/meta");
  const { data: me } = useApi("/api/auth/me");
  const [band, setBand] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [toast, notify] = useToast();
  const isAdmin = me?.user.role === "ADMIN";

  const rooms = useMemo(() => (meta?.rooms || []).filter((r) => String(r.building_id) === String(form.building_id)), [meta, form.building_id]);
  const list = (data?.assets || []).filter((a) => !band || a.risk_band === band);
  const counts = (data?.assets || []).reduce((m, a) => ((m[a.risk_band] = (m[a.risk_band] || 0) + 1), m), {});

  async function save(e) {
    e.preventDefault();
    try {
      const d = await api("/api/assets", { method: "POST", body: form });
      notify(d.message);
      setForm(EMPTY);
      setShowForm(false);
      reload();
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function decommission(a) {
    try {
      const d = await api(`/api/assets/${a.asset_id}`, { method: "PATCH", body: { status: "DECOMMISSIONED" } });
      notify(d.message);
      reload();
    } catch (err) {
      notify(err.message, true);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      {toast}
      <PageHead
        title="Asset health"
        sub="Predictive maintenance from database history: failures in the last 180 days, time since last service, age and criticality give a risk score; the average gap between failures (LAG window function) estimates the next one."
      >
        <div className="seg">
          {[["", `All (${data?.assets.length ?? 0})`], ["HIGH", `High (${counts.HIGH || 0})`], ["MEDIUM", `Medium (${counts.MEDIUM || 0})`], ["LOW", `Low (${counts.LOW || 0})`]].map(([b, l]) => (
            <button key={b} className={band === b ? "on" : ""} onClick={() => setBand(b)}>
              {l}
            </button>
          ))}
        </div>
        {isAdmin && (
          <button className="btn signal" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Close" : "Register asset"}
          </button>
        )}
      </PageHead>
      <ErrorNote error={error} />

      {showForm && meta && (
        <form className="panel panel-body" style={{ marginBottom: 18 }} onSubmit={save}>
          <div className="row">
            <div className="field">
              <label>Asset tag</label>
              <input type="text" required placeholder="AC-LABB-003" value={form.asset_tag} onChange={set("asset_tag")} />
              <span className="hint">Format AAA-XXXX-000 (checked by a CHECK constraint)</span>
            </div>
            <div className="field">
              <label>Name</label>
              <input type="text" required value={form.asset_name} onChange={set("asset_name")} />
            </div>
            <div className="field">
              <label>Category</label>
              <select required value={form.category_id} onChange={set("category_id")}>
                <option value="">Choose</option>
                {meta.categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Building</label>
              <select required value={form.building_id} onChange={set("building_id")}>
                <option value="">Choose</option>
                {meta.buildings.map((b) => (
                  <option key={b.building_id} value={b.building_id}>
                    {b.building_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Room</label>
              <select required value={form.room_id} onChange={set("room_id")}>
                <option value="">Choose</option>
                {rooms.map((r) => (
                  <option key={r.room_id} value={r.room_id}>
                    {r.room_number}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Manufacturer</label>
              <input type="text" value={form.manufacturer} onChange={set("manufacturer")} />
            </div>
            <div className="field">
              <label>Installed on</label>
              <input type="date" required value={form.install_date} onChange={set("install_date")} />
            </div>
            <div className="field">
              <label>Criticality (1-5)</label>
              <input type="number" min="1" max="5" value={form.criticality} onChange={set("criticality")} />
            </div>
          </div>
          <button className="btn">Save asset</button>
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
                  <th>Asset</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th className="right">Failures 180 d</th>
                  <th className="right">Days since service</th>
                  <th className="right">MTBF</th>
                  <th>Next failure (est.)</th>
                  <th className="right">Maintenance cost</th>
                  <th>Risk</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.asset_id}>
                    <td>
                      <strong style={{ fontWeight: 600 }}>{a.asset_name}</strong>
                      <div className="small faint">
                        <span className="tag-code">{a.asset_tag}</span> {a.category_name}, criticality {a.criticality}
                      </div>
                    </td>
                    <td className="small">
                      {a.building_name}, {a.room_number}
                    </td>
                    <td>
                      <Status value={a.status} />
                    </td>
                    <td className="right num">{a.failures_180d}</td>
                    <td className="right num">
                      <span className={a.days_since_maintenance > a.maintenance_interval_days ? "overdue" : ""}>{a.days_since_maintenance}</span>
                      <span className="faint"> / {a.maintenance_interval_days}</span>
                    </td>
                    <td className="right num">{a.mtbf_days ? `${Math.round(a.mtbf_days)} d` : "-"}</td>
                    <td className="small">{fmt.due(a.predicted_next_failure)}</td>
                    <td className="right num">{fmt.money(a.maintenance_cost)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <RiskMeter score={a.risk_score} />
                    </td>
                    {isAdmin && (
                      <td>
                        <button className="btn small danger" onClick={() => decommission(a)}>
                          Decommission
                        </button>
                      </td>
                    )}
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
