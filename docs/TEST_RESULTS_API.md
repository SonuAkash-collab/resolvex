# API and security test results

Run on 2026-10-25 13:21 UTC with `npm run test:api` against http://localhost:3000.

**41 of 41 passed.**

| ID | Area | Test case | Result | Detail |
|----|------|-----------|--------|--------|
| A01 | Authentication | Wrong password is refused | PASS | HTTP 401: Incorrect email or password |
| A02 | Authentication | Session cookie is httpOnly and SameSite | PASS | rx_session=<jwt>; Path=/; Expires=Sun, 25 Oct 2026 21:21:15 GMT; Max-Age=28800; Secure; HttpOnly; SameSite=lax |
| A03 | Authentication | API without a session returns 401 | PASS | HTTP 401 |
| A04 | Authentication | Tampered JWT is rejected | PASS | HTTP 401 |
| A05 | Authentication | Deactivated account cannot log in | PASS | HTTP 403: This account has been deactivated. Contact the administrator. |
| A06 | Authorisation (RBAC) | Student cannot list users (admin only) | PASS | HTTP 403 |
| A07 | Authorisation (RBAC) | Student cannot assign technicians | PASS | HTTP 403 |
| A08 | Authorisation (RBAC) | Technician cannot open analytics | PASS | HTTP 403 |
| A09 | Authorisation (RBAC) | Facility manager can open analytics | PASS | HTTP 200, 12 active incidents |
| A10 | Authorisation (RBAC) | Manager cannot create users | PASS | HTTP 403 |
| A11 | Authorisation (pages) | Student opening /queue is redirected to /my | PASS | HTTP 307 -> /my |
| A12 | Data protection | User list never exposes password hashes | PASS | 21 users returned, no hash fields |
| A13 | SQL injection | Injection in login email does not bypass authentication | PASS | HTTP 401 |
| A14 | SQL injection | Injection text in search is treated as plain data | PASS | search HTTP 200, incidents table intact |
| A15 | Validation | Too-short title is rejected by the API | PASS | HTTP 400: Title must be 5-150 characters |
| A16 | Validation | Weak password is rejected when creating a user | PASS | HTTP 400: Password needs upper case, lower case, a digit and a symbol |
| A17 | Validation (database) | Database trigger error is returned as a clear message | PASS | HTTP 400: Asset AV-ACBA-002 is not located in the selected room |
| A18 | Functional | Student reports an incident; priority and SLA are computed | PASS | HTTP 201, #199 P2 score 68.99 |
| A19 | Functional (vector) | Similar-report check finds the new incident as a duplicate | PASS | #199 similarity 0.9119, match 1.0619 (SAME_ASSET) |
| A20 | Functional | Reporter withdraws the test incident (cleanup) | PASS | HTTP 200, status CANCELLED |
| A21 | Authorisation (RBAC) | Student cannot run showcase queries | PASS | HTTP 403 |
| A23 | Integrity (DELETE) | Deleting a spare part used in repairs is refused | PASS | HTTP 400: Cannot delete: other records still refer to it (work_order_parts_part_id_fkey) |
| A24 | Vector DELETE + CREATE | Admin deletes a vector: it leaves semantic search; create-missing restores it | PASS | found true, deleted 200, gone true, recreated 200, found again true |
| A25 | Vector RBAC | Facility manager cannot delete vectors; student cannot read the vector store | PASS | manager delete HTTP 403, student read HTTP 403 |
| A26 | Vector UPDATE | Reporter edits their open report; text and vector are updated together | PASS | HTTP 200, vector FRESH |
| A27 | Vector UPDATE RBAC | Another student cannot edit someone else's report | PASS | HTTP 403 |
| A28 | Reports | All 15 reports (8 SQL, 7 MongoDB pipelines) run for every period | PASS | 8 SQL + 7 MongoDB reports, 301 rows in total |
| A29 | NoSQL READ | Students see only PUBLIC notes; staff also see internal ones | PASS | incident #163: manager sees 4 notes, student 2 (0 internal leaked) |
| A30 | NoSQL CREATE | Student posts a comment; tags are normalised and it is stored in MongoDB | PASS | HTTP 201, _id 6ade024d2e931e6db6d661bf, tags ["exam-week","urgent"] |
| A31 | NoSQL RBAC | Student cannot post internal notes or inspection logs | PASS | internal note HTTP 403, inspection HTTP 403: Only the technician assigned to this incident, or a manager, can log an inspection |
| A32 | NoSQL RBAC | Technician logs an inspection only on an incident he has a work order for | PASS | own job #161 HTTP 201; someone else's job #166 HTTP 403 |
| A33 | NoSQL validation | Readings are checked against the category's template | PASS | "voltage_v" is not a reading of HVAC / Air Conditioning / Supply air temperature must be between 0 and 45 °C |
| A34 | NoSQL UPDATE | Only the author edits a note; the old text is kept in its history | PASS | manager HTTP 403; author HTTP 200, edits 1 |
| A35 | NoSQL UPDATE | Helpful vote toggles ($addToSet / $pull); no voting on your own note | PASS | self HTTP 400; votes 1 then 0 |
| A36 | NoSQL DELETE | Others cannot delete a note; the author can | PASS | other student HTTP 403; author HTTP 200; gone from thread: true |
| A37 | NoSQL injection | Operator objects and $where are refused | PASS | text object HTTP 400; id {"$ne":null} HTTP 400; $where HTTP 400 |
| A38 | Cross-database | A note cannot be attached to an incident that does not exist in PostgreSQL | PASS | HTTP 404: Incident not found |
| A39 | NoSQL RBAC | Document store page: students refused, managers see collections, validators and indexes | PASS | student HTTP 403; incident_notes 345 docs / 6 indexes, inspection_templates 9 docs / 2 indexes, search_events 269 docs / 3 indexes |
| A40 | NoSQL indexes | Query console shows index use with explain() | PASS | db.incident_notes.find({"tags":"refrigerant"}).limit(5) -> LIMIT ← FETCH ← IXSCAN, 7 match |
| A41 | NoSQL CREATE | Each search is appended to the MongoDB search log | PASS | search_events 269 -> 270 |
| A22 | Brute-force protection | Sixth wrong password in a row is throttled | PASS | HTTP 429: Too many failed attempts. Try again in 10 minutes. |
