# Team split and Git workflow

The brief asks that **each member works on both the database and the application**, and that **commits show individual contributions**. The project is split into two vertical modules, so each person owns tables, SQL logic, APIs and pages end to end, and can explain all of it in the viva.

## Ownership

| | Member 1: Incident intelligence | Member 2: Operations and assets |
|---|---|---|
| **Tables** | incidents, incident_embeddings, incident_reporters, incident_status_history, incident_status_transitions, sla_policies | roles, users, technicians, technician_skills, buildings, rooms, asset_categories, assets, work_orders, spare_parts, work_order_parts, maintenance_records, alerts, audit_log |
| **SQL logic** | fn_priority_breakdown / score / level, fn_similar_incidents, fn_detect_duplicates, fn_hybrid_search, sp_mark_duplicate, sp_escalate_overdue; triggers trg_incident_* ; views v_incident_details, v_critical_incidents, v_sla_compliance; HNSW + GIN indexes | fn_asset_risk_score, sp_assign_technician, sp_complete_work_order, sp_schedule_preventive_maintenance, sp_restock_part; triggers trg_technician_role, trg_work_order_*, trg_low_stock_alert, trg_audit_*; views v_technician_workload, v_asset_health, v_maintenance_cost_summary, v_low_stock_parts, materialized view; 07_security.sql |
| **API** | /api/incidents/**, /api/search, /api/alerts, /api/meta | /api/auth/**, /api/work-orders/**, /api/parts/**, /api/assets/**, /api/users/**, /api/campus, /api/maintenance, /api/analytics, /api/audit, /api/showcase |
| **Pages** | report, my reports, search, incidents list + detail, priority queue, notifications | login, work orders, spare parts, asset health, analytics, admin users / campus / audit, DB showcase |
| **Lib** | lib/embeddings.js, lib/incidents.js, components/IncidentTable.js | lib/db.js, lib/auth.js, lib/api.js, middleware.js, components/Shell.js |
| **Tests and docs** | T04-T18, T25, T27-T29; docs/VECTOR_SEARCH.md | T01-T03, T19-T24, T26, T29b-T35, API tests; docs/DATABASE_DESIGN.md |
| **Together** | ER diagram and schema review, 01_schema.sql, seed generator, README, report | |

## Setting up the repository

1. Member 2 creates a **private** GitHub repository named `resolvex` and adds Member 1 as a collaborator (Settings, Collaborators).
2. Each member sets their **own** identity on their own laptop, so commits are credited correctly:
   ```bash
   git config --global user.name  "Your Name"
   git config --global user.email "the-email-on-your-github-account"
   ```
3. Member 2 copies the project folder (without `node_modules`, `.next`, `.env.local`), then:
   ```bash
   git init -b main
   git remote add origin https://github.com/<user>/resolvex.git
   ```
4. Follow the commit plan below. Each person commits **only the files they own**, from their own machine. Pull before you start (`git pull --rebase`) and push after each commit.
5. Optional but good practice: work on a branch per feature (`git switch -c feature/vector-search`), open a pull request, and have the other member review and merge it. Reviews show up as contributions too.

## Commit plan

Commit in this order. Each step lists who commits and which files. Read and run your part before committing it: the viva will ask you about it.

| # | Who | Files | Commit message |
|---|---|---|---|
| 1 | M2 | package.json, package-lock.json, next.config.mjs, jsconfig.json, .gitignore, .env.example, docker-compose.yml | chore: project setup (Next.js, pg, env template, pgvector compose) |
| 2 | M1 | README.md, docs/REQUIREMENTS_CHECKLIST.md | docs: problem statement, setup guide and requirements mapping |
| 3 | M2 | database/00_drop.sql, database/01_schema.sql (roles → maintenance_records) | feat(db): core relational schema with keys and CHECK constraints |
| 4 | M1 | database/01_schema.sql (incidents, embeddings, reporters, history, transitions, SLA) | feat(db): incident, SLA and vector tables |
| 5 | M1 | database/02_alter.sql, database/03_indexes.sql | feat(db): ALTER migrations, B-tree/partial/GIN/HNSW indexes |
| 6 | M1 | database/04_functions_procedures.sql (priority, similarity, hybrid search, mark duplicate, escalate) | feat(db): priority scoring and vector search functions |
| 7 | M2 | database/04_functions_procedures.sql (risk score, assign, complete work order, preventive, restock) | feat(db): transactional work order procedures and risk scoring |
| 8 | M1 | database/05_triggers.sql (incident triggers) | feat(db): incident validation, priority, state machine triggers |
| 9 | M2 | database/05_triggers.sql (technician, work order, stock, audit triggers) | feat(db): work order, low-stock and audit triggers |
| 10 | M2 | database/06_views.sql, database/07_security.sql | feat(db): dashboard views, materialized view, roles and grants |
| 11 | M1 | scripts/generate_seed.py, database/08_seed.sql, scripts/setup-db.mjs, scripts/embed-incidents.mjs | feat(db): seed data generator, setup and embedding scripts |
| 12 | M2 | lib/db.js, lib/auth.js, lib/api.js, middleware.js, app/api/auth/** | feat(api): db pool, transactions, JWT auth and role middleware |
| 13 | M1 | lib/embeddings.js, lib/incidents.js, app/api/incidents/**, app/api/search, app/api/meta | feat(api): incident and semantic search endpoints |
| 14 | M2 | app/api/work-orders/**, parts/**, assets/**, users/**, campus, maintenance, analytics, audit, alerts | feat(api): work orders, inventory, assets, admin and analytics endpoints |
| 15 | M2 | app/layout.js, app/globals.css, app/page.js, app/not-found.js, app/login, components/Shell.js, components/ui.js, public/ | feat(ui): design system, login and role-based shell |
| 16 | M1 | app/(app)/report, my, search, incidents/**, queue, alerts, components/IncidentTable.js | feat(ui): reporting with live duplicate detection, search, queue |
| 17 | M2 | app/(app)/work-orders, inventory, assets, analytics, admin/**, showcase, lib/showcase.js, app/api/showcase | feat(ui): technician, analytics, asset health, admin, DB showcase |
| 18 | M1 | database/09_queries.sql, tests/run-db-tests.mjs | test(db): important queries and database test suite |
| 19 | M2 | tests/run-api-tests.mjs, scripts/take_screenshots.py, scripts/generate_data_dictionary.py | test(api): API and security tests, tooling |
| 20 | M1 | docs/VECTOR_SEARCH.md, docs/diagrams/** | docs: vector search design, ER and architecture diagrams |
| 21 | M2 | docs/DATABASE_DESIGN.md, docs/DATA_DICTIONARY.md, docs/TEST_RESULTS_*.md, docs/screenshots/** | docs: database design, data dictionary, test results, screenshots |
| 22 | both | docs/DEMO_GUIDE.md, docs/TEAM_SPLIT.md, report | docs: demo guide and team split |

For steps where one file is shared (01, 04 and 05), the first person commits their part of the file and the second person adds the rest in their commit.

After this, keep working on small improvements in your own module (a new query, a UI tweak, a test). Commit them separately so the history keeps growing up to the demo.
