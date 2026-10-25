// =====================================================================
// ResolveX API / security test suite (authentication, role based access,
// validation, SQL-injection resistance). Requires the app to be running.
// Usage:  npm run test:api            (default http://localhost:3000)
//         BASE_URL=http://host:port npm run test:api
// Results are written to docs/TEST_RESULTS_API.md
// =====================================================================
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PW = "Resolve@123";

async function call(path, { method = "GET", body, cookie, redirect = "manual" } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

async function login(email, password = PW) {
  const r = await call("/api/auth/login", { method: "POST", body: { email, password } });
  const setCookie = r.headers.get("set-cookie") || "";
  return { ...r, cookie: setCookie.split(";")[0], setCookie };
}

const results = [];
async function test(id, area, name, fn) {
  let pass = false;
  let detail = "";
  try {
    const out = await fn();
    pass = out.pass;
    detail = out.detail;
  } catch (e) {
    detail = "error: " + e.message;
  }
  results.push({ id, area, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}\n        ${detail}`);
}

async function main() {
  const student = await login("student@resolvex.edu");
  const tech = await login("tech@resolvex.edu");
  const manager = await login("manager@resolvex.edu");
  const admin = await login("admin@resolvex.edu");

  await test("A01", "Authentication", "Wrong password is refused", async () => {
    const r = await login("staff@resolvex.edu", "wrong-password");
    return { pass: r.status === 401, detail: `HTTP ${r.status}: ${r.json?.error}` };
  });
  await test("A02", "Authentication", "Session cookie is httpOnly and SameSite", async () => ({
    pass: student.status === 200 && /HttpOnly/i.test(student.setCookie) && /SameSite=lax/i.test(student.setCookie),
    detail: student.setCookie.replace(/rx_session=[^;]+/, "rx_session=<jwt>"),
  }));
  await test("A03", "Authentication", "API without a session returns 401", async () => {
    const r = await call("/api/incidents");
    return { pass: r.status === 401, detail: `HTTP ${r.status}` };
  });
  await test("A04", "Authentication", "Tampered JWT is rejected", async () => {
    const forged = student.cookie.slice(0, -4) + "AAAA";
    const r = await call("/api/auth/me", { cookie: forged });
    return { pass: r.status === 401, detail: `HTTP ${r.status}` };
  });
  await test("A05", "Authentication", "Deactivated account cannot log in", async () => {
    const r = await login("nikhil.jain@resolvex.edu");
    return { pass: r.status === 403, detail: `HTTP ${r.status}: ${r.json?.error}` };
  });

  await test("A06", "Authorisation (RBAC)", "Student cannot list users (admin only)", async () => {
    const r = await call("/api/users", { cookie: student.cookie });
    return { pass: r.status === 403, detail: `HTTP ${r.status}` };
  });
  await test("A07", "Authorisation (RBAC)", "Student cannot assign technicians", async () => {
    const r = await call("/api/incidents/1/assign", { method: "POST", body: {}, cookie: student.cookie });
    return { pass: r.status === 403, detail: `HTTP ${r.status}` };
  });
  await test("A08", "Authorisation (RBAC)", "Technician cannot open analytics", async () => {
    const r = await call("/api/analytics", { cookie: tech.cookie });
    return { pass: r.status === 403, detail: `HTTP ${r.status}` };
  });
  await test("A09", "Authorisation (RBAC)", "Facility manager can open analytics", async () => {
    const r = await call("/api/analytics", { cookie: manager.cookie });
    return { pass: r.status === 200 && r.json.kpi, detail: `HTTP ${r.status}, ${r.json?.kpi?.active} active incidents` };
  });
  await test("A10", "Authorisation (RBAC)", "Manager cannot create users", async () => {
    const r = await call("/api/users", { method: "POST", cookie: manager.cookie, body: { full_name: "X Y Z", email: "x@resolvex.edu", password: "Aa1!aaaa", role: "ADMIN" } });
    return { pass: r.status === 403, detail: `HTTP ${r.status}` };
  });
  await test("A11", "Authorisation (pages)", "Student opening /queue is redirected to /my", async () => {
    const r = await call("/queue", { cookie: student.cookie });
    return { pass: [307, 308].includes(r.status) && r.headers.get("location").endsWith("/my"), detail: `HTTP ${r.status} -> ${r.headers.get("location")}` };
  });
  await test("A12", "Data protection", "User list never exposes password hashes", async () => {
    const r = await call("/api/users", { cookie: admin.cookie });
    const leaked = JSON.stringify(r.json).includes("$2a$") || JSON.stringify(r.json).includes("password_hash");
    return { pass: r.status === 200 && !leaked, detail: `${r.json?.users?.length} users returned, no hash fields` };
  });

  await test("A13", "SQL injection", "Injection in login email does not bypass authentication", async () => {
    const r = await login("' OR '1'='1' --", "anything");
    return { pass: r.status === 401, detail: `HTTP ${r.status}` };
  });
  await test("A14", "SQL injection", "Injection text in search is treated as plain data", async () => {
    const r = await call(`/api/search?mode=keyword&q=${encodeURIComponent("x'; DROP TABLE incidents; --")}`, { cookie: student.cookie });
    const still = await call("/api/incidents?limit=1", { cookie: student.cookie });
    return { pass: r.status === 200 && still.status === 200 && still.json.incidents.length === 1, detail: `search HTTP ${r.status}, incidents table intact` };
  });

  await test("A15", "Validation", "Too-short title is rejected by the API", async () => {
    const r = await call("/api/incidents", { method: "POST", cookie: student.cookie, body: { title: "AC", description: "short", room_id: 11, category_id: 1, severity: 3 } });
    return { pass: r.status === 400, detail: `HTTP ${r.status}: ${r.json?.error}` };
  });
  await test("A16", "Validation", "Weak password is rejected when creating a user", async () => {
    const r = await call("/api/users", { method: "POST", cookie: admin.cookie, body: { full_name: "Test User", email: "weak@resolvex.edu", password: "password", role: "STUDENT_STAFF" } });
    return { pass: r.status === 400, detail: `HTTP ${r.status}: ${r.json?.error}` };
  });
  await test("A17", "Validation (database)", "Database trigger error is returned as a clear message", async () => {
    const r = await call("/api/incidents", { method: "POST", cookie: student.cookie, body: { title: "Projector issue", description: "Testing a wrong asset and room pair", room_id: 1, asset_id: 23, category_id: 6, severity: 2 } });
    return { pass: r.status === 400 && /not located in the selected room/.test(r.json?.error), detail: `HTTP ${r.status}: ${r.json?.error}` };
  });

  let createdId = null;
  await test("A18", "Functional", "Student reports an incident; priority and SLA are computed", async () => {
    const r = await call("/api/incidents", {
      method: "POST",
      cookie: student.cookie,
      body: { title: "Water leaking from AC", description: "Water is dripping from the AC unit onto the computers in the lab.", room_id: 12, asset_id: 2, category_id: 1, severity: 3, affected_users: 20 },
    });
    createdId = r.json?.incident?.incident_id;
    return { pass: r.status === 201 && /^P[1-4]$/.test(r.json.incident.priority_level), detail: `HTTP ${r.status}, #${createdId} ${r.json?.incident?.priority_level} score ${r.json?.incident?.priority_score}` };
  });
  await test("A19", "Functional (vector)", "Similar-report check finds the new incident as a duplicate", async () => {
    const r = await call("/api/incidents/similar", { method: "POST", cookie: tech.cookie, body: { title: "AC dripping water", description: "AC unit is leaking water on the desks in lab 2", room_id: 12, asset_id: 2, category_id: 1 } });
    const hit = r.json?.duplicates?.find((d) => d.incident_id === createdId);
    return { pass: !!hit, detail: hit ? `#${hit.incident_id} similarity ${hit.similarity}, match ${hit.match_score} (${hit.location_match})` : JSON.stringify(r.json).slice(0, 120) };
  });
  await test("A20", "Functional", "Reporter withdraws the test incident (cleanup)", async () => {
    const r = await call(`/api/incidents/${createdId}`, { method: "PATCH", cookie: student.cookie, body: { action: "cancel" } });
    return { pass: r.status === 200 && r.json.incident.status === "CANCELLED", detail: `HTTP ${r.status}, status ${r.json?.incident?.status}` };
  });
  await test("A21", "Authorisation (RBAC)", "Student cannot run showcase queries", async () => {
    const r = await call("/api/showcase?id=q01", { cookie: student.cookie });
    return { pass: r.status === 403, detail: `HTTP ${r.status}` };
  });
  await test("A23", "Integrity (DELETE)", "Deleting a spare part used in repairs is refused", async () => {
    const r = await call("/api/parts/1", { method: "DELETE", cookie: admin.cookie });
    return { pass: r.status === 400 && /still refer/.test(r.json?.error), detail: `HTTP ${r.status}: ${r.json?.error}` };
  });
  await test("A24", "Vector DELETE + CREATE", "Admin deletes a vector: it leaves semantic search; create-missing restores it", async () => {
    const find = async () =>
      (await call(`/api/search?mode=semantic&q=${encodeURIComponent("AC not cooling in Computer Lab 1")}`, { cookie: student.cookie })).json.results.some((r) => r.incident_id === 168);
    const before = await find();
    const del = await call("/api/vectors/168", { method: "DELETE", cookie: admin.cookie });
    const gone = !(await find());
    const add = await call("/api/vectors", { method: "POST", cookie: admin.cookie, body: { action: "create-missing" } });
    const back = await find();
    return { pass: before && del.status === 200 && gone && add.status === 200 && back, detail: `found ${before}, deleted ${del.status}, gone ${gone}, recreated ${add.status}, found again ${back}` };
  });
  await test("A25", "Vector RBAC", "Facility manager cannot delete vectors; student cannot read the vector store", async () => {
    const d = await call("/api/vectors/168", { method: "DELETE", cookie: manager.cookie });
    const r = await call("/api/vectors", { cookie: student.cookie });
    return { pass: d.status === 403 && r.status === 403, detail: `manager delete HTTP ${d.status}, student read HTTP ${r.status}` };
  });
  await test("A26", "Vector UPDATE", "Reporter edits their open report; text and vector are updated together", async () => {
    const text = "Internet in the library reading hall is extremely slow and drops every few minutes.";
    const r = await call("/api/incidents/167", { method: "PATCH", cookie: student.cookie, body: { action: "edit", title: "Library Wi-Fi extremely slow", description: text } });
    const v = await call("/api/vectors?id=167", { cookie: manager.cookie });
    return { pass: r.status === 200 && v.json.vector.vector_status === "FRESH" && v.json.vector.source_text.includes(text), detail: `HTTP ${r.status}, vector ${v.json?.vector?.vector_status}` };
  });
  await test("A27", "Vector UPDATE RBAC", "Another student cannot edit someone else's report", async () => {
    const other = await login("meghana.reddy@resolvex.edu");
    const r = await call("/api/incidents/167", { method: "PATCH", cookie: other.cookie, body: { action: "edit", title: "Changed by someone else", description: "This should never be saved" } });
    return { pass: r.status === 403, detail: `HTTP ${r.status}` };
  });
  await test("A28", "Reports", "All 8 management reports run for every period", async () => {
    const list = (await call("/api/reports", { cookie: manager.cookie })).json.reports;
    let rows = 0;
    for (const rep of list) for (const d of ["", "&days=30"]) {
      const r = await call(`/api/reports?id=${rep.id}${d}`, { cookie: manager.cookie });
      if (r.status !== 200) return { pass: false, detail: `${rep.id}${d}: HTTP ${r.status} ${r.json?.error}` };
      rows += r.json.rows.length;
    }
    return { pass: list.length === 8 && rows > 0, detail: `${list.length} reports, ${rows} rows in total` };
  });
  await test("A22", "Brute-force protection", "Sixth wrong password in a row is throttled", async () => {
    let last;
    for (let i = 0; i < 6; i++) last = await login("sunil.patil@resolvex.edu", "nope" + i);
    return { pass: last.status === 429, detail: `HTTP ${last.status}: ${last.json?.error}` };
  });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  const md = [
    "# API and security test results",
    "",
    `Run on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC with \`npm run test:api\` against ${BASE}.`,
    "",
    `**${passed} of ${results.length} passed.**`,
    "",
    "| ID | Area | Test case | Result | Detail |",
    "|----|------|-----------|--------|--------|",
    ...results.map((r) => `| ${r.id} | ${r.area} | ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${String(r.detail).replace(/\|/g, "/").slice(0, 160)} |`),
    "",
  ].join("\n");
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/TEST_RESULTS_API.md", md);
  process.exit(passed === results.length ? 0 : 1);
}

main();
