"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/components/ui";

const DEMO = [
  ["student@resolvex.edu", "Aditya Rao", "Student / Staff"],
  ["tech@resolvex.edu", "Ravi Kumar", "Technician"],
  ["manager@resolvex.edu", "Arjun Mehta", "Facility Manager"],
  ["admin@resolvex.edu", "Kavya Raman", "Administrator"],
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e, override) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const creds = override || { email, password };
      const data = await api("/api/auth/login", { method: "POST", body: creds });
      const next = params.get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : data.home);
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2 style={{ fontSize: 30 }}>Sign in</h2>
      <p className="muted" style={{ margin: "6px 0 22px" }}>
        Use your campus account.
      </p>
      {error && <div className="notice err">{error}</div>}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button className="btn signal" style={{ width: "100%", justifyContent: "center", padding: "11px" }} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <div className="demo">
        <div className="small muted">Demo accounts (password Resolve@123)</div>
        <div className="demo-list">
          {DEMO.map(([em, name, role]) => (
            <button
              type="button"
              key={em}
              disabled={busy}
              onClick={() => {
                setEmail(em);
                setPassword("Resolve@123");
                submit(null, { email: em, password: "Resolve@123" });
              }}
            >
              <strong>{role}</strong>
              <span>{name}</span>
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login">
      <section className="login-art">
        <div>
          <div className="wordmark" style={{ color: "#fff" }}>
            Resolve<span style={{ color: "var(--signal)" }}>X</span>
          </div>
          <h1>Every broken thing on campus, tracked to the fix.</h1>
          <p>
            Report a fault in plain words. ResolveX recognises when others reported the same problem, ranks it by real
            urgency, sends the right technician and remembers how it was fixed last time.
          </p>
          <div className="ticket" aria-hidden="true">
            <span className="ptag P1">P1 Critical</span>
            <div className="t" style={{ marginTop: 10 }}>AC not cooling in Computer Lab 1</div>
            <div className="m">Engineering Labs Block B, room 301. Two people reported it; the fix is due in 5 hours.</div>
          </div>
        </div>
        <div className="small" style={{ color: "#8fa09b" }}>
          Built on PostgreSQL with pgvector and Next.js
        </div>
      </section>
      <section className="login-form">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </div>
  );
}
