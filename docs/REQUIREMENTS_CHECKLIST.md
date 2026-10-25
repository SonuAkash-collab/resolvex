# Requirements checklist (DBMS Level 3 brief → ResolveX)

| # | Requirement | How ResolveX meets it | Where to show it |
|---|---|---|---|
| 1 | Unique title, real-world problem, not plain CRUD | "ResolveX: Intelligent Campus Infrastructure Incident, Maintenance and Asset Management". Beyond CRUD: computed priority, semantic duplicate detection, auto assignment, atomic repair transaction, SLA escalation, predictive maintenance | Login page, queue, report page |
| 2 | 2-member team, both on DB and app | Split by vertical module, each owning tables, SQL objects, APIs and pages | `docs/TEAM_SPLIT.md`, Git history |
| 3 | SQL + NoSQL / vector | PostgreSQL 16 (relational) + pgvector (vector), justified by data shape | `docs/DATABASE_DESIGN.md §1` |
| 4 | ER diagram → relational schema; entities, attributes, PK, FK, relationships, constraints | Chen ER (15 entities, 21 relationships, weak entities, ISA, recursive, M:N) + mapping table + schema diagram | `docs/diagrams/er_diagram.png`, `relational_schema.png`, `DATABASE_DESIGN.md §2-4` |
| 4 | Vector data model: collections, indexes, embeddings, metadata, retrieval | `incident_embeddings` table, HNSW cosine index, model/source metadata, 3 retrieval functions | `docs/VECTOR_SEARCH.md` |
| 5 | DDL: CREATE, ALTER, DROP, PK/FK, constraints, indexes, views | `00_drop.sql`, `01_schema.sql`, `02_alter.sql`, `03_indexes.sql`, `06_views.sql`. 20 tables, 30 FKs, 57 CHECKs, 53 indexes, 8 views + 1 materialized view | `database/` |
| 6 | DML: INSERT, UPDATE, DELETE, SELECT | Covered across the app (table in `DATABASE_DESIGN.md §14`) | Report (INSERT), close/assign (UPDATE), withdraw confirmation / delete notifications / delete part (DELETE) |
| 6 | JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | 8 management reports with CSV export, and 23 documented queries run live on the DB showcase page (also window functions, recursive CTE, ROLLUP, EXISTS / NOT EXISTS, correlated subqueries) | `/reports`, `database/09_queries.sql`, `/showcase` |
| 7 | ≥ 4 advanced SQL features | Transactions, triggers (17), stored procedures (6), functions (11), views + materialized view, Row-Level Security, indexing (partial, expression, GIN, HNSW), full-text search, window functions, recursive CTE, SECURITY DEFINER | `04`-`07` SQL files |
| 7 | ≥ 1 NoSQL / vector feature | Vector similarity search, duplicate detection, hybrid vector + full-text search (RRF); full read / update (re-embed) / delete / create on the vectors | `/report`, `/search`, `/vectors`, incident edit |
| 8 | Explain embeddings: data, model, storage, metric, retrieval | All five answered | `docs/VECTOR_SEARCH.md` |
| 9 | Next.js interface: forms, tables, search, filtering, dashboards | 17 pages: report form with live suggestions, filters, search modes, analytics charts, queue, admin forms | `app/(app)/` |
| 10 | Backend/API layer; no hard-coded credentials; env variables | 29 Route Handlers; `DATABASE_URL`, `JWT_SECRET` etc. read from `.env.local`; `.env.example` committed, `.env.local` git-ignored | `app/api/`, `lib/db.js` |
| 11 | Authentication; ≥ 2 roles | Login with bcrypt + JWT httpOnly cookie; 4 roles enforced in middleware (pages), in every API (`requireRole`) and **inside PostgreSQL with Row-Level Security** (65 policies, role looked up from the users table) | `lib/auth.js`, `middleware.js`, `07_security.sql`, tests A01-A12, T36-T47 |
| 12 | Validation at DB level; consistency and integrity | CHECK, UNIQUE, FK, NOT NULL, state machine, cross-table validation triggers, generated columns, transactions | `DATABASE_DESIGN.md §7`, tests T01-T21 |
| 13 | Security; no plain-text passwords or credentials | bcrypt (and a CHECK that rejects non-hashes); least-privilege DB role; append-only audit; parameterised SQL; login throttling; security headers | `07_security.sql`, tests T31-T47, A13-A14, A22 |
| 14 | Documentation (problem → conclusion) | Project report + repository docs | Report; `README.md`, `docs/` |
| 15 | Git/GitHub, individual commits, README | Commit plan per member; README with setup and run steps | `docs/TEAM_SPLIT.md`, `README.md` |
| 16 | Demonstration items | Step-by-step demo script covering each item | `docs/DEMO_GUIDE.md` |
| 17 | Originality | Original schema, scoring formulas, seed generator and UI written for this project | |
| 18 | Level 3: beyond CRUD; DB concepts linked to the app; justified DB choice | Every intelligent feature is SQL running inside PostgreSQL and surfaced in the UI (priority breakdown panel, DB showcase page, audit log page) | Incident page "Why this priority", `/showcase` |

## Evaluation rubric (50 marks) → evidence

| # | Component (marks) | What to show |
|---|---|---|
| 1 | ER diagram (2) | `docs/diagrams/er_diagram.png`: 15 entities (lab minimum is 5), weak entities, ISA, M:N, recursive |
| 2 | Relational schema with keys, relationships, constraints (3) | `docs/diagrams/relational_schema.png`, `DATABASE_DESIGN.md §3-4`, `\d incidents` in psql |
| 3 | SQL DDL with constraints (4) | `01_schema.sql`, `02_alter.sql` (ALTER), `00_drop.sql` (DROP); live: section 1 of `10_viva_live_demo.sql` |
| 4 | NoSQL / vector database creation (4) | `incident_embeddings vector(384)` + HNSW index (`01_schema.sql`, `03_indexes.sql`), `npm run db:embed`, Vector store page |
| 5 | Technology justification (1) | `DATABASE_DESIGN.md §1`, `DEMO_GUIDE.md` viva answers |
| 6 | DML operations (4) | Report (INSERT), assign / close / edit (UPDATE), withdraw confirmation / delete notifications (DELETE); live: section 2 |
| 7 | Nested / correlated / recursive queries, JOINs (4) | Showcase q03 (subquery in HAVING), q04 / q08 (correlated), q09 (recursive CTE), Reports page |
| 8 | Procedures / functions, triggers, CTE (6) | 6 procedures, 11 functions, 17 triggers; "Why this priority" panel, auto-assign, rollback demo |
| 9 | NoSQL / vector feature, RUD (7) | **Read:** report page duplicates, search page. **Update:** edit an incident (re-embedded), Vector store "Re-embed". **Delete:** Vector store "Delete" (admin), cascade. Tests T48-T51, A24-A27 |
| 10 | Next.js interface (3) | 17 pages, 4 role dashboards |
| 11 | Backend / API and DB integration (2) | 29 route handlers, `lib/db.js` (pool, transactions, user context) |
| 12 | Authentication, ≥ 2 roles, RBAC in database (4) | Login, 4 roles, **Row-Level Security** (showcase q22, section 10 of the viva script, tests T36-T47) |
| 13 | Documentation, Git / GitHub (2) | Report, `README.md`, `docs/`, commits per `TEAM_SPLIT.md` |
| 14 | Originality, individual contribution, modification / viva (4) | `TEAM_SPLIT.md`, `DEMO_GUIDE.md`, live changes with `10_viva_live_demo.sql` |
