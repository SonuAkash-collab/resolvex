-- =====================================================================
-- ResolveX : 10_viva_live_demo.sql
-- Ready-to-run commands for when the examiner says "show me a DDL / DML /
-- constraint / trigger / transaction / procedure / view / vector query".
--
-- HOW TO OPEN THE SQL PROMPT (Docker):
--     docker exec -it resolvex-db psql -U postgres -d resolvex
-- Copy ONE block at a time and paste it into the prompt (right-click pastes
-- in Command Prompt). Type \q to leave.
--
-- Incident numbers below match a fresh `npm run db:setup`.
-- To put all data back as it was afterwards:   npm run db:setup
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. LOOK AROUND (psql meta-commands)
-- ---------------------------------------------------------------------
\dt                      -- list all tables
\d incidents             -- columns, keys, CHECKs, indexes and triggers of one table
\dv                      -- list views
\df sp_*                 -- list stored procedures
\di                      -- list indexes


-- ---------------------------------------------------------------------
-- 1. DDL : CREATE / ALTER / DROP  (on a new demo table, safe for the app)
-- ---------------------------------------------------------------------
CREATE TABLE maintenance_vendors (
    vendor_id     SERIAL PRIMARY KEY,
    vendor_name   VARCHAR(100) NOT NULL UNIQUE,
    category_id   INT NOT NULL REFERENCES asset_categories(category_id),
    phone         VARCHAR(10),
    rating        NUMERIC(2,1) DEFAULT 3.0,
    CONSTRAINT chk_vendor_phone  CHECK (phone ~ '^[6-9][0-9]{9}$'),
    CONSTRAINT chk_vendor_rating CHECK (rating BETWEEN 1 AND 5)
);

ALTER TABLE maintenance_vendors ADD COLUMN email VARCHAR(120);
ALTER TABLE maintenance_vendors ADD CONSTRAINT chk_vendor_email CHECK (email LIKE '%@%');
ALTER TABLE maintenance_vendors RENAME COLUMN vendor_name TO company_name;
ALTER TABLE maintenance_vendors ALTER COLUMN rating SET DEFAULT 4.0;
CREATE INDEX idx_vendor_category ON maintenance_vendors(category_id);
\d maintenance_vendors

-- ALTER on a real table (the app keeps working)
ALTER TABLE buildings ADD COLUMN campus_zone VARCHAR(20) DEFAULT 'MAIN';
SELECT building_code, building_name, campus_zone FROM buildings;
ALTER TABLE buildings DROP COLUMN campus_zone;


-- ---------------------------------------------------------------------
-- 2. DML : INSERT / UPDATE / DELETE / SELECT
-- ---------------------------------------------------------------------
INSERT INTO maintenance_vendors (company_name, category_id, phone, email)
VALUES ('CoolAir Services', 1, '9845011111', 'help@coolair.in'),
       ('Sparky Electricals', 2, '9845022222', 'desk@sparky.in');

UPDATE maintenance_vendors SET rating = 4.5 WHERE company_name = 'CoolAir Services';

SELECT v.company_name, c.category_name, v.rating
  FROM maintenance_vendors v JOIN asset_categories c ON c.category_id = v.category_id;

DELETE FROM maintenance_vendors WHERE company_name = 'Sparky Electricals';
SELECT * FROM maintenance_vendors;

-- DML that you can then SHOW IN THE WEB APP (Admin > Campus & SLA)
INSERT INTO buildings (building_code, building_name, building_type, importance_level, total_floors)
VALUES ('SPT', 'Sports Complex', 'SPORTS', 2, 2);
INSERT INTO rooms (building_id, room_number, floor_no, room_type, capacity)
VALUES ((SELECT building_id FROM buildings WHERE building_code = 'SPT'), 'GYM', 0, 'HALL', 80);

-- finally DROP the demo table (DDL)
DROP TABLE maintenance_vendors;


