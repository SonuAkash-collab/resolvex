# Demo guide and viva preparation

## Before the demo (5 minutes)
1. `docker compose up -d` (or start PostgreSQL), then `npm run db:setup` for fresh data. Deadlines are relative to now, so they look realistic.
2. `npm run build && npm start`, or `npm run dev`. Open http://localhost:3000.
3. Keep open in tabs: this guide, `docs/diagrams/er_diagram.png`, a `psql` session on the database, and the GitHub repository's contributors page.

## Demo flow (about 14 minutes; follows section 16 of the brief and the 50-mark rubric)

| Min | Brief item | What to show | Who |
|---|---|---|---|
| 0-1 | Problem and motivation | Login page: complaints arrive by phone and paper, so nobody can track, prioritise or spot repeat failures. ResolveX fixes that with database-driven reasoning. | M1 |
| 1-3 | ER diagram, design, relational schema | ER diagram: weak entities (ROOM, history, embedding), ISA (technician), M:N (skills, parts used, confirmations), recursive DUPLICATE_OF. Then the schema diagram and how each construct mapped to tables. Why two paradigms (DATABASE_DESIGN §1). | M2 |
| 3-5 | Vector database (student role) | Log in as **Student** (Aditya), go to **Report a problem**: Engineering Labs Block B, room 301, HVAC, title "Lab is very hot", description "AC blowing warm air". The panel finds incident #168 "AC not cooling" with no shared words, then the past fixes. Click **I have this problem too**: the toast shows affected users and priority score rising (trigger chain). **Search** "room is too hot" and switch Hybrid / Meaning only / Exact words. | M1 |
| 5-7 | Advanced SQL: functions, triggers, procedures (manager role) | Log in as **Manager**, **Priority queue**. Open #168, **Why this priority** panel (`fn_priority_breakdown`). Re-classify severity and watch the score and deadline change (trigger). **Auto-assign** (`sp_assign_technician`, row locks). **Escalate SLA breaches** (`sp_escalate_overdue`). | M1 |
| 5-6 | Vector RUD (7 marks) | Still as the student: open your own open report (#167 "Library Wi-Fi extremely slow" from **My reports**), **Edit title and description**, then **Save and re-embed**. The Vector line shows *fresh* (UPDATE). Log in as **Admin**, **Vector store**: **View** #168 shows the stored numbers and nearest neighbours (READ). **Delete** its vector: it becomes *missing* and drops out of semantic search (DELETE). **Create missing** brings it back (CREATE). | M1 |
| 7-9 | Transactions (technician role) | Log in as **Technician**, **Work orders**, **Complete**. Add a part with quantity 99: "Transaction rolled back, nothing was saved". Set quantity 1 and complete: stock deducted, cost recorded, incident resolved, asset back to operational, reporter notified, all in one transaction. | M2 |
| 9-10 | Views, analytics, predictive maintenance | **Analytics** (views + materialized view), **Asset health**: risk score, MTBF from the `LAG()` window function, predicted next failure. **Plan preventive maintenance** (procedure). | M2 |
| 10-11 | Reports, important queries, integration | **Reports**: average resolution time per category, cost per building, technician performance (like "average salary per department"); change the period, **Download CSV**, **Show the SQL**. **DB showcase**: q02 (GROUP BY / HAVING), q06 (RANK window), q09 (recursive CTE), q15 (EXPLAIN shows the index), q19-q21 (catalog). Admin **Audit log**: who changed what (trigger). | M2 |
| 11-13 | RBAC in the database (4 marks) | **DB showcase** q22 lists the 65 Row-Level Security policies. In psql run section 10 of `database/10_viva_live_demo.sql`: as the app role with no user you see 0 incidents; as student 11 you cannot update others' incidents (UPDATE 0) or create a building (RLS error); the audit log is empty for non-admins; deactivated user 21 sees nothing. | M2 |
| 13-14 | Security, test cases, contribution | `npm run test:db` (53 pass) and `npm run test:api` (28 pass) in the terminal. `.env.example` shows no hard-coded secrets. GitHub contributors graph. | both |

## Likely viva questions

**The lab mail says RDBMS + NoSQL. Is pgvector really a second database?**
The brief allows "SQL + Vector Database" (Option 2) and names "PostgreSQL with pgvector" as an example. The rubric says "NoSQL/Vector". pgvector adds a different data model with its own type (`vector(384)`), its own index structure (HNSW graph, not a B-tree) and its own query style (nearest-neighbour by cosine distance, not equality). Keeping it in the same engine is a design choice: similarity results join with relational data in one query, and the incident and its vector are saved in one ACID transaction. If the examiner insists on a separate product, say that the vector table could move to Qdrant or Pinecone, but you would lose those joins and that atomicity.

**What is Row-Level Security and why do you need it if the website already checks roles?**
RLS policies are rules attached to a table that PostgreSQL applies to every query. That is defence in depth: even if the website had a bug, or someone used the app's database password in psql, a student still could not change another person's incident and a technician could not touch another technician's job. The role is looked up inside the database from `users` (`fn_current_app_role`), not taken from the browser.

**How does the database know who is logged in when the app uses one database user?**
Each request runs inside a transaction that first executes `SELECT set_config('app.current_user_id', '<id>', true)`. The `true` makes it local to that transaction, so it cannot leak to another request. The policies call `fn_current_app_user()` and `fn_current_app_role()`.

**Show update and delete on your vector data.**
Update: edit your own open report and save. The text and its embedding are updated in one transaction, and the Vector line shows *fresh*. A text change made in plain SQL shows as *stale* on the Vector store page until it is re-embedded. Delete: as admin, Vector store, **Delete**. The incident stays but is no longer found by meaning. Only an admin may delete vectors, which an RLS policy enforces.

**Why PostgreSQL + pgvector rather than MongoDB?**
Our unstructured data is free text whose meaning must be compared, which is a vector-similarity problem, not a flexible-document problem. pgvector keeps the vectors next to the relational data, so one SQL query returns similarity, location, status and the past fix. With a separate store we would need two systems and application-side joins.

**What is an embedding, and why cosine?**
An embedding is a list of 384 numbers that represents the meaning of a sentence. Similar meanings point in similar directions. Cosine compares direction and ignores length. Our vectors are normalised, so cosine equals the dot product. `<=>` is cosine distance, and similarity = 1 − distance.

**What does the HNSW index do?**
It builds a layered graph of the vectors, so the nearest neighbours are found by walking the graph instead of comparing against every row. It is approximate but much faster as data grows. `m = 16` is the number of links per node and `ef_construction = 64` is the build-time candidate list.

**Show a transaction and what happens on failure.**
`sp_complete_work_order` locks the work order and each part (`FOR UPDATE`), deducts stock, inserts usage and a maintenance record, and completes the order, and triggers then resolve the incident. Any exception (for example insufficient stock) rolls back every statement. `withTransaction()` in `lib/db.js` issues BEGIN / COMMIT / ROLLBACK.

**Why are priority_level and sla_due_at stored if they can be derived?**
This is deliberate, controlled redundancy. The deadline promised at report time must not change when an admin edits the SLA policy later, and the column is indexed for overdue queries. A trigger keeps the values consistent, so they cannot drift.

**Which normal form are your tables in? Give an example.**
3NF / BCNF. `incidents` stores `room_id`, not `building_id`: building depends on room, so storing it would be a transitive dependency. The skills of a technician are a separate table (1NF) instead of a list.

**Trigger vs CHECK constraint: when do you use which?**
A CHECK can only look at the row being written (severity 1-5, stock ≥ 0). Rules that need other tables use triggers: the asset must be in the selected room, the technician must have the skill, only legal status transitions are allowed.

**How do you stop two managers assigning the same incident at once?**
`sp_assign_technician` locks the incident row with `SELECT ... FOR UPDATE` and accepts only OPEN incidents. The partial unique index `uq_one_active_work_order` also makes a second active work order impossible.

**How are passwords stored?**
As bcrypt hashes (cost 10) created by `bcryptjs`; the seed uses pgcrypto `crypt(..., gen_salt('bf'))`. A CHECK constraint rejects any value that is not a bcrypt hash, so a plain-text password cannot be stored even by mistake. Sessions are signed JWTs in httpOnly cookies.

**How do you prevent SQL injection?**
All queries use placeholders (`$1, $2`); user input never becomes SQL text. Test A13 tries `' OR '1'='1' --` at login and A14 puts `DROP TABLE` in the search box. Neither works.

**What can the web app's database user NOT do?**
It cannot run DDL, cannot update or delete the audit log or status history, and cannot change roles or the state machine (`07_security.sql`). Refreshing the materialized view is allowed only through a SECURITY DEFINER function.

**Explain the priority formula.**
Severity ×6 (max 30), people affected on a log scale (max 15), asset criticality ×4 (max 20), building importance ×3 (max 15), repeat failures in 90 days ×2.5 (max 10), category urgency (max 10), and +10 per SLA escalation, capped at 100. Severity 5 is never below 70. The score maps to P1-P4 thresholds in `sla_policies`, which sets the deadline.

**How is "predicted next failure" computed?**
`v_asset_health` uses `LAG(reported_at) OVER (PARTITION BY asset_id ORDER BY reported_at)` to get the gap between consecutive failures. It averages those gaps (MTBF) and adds the MTBF to the last failure date.

**What is Reciprocal Rank Fusion?**
It merges two ranked lists by adding 1/(60 + rank) from each. Items ranked well by both semantic and keyword search rise to the top. It needs no tuning of score scales.

**What happens if the embedding service is down when a report is submitted?**
The embedding is computed before the transaction starts. If it fails, the API returns an error and nothing is inserted. An incident is never stored without its vector, because both inserts are in one transaction. `npm run db:embed` can backfill any rows that lack a vector.
