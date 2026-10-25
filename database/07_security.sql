-- =====================================================================
-- ResolveX : 07_security.sql
-- DATABASE SECURITY : least-privilege roles, GRANT / REVOKE and a
-- SECURITY DEFINER function.
--   resolvex_app      : role used by the Next.js backend (DML + EXECUTE only,
--                       no DDL, cannot tamper with the audit trail)
--   resolvex_readonly : reporting role, SELECT on views only
-- A LOGIN user is created by scripts/setup-db.mjs from environment
-- variables (APP_DB_USER / APP_DB_PASSWORD) and made a member of
-- resolvex_app, so no password is ever written in source code.
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolvex_app') THEN
        CREATE ROLE resolvex_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolvex_readonly') THEN
        CREATE ROLE resolvex_readonly NOLOGIN;
    END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO resolvex_app, resolvex_readonly;

-- application role : DML on tables, use sequences, run functions/procedures
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO resolvex_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO resolvex_app;
GRANT EXECUTE ON ALL FUNCTIONS  IN SCHEMA public TO resolvex_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO resolvex_app;

-- audit trail and status history are APPEND-ONLY for the application
REVOKE UPDATE, DELETE ON audit_log               FROM resolvex_app;
REVOKE UPDATE, DELETE ON incident_status_history FROM resolvex_app;
-- reference data the app must never modify
REVOKE INSERT, UPDATE, DELETE ON roles, incident_status_transitions FROM resolvex_app;

-- reporting role : read-only access to the dashboard views
GRANT SELECT ON v_incident_details, v_critical_incidents, v_technician_workload,
                v_asset_health, v_maintenance_cost_summary, v_sla_compliance,
                v_low_stock_parts, mv_monthly_incident_stats
      TO resolvex_readonly;

-- Refreshing a materialized view needs ownership. Instead of giving the
-- app role ownership, a SECURITY DEFINER function (runs with the owner's
-- rights) exposes exactly this one privileged action.
CREATE OR REPLACE FUNCTION fn_refresh_monthly_stats()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_incident_stats;
END;
$$;

REVOKE ALL ON FUNCTION fn_refresh_monthly_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_refresh_monthly_stats() TO resolvex_app;

-- =====================================================================
-- ROLE-BASED ACCESS CONTROL INSIDE THE DATABASE (Row-Level Security)
--
-- The web app connects as ONE database login (member of resolvex_app),
-- but every request first runs
--     SELECT set_config('app.current_user_id', '<id>', true)
-- inside its transaction. The database then looks up that user's
-- application role (STUDENT_STAFF / TECHNICIAN / FACILITY_MANAGER / ADMIN)
-- from the users table and the policies below decide, ROW BY ROW, what
-- the request may read or change. Even a bug in the website - or someone
-- typing SQL with the app's credentials - cannot bypass these rules.
-- A deactivated user (is_active = FALSE) gets no role and sees nothing.
-- Table owners (setup / seed scripts) are not subject to RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: application role of the current request, read from the DB
-- (never trusted from the client). SECURITY DEFINER so it can read users
-- regardless of the policies on that table.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_current_app_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT r.role_name
      FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = fn_current_app_user()
       AND u.is_active;
$$;

-- ---------------------------------------------------------------------
-- Password hashes are hidden from the app role (column-level privilege).
-- Login reads one user's hash only through this SECURITY DEFINER function.
-- ---------------------------------------------------------------------
REVOKE SELECT ON users FROM resolvex_app;
GRANT  SELECT (user_id, full_name, email, role_id, phone, is_active, created_at) ON users TO resolvex_app;