-- ---------------------------------------------------------------------
-- 3. CONSTRAINTS REJECT BAD DATA (each line should give an ERROR)
-- ---------------------------------------------------------------------
INSERT INTO users (full_name, email, password_hash, role_id)
VALUES ('Test User', 'not-an-email', 'abc', 1);                     -- CHECK: email format / bcrypt hash
UPDATE spare_parts SET quantity_in_stock = -5 WHERE part_id = 1;     -- CHECK: stock >= 0
INSERT INTO incidents (title, description, reported_by, room_id, category_id, severity)
VALUES ('Bad severity', 'severity must be 1 to 5', 11, 1, 2, 9);     -- CHECK: severity 1-5
INSERT INTO rooms (building_id, room_number, floor_no, room_type)
VALUES (999, 'X1', 0, 'OFFICE');                                     -- FOREIGN KEY: building 999 missing
INSERT INTO buildings (building_code, building_name, building_type, total_floors)
VALUES ('LIB', 'Duplicate code', 'LIBRARY', 1);                      -- UNIQUE: building_code
DELETE FROM spare_parts WHERE part_id = 1;                           -- FK: part used in repairs


-- ---------------------------------------------------------------------
-- 4. TRIGGERS IN ACTION
-- ---------------------------------------------------------------------
-- 4a. priority, level and SLA deadline are computed automatically on INSERT
INSERT INTO incidents (title, description, reported_by, room_id, asset_id, category_id, severity, affected_users)
VALUES ('Projector flickering', 'The projector in A-101 keeps flickering during lectures', 12, 1, 22, 6, 3, 40)
RETURNING incident_id, priority_score, priority_level, sla_due_at;

-- 4b. changing severity re-computes the priority (watch score and level change)
SELECT incident_id, title, severity, priority_score, priority_level, sla_due_at FROM incidents WHERE incident_id = 162;
UPDATE incidents SET severity = 5 WHERE incident_id = 162;
SELECT incident_id, title, severity, priority_score, priority_level, sla_due_at FROM incidents WHERE incident_id = 162;

-- 4c. state machine: an OPEN incident cannot jump straight to CLOSED  (ERROR expected)
UPDATE incidents SET status = 'CLOSED' WHERE incident_id = 158;

-- 4d. low-stock alert trigger
UPDATE spare_parts SET quantity_in_stock = 3 WHERE part_id = 1;
SELECT alert_type, alert_level, message FROM alerts ORDER BY alert_id DESC LIMIT 1;

-- 4e. "me too": insert a co-reporter -> affected_users +1 -> priority recomputed
SELECT affected_users, priority_score FROM incidents WHERE incident_id = 158;
INSERT INTO incident_reporters (incident_id, user_id) VALUES (158, 15);
SELECT affected_users, priority_score FROM incidents WHERE incident_id = 158;

-- 4f. audit trigger recorded the stock change
SELECT table_name, operation, row_pk, old_data->>'quantity_in_stock' AS old_qty,
       new_data->>'quantity_in_stock' AS new_qty, changed_at
  FROM audit_log ORDER BY audit_id DESC LIMIT 3;


-- ---------------------------------------------------------------------
-- 5. TRANSACTIONS : COMMIT, ROLLBACK, SAVEPOINT
-- ---------------------------------------------------------------------
BEGIN;
UPDATE spare_parts SET quantity_in_stock = quantity_in_stock - 2 WHERE part_id = 3;
SELECT part_name, quantity_in_stock FROM spare_parts WHERE part_id = 3;   -- shows 23
ROLLBACK;
SELECT part_name, quantity_in_stock FROM spare_parts WHERE part_id = 3;   -- back to 25

BEGIN;
UPDATE spare_parts SET unit_cost = unit_cost + 10 WHERE part_id = 7;
SAVEPOINT before_mistake;
UPDATE spare_parts SET unit_cost = 0 WHERE part_id = 7;                  -- violates CHECK -> error
ROLLBACK TO SAVEPOINT before_mistake;                                    -- undo only the mistake
COMMIT;
SELECT part_name, unit_cost FROM spare_parts WHERE part_id = 7;          -- 230.00 (first update kept)


