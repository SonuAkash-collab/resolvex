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
