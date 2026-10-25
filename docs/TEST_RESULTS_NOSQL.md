# MongoDB (document store) test results

Run on 2026-10-25 13:21 UTC with `npm run test:nosql`, logged in as the app's MongoDB user.

**27 of 27 passed.**

| ID | Area | Test case | Result | Detail |
|----|------|-----------|--------|--------|
| N01 | Collections | Three collections exist with strict $jsonSchema validators | PASS | search_events (strict/error), incident_notes (strict/error), inspection_templates (strict/error) |
| N02 | Indexes | Compound, multikey, partial, text, unique and TTL indexes exist | PASS | 11 indexes incl. ix_incident_thread, ix_author, ix_tags, ix_inspection_verdict, tx_note_text, uq_category_id, ttl_search_events, ix_mode_time |
| N03 | Data | Templates, notes and search events are loaded | PASS | 9 templates, 192 comments, 153 inspection logs, 260 search events |
| N04 | Validation | Document without an author is rejected | PASS | code 121 |
| N05 | Validation | Unknown kind (enum) is rejected | PASS | code 121 |
| N06 | Validation | An HVAC inspection cannot contain an Electrical reading (voltage_v) | PASS | code 121 (readings.additionalProperties: false, generated from the HVAC template) |
| N07 | Validation | A reading outside its allowed range is rejected (supply air 99 °C) | PASS | code 121 |
| N08 | Validation | A reading of the wrong type is rejected (compressor_running: "yes") | PASS | code 121 |
| N09 | Validation | A student cannot be the author of an inspection log | PASS | code 121 |
| N10 | Validation | A comment cannot carry readings (oneOf branches) | PASS | code 121 |
| N11 | Validation | Tags must be lower-case slugs and unique | PASS | "Gas Leak": code 121; duplicate tag: code 121 |
| N12 | Flexible schema | Valid inspections of two categories store different reading fields | PASS | stored: supply_air_temp_c+filter_condition / door_faults_7d+emergency_phone_ok in the same collection |
| N13 | UPDATE | $set + $push edit history in one atomic update | PASS | text "__test__ v2", edits ["__test__ v1"] |
| N14 | UPDATE | $addToSet is idempotent and $pull removes a vote | PASS | after adding twice: 1 vote, after $pull: 0 |
| N15 | UPDATE | An update that breaks the validator is rejected too | PASS | code 121 |
| N16 | DELETE | deleteMany removes the test documents | PASS | 5 of 5 test documents deleted |
| N17 | Index use | An incident's thread is read with the compound index, no collection scan | PASS | FETCH <- IXSCAN; docs examined 1, returned 1 |
| N18 | Index use | Partial index serves inspection queries by category and verdict | PASS | FETCH <- IXSCAN via ix_inspection_verdict; 30 returned |
| N19 | Index use | Multikey index on the tags array | PASS | FETCH <- IXSCAN; 7 notes tagged refrigerant |
| N20 | Text search | $text search ranks the fan-motor note first | PASS | top (6.43): Outdoor fan motor bearing worn: loud rattling and the fan stalls now and then. Spare part requested from stores. |
| N21 | TTL | search_events expire automatically after 90 days (TTL index) | PASS | key {"at":1}, expireAfterSeconds 7776000 |
| N22 | Aggregation | $unwind/$group failed-check counts match a manual count | PASS | pipeline 120, manual 120 |
| N23 | Aggregation | $lookup + $objectToArray finds readings outside the template's normal range | PASS | 139 abnormal readings, e.g. supply_air_temp_c=17.2 (normal 8-16), room_temp_c=28.8 (normal 20-27) |
| N24 | Security | The app's MongoDB login cannot drop, alter, bypass validation or touch other databases | PASS | drop collection, delete search log, change template, create index, switch validator off, bypass validation, create user, read admin db: all denied |
| N25 | Cross-database | Every note refers to an incident that exists in PostgreSQL | PASS | 169 incident ids in MongoDB, 169 found in PostgreSQL |
| N26 | Cross-database | Each inspection's category matches its incident's category in PostgreSQL | PASS | 153 inspection logs checked, 0 mismatches |
| N27 | Cross-database | Seeded inspection authors are technicians with a work order on that incident | PASS | 153 checked against work_orders, 0 without a matching work order |
