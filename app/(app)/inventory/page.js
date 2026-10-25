"use client";
import { useState } from "react";
import { api, useApi, useToast, PageHead, Loading, ErrorNote, fmt } from "@/components/ui";

export default function InventoryPage() {
  const { data, error, reload } = useApi("/api/parts");
  const { data: me } = useApi("/api/auth/me");
  const { data: meta } = useApi("/api/meta");
  const [qty, setQty] = useState({});
  const [toast, notify] = useToast();
  const [form, setForm] = useState(null);
  const canRestock = ["ADMIN", "FACILITY_MANAGER"].includes(me?.user.role);
  const isAdmin = me?.user.role === "ADMIN";

  async function restock(p) {
    try {
      const d = await api(`/api/parts/${p.part_id}/restock`, { method: "POST", body: { quantity: Number(qty[p.part_id] || 0) } });
      notify(`${p.part_name}: ${d.message}`);
      setQty((q) => ({ ...q, [p.part_id]: "" }));
      reload();
    } catch (e) {
      notify(e.message, true);
    }
  }

  async function removePart(p) {
    try {
      const d = await api(`/api/parts/${p.part_id}`, { method: "DELETE" });
      notify(d.message);
      reload();
    } catch (e) {
      notify(e.message, true);
    }
  }

  async function addPart(e) {
    e.preventDefault();
    try {
      const d = await api("/api/parts", { method: "POST", body: form });
      notify(d.message);
      setForm(null);
      reload();
    } catch (err) {
      notify(err.message, true);
    }
  }

  const parts = data?.parts || [];
  const low = parts.filter((p) => p.low_stock).length;
  const value = parts.reduce((s, p) => s + p.quantity_in_stock * p.unit_cost, 0);

  return (
    <>
      {toast}
      <PageHead title="Spare parts" sub="Stock is deducted only inside the work order completion transaction; a CHECK constraint stops it from ever going below zero and a trigger raises a low-stock alert.">
        {isAdmin && (
          <button className="btn signal" onClick={() => setForm(form ? null : { part_code: "", part_name: "", category_id: "", unit_cost: "", quantity_in_stock: 0, reorder_level: 5 })}>
            {form ? "Close" : "Add part"}
          </button>
        )}
      </PageHead>
      <ErrorNote error={error} />
      <div className="kpis">
        <div className="kpi">
          <div className="v num">{parts.length}</div>
          <div className="l">Part types</div>
        </div>
        <div className={"kpi" + (low ? " alert" : "")}>
          <div className="v num">{low}</div>
          <div className="l">At or below reorder level</div>
        </div>
        <div className="kpi">
          <div className="v num">{fmt.money(value)}</div>
          <div className="l">Stock value</div>
        </div>
      </div>

      {form && meta && (
        <form className="panel panel-body" style={{ marginBottom: 18 }} onSubmit={addPart}>
          <div className="row">
            {[
              ["part_code", "Part code", "text"],
              ["part_name", "Name", "text"],
              ["unit_cost", "Unit cost (₹)", "number"],
              ["quantity_in_stock", "Opening stock", "number"],
              ["reorder_level", "Reorder level", "number"],
            ].map(([k, label, type]) => (
              <div className="field" key={k}>
                <label>{label}</label>
                <input type={type} step="any" required value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
            <div className="field">
              <label>Category</label>
              <select required value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                <option value="">Choose</option>
                {meta.categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn">Save part</button>
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
                  <th>Part</th>
                  <th>Category</th>
                  <th className="right">Unit cost</th>
                  <th className="right">In stock</th>
                  <th className="right">Used (30 d / total)</th>
                  {canRestock && <th className="right">Restock</th>}
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.part_id}>
                    <td>
                      {p.part_name}
                      <div className="small faint tag-code">{p.part_code}</div>
                    </td>
                    <td className="small">{p.category_name}</td>
                    <td className="right num">{fmt.money(p.unit_cost)}</td>
                    <td className="right num">
                      {p.low_stock ? (
                        <span className={"chip " + (p.quantity_in_stock === 0 ? "bad" : "warn")}>
                          {p.quantity_in_stock} (reorder at {p.reorder_level})
                        </span>
                      ) : (
                        p.quantity_in_stock
                      )}
                    </td>
                    <td className="right num">
                      {p.used_30d} / {p.used_total}
                    </td>
                    {canRestock && (
                      <td className="right" style={{ whiteSpace: "nowrap" }}>
                        <input type="number" min="1" placeholder="Qty" aria-label={`Restock quantity for ${p.part_name}`} value={qty[p.part_id] || ""} onChange={(e) => setQty((q) => ({ ...q, [p.part_id]: e.target.value }))} style={{ width: 80, padding: "5px 8px", marginRight: 6 }} />
                        <button className="btn small ghost" disabled={!qty[p.part_id]} onClick={() => restock(p)}>
                          Add
                        </button>
                        {isAdmin && (
                          <button className="btn small danger" style={{ marginLeft: 6 }} title={p.used_total ? "Used in repairs: the foreign key will refuse the delete" : "Remove this part"} onClick={() => removePart(p)}>
                            Delete
                          </button>
                        )}
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