CREATE OR REPLACE FUNCTION fn_login_lookup(p_email TEXT)
RETURNS TABLE (user_id INT, full_name VARCHAR, email VARCHAR, password_hash VARCHAR,
               is_active BOOLEAN, role_name VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.user_id, u.full_name, u.email, u.password_hash, u.is_active, r.role_name
      FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE lower(u.email) = lower(p_email);
$$;
REVOKE ALL ON FUNCTION fn_login_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_current_app_role(), fn_login_lookup(TEXT) TO resolvex_app;

-- ---------------------------------------------------------------------
-- History and audit rows are written ONLY by trigger functions that run
-- with the owner's rights (SECURITY DEFINER). The app cannot insert,
-- change or delete them itself, so they cannot be forged.
-- ---------------------------------------------------------------------
REVOKE INSERT ON audit_log, incident_status_history FROM resolvex_app;

ALTER FUNCTION trgfn_audit()                     SECURITY DEFINER SET search_path = public;
ALTER FUNCTION trgfn_incident_status_log()       SECURITY DEFINER SET search_path = public;
ALTER FUNCTION trgfn_incident_reporter_count()   SECURITY DEFINER SET search_path = public;
ALTER FUNCTION trgfn_work_order_sync()           SECURITY DEFINER SET search_path = public;
ALTER FUNCTION trgfn_work_order_assigned_alert() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION trgfn_low_stock_alert()           SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------
ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE technicians             ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_skills       ENABLE ROW LEVEL SECURITY;
ALTER TABLE buildings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE spare_parts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_parts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_embeddings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reporters      ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 1. Every table: only a logged-in, ACTIVE user may read anything.
--    (no app.current_user_id, or a deactivated user  ->  zero rows)
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users','technicians','technician_skills','buildings','rooms',
                             'asset_categories','sla_policies','assets','spare_parts',
                             'work_order_parts','maintenance_records','incidents',
                             'incident_embeddings','incident_reporters','incident_status_history',
                             'work_orders']
    LOOP
        EXECUTE format('CREATE POLICY p_%s_read ON %I FOR SELECT
                        USING ((SELECT fn_current_app_role()) IS NOT NULL)', t, t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Master data: only ADMIN may create, change or delete it.
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users','technician_skills','buildings','rooms','asset_categories','sla_policies']
    LOOP
        EXECUTE format('CREATE POLICY p_%s_admin_insert ON %I FOR INSERT
                        WITH CHECK ((SELECT fn_current_app_role()) = ''ADMIN'')', t, t);
        EXECUTE format('CREATE POLICY p_%s_admin_update ON %I FOR UPDATE
                        USING ((SELECT fn_current_app_role()) = ''ADMIN'')', t, t);
        EXECUTE format('CREATE POLICY p_%s_admin_delete ON %I FOR DELETE
                        USING ((SELECT fn_current_app_role()) = ''ADMIN'')', t, t);
    END LOOP;
END $$;

-- technicians: ADMIN creates / deletes; managers may also lock & update
-- them (availability, auto-assignment uses SELECT ... FOR UPDATE)
CREATE POLICY p_technicians_insert ON technicians FOR INSERT
    WITH CHECK ((SELECT fn_current_app_role()) = 'ADMIN');
CREATE POLICY p_technicians_update ON technicians FOR UPDATE
    USING ((SELECT fn_current_app_role()) IN ('FACILITY_MANAGER','ADMIN'));
CREATE POLICY p_technicians_delete ON technicians FOR DELETE
    USING ((SELECT fn_current_app_role()) = 'ADMIN');

-- ---------------------------------------------------------------------
-- 3. Assets and inventory: ADMIN registers / removes; technicians and
--    managers may update (stock used in a repair, asset status, restock).
--    Students can never change them.
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['assets','spare_parts']
    LOOP
        EXECUTE format('CREATE POLICY p_%s_insert ON %I FOR INSERT
                        WITH CHECK ((SELECT fn_current_app_role()) = ''ADMIN'')', t, t);
        EXECUTE format('CREATE POLICY p_%s_update ON %I FOR UPDATE
                        USING ((SELECT fn_current_app_role()) IN (''TECHNICIAN'',''FACILITY_MANAGER'',''ADMIN''))', t, t);
        EXECUTE format('CREATE POLICY p_%s_delete ON %I FOR DELETE
                        USING ((SELECT fn_current_app_role()) = ''ADMIN'')', t, t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['work_order_parts','maintenance_records']
    LOOP
        EXECUTE format('CREATE POLICY p_%s_insert ON %I FOR INSERT
                        WITH CHECK ((SELECT fn_current_app_role()) IN (''TECHNICIAN'',''FACILITY_MANAGER'',''ADMIN''))', t, t);
        EXECUTE format('CREATE POLICY p_%s_update ON %I FOR UPDATE
                        USING ((SELECT fn_current_app_role()) IN (''TECHNICIAN'',''FACILITY_MANAGER'',''ADMIN''))', t, t);
        EXECUTE format('CREATE POLICY p_%s_delete ON %I FOR DELETE
                        USING ((SELECT fn_current_app_role()) = ''ADMIN'')', t, t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. Incidents
--    INSERT : you can only report in YOUR OWN name
--    UPDATE : the reporter, a technician who has a work order on it,
--             or a facility manager / admin
--    DELETE : admin only
-- ---------------------------------------------------------------------
CREATE POLICY p_incidents_insert ON incidents FOR INSERT
    WITH CHECK (reported_by = (SELECT fn_current_app_user())
                AND (SELECT fn_current_app_role()) IS NOT NULL);

CREATE POLICY p_incidents_update ON incidents FOR UPDATE
    USING (
        (SELECT fn_current_app_role()) IN ('FACILITY_MANAGER','ADMIN')
        OR reported_by = (SELECT fn_current_app_user())
        OR EXISTS (SELECT 1 FROM work_orders w
                    WHERE w.incident_id = incidents.incident_id
                      AND w.technician_id = (SELECT fn_current_app_user())));

CREATE POLICY p_incidents_delete ON incidents FOR DELETE
    USING ((SELECT fn_current_app_role()) = 'ADMIN');

-- ---------------------------------------------------------------------
-- 5. Vector store (incident_embeddings) - RBAC on the vector data
--    CREATE / UPDATE (re-embed) : the incident's reporter or a manager/admin
--    DELETE                     : admin only
-- ---------------------------------------------------------------------
CREATE POLICY p_embeddings_insert ON incident_embeddings FOR INSERT
    WITH CHECK (
        (SELECT fn_current_app_role()) IN ('FACILITY_MANAGER','ADMIN')
        OR EXISTS (SELECT 1 FROM incidents i
                    WHERE i.incident_id = incident_embeddings.incident_id
                      AND i.reported_by = (SELECT fn_current_app_user())));

CREATE POLICY p_embeddings_update ON incident_embeddings FOR UPDATE
    USING (
        (SELECT fn_current_app_role()) IN ('FACILITY_MANAGER','ADMIN')
        OR EXISTS (SELECT 1 FROM incidents i
                    WHERE i.incident_id = incident_embeddings.incident_id
                      AND i.reported_by = (SELECT fn_current_app_user())));

CREATE POLICY p_embeddings_delete ON incident_embeddings FOR DELETE
    USING ((SELECT fn_current_app_role()) = 'ADMIN');

-- ---------------------------------------------------------------------
-- 6. "Me too" confirmations: only for yourself (managers may add the
--    reporter of a merged duplicate); withdraw only your own.
-- ---------------------------------------------------------------------
CREATE POLICY p_reporters_insert ON incident_reporters FOR INSERT
    WITH CHECK (user_id = (SELECT fn_current_app_user())
                OR (SELECT fn_current_app_role()) IN ('FACILITY_MANAGER','ADMIN'));

CREATE POLICY p_reporters_delete ON incident_reporters FOR DELETE
    USING (user_id = (SELECT fn_current_app_user())
           OR (SELECT fn_current_app_role()) = 'ADMIN');

-- ---------------------------------------------------------------------
-- 7. Work orders: created by managers; a technician may only update
--    HIS OWN work orders.
-- ---------------------------------------------------------------------
CREATE POLICY p_work_orders_insert ON work_orders FOR INSERT
    WITH CHECK ((SELECT fn_current_app_role()) IN ('FACILITY_MANAGER','ADMIN'));

CREATE POLICY p_work_orders_update ON work_orders FOR UPDATE
    USING ((SELECT fn_current_app_role()) IN ('FACILITY_MANAGER','ADMIN')
           OR technician_id = (SELECT fn_current_app_user()));

CREATE POLICY p_work_orders_delete ON work_orders FOR DELETE
    USING ((SELECT fn_current_app_role()) = 'ADMIN');

-- ---------------------------------------------------------------------
-- 8. Notifications: you see / mark / delete only alerts addressed to you
--    or to your role (admin sees all). Managers' procedures may create them.
-- ---------------------------------------------------------------------
CREATE POLICY p_alerts_own ON alerts FOR SELECT
    USING (target_user_id = (SELECT fn_current_app_user())
           OR target_role = (SELECT fn_current_app_role())
           OR (SELECT fn_current_app_role()) = 'ADMIN');

CREATE POLICY p_alerts_update_own ON alerts FOR UPDATE
    USING (target_user_id = (SELECT fn_current_app_user())
           OR target_role = (SELECT fn_current_app_role())
           OR (SELECT fn_current_app_role()) = 'ADMIN');

CREATE POLICY p_alerts_delete_own ON alerts FOR DELETE
    USING (target_user_id = (SELECT fn_current_app_user())
           OR target_role = (SELECT fn_current_app_role())
           OR (SELECT fn_current_app_role()) = 'ADMIN');

CREATE POLICY p_alerts_insert ON alerts FOR INSERT
    WITH CHECK ((SELECT fn_current_app_role()) IN ('FACILITY_MANAGER','ADMIN'));

-- ---------------------------------------------------------------------
-- 9. Audit log: readable by ADMIN only
-- ---------------------------------------------------------------------
CREATE POLICY p_audit_admin_read ON audit_log FOR SELECT
    USING ((SELECT fn_current_app_role()) = 'ADMIN');
