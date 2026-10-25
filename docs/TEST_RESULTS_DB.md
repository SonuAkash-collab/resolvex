# Database test results

Run on 2026-10-13 13:35 UTC with `npm run test:db`. Every test runs in its own transaction and is rolled back.

**37 of 37 passed.**

| ID | Area | Test case | Expected | Result | Detail |
|----|------|-----------|----------|--------|--------|
| T01 | CHECK constraint | Invalid email format is rejected | Rejected by database | PASS | rejected: new row for relation "users" violates check constraint "chk_user_email_fmt" |
| T02 | CHECK constraint | Plain-text password cannot be stored | Rejected by database | PASS | rejected: new row for relation "users" violates check constraint "chk_password_is_hash" |
| T03 | UNIQUE constraint | Duplicate email is rejected | Rejected by database | PASS | rejected: duplicate key value violates unique constraint "users_email_key" |
| T04 | CHECK constraint | Severity outside 1-5 is rejected | Rejected by database | PASS | rejected: new row for relation "incidents" violates check constraint "chk_severity" |
| T05 | CHECK constraint | Spare part stock can never go negative | Rejected by database | PASS | rejected: new row for relation "spare_parts" violates check constraint "chk_part_stock" |
| T06 | Foreign key | Incident in a non-existent room is rejected | Rejected by database | PASS | rejected: insert or update on table "incidents" violates foreign key constraint "incidents_room_id_fkey" |
| T07 | CHECK constraint | Resolved time before reported time is rejected | Rejected by database | PASS | rejected: new row for relation "incidents" violates check constraint "chk_resolved_time" |
| T08 | Self-referencing FK | Incident cannot be a duplicate of itself | Rejected by database | PASS | rejected: new row for relation "incidents" violates check constraint "chk_not_duplicate_of_self" |
| T09 | CHECK constraint | Feedback rating only allowed after resolution | Rejected by database | PASS | rejected: new row for relation "incidents" violates check constraint "chk_feedback_after_resolve" |
| T10 | Partial UNIQUE index | Only one active work order per incident | Rejected by database | PASS | rejected: duplicate key value violates unique constraint "uq_one_active_work_order" |
| T11 | Trigger (validation) | State machine blocks OPEN -> CLOSED | Rejected by database | PASS | rejected: Invalid status change for incident 178: OPEN -> CLOSED |
| T12 | Trigger (validation) | Asset must be in the selected room | Rejected by database | PASS | rejected: Asset AC-LABB-001 is not located in the selected room |
| T13 | Trigger (validation) | Technician without the skill cannot be assigned | Rejected by database | PASS | rejected: Technician TECH003 is not skilled for this incident category |
| T14 | Trigger (validation) | Technician job limit is enforced | Rejected by database | PASS | rejected: Technician TECH001 already has 1 active jobs (limit 1) |
| T15 | Trigger (automation) | Priority score, level and SLA deadline set on insert | Succeeds with correct effect | PASS | score 71.17, level P2 |
| T16 | Trigger chain | 'Me too' raises affected users and recomputes priority | Succeeds with correct effect | PASS | affected 1 -> 4, score 65.00 -> 70.32 |
| T16b | Trigger chain (DELETE) | Withdrawing a confirmation lowers affected users again | Succeeds with correct effect | PASS | affected users 1 -> 3 -> 2 |
| T17 | Trigger (validation) | Reporter cannot confirm their own incident | Rejected by database | PASS | rejected: You are already the original reporter of this incident |
| T18 | Trigger (automation) | Status change is written to history and notifies reporter | Succeeds with correct effect | PASS | 2 history rows, 1 alert |
| T19 | Trigger (automation) | Low-stock alert when stock crosses reorder level | Succeeds with correct effect | PASS | 1 LOW_STOCK alert |
| T20 | Trigger (audit) | Updates are recorded in the audit log with the acting user | Succeeds with correct effect | PASS | unit_cost 250.00 -> 251.00 by user 1 |
| T21 | Trigger (validation) | Decommissioned asset cannot receive new incidents | Rejected by database | PASS | rejected: Asset AC-LABB-001 is decommissioned and cannot receive new incidents |
| T22 | Stored procedure | sp_assign_technician picks a skilled technician with spare capacity | Succeeds with correct effect | PASS | technician 4, incident ASSIGNED |
| T23 | Transaction (rollback) | Completing with insufficient stock rolls back everything | Succeeds with correct effect | PASS | error raised, part 1 stock stayed 12, work order still ASSIGNED |
| T24 | Transaction (commit) | sp_complete_work_order updates stock, cost, incident and asset together | Succeeds with correct effect | PASS | stock 25 -> 23, incident RESOLVED, cost 700.00 + 500.00 = 1200.00 |
| T25 | Stored procedure + recursive CTE | sp_mark_duplicate merges into the root original | Succeeds with correct effect | PASS | duplicate linked, original affected users 5 -> 6 |
| T26 | Stored procedure | sp_restock_part rejects invalid quantity | Rejected by database | PASS | rejected: Restock quantity must be between 1 and 10000 |
| T27 | Stored procedure | SLA escalation raises priority of overdue incidents | Succeeds with correct effect | PASS | 2 escalated; #157 score 70.50 -> 80.50 |
| T28 | Vector similarity (pgvector) | Nearest neighbours of an AC incident are AC incidents | Succeeds with correct effect | PASS | top-5 all HVAC, similarity 0.9468 .. 0.7125 |
| T29 | Full-text search | websearch_to_tsquery finds 'geyser' incidents via GIN index | Succeeds with correct effect | PASS | 5 matches |
| T29b | Foreign key (ON DELETE) | A spare part used in repairs cannot be deleted | Rejected by database | PASS | rejected: update or delete on table "spare_parts" violates foreign key constraint "work_order_parts_part_id_fkey" on table "work_order_parts" |
| T30 | Generated column | total_cost is always labour_cost + parts_cost | Succeeds with correct effect | PASS | 0 inconsistent rows |
| T31 | Security (GRANT/REVOKE) | Application role cannot delete the audit trail | Rejected by database | PASS | rejected: permission denied for table audit_log |
| T32 | Security (GRANT/REVOKE) | Application role cannot drop tables | Rejected by database | PASS | rejected: must be owner of table alerts |
| T33 | Security (GRANT/REVOKE) | Application role cannot edit the state machine | Rejected by database | PASS | rejected: permission denied for table incident_status_transitions |
| T34 | Security (SECURITY DEFINER) | Application role can refresh stats only through the definer function | Succeeds with correct effect | PASS | refreshed |
| T35 | Security | Read-only transaction blocks writes (used by the showcase page) | Rejected by database | PASS | rejected: cannot execute UPDATE in a read-only transaction |
