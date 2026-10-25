// =====================================================================
// ResolveX database test suite
// Every test runs inside its own transaction that is ROLLED BACK at the
// end, so the suite never changes the data. Results are printed and
// written to docs/TEST_RESULTS_DB.md for the project report.
// Usage:  npm run test:db      (run after npm run db:setup)
// =====================================================================
import fs from "node:fs";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const ADMIN_URL = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

// helper SQL: a fresh test incident (student 11, Computer Lab 1, AC asset 1)
const NEW_INCIDENT = `INSERT INTO incidents (title, description, reported_by, room_id, asset_id, category_id, severity, affected_users)
                      VALUES ('Test: AC fault', 'Automated test incident description', 11, 11, 1, 1, 3, 5) RETURNING *`;

const tests = [
  // ---------------------------------------------------------------- constraints
  { id: "T01", area: "CHECK constraint", name: "Invalid email format is rejected",
    run: (c) => c.query(`INSERT INTO users (full_name, email, password_hash, role_id) VALUES ('Bad Mail', 'not-an-email', '$2a$10$abcdefghijklmnopqrstuuJ5eY4Gm9qYc0r0n1w2x3y4z5A6B7C8D', 1)`),
    expectError: "chk_user_email_fmt" },
  { id: "T02", area: "CHECK constraint", name: "Plain-text password cannot be stored",
    run: (c) => c.query(`INSERT INTO users (full_name, email, password_hash, role_id) VALUES ('Plain Text', 'plain@resolvex.edu', 'password123', 1)`),
    expectError: "chk_password_is_hash" },
  { id: "T03", area: "UNIQUE constraint", name: "Duplicate email is rejected",
    run: (c) => c.query(`INSERT INTO users (full_name, email, password_hash, role_id) SELECT 'Copy', email, password_hash, 1 FROM users WHERE user_id = 11`),
    expectError: "unique" },
  { id: "T04", area: "CHECK constraint", name: "Severity outside 1-5 is rejected",
    run: (c) => c.query(NEW_INCIDENT.replace("1, 3, 5)", "1, 9, 5)")),
    expectError: "chk_severity" },
  { id: "T05", area: "CHECK constraint", name: "Spare part stock can never go negative",
    run: (c) => c.query(`UPDATE spare_parts SET quantity_in_stock = -1 WHERE part_id = 1`),
    expectError: "chk_part_stock" },
  { id: "T06", area: "Foreign key", name: "Incident in a non-existent room is rejected",
    run: (c) => c.query(NEW_INCIDENT.replace("11, 11, 1, 1", "11, 9999, NULL, 1")),
    expectError: "foreign key" },
  { id: "T07", area: "CHECK constraint", name: "Resolved time before reported time is rejected",
    run: (c) => c.query(`INSERT INTO incidents (title, description, reported_by, room_id, category_id, severity, status, reported_at, resolved_at)
                         VALUES ('Test: time travel', 'Resolved before it was reported', 11, 1, 2, 2, 'RESOLVED', now(), now() - interval '1 day')`),
    expectError: "chk_resolved_time" },
  { id: "T08", area: "Self-referencing FK", name: "Incident cannot be a duplicate of itself",
    run: async (c) => {
      const { rows } = await c.query(NEW_INCIDENT);
      await c.query(`UPDATE incidents SET status = 'DUPLICATE', duplicate_of = incident_id WHERE incident_id = $1`, [rows[0].incident_id]);
    },
    expectError: "chk_not_duplicate_of_self" },
  { id: "T09", area: "CHECK constraint", name: "Feedback rating only allowed after resolution",
    run: async (c) => {
      const { rows } = await c.query(NEW_INCIDENT);
      await c.query(`UPDATE incidents SET feedback_rating = 5 WHERE incident_id = $1`, [rows[0].incident_id]);
    },
    expectError: "chk_feedback_after_resolve" },
  { id: "T10", area: "Partial UNIQUE index", name: "Only one active work order per incident",
    run: async (c) => {
      const { rows } = await c.query(NEW_INCIDENT);
      await c.query(`INSERT INTO work_orders (incident_id, technician_id, assigned_by) VALUES ($1, 4, 2)`, [rows[0].incident_id]);
      await c.query(`INSERT INTO work_orders (incident_id, technician_id, assigned_by) VALUES ($1, 10, 2)`, [rows[0].incident_id]);
    },
    expectError: "uq_one_active_work_order" },

  // ---------------------------------------------------------------- triggers
  { id: "T11", area: "Trigger (validation)", name: "State machine blocks OPEN -> CLOSED",
    run: async (c) => {
      const { rows } = await c.query(NEW_INCIDENT);
      await c.query(`UPDATE incidents SET status = 'CLOSED' WHERE incident_id = $1`, [rows[0].incident_id]);
    },
    expectError: "Invalid status change" },
  { id: "T12", area: "Trigger (validation)", name: "Asset must be in the selected room",
    run: (c) => c.query(NEW_INCIDENT.replace("11, 11, 1, 1", "11, 1, 1, 1")),
    expectError: "is not located in the selected room" },
  { id: "T13", area: "Trigger (validation)", name: "Technician without the skill cannot be assigned",
    run: async (c) => {
      const { rows } = await c.query(NEW_INCIDENT);
      await c.query(`INSERT INTO work_orders (incident_id, technician_id, assigned_by) VALUES ($1, 6, 2)`, [rows[0].incident_id]);
    },
    expectError: "not skilled" },
  { id: "T14", area: "Trigger (validation)", name: "Technician job limit is enforced",
    run: async (c) => {
      await c.query(`UPDATE technicians SET max_concurrent_jobs = 1 WHERE technician_id = 4`);
      const a = await c.query(NEW_INCIDENT);
      const b = await c.query(NEW_INCIDENT);
      await c.query(`INSERT INTO work_orders (incident_id, technician_id, assigned_by) VALUES ($1, 4, 2)`, [a.rows[0].incident_id]);
      await c.query(`INSERT INTO work_orders (incident_id, technician_id, assigned_by) VALUES ($1, 4, 2)`, [b.rows[0].incident_id]);
    },
    expectError: "active jobs" },
  { id: "T15", area: "Trigger (automation)", name: "Priority score, level and SLA deadline set on insert",
    run: async (c) => (await c.query(NEW_INCIDENT)).rows[0],
    check: (r) => r.priority_score > 0 && /^P[1-4]$/.test(r.priority_level) && r.sla_due_at > r.reported_at,
    show: (r) => `score ${r.priority_score}, level ${r.priority_level}` },
  { id: "T16", area: "Trigger chain", name: "'Me too' raises affected users and recomputes priority",
    run: async (c) => {
      const inc = (await c.query(NEW_INCIDENT.replace("1, 3, 5)", "1, 3, 1)"))).rows[0];
      await c.query(`INSERT INTO incident_reporters (incident_id, user_id) VALUES ($1, 12), ($1, 13), ($1, 14)`, [inc.incident_id]);
      const after = (await c.query(`SELECT affected_users, priority_score FROM incidents WHERE incident_id = $1`, [inc.incident_id])).rows[0];
      return { before: inc, after };
    },
    check: (r) => r.after.affected_users === 4 && Number(r.after.priority_score) > Number(r.before.priority_score),
    show: (r) => `affected 1 -> ${r.after.affected_users}, score ${r.before.priority_score} -> ${r.after.priority_score}` },
  { id: "T16b", area: "Trigger chain (DELETE)", name: "Withdrawing a confirmation lowers affected users again",
    run: async (c) => {
      const inc = (await c.query(NEW_INCIDENT.replace("1, 3, 5)", "1, 3, 1)"))).rows[0];
      await c.query(`INSERT INTO incident_reporters (incident_id, user_id) VALUES ($1, 12), ($1, 13)`, [inc.incident_id]);
      await c.query(`DELETE FROM incident_reporters WHERE incident_id = $1 AND user_id = 13`, [inc.incident_id]);
      return (await c.query(`SELECT affected_users FROM incidents WHERE incident_id = $1`, [inc.incident_id])).rows[0].affected_users;
    },
    check: (n) => n === 2, show: (n) => `affected users 1 -> 3 -> ${n}` },
  { id: "T17", area: "Trigger (validation)", name: "Reporter cannot confirm their own incident",
    run: async (c) => {
      const inc = (await c.query(NEW_INCIDENT)).rows[0];
      await c.query(`INSERT INTO incident_reporters (incident_id, user_id) VALUES ($1, 11)`, [inc.incident_id]);
    },
    expectError: "already the original reporter" },
  { id: "T18", area: "Trigger (automation)", name: "Status change is written to history and notifies reporter",
    run: async (c) => {
      const inc = (await c.query(NEW_INCIDENT)).rows[0];
      await c.query(`UPDATE incidents SET status = 'CANCELLED' WHERE incident_id = $1`, [inc.incident_id]);
      const h = await c.query(`SELECT COUNT(*)::INT n FROM incident_status_history WHERE incident_id = $1`, [inc.incident_id]);
      const a = await c.query(`SELECT COUNT(*)::INT n FROM alerts WHERE incident_id = $1 AND alert_type = 'STATUS_CHANGE'`, [inc.incident_id]);
      return { history: h.rows[0].n, alerts: a.rows[0].n };
    },
    check: (r) => r.history === 2 && r.alerts === 1,
    show: (r) => `${r.history} history rows, ${r.alerts} alert` },
  { id: "T19", area: "Trigger (automation)", name: "Low-stock alert when stock crosses reorder level",
    run: async (c) => {
      await c.query(`UPDATE spare_parts SET quantity_in_stock = reorder_level WHERE part_id = 1`);
      return (await c.query(`SELECT COUNT(*)::INT n FROM alerts WHERE part_id = 1 AND alert_type = 'LOW_STOCK'`)).rows[0].n;
    },
    check: (n) => n >= 1, show: (n) => `${n} LOW_STOCK alert` },
  { id: "T20", area: "Trigger (audit)", name: "Updates are recorded in the audit log with the acting user",
    run: async (c) => {
      await c.query(`UPDATE spare_parts SET unit_cost = unit_cost + 1 WHERE part_id = 3`);
      return (await c.query(`SELECT changed_by, old_data->>'unit_cost' AS old, new_data->>'unit_cost' AS new FROM audit_log WHERE table_name = 'spare_parts' ORDER BY audit_id DESC LIMIT 1`)).rows[0];
    },
    check: (r) => r && r.changed_by === 1 && Number(r.new) === Number(r.old) + 1,
    show: (r) => `unit_cost ${r.old} -> ${r.new} by user ${r.changed_by}` },
  { id: "T21", area: "Trigger (validation)", name: "Decommissioned asset cannot receive new incidents",
    run: async (c) => {
      await c.query(`UPDATE assets SET status = 'DECOMMISSIONED' WHERE asset_id = 1`);
      await c.query(NEW_INCIDENT);
    },
    expectError: "decommissioned" },

  // ---------------------------------------------------------------- procedures and transactions
  { id: "T22", area: "Stored procedure", name: "sp_assign_technician picks a skilled technician with spare capacity",
    run: async (c) => {
      const inc = (await c.query(NEW_INCIDENT)).rows[0];
      const wo = (await c.query(`CALL sp_assign_technician($1, 2, NULL, NULL)`, [inc.incident_id])).rows[0].p_work_order_id;
      return (await c.query(`SELECT w.technician_id, i.status, EXISTS (SELECT 1 FROM technician_skills s WHERE s.technician_id = w.technician_id AND s.category_id = 1) AS skilled
                               FROM work_orders w JOIN incidents i ON i.incident_id = w.incident_id WHERE w.work_order_id = $1`, [wo])).rows[0];
    },
    check: (r) => r.skilled && r.status === "ASSIGNED", show: (r) => `technician ${r.technician_id}, incident ${r.status}` },
  { id: "T23", area: "Transaction (rollback)", name: "Completing with insufficient stock rolls back everything",
    run: async (c) => {
      const inc = (await c.query(NEW_INCIDENT)).rows[0];
      const wo = (await c.query(`CALL sp_assign_technician($1, 2, 4, NULL)`, [inc.incident_id])).rows[0].p_work_order_id;
      const before = (await c.query(`SELECT quantity_in_stock FROM spare_parts WHERE part_id = 1`)).rows[0].quantity_in_stock;
      await c.query("SAVEPOINT before_complete");
      let error = null;
      try {
        await c.query(`CALL sp_complete_work_order($1, 4, 2, 'Replaced compressor parts', '[{"part_id":1,"quantity":1},{"part_id":2,"quantity":500}]')`, [wo]);
      } catch (e) {
        error = e.message;
        await c.query("ROLLBACK TO SAVEPOINT before_complete");
      }
      const after = (await c.query(`SELECT quantity_in_stock FROM spare_parts WHERE part_id = 1`)).rows[0].quantity_in_stock;
      const status = (await c.query(`SELECT status FROM work_orders WHERE work_order_id = $1`, [wo])).rows[0].status;
      return { error, before, after, status };
    },
    check: (r) => r.error?.includes("Insufficient stock") && r.before === r.after && r.status === "ASSIGNED",
    show: (r) => `error raised, part 1 stock stayed ${r.after}, work order still ${r.status}` },
  { id: "T24", area: "Transaction (commit)", name: "sp_complete_work_order updates stock, cost, incident and asset together",
    run: async (c) => {
      const inc = (await c.query(NEW_INCIDENT)).rows[0];
      const wo = (await c.query(`CALL sp_assign_technician($1, 2, 4, NULL)`, [inc.incident_id])).rows[0].p_work_order_id;
      const before = (await c.query(`SELECT quantity_in_stock FROM spare_parts WHERE part_id = 3`)).rows[0].quantity_in_stock;
      await c.query(`CALL sp_complete_work_order($1, 4, 2, 'Cleaned coil and replaced filters', '[{"part_id":3,"quantity":2}]')`, [wo]);
      return (await c.query(
        `SELECT (SELECT quantity_in_stock FROM spare_parts WHERE part_id = 3) AS stock, $2::INT AS before,
                i.status, i.resolved_at IS NOT NULL AS resolved, a.status AS asset_status,
                m.labour_cost, m.parts_cost, m.total_cost
           FROM incidents i JOIN assets a ON a.asset_id = i.asset_id
           JOIN maintenance_records m ON m.work_order_id = $3
          WHERE i.incident_id = $1`, [inc.incident_id, before, wo])).rows[0];
    },
    check: (r) => r.stock === r.before - 2 && r.status === "RESOLVED" && r.resolved && r.asset_status === "OPERATIONAL" &&
                  Number(r.total_cost) === Number(r.labour_cost) + Number(r.parts_cost) && Number(r.parts_cost) === 500,
    show: (r) => `stock ${r.before} -> ${r.stock}, incident ${r.status}, cost ${r.labour_cost} + ${r.parts_cost} = ${r.total_cost}` },
  { id: "T25", area: "Stored procedure + recursive CTE", name: "sp_mark_duplicate merges into the root original",
    run: async (c) => {
      const a = (await c.query(NEW_INCIDENT)).rows[0];
      const b = (await c.query(NEW_INCIDENT.replace("VALUES ('Test: AC fault', 'Automated test incident description', 11", "VALUES ('Test: AC fault 2', 'Automated test incident description', 12"))).rows[0];
      await c.query(`CALL sp_mark_duplicate($1, $2, 2)`, [b.incident_id, a.incident_id]);
      return (await c.query(`SELECT d.status, d.duplicate_of = $2 AS linked, o.affected_users AS orig_affected
                               FROM incidents d, incidents o WHERE d.incident_id = $1 AND o.incident_id = $2`, [b.incident_id, a.incident_id])).rows[0];
    },
    check: (r) => r.status === "DUPLICATE" && r.linked && r.orig_affected === 6,
    show: (r) => `duplicate linked, original affected users 5 -> ${r.orig_affected}` },
  { id: "T26", area: "Stored procedure", name: "sp_restock_part rejects invalid quantity",
    run: (c) => c.query(`CALL sp_restock_part(1, 0)`), expectError: "between 1 and 10000" },
  { id: "T27", area: "Stored procedure", name: "SLA escalation raises priority of overdue incidents",
    run: async (c) => {
      const before = (await c.query(`SELECT incident_id, priority_score FROM incidents WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD') AND sla_due_at < now() ORDER BY incident_id LIMIT 1`)).rows[0];
      const n = (await c.query(`CALL sp_escalate_overdue(NULL)`)).rows[0].p_escalated;
      const after = before ? (await c.query(`SELECT priority_score, escalation_level FROM incidents WHERE incident_id = $1`, [before.incident_id])).rows[0] : null;
      return { n, before, after };
    },
    check: (r) => r.n >= 1 && r.after.escalation_level >= 1 && Number(r.after.priority_score) >= Number(r.before.priority_score),
    show: (r) => `${r.n} escalated; #${r.before.incident_id} score ${r.before.priority_score} -> ${r.after.priority_score}` },

  // ---------------------------------------------------------------- vector / full-text
  { id: "T28", area: "Vector similarity (pgvector)", name: "Nearest neighbours of an AC incident are AC incidents",
    run: async (c) => {
      const src = (await c.query(`SELECT i.incident_id FROM incidents i JOIN incident_embeddings e USING (incident_id) WHERE i.title ILIKE 'AC blowing warm air%' LIMIT 1`)).rows[0];
      const rows = (await c.query(`SELECT s.category_name, s.similarity FROM incident_embeddings e, LATERAL fn_similar_incidents(e.embedding, 5, 0.3, e.incident_id) s WHERE e.incident_id = $1`, [src.incident_id])).rows;
      return rows;
    },
    check: (rows) => rows.length === 5 && rows.every((r) => r.category_name.startsWith("HVAC")),
    show: (rows) => `top-5 all HVAC, similarity ${rows[0].similarity} .. ${rows[4].similarity}` },
  { id: "T29", area: "Full-text search", name: "websearch_to_tsquery finds 'geyser' incidents via GIN index",
    run: async (c) => (await c.query(`SELECT COUNT(*)::INT n FROM incidents WHERE search_vector @@ websearch_to_tsquery('english', 'geyser')`)).rows[0].n,
    check: (n) => n > 0, show: (n) => `${n} matches` },
  { id: "T29b", area: "Foreign key (ON DELETE)", name: "A spare part used in repairs cannot be deleted",
    run: (c) => c.query(`DELETE FROM spare_parts WHERE part_id = (SELECT part_id FROM work_order_parts LIMIT 1)`),
    expectError: "violates foreign key" },
  { id: "T30", area: "Generated column", name: "total_cost is always labour_cost + parts_cost",
    run: async (c) => (await c.query(`SELECT COUNT(*)::INT n FROM maintenance_records WHERE total_cost <> labour_cost + parts_cost`)).rows[0].n,
    check: (n) => n === 0, show: () => "0 inconsistent rows" },

  // ---------------------------------------------------------------- security (run as the application role)
  { id: "T31", area: "Security (GRANT/REVOKE)", name: "Application role cannot delete the audit trail", app: true,
    run: (c) => c.query(`DELETE FROM audit_log`), expectError: "permission denied" },
  { id: "T32", area: "Security (GRANT/REVOKE)", name: "Application role cannot drop tables", app: true,
    run: (c) => c.query(`DROP TABLE alerts`), expectError: "must be owner" },
  { id: "T33", area: "Security (GRANT/REVOKE)", name: "Application role cannot edit the state machine", app: true,
    run: (c) => c.query(`INSERT INTO incident_status_transitions VALUES ('CLOSED','OPEN')`), expectError: "permission denied" },
  { id: "T34", area: "Security (SECURITY DEFINER)", name: "Application role can refresh stats only through the definer function", app: true,
    run: async (c) => (await c.query(`SELECT fn_refresh_monthly_stats()`)).rowCount, check: (n) => n === 1, show: () => "refreshed" },
  { id: "T35", area: "Security", name: "Read-only transaction blocks writes (used by the showcase page)", app: true,
    run: async (c) => {
      await c.query("SET TRANSACTION READ ONLY");
      await c.query(`UPDATE spare_parts SET quantity_in_stock = 0`);
    },
    expectError: "read-only transaction" },

  // ---------------------------------------------------------------- RBAC in the database (Row-Level Security)
  // these run as the web app's restricted login; "as" = app.current_user_id of the request
  // users: 1 admin, 2 manager, 4 technician (Ravi), 7 technician (Priya), 11 student, 12 student, 21 deactivated
  { id: "T36", area: "RLS", name: "Without a logged-in user the app role sees no rows", app: true, as: "",
    run: async (c) => (await c.query("SELECT COUNT(*)::INT n FROM incidents")).rows[0].n,
    check: (n) => n === 0, show: (n) => `${n} incidents visible` },
  { id: "T37", area: "RLS", name: "A student sees only their own notifications", app: true, as: 11,
    run: async (c) => {
      const own = (await c.query("SELECT COUNT(*)::INT n FROM alerts")).rows[0].n;
      const others = (await c.query("SELECT COUNT(*)::INT n FROM alerts WHERE target_user_id IS DISTINCT FROM 11 AND target_role IS DISTINCT FROM 'STUDENT_STAFF'")).rows[0].n;
      await c.query("SELECT set_config('app.current_user_id', '1', true)");
      const all = (await c.query("SELECT COUNT(*)::INT n FROM alerts")).rows[0].n;
      return { own, others, all };
    },
    check: (r) => r.others === 0 && r.all > r.own, show: (r) => `student sees ${r.own}, other people's: ${r.others}; admin sees ${r.all}` },
  { id: "T38", area: "RLS", name: "A student cannot file a report in someone else's name", app: true, as: 11,
    run: (c) => c.query("INSERT INTO incidents (title, description, reported_by, room_id, category_id, severity) VALUES ('Fake report', 'Pretending to be user 12', 12, 1, 2, 2)"),
    expectError: "row-level security" },
  { id: "T39", area: "RLS", name: "A student cannot change another person's incident", app: true, as: 11,
    run: async (c) => (await c.query("UPDATE incidents SET severity = 1 WHERE reported_by <> 11")).rowCount,
    check: (n) => n === 0, show: (n) => `${n} rows changed` },
  { id: "T40", area: "RLS", name: "A technician cannot update another technician's work order", app: true, as: 4,
    run: async (c) => (await c.query("UPDATE work_orders SET labour_hours = 9 WHERE technician_id <> 4")).rowCount,
    check: (n) => n === 0, show: (n) => `${n} rows changed` },
  { id: "T41", area: "RLS", name: "Only an admin can create buildings", app: true, as: 2,
    run: (c) => c.query("INSERT INTO buildings (building_code, building_name, building_type, total_floors) VALUES ('ZZ', 'Manager building', 'LAB', 1)"),
    expectError: "row-level security" },
  { id: "T42", area: "RLS", name: "Only an admin can read the audit log", app: true, as: 2,
    run: async (c) => {
      await c.query("CALL sp_restock_part(3, 5)");                                   // creates an audit row
      const mgr = (await c.query("SELECT COUNT(*)::INT n FROM audit_log")).rows[0].n;
      await c.query("SELECT set_config('app.current_user_id', '1', true)");
      const adm = (await c.query("SELECT COUNT(*)::INT n FROM audit_log")).rows[0].n;
      return { mgr, adm };
    },
    check: (r) => r.mgr === 0 && r.adm > 0, show: (r) => `manager sees ${r.mgr}, admin sees ${r.adm}` },
  { id: "T43", area: "RLS", name: "A deactivated user loses all database access at once", app: true, as: 21,
    run: async (c) => (await c.query("SELECT COUNT(*)::INT n FROM incidents")).rows[0].n,
    check: (n) => n === 0, show: (n) => `${n} incidents visible` },
  { id: "T44", area: "Column privilege", name: "The app role cannot read password hashes", app: true, as: 1,
    run: (c) => c.query("SELECT password_hash FROM users LIMIT 1"),
    expectError: "permission denied" },
  { id: "T45", area: "RLS (vector)", name: "Only an admin can delete vectors", app: true, as: 11,
    run: async (c) => (await c.query("DELETE FROM incident_embeddings")).rowCount,
    check: (n) => n === 0, show: (n) => `${n} vectors deleted by a student` },
  { id: "T46", area: "RLS (vector)", name: "Only the reporter (or a manager) may re-embed an incident's vector", app: true, as: 11,
    run: async (c) => {
      const own = (await c.query("UPDATE incident_embeddings SET embedded_at = now() WHERE incident_id = 167")).rowCount;
      await c.query("SELECT set_config('app.current_user_id', '12', true)");
      const other = (await c.query("UPDATE incident_embeddings SET embedded_at = now() WHERE incident_id = 167")).rowCount;
      return { own, other };
    },
    check: (r) => r.own === 1 && r.other === 0, show: (r) => `reporter updated ${r.own}, another student ${r.other}` },
  { id: "T47", area: "RLS + procedures", name: "Assignment and completion still work under RLS for the right roles", app: true, as: 2,
    run: async (c) => {
      const wo = (await c.query("CALL sp_assign_technician(158, 2, 6, NULL)")).rows[0].p_work_order_id;   // benches -> Suresh
      await c.query("SELECT set_config('app.current_user_id', '6', true)");                               // act as Suresh
      await c.query("CALL sp_complete_work_order($1, 6, 1.5, 'Repaired bench joints and planks', '[]')", [wo]);
      return (await c.query("SELECT status FROM incidents WHERE incident_id = 158")).rows[0].status;
    },
    check: (s) => s === "RESOLVED", show: (s) => `manager assigned, technician completed, incident ${s}` },

  // ---------------------------------------------------------------- vector store RUD
  { id: "T48", area: "Vector READ", name: "Every vector has 384 dimensions and unit length",
    run: async (c) => (await c.query("SELECT COUNT(*) FILTER (WHERE vector_dims(embedding) <> 384 OR abs(vector_norm(embedding) - 1) > 0.001)::INT bad, COUNT(*)::INT n FROM incident_embeddings")).rows[0],
    check: (r) => r.bad === 0 && r.n > 0, show: (r) => `${r.n} vectors, ${r.bad} malformed` },
  { id: "T49", area: "Vector UPDATE", name: "Changed text is detected as STALE and becomes FRESH after re-embedding",
    run: async (c) => {
      await c.query("UPDATE incidents SET description = 'The AC in the lab is making a loud noise and leaking water' WHERE incident_id = 168");
      const before = (await c.query("SELECT vector_status FROM v_embedding_status WHERE incident_id = 168")).rows[0].vector_status;
      await c.query(`UPDATE incident_embeddings e
                        SET embedding = (SELECT embedding FROM incident_embeddings WHERE incident_id = 160),
                            source_text = concat_ws('. ', i.title, i.description, c.category_name), embedded_at = now()
                       FROM incidents i JOIN asset_categories c ON c.category_id = i.category_id
                      WHERE i.incident_id = e.incident_id AND e.incident_id = 168`);
      const after = (await c.query("SELECT vector_status FROM v_embedding_status WHERE incident_id = 168")).rows[0].vector_status;
      return { before, after };
    },
    check: (r) => r.before === "STALE" && r.after === "FRESH", show: (r) => `${r.before} -> ${r.after}` },
  { id: "T50", area: "Vector DELETE", name: "A deleted vector drops out of similarity search; the incident stays",
    run: async (c) => {
      const q = "SELECT COUNT(*)::INT n FROM incident_embeddings e, LATERAL fn_similar_incidents(e.embedding, 20, 0.0, e.incident_id) s WHERE e.incident_id = 119 AND s.incident_id = 97";
      const before = (await c.query(q)).rows[0].n;
      await c.query("DELETE FROM incident_embeddings WHERE incident_id = 97");
      const after = (await c.query(q)).rows[0].n;
      const status = (await c.query("SELECT vector_status FROM v_embedding_status WHERE incident_id = 97")).rows[0].vector_status;
      const stillThere = (await c.query("SELECT COUNT(*)::INT n FROM incidents WHERE incident_id = 97")).rows[0].n;
      return { before, after, status, stillThere };
    },
    check: (r) => r.before === 1 && r.after === 0 && r.status === "MISSING" && r.stillThere === 1,
    show: (r) => `found before ${r.before}, after ${r.after}; status ${r.status}; incident kept` },
  { id: "T51", area: "Vector DELETE (cascade)", name: "Deleting an incident deletes its vector (ON DELETE CASCADE)",
    run: async (c) => {
      const inc = (await c.query(NEW_INCIDENT)).rows[0].incident_id;
      await c.query("INSERT INTO incident_embeddings (incident_id, embedding, source_text) SELECT $1, embedding, 'copy' FROM incident_embeddings WHERE incident_id = 168", [inc]);
      await c.query("DELETE FROM incidents WHERE incident_id = $1", [inc]);
      return (await c.query("SELECT COUNT(*)::INT n FROM incident_embeddings WHERE incident_id = $1", [inc])).rows[0].n;
    },
    check: (n) => n === 0, show: (n) => `${n} orphan vectors` },
];

