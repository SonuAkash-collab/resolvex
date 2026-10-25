# Demo guide and viva preparation

## Before the demo (5 minutes)
1. `docker compose up -d` (starts PostgreSQL and MongoDB), then `npm run db:setup` for fresh data in both. Deadlines are relative to now, so they look realistic.
2. `npm run build && npm start`, or `npm run dev`. Open http://localhost:3000.
3. Keep open in tabs: this guide, `docs/diagrams/er_diagram.png`, `docs/diagrams/document_model.png`, a `psql` session, a MongoDB shell (`docker exec -it resolvex-mongo mongosh -u root -p mongo_dev_only --authenticationDatabase admin resolvex`), and the GitHub repository's contributors page.

## Demo flow (about 16 minutes; follows section 16 of the brief and the 50-mark rubric)

| Min | Brief item | What to show | Who |
|---|---|---|---|
| 0-1 | Problem and motivation | Login page: complaints arrive by phone and paper, so nobody can track, prioritise or spot repeat failures. ResolveX fixes that with database-driven reasoning. | M1 |
| 1-3 | ER diagram, design, relational schema | ER diagram: weak entities (ROOM, history, embedding), ISA (technician), M:N (skills, parts used, confirmations), recursive DUPLICATE_OF. Then the schema diagram and how each construct mapped to tables. Why two paradigms (DATABASE_DESIGN §1). | M2 |
| 3-5 | Vector database (student role) | Log in as **Student** (Aditya), go to **Report a problem**: Engineering Labs Block B, room 301, HVAC, title "Lab is very hot", description "AC blowing warm air". The panel finds incident #168 "AC not cooling" with no shared words, then the past fixes. Click **I have this problem too**: the toast shows affected users and priority score rising (trigger chain). **Search** "room is too hot" and switch Hybrid / Meaning only / Exact words. | M1 |
| 5-7 | Advanced SQL: functions, triggers, procedures (manager role) | Log in as **Manager**, **Priority queue**. Open #168, **Why this priority** panel (`fn_priority_breakdown`). Re-classify severity and watch the score and deadline change (trigger). **Auto-assign** (`sp_assign_technician`, row locks). **Escalate SLA breaches** (`sp_escalate_overdue`). | M1 |
| 5-6 | Vector RUD (7 marks) | Still as the student: open your own open report (#167 "Library Wi-Fi extremely slow" from **My reports**), **Edit title and description**, then **Save and re-embed**. The Vector line shows *fresh* (UPDATE). Log in as **Admin**, **Vector store**: **View** #168 shows the stored numbers and nearest neighbours (READ). **Delete** its vector: it becomes *missing* and drops out of semantic search (DELETE). **Create missing** brings it back (CREATE). | M1 |
| 7-9 | NoSQL: MongoDB (technician, student, manager) | Log in as **Technician**, open incident **#161** (his HVAC job). In **Discussion and field logs**, pick **Inspection log**: the form fields (supply air °C, suction psi, filter) come from the HVAC document in `inspection_templates`. Enter 21.5 °C, 84 psi, Dusty, untick *Filter clean*, verdict *Needs parts*, save (CREATE): out-of-range readings turn red. Log in as **Student**, open **#163**: only public notes are visible (READ). Post a comment, **Edit** it (UPDATE, old text kept in `edits`), **Delete** it (DELETE). Log in as **Manager**, **Document store**: collections, the `$jsonSchema` validator, indexes, sample documents; run an example query and show `IXSCAN` (index used) vs `COLLSCAN`. **Reports** → MongoDB group → *Abnormal readings* → **Show the pipeline** (`$lookup`, `$unwind`, `$group`). Optional: in the MongoDB shell run sections 2-5 of `database/mongodb/live_demo.mongosh.js`. | M1 |
| 9-10 | Transactions (technician role) | Log in as **Technician**, **Work orders**, **Complete**. Add a part with quantity 99: "Transaction rolled back, nothing was saved". Set quantity 1 and complete: stock deducted, cost recorded, incident resolved, asset back to operational, reporter notified, all in one transaction. | M2 |
| 10-11 | Views, analytics, predictive maintenance | **Analytics** (views + materialized view), **Asset health**: risk score, MTBF from the `LAG()` window function, predicted next failure. **Plan preventive maintenance** (procedure). | M2 |
| 11-12 | Reports, important queries, integration | **Reports**: average resolution time per category, cost per building, technician performance (like "average salary per department"); change the period, **Download CSV**, **Show the SQL**. **DB showcase**: q02 (GROUP BY / HAVING), q06 (RANK window), q09 (recursive CTE), q15 (EXPLAIN shows the index), q19-q21 (catalog). Admin **Audit log**: who changed what (trigger). | M2 |
| 12-14 | RBAC in the database (4 marks) | **DB showcase** q22 lists the 65 Row-Level Security policies. In psql run section 10 of `database/10_viva_live_demo.sql`: as the app role with no user you see 0 incidents; as student 11 you cannot update others' incidents (UPDATE 0) or create a building (RLS error); the audit log is empty for non-admins; deactivated user 21 sees nothing. | M2 |
| 14-16 | Security, test cases, contribution | `npm run test:db` (53 pass), `npm run test:nosql` (27 pass) and `npm run test:api` (41 pass) in the terminal. `.env.example` shows no hard-coded secrets. GitHub contributors graph. | both |

## Likely viva questions

**Which databases do you use, and why each?**
RDBMS + NoSQL, plus vectors. PostgreSQL holds everything structured and transactional: incidents, work orders, stock, money, users. A repair must change stock, cost and status together, so it needs ACID transactions and foreign keys. MongoDB holds the semi-structured data: the discussion and inspection logs. An AC inspection records temperatures and refrigerant pressure; a Wi-Fi inspection records signal and packet loss. 9 categories have 38 different reading fields, so each document stores only its own. pgvector (inside PostgreSQL) holds the sentence embeddings for meaning-based search.

**Why MongoDB for notes, and not a JSONB column in PostgreSQL?**
JSONB would work for storage. We chose a document store because the brief asks for one, and because this data behaves like documents: it is read as a whole thread, it is append-heavy, it needs no joins, and it should not compete with the transactional tables for locks. MongoDB gives us per-category `$jsonSchema` validation, array update operators (`$push`, `$addToSet`, `$pull`), multikey, text and TTL indexes, and aggregation pipelines. The cost is no foreign key across the databases, and we handle that in the API.

**MongoDB has no foreign keys. How do you keep notes consistent with incidents?**
Before any note is written, the API loads the incident from PostgreSQL, under row-level security. If it does not exist or the user cannot see it, the answer is 404 and nothing is written (test A38). The Document store page's *Check references* finds orphaned notes (for example, after someone deletes an incident in psql), and an admin can remove them with `deleteMany`. Tests N25-N27 check every note against PostgreSQL.

**How is data validated in MongoDB if it is "schemaless"?**
Each collection has a `$jsonSchema` validator with `validationLevel: strict` and `validationAction: error`. For inspections the validator is generated from the templates: an HVAC log may only contain the 5 HVAC readings, each with its type and range, so `voltage_v` in an AC log or 99 °C supply air is rejected with "Document failed validation". Students cannot be authors of inspections. Show it live: section 2b of the mongosh script.

**How is MongoDB secured?**
The app does not use the root login. `db:setup` creates `resolvex_app` with a custom role, `resolvexAppRole`. It may find, insert, update and remove notes, only insert into the search log (append-only), and only read templates. It cannot drop collections, change indexes or the validator, bypass validation, or create users (test N24). Credentials come from `.env.local`. MongoDB has no row-level security, so the API adds `visibility: "PUBLIC"` to every student query, and puts `"author.user_id": me` in edit and delete filters.

**What is NoSQL injection and how do you stop it?**
If a request body like `{"text": {"$gt": ""}}` reached a query unchecked, the operator object could change what the query matches. Every value is type-checked first (a comment must be a string, an id must be a 24-hex ObjectId), so that request gets HTTP 400 (test A37). The query console rejects `$where`, `$function`, `$accumulator`, `$out` and `$merge`, allows only the 3 collections, and has a 3-second time limit.

**Show an index being used in MongoDB.**
Document store → example query "HVAC inspections with a blocked filter" shows `IXSCAN` on the partial index `ix_inspection_verdict`. "Low suction pressure" shows `COLLSCAN`, because there is no index on readings. The incident thread uses `ix_incident_thread`, and examined = returned (test N17).

**What is a TTL index?**
An index on a date field with `expireAfterSeconds`. A background task in MongoDB deletes documents older than that. `search_events` expire after 90 days, so the log never grows without bound and old search text is not kept.

**What if MongoDB is down?**
Only the notes panel and the MongoDB reports show "document store not reachable" (HTTP 503). Reporting, assignment, repairs and search keep working, because they are in PostgreSQL. The driver reconnects by itself.

**What is Row-Level Security and why do you need it if the website already checks roles?**
RLS policies are rules attached to a table that PostgreSQL applies to every query. That is defence in depth: even if the website had a bug, or someone used the app's database password in psql, a student still could not change another person's incident and a technician could not touch another technician's job. The role is looked up inside the database from `users` (`fn_current_app_role`), not taken from the browser.

**How does the database know who is logged in when the app uses one database user?**
Each request runs inside a transaction that first executes `SELECT set_config('app.current_user_id', '<id>', true)`. The `true` makes it local to that transaction, so it cannot leak to another request. The policies call `fn_current_app_user()` and `fn_current_app_role()`.

**Show update and delete on your vector data.**
Update: edit your own open report and save. The text and its embedding are updated in one transaction, and the Vector line shows *fresh*. A text change made in plain SQL shows as *stale* on the Vector store page until it is re-embedded. Delete: as admin, Vector store, **Delete**. The incident stays but is no longer found by meaning. Only an admin may delete vectors, which an RLS policy enforces.

**Why are the vectors in PostgreSQL (pgvector) and not in MongoDB?**
The incident text must be compared by meaning, and the result must be joined with location, status and the past fix. pgvector keeps each vector next to its incident, so one SQL query does the similarity search and the joins, and the incident and its vector are saved in one ACID transaction. The notes are different: they are flexible documents that are read as a thread and need no joins, so they live in MongoDB.

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
