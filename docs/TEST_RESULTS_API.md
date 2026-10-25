# API and security test results

Run on 2026-10-25 12:23 UTC with `npm run test:api` against http://localhost:3000.

**28 of 28 passed.**

| ID | Area | Test case | Result | Detail |
|----|------|-----------|--------|--------|
| A01 | Authentication | Wrong password is refused | PASS | HTTP 401: Incorrect email or password |
| A02 | Authentication | Session cookie is httpOnly and SameSite | PASS | rx_session=<jwt>; Path=/; Expires=Sun, 25 Oct 2026 20:23:15 GMT; Max-Age=28800; Secure; HttpOnly; SameSite=lax |
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
| A18 | Functional | Student reports an incident; priority and SLA are computed | PASS | HTTP 201, #197 P2 score 68.99 |
| A19 | Functional (vector) | Similar-report check finds the new incident as a duplicate | PASS | #197 similarity 0.9119, match 1.0619 (SAME_ASSET) |
| A20 | Functional | Reporter withdraws the test incident (cleanup) | PASS | HTTP 200, status CANCELLED |
| A21 | Authorisation (RBAC) | Student cannot run showcase queries | PASS | HTTP 403 |
| A23 | Integrity (DELETE) | Deleting a spare part used in repairs is refused | PASS | HTTP 400: Cannot delete: other records still refer to it (work_order_parts_part_id_fkey) |
| A24 | Vector DELETE + CREATE | Admin deletes a vector: it leaves semantic search; create-missing restores it | PASS | found true, deleted 200, gone true, recreated 200, found again true |
| A25 | Vector RBAC | Facility manager cannot delete vectors; student cannot read the vector store | PASS | manager delete HTTP 403, student read HTTP 403 |
| A26 | Vector UPDATE | Reporter edits their open report; text and vector are updated together | PASS | HTTP 200, vector FRESH |
| A27 | Vector UPDATE RBAC | Another student cannot edit someone else's report | PASS | HTTP 403 |
| A28 | Reports | All 8 management reports run for every period | PASS | 8 reports, 117 rows in total |
| A22 | Brute-force protection | Sixth wrong password in a row is throttled | PASS | HTTP 429: Too many failed attempts. Try again in 10 minutes. |