-- ---------------------------------------------------------------------
-- 6. STORED PROCEDURES (each is one transaction)
-- ---------------------------------------------------------------------
-- 6a. auto-assign the best technician to incident 168 (AC not cooling in Computer Lab 1)
CALL sp_assign_technician(168, 2, NULL, NULL);
SELECT w.work_order_id, u.full_name AS technician, i.status
  FROM work_orders w JOIN users u ON u.user_id = w.technician_id
  JOIN incidents i ON i.incident_id = w.incident_id
 WHERE w.incident_id = 168;

-- 6b. complete it with too many parts -> ERROR, nothing changes (rollback)
--     (use the work_order_id printed above in place of 156 if it differs)
CALL sp_complete_work_order(156, 4, 2, 'Replaced the run capacitor', '[{"part_id": 2, "quantity": 50}]');
SELECT status FROM work_orders WHERE work_order_id = 156;                -- still ASSIGNED

-- 6c. complete it properly -> stock, cost, incident and asset updated together
CALL sp_complete_work_order(156, 4, 2, 'Replaced the run capacitor', '[{"part_id": 2, "quantity": 1}]');
SELECT i.status, i.resolved_at, m.labour_cost, m.parts_cost, m.total_cost
  FROM incidents i JOIN maintenance_records m ON m.work_order_id = 156
 WHERE i.incident_id = 168;

-- 6d. SLA escalation of overdue incidents
CALL sp_escalate_overdue(NULL);


-- ---------------------------------------------------------------------
-- 7. VIEWS and the MATERIALIZED VIEW
-- ---------------------------------------------------------------------
SELECT full_name, skills, active_jobs, completed_30d FROM v_technician_workload;
SELECT asset_tag, failures_180d, mtbf_days, predicted_next_failure, risk_score, risk_band
  FROM v_asset_health ORDER BY risk_score DESC LIMIT 5;
SELECT * FROM v_sla_compliance;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_incident_stats;

-- create and drop your own view live
CREATE VIEW v_open_by_building AS
SELECT building_name, COUNT(*) AS open_incidents
  FROM v_incident_details WHERE status = 'OPEN' GROUP BY building_name;
SELECT * FROM v_open_by_building ORDER BY open_incidents DESC;
DROP VIEW v_open_by_building;


-- ---------------------------------------------------------------------
-- 8. QUERIES : JOIN, GROUP BY, HAVING, ORDER BY, subquery
--    (all 21 documented queries are in 09_queries.sql and on the DB showcase page)
-- ---------------------------------------------------------------------
SELECT c.category_name, COUNT(*) AS incidents, ROUND(AVG(i.priority_score), 1) AS avg_priority
  FROM incidents i JOIN asset_categories c ON c.category_id = i.category_id
 GROUP BY c.category_name
HAVING COUNT(*) > 10
 ORDER BY incidents DESC;

SELECT title, priority_score FROM incidents
 WHERE priority_score > (SELECT AVG(priority_score) FROM incidents)
   AND status = 'OPEN'
 ORDER BY priority_score DESC;


-- ---------------------------------------------------------------------
-- 9. VECTOR DATABASE (pgvector)
-- ---------------------------------------------------------------------
\d incident_embeddings
SELECT incident_id, model_name, vector_dims(embedding) AS dims, left(source_text, 60) AS text
  FROM incident_embeddings LIMIT 3;

-- 5 incidents most similar in MEANING to incident 168 (cosine distance <=>)
SELECT i.incident_id, i.title,
       ROUND((1 - (e.embedding <=> (SELECT embedding FROM incident_embeddings WHERE incident_id = 168)))::NUMERIC, 3) AS similarity
  FROM incident_embeddings e JOIN incidents i ON i.incident_id = e.incident_id
 WHERE e.incident_id <> 168
 ORDER BY e.embedding <=> (SELECT embedding FROM incident_embeddings WHERE incident_id = 168)
 LIMIT 5;

