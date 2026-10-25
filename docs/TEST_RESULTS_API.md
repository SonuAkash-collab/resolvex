# API and security test results

Run on 2026-10-13 13:35 UTC with `npm run test:api` against http://localhost:3000.

**23 of 23 passed.**

| ID | Area | Test case | Result | Detail |
|----|------|-----------|--------|--------|
| A01 | Authentication | Wrong password is refused | PASS | HTTP 401: Incorrect email or password |
| A02 | Authentication | Session cookie is httpOnly and SameSite | PASS | rx_session=<jwt>; Path=/; Expires=Tue, 13 Oct 2026 21:35:19 GMT; Max-Age=28800; Secure; HttpOnly; SameSite=lax |
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
| A18 | Functional | Student reports an incident; priority and SLA are computed | PASS | HTTP 201, #173 P2 score 68.99 |
| A19 | Functional (vector) | Similar-report check finds the new incident as a duplicate | PASS | #173 similarity 0.9119, match 1.0619 (SAME_ASSET) |
| A20 | Functional | Reporter withdraws the test incident (cleanup) | PASS | HTTP 200, status CANCELLED |
| A21 | Authorisation (RBAC) | Student cannot run showcase queries | PASS | HTTP 403 |
| A23 | Integrity (DELETE) | Deleting a spare part used in repairs is refused | PASS | HTTP 400: Cannot delete: other records still refer to it (work_order_parts_part_id_fkey) |
| A22 | Brute-force protection | Sixth wrong password in a row is throttled | PASS | HTTP 429: Too many failed attempts. Try again in 10 minutes. |
