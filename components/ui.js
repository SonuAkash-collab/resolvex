"use client";
// Small shared UI pieces and the fetch helper used by every page.
import { useCallback, useEffect, useState } from "react";

/** Calls a ResolveX API route and returns parsed JSON (throws with the server's error text). */
export async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Loads data from an API route; returns { data, error, loading, reload }. */
export function useApi(url) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!url) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api(url);
      setState({ data, error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e.message, loading: false });
    }
  }, [url]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

/** Toast message for the result of an action. */
export function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.err ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? (
    <div className={"toast" + (toast.err ? " err" : "")} role="status">
      {toast.text}
    </div>
  ) : null;
  return [node, (text, err = false) => setToast({ text, err })];
}

export function PriorityTag({ level, score }) {
  if (!level) return <span className="faint">-</span>;
  const label = { P1: "P1 Critical", P2: "P2 High", P3: "P3 Medium", P4: "P4 Low" }[level];
  return (
    <span className={"ptag " + level} title={score != null ? `Priority score ${score} / 100` : undefined}>
      {label}
      {score != null && <span className="score">{Number(score).toFixed(0)}</span>}
    </span>
  );
}

export function Status({ value }) {
  if (!value) return null;
  return <span className={"status s-" + value}>{value.replace("_", " ").toLowerCase()}</span>;
}

export function Loading({ what = "Loading" }) {
  return <div className="empty">{what}…</div>;
}

export function ErrorNote({ error }) {
  return error ? <div className="notice err">{error}</div> : null;
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function RiskMeter({ score }) {
  const s = Number(score) || 0;
  const color = s >= 75 ? "var(--p1)" : s >= 50 ? "var(--p2)" : "var(--p4)";
  return (
    <span className="num">
      <span className="risk-meter">
        <i style={{ width: `${Math.min(100, s)}%`, background: color }} />
      </span>
      {s.toFixed(0)}
    </span>
  );
}

export function HBars({ items, format = (v) => v, highlightTop = true }) {
  const max = Math.max(1, ...items.map((i) => Number(i.value)));
  return (
    <div className="hbars">
      {items.map((it, idx) => (
        <div className={"hbar" + (highlightTop && idx === 0 ? " top" : "")} key={it.label}>
          <span title={it.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {it.label}
          </span>
          <span className="track">
            <i style={{ width: `${(Number(it.value) / max) * 100}%` }} />
          </span>
          <span className="val">{format(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

export const fmt = {
  date: (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"),
  dt: (d) =>
    d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-",
  ago(d) {
    if (!d) return "-";
    const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  },
  due(d) {
    if (!d) return "-";
    const past = new Date(d) < new Date(new Date().toDateString());
    return past ? <span className="overdue">due now (est. {fmt.date(d)})</span> : fmt.date(d);
  },
  money: (v) => "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
  sla(hoursLeft, overdue) {
    if (hoursLeft == null) return "-";
    const h = Number(hoursLeft);
    if (overdue || h < 0) return <span className="overdue">{Math.abs(h).toFixed(0)} h overdue</span>;
    if (h < 24) return `${h.toFixed(0)} h left`;
    return `${(h / 24).toFixed(1)} days left`;
  },
};

export const SEVERITY = [
  { v: 1, label: "Minor" },
  { v: 2, label: "Low" },
  { v: 3, label: "Moderate" },
  { v: 4, label: "Serious" },
  { v: 5, label: "Danger" },
];
