"use client";
import { useState } from "react";
import { api, useApi, useToast, PageHead, Loading, ErrorNote, PriorityTag } from "@/components/ui";

const BTYPES = ["ACADEMIC", "LAB", "HOSTEL", "LIBRARY", "ADMIN", "AUDITORIUM", "CAFETERIA", "SPORTS"];
const RTYPES = ["CLASSROOM", "LAB", "OFFICE", "HOSTEL_ROOM", "WASHROOM", "CORRIDOR", "HALL", "SERVER_ROOM", "KITCHEN", "READING_ROOM"];

export default function CampusPage() {
  const { data, error, reload } = useApi("/api/campus");
  const [toast, notify] = useToast();
  const [b, setB] = useState({ building_code: "", building_name: "", building_type: "ACADEMIC", importance_level: 3, total_floors: 3 });
  const [r, setR] = useState({ building_id: "", room_number: "", floor_no: 0, room_type: "CLASSROOM", capacity: 0 });
  const [sla, setSla] = useState({});

  async function post(body, after) {
    try {
      const d = await api("/api/campus", { method: "POST", body });
      notify(d.message);
      after?.();
      reload();
    } catch (e) {
      notify(e.message, true);
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      {toast}
      <PageHead title="Campus and SLA policy" sub="Buildings, rooms and the service-level targets that turn a priority score into a deadline." />
      <div className="grid split">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h3>Buildings</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Building</th>
                    <th>Type</th>
                    <th className="right">Importance</th>
                    <th className="right">Rooms</th>
                    <th className="right">Assets</th>
                    <th className="right">Active incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buildings.map((x) => (
                    <tr key={x.building_id}>
                      <td>
                        {x.building_name} <span className="tag-code">{x.building_code}</span>
                      </td>
                      <td className="small">{x.building_type.toLowerCase()}</td>
                      <td className="right num">{x.importance_level} / 5</td>
                      <td className="right num">{x.rooms}</td>
                      <td className="right num">{x.assets}</td>
                      <td className="right num">{x.active_incidents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h3>SLA policy</h3>
              <span className="small muted">changes are written to the audit log by a trigger</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th className="right">Score from</th>
                    <th className="right">Respond within (h)</th>
                    <th className="right">Resolve within (h)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.sla.map((s) => {
                    const e = sla[s.priority_level] || {};
                    return (
                      <tr key={s.priority_level}>
                        <td>
                          <PriorityTag level={s.priority_level} />
                        </td>
                        <td className="right num">{Number(s.min_score)}</td>
                        <td className="right">
                          <input type="number" min="1" style={{ width: 90 }} aria-label="Response hours" value={e.response_hours ?? s.response_hours} onChange={(ev) => setSla((m) => ({ ...m, [s.priority_level]: { ...e, response_hours: ev.target.value } }))} />
                        </td>
                        <td className="right">
                          <input type="number" min="1" style={{ width: 90 }} aria-label="Resolution hours" value={e.resolution_hours ?? s.resolution_hours} onChange={(ev) => setSla((m) => ({ ...m, [s.priority_level]: { ...e, resolution_hours: ev.target.value } }))} />
                        </td>
                        <td className="right">
                          <button
                            className="btn small ghost"
                            disabled={!sla[s.priority_level]}
                            onClick={() =>
                              post(
                                { type: "sla", priority_level: s.priority_level, response_hours: Number(e.response_hours ?? s.response_hours), resolution_hours: Number(e.resolution_hours ?? s.resolution_hours) },
                                () => setSla((m) => ({ ...m, [s.priority_level]: undefined }))
                              )
                            }
                          >
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="small muted panel-body">A CHECK constraint requires the resolution target to be at least the response target.</p>
          </section>
        </div>
        <div className="stack">
          <form
            className="panel panel-body"
            onSubmit={(e) => {
              e.preventDefault();
              post({ type: "building", ...b, importance_level: Number(b.importance_level), total_floors: Number(b.total_floors) });
            }}
          >
            <h3 style={{ marginBottom: 12 }}>Add building</h3>
            <div className="row">
              <div className="field">
                <label>Code</label>
                <input type="text" required value={b.building_code} onChange={(e) => setB({ ...b, building_code: e.target.value })} />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={b.building_type} onChange={(e) => setB({ ...b, building_type: e.target.value })}>
                  {BTYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Name</label>
              <input type="text" required value={b.building_name} onChange={(e) => setB({ ...b, building_name: e.target.value })} />
            </div>
            <div className="row">
              <div className="field">
                <label>Importance (1-5)</label>
                <input type="number" min="1" max="5" value={b.importance_level} onChange={(e) => setB({ ...b, importance_level: e.target.value })} />
              </div>
              <div className="field">
                <label>Floors</label>
                <input type="number" min="1" max="30" value={b.total_floors} onChange={(e) => setB({ ...b, total_floors: e.target.value })} />
              </div>
            </div>
            <button className="btn">Add building</button>
          </form>
          <form
            className="panel panel-body"
            onSubmit={(e) => {
              e.preventDefault();
              post({ type: "room", ...r, building_id: Number(r.building_id), floor_no: Number(r.floor_no), capacity: Number(r.capacity) });
            }}
          >
            <h3 style={{ marginBottom: 12 }}>Add room</h3>
            <div className="field">
              <label>Building</label>
              <select required value={r.building_id} onChange={(e) => setR({ ...r, building_id: e.target.value })}>
                <option value="">Choose</option>
                {data.buildings.map((x) => (
                  <option key={x.building_id} value={x.building_id}>
                    {x.building_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <div className="field">
                <label>Room number</label>
                <input type="text" required value={r.room_number} onChange={(e) => setR({ ...r, room_number: e.target.value })} />
              </div>
              <div className="field">
                <label>Floor</label>
                <input type="number" min="0" max="30" value={r.floor_no} onChange={(e) => setR({ ...r, floor_no: e.target.value })} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Type</label>
                <select value={r.room_type} onChange={(e) => setR({ ...r, room_type: e.target.value })}>
                  {RTYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Capacity</label>
                <input type="number" min="0" value={r.capacity} onChange={(e) => setR({ ...r, capacity: e.target.value })} />
              </div>
            </div>
            <button className="btn">Add room</button>
          </form>
        </div>
      </div>
    </>
  );
}
