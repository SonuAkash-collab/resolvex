-- =====================================================================
-- ResolveX : 00_drop.sql
-- DDL - DROP statements. Resets the database so the scripts can be
-- re-run from scratch. Objects are dropped in reverse dependency order.
-- =====================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_monthly_incident_stats CASCADE;

DROP VIEW IF EXISTS v_incident_details        CASCADE;
DROP VIEW IF EXISTS v_critical_incidents      CASCADE;
DROP VIEW IF EXISTS v_technician_workload     CASCADE;
DROP VIEW IF EXISTS v_asset_health            CASCADE;
DROP VIEW IF EXISTS v_maintenance_cost_summary CASCADE;
DROP VIEW IF EXISTS v_sla_compliance          CASCADE;
DROP VIEW IF EXISTS v_low_stock_parts         CASCADE;

DROP TABLE IF EXISTS audit_log                 CASCADE;
DROP TABLE IF EXISTS alerts                    CASCADE;
DROP TABLE IF EXISTS maintenance_records       CASCADE;
DROP TABLE IF EXISTS work_order_parts          CASCADE;
DROP TABLE IF EXISTS spare_parts               CASCADE;
DROP TABLE IF EXISTS work_orders               CASCADE;
DROP TABLE IF EXISTS incident_status_history   CASCADE;
DROP TABLE IF EXISTS incident_reporters        CASCADE;
DROP TABLE IF EXISTS incident_embeddings       CASCADE;
DROP TABLE IF EXISTS incidents                 CASCADE;
DROP TABLE IF EXISTS incident_status_transitions CASCADE;
DROP TABLE IF EXISTS sla_policies              CASCADE;
DROP TABLE IF EXISTS technician_skills         CASCADE;
DROP TABLE IF EXISTS technicians               CASCADE;
DROP TABLE IF EXISTS assets                    CASCADE;
DROP TABLE IF EXISTS asset_categories          CASCADE;
DROP TABLE IF EXISTS rooms                     CASCADE;
DROP TABLE IF EXISTS buildings                 CASCADE;
DROP TABLE IF EXISTS users                     CASCADE;
DROP TABLE IF EXISTS roles                     CASCADE;

DROP FUNCTION IF EXISTS fn_priority_score          CASCADE;
DROP FUNCTION IF EXISTS fn_priority_breakdown      CASCADE;
DROP FUNCTION IF EXISTS fn_priority_level          CASCADE;
DROP FUNCTION IF EXISTS fn_asset_risk_score        CASCADE;
DROP FUNCTION IF EXISTS fn_similar_incidents       CASCADE;
DROP FUNCTION IF EXISTS fn_hybrid_search           CASCADE;
DROP FUNCTION IF EXISTS fn_detect_duplicates       CASCADE;
DROP FUNCTION IF EXISTS fn_current_app_user        CASCADE;
DROP FUNCTION IF EXISTS fn_refresh_monthly_stats   CASCADE;
DROP FUNCTION IF EXISTS fn_current_app_role        CASCADE;
DROP FUNCTION IF EXISTS fn_login_lookup            CASCADE;
DROP PROCEDURE IF EXISTS sp_assign_technician      CASCADE;
DROP PROCEDURE IF EXISTS sp_complete_work_order    CASCADE;
DROP PROCEDURE IF EXISTS sp_mark_duplicate         CASCADE;
DROP PROCEDURE IF EXISTS sp_escalate_overdue       CASCADE;
DROP PROCEDURE IF EXISTS sp_schedule_preventive_maintenance CASCADE;
DROP PROCEDURE IF EXISTS sp_restock_part           CASCADE;