async function main() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  const app = new pg.Client({ connectionString: APP_URL });
  await admin.connect();
  await app.connect();
  const results = [];

  for (const t of tests) {
    const c = t.app ? app : admin;
    let pass = false;
    let detail = "";
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [String(t.as ?? 1)]);
    try {
      const out = await t.run(c);
      if (t.expectError !== undefined) {
        detail = "expected an error but the statement succeeded";
      } else {
        pass = !!t.check(out);
        detail = t.show ? t.show(out) : "";
      }
    } catch (e) {
      if (t.expectError !== undefined) {
        const msg = `${e.message} ${e.constraint || ""}`;
        pass = msg.toLowerCase().includes(t.expectError.toLowerCase());
        detail = `rejected: ${e.message}${e.constraint && !e.message.includes(e.constraint) ? ` (${e.constraint})` : ""}`;
      } else {
        detail = "unexpected error: " + e.message;
      }
    } finally {
      await c.query("ROLLBACK");
    }
    results.push({ ...t, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${t.id}  ${t.name}\n        ${detail}`);
  }
  await admin.end();
  await app.end();

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} tests passed`);

  const md = [
    "# Database test results",
    "",
    `Run on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC with \`npm run test:db\`. Every test runs in its own transaction and is rolled back.`,
    "",
    `**${passed} of ${results.length} passed.**`,
    "",
    "| ID | Area | Test case | Expected | Result | Detail |",
    "|----|------|-----------|----------|--------|--------|",
    ...results.map((r) =>
      `| ${r.id} | ${r.area} | ${r.name} | ${r.expectError !== undefined ? "Rejected by database" : "Succeeds with correct effect"} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail.replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 160)} |`
    ),
    "",
  ].join("\n");
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/TEST_RESULTS_DB.md", md);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