-- prove the HNSW index is used
EXPLAIN SELECT incident_id FROM incident_embeddings
 ORDER BY embedding <=> (SELECT embedding FROM incident_embeddings WHERE incident_id = 168) LIMIT 5;


-- ---------------------------------------------------------------------
-- 9b. VECTOR DATA : READ / UPDATE / DELETE / CREATE (RUD on pgvector)
-- ---------------------------------------------------------------------
-- READ: the stored vector (first 5 of 384 numbers) and its health
SELECT incident_id, model_name, vector_dims(embedding) AS dims,
       (embedding::real[])[1:5] AS first_values, round(vector_norm(embedding)::numeric, 3) AS norm
  FROM incident_embeddings WHERE incident_id = 167;
SELECT vector_status, COUNT(*) FROM v_embedding_status GROUP BY vector_status;

-- UPDATE (1): change the text -> the view flags the vector as STALE
UPDATE incidents SET description = 'Library Wi-Fi keeps disconnecting every five minutes' WHERE incident_id = 167;
SELECT incident_id, vector_status FROM v_embedding_status WHERE incident_id = 167;          -- STALE
--   -> in the web app: Vector store > "Re-embed stale (1)" recomputes it -> FRESH
--   (or edit the text from the incident page: text + vector are updated in ONE transaction)

-- UPDATE (2): overwrite a vector directly in SQL (here: copy another incident's vector)
UPDATE incident_embeddings
   SET embedding = (SELECT embedding FROM incident_embeddings WHERE incident_id = 168), embedded_at = now()
 WHERE incident_id = 167;

-- DELETE: remove one vector -> the incident stays but is no longer found by meaning
DELETE FROM incident_embeddings WHERE incident_id = 167;
SELECT incident_id, vector_status FROM v_embedding_status WHERE incident_id = 167;          -- MISSING
--   -> CREATE again: Vector store > "Create missing", or in the project folder: npm run db:embed


-- ---------------------------------------------------------------------
-- 10. RBAC INSIDE THE DATABASE : Row-Level Security
--     The web app's DB role + the logged-in user id decide row by row.
-- ---------------------------------------------------------------------
SELECT tablename, policyname, cmd FROM pg_policies ORDER BY tablename LIMIT 20;   -- the policies

SET ROLE resolvex_app;                                       -- act as the web app

SELECT COUNT(*) FROM incidents;                              -- 0 : nobody logged in

BEGIN;
SELECT set_config('app.current_user_id', '11', true);        -- log in as student Aditya Rao
SELECT fn_current_app_role();                                -- STUDENT_STAFF (looked up in the DB)
SELECT COUNT(*) FROM incidents;                              -- can read incidents
SELECT COUNT(*) FROM audit_log;                              -- 0 : audit log is admin-only
UPDATE incidents SET severity = 1 WHERE reported_by <> 11;   -- UPDATE 0 : not his incidents
DELETE FROM incident_embeddings;                             -- DELETE 0 : vectors are admin-only
INSERT INTO buildings (building_code, building_name, building_type, total_floors)
VALUES ('ZZ', 'Hack block', 'LAB', 1);                       -- ERROR: row-level security
ROLLBACK;

BEGIN;
SELECT set_config('app.current_user_id', '1', true);         -- now as the administrator
SELECT COUNT(*) FROM audit_log;                              -- admin can read it
ROLLBACK;

BEGIN;
SELECT set_config('app.current_user_id', '21', true);        -- deactivated user Nikhil Jain
SELECT COUNT(*) FROM incidents;                              -- 0 : no access at all
ROLLBACK;

SELECT password_hash FROM users LIMIT 1;                     -- ERROR: permission denied (column hidden)
DELETE FROM audit_log;                                       -- ERROR: permission denied
DROP TABLE alerts;                                           -- ERROR: must be owner
RESET ROLE;

SELECT email, left(password_hash, 20) || '...' AS stored_password FROM users LIMIT 3;   -- only bcrypt hashes

-- ---------------------------------------------------------------------
-- Done. Reset everything with:   npm run db:setup   (in the project folder)
-- ---------------------------------------------------------------------
