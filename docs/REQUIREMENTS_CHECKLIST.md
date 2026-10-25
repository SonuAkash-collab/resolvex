# Requirements checklist (DBMS Level 3 brief → ResolveX)

| # | Requirement | How ResolveX meets it | Where to show it |
|---|---|---|---|
| 1 | Unique title, real-world problem, not plain CRUD | "ResolveX: An Intelligent Database-Driven Campus Infrastructure Incident, Maintenance and Asset Management System". Beyond CRUD: computed priority, semantic duplicate detection, auto assignment, atomic repair transaction, SLA escalation, predictive maintenance | Login page, queue, report page |
| 2 | 2-member team, both on DB and app | Split by vertical module, each owning tables, SQL objects, APIs and pages | `docs/TEAM_SPLIT.md`, Git history |
| 3 | SQL + NoSQL / vector | PostgreSQL 16 (relational) + pgvector (vector), justified by data shape | `docs/DATABASE_DESIGN.md §1` |
| 4 | ER diagram → relational schema; entities, attributes, PK, FK, relationships, constraints | Chen ER (15 entities, 21 relationships, weak entities, ISA, recursive, M:N) + mapping table + schema diagram | `docs/diagrams/er_diagram.png`, `relational_schema.png`, `DATABASE_DESIGN.md §2-4` |
| 4 | Vector data model: collections, indexes, embeddings, metadata, retrieval | `incident_embeddings` table, HNSW cosine index, model/source metadata, 3 retrieval functions | `docs/VECTOR_SEARCH.md` |
| 5 | DDL: CREATE, ALTER, DROP, PK/FK, constraints, indexes, views | `00_drop.sql`, `01_schema.sql`, `02_alter.sql`, `03_indexes.sql`, `06_views.sql`. 20 tables, 30 FKs, 57 CHECKs, 53 indexes, 7 views + 1 materialized view | `database/` |
| 6 | DML: INSERT, UPDATE, DELETE, SELECT | Covered across the app (table in `DATABASE_DESIGN.md §14`) | Report (INSERT), close/assign (UPDATE), withdraw confirmation / delete notifications / delete part (DELETE) |
| 6 | JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | 21 documented queries, run live on the DB showcase page (also window functions, recursive CTE, ROLLUP, EXISTS / NOT EXISTS, correlated subqueries) | `database/09_queries.sql`, `/showcase` |
| 7 | ≥ 4 advanced SQL features | Transactions, triggers (17), stored procedures (6), functions (9), views + materialized view, indexing (partial, expression, GIN, HNSW), full-text search, window functions, recursive CTE, SECURITY DEFINER | `04`-`07` SQL files |
| 7 | ≥ 1 NoSQL / vector feature | Vector similarity search, duplicate detection, hybrid vector + full-text search (RRF) | `/report`, `/search` |
| 8 | Explain embeddings: data, model, storage, metric, retrieval | All five answered | `docs/VECTOR_SEARCH.md` |
| 9 | Next.js interface: forms, tables, search, filtering, dashboards | 15 pages: report form with live suggestions, filters, search modes, analytics charts, queue, admin forms | `app/(app)/` |
| 10 | Backend/API layer; no hard-coded credentials; env variables | 26 Route Handlers; `DATABASE_URL`, `JWT_SECRET` etc. read from `.env.local`; `.env.example` committed, `.env.local` git-ignored | `app/api/`, `lib/db.js` |
| 11 | Authentication; ≥ 2 roles | Login with bcrypt + JWT httpOnly cookie; 4 roles enforced in middleware (pages) and in every API (`requireRole`) | `lib/auth.js`, `middleware.js`, tests A01-A12 |
| 12 | Validation at DB level; consistency and integrity | CHECK, UNIQUE, FK, NOT NULL, state machine, cross-table validation triggers, generated columns, transactions | `DATABASE_DESIGN.md §7`, tests T01-T21 |
| 13 | Security; no plain-text passwords or credentials | bcrypt (and a CHECK that rejects non-hashes); least-privilege DB role; append-only audit; parameterised SQL; login throttling; security headers | `07_security.sql`, tests T31-T35, A13-A14, A22 |
| 14 | Documentation (problem → conclusion) | Project report + repository docs | Report; `README.md`, `docs/` |
| 15 | Git/GitHub, individual commits, README | Commit plan per member; README with setup and run steps | `docs/TEAM_SPLIT.md`, `README.md` |
| 16 | Demonstration items | Step-by-step demo script covering each item | `docs/DEMO_GUIDE.md` |
| 17 | Originality | Original schema, scoring formulas, seed generator and UI written for this project | |
| 18 | Level 3: beyond CRUD; DB concepts linked to the app; justified DB choice | Every intelligent feature is SQL running inside PostgreSQL and surfaced in the UI (priority breakdown panel, DB showcase page, audit log page) | Incident page "Why this priority", `/showcase` |
