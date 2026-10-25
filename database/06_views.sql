-- =====================================================================
-- ResolveX : 06_views.sql
-- VIEWS (and one MATERIALIZED VIEW) that power the dashboards.
-- =====================================================================

-- ---------------------------------------------------------------------
-- v_incident_details : one denormalised row per incident (8-table join)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_incident_details AS
SELECT i.incident_id,
       i.title,
       i.description,
       i.incident_type,
       i.status,
       i.severity,
       i.affected_users,
       i.priority_score,
       i.priority_level,
       sp.label                              AS priority_label,
       i.escalation_level,
       i.reported_at,
       i.sla_due_at,
       i.resolved_at,
       i.duplicate_of,
       i.feedback_rating,
       ROUND(EXTRACT(EPOCH FROM (i.sla_due_at - now())) / 3600.0, 1) AS sla_hours_left,
       (i.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD') AND i.sla_due_at < now()) AS is_overdue,
       c.category_id,
       c.category_name,
       r.room_id,
       r.room_number,
       r.floor_no,
       b.building_id,
       b.building_code,
       b.building_name,
       a.asset_id,
       a.asset_tag,
       a.asset_name,
       u.user_id                             AS reporter_id,
       u.full_name                           AS reporter_name,
       wo.work_order_id,
       wo.status                             AS work_order_status,
       wo.technician_id,
       tu.full_name                          AS technician_name,
       wo.resolution_notes,
       (SELECT COUNT(*) FROM incident_reporters ir WHERE ir.incident_id = i.incident_id) AS co_reporters
  FROM incidents i
  JOIN asset_categories c ON c.category_id = i.category_id
  JOIN rooms r            ON r.room_id = i.room_id
  JOIN buildings b        ON b.building_id = r.building_id
  JOIN users u            ON u.user_id = i.reported_by
  LEFT JOIN sla_policies sp ON sp.priority_level = i.priority_level
  LEFT JOIN assets a      ON a.asset_id = i.asset_id
  LEFT JOIN LATERAL (                       -- latest work order of the incident
        SELECT w.* FROM work_orders w
         WHERE w.incident_id = i.incident_id
         ORDER BY w.assigned_at DESC LIMIT 1) wo ON TRUE
  LEFT JOIN users tu      ON tu.user_id = wo.technician_id;

-- ---------------------------------------------------------------------
-- v_critical_incidents : active P1/P2 or overdue incidents
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_critical_incidents AS
SELECT incident_id, title, status, priority_level, priority_score,
       building_name, room_number, category_name, asset_tag,
       technician_name, sla_due_at, sla_hours_left, is_overdue, escalation_level
  FROM v_incident_details
 WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')
   AND (priority_level IN ('P1','P2') OR is_overdue)
 ORDER BY is_overdue DESC, priority_score DESC;

-- ---------------------------------------------------------------------
-- v_technician_workload
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_technician_workload AS
SELECT t.technician_id,
       u.full_name,
       t.employee_code,
       t.is_available,
       t.max_concurrent_jobs,
       (SELECT string_agg(c.category_name, ', ' ORDER BY c.category_name)
          FROM technician_skills s JOIN asset_categories c ON c.category_id = s.category_id
         WHERE s.technician_id = t.technician_id)                                   AS skills,
       COUNT(w.work_order_id) FILTER (WHERE w.status IN ('ASSIGNED','IN_PROGRESS')) AS active_jobs,
       COUNT(w.work_order_id) FILTER (WHERE w.status = 'COMPLETED'
                                        AND w.completed_at >= now() - INTERVAL '30 days') AS completed_30d,
       COUNT(w.work_order_id) FILTER (WHERE w.status = 'COMPLETED')                AS completed_total,
       ROUND(AVG(EXTRACT(EPOCH FROM (w.completed_at - w.assigned_at)) / 3600.0)
             FILTER (WHERE w.status = 'COMPLETED'), 1)                              AS avg_turnaround_hours,
       COALESCE(SUM(w.labour_hours) FILTER (WHERE w.status = 'COMPLETED'), 0)       AS total_labour_hours,
       ROUND(100.0 * COUNT(w.work_order_id) FILTER (WHERE w.status IN ('ASSIGNED','IN_PROGRESS'))
             / t.max_concurrent_jobs, 0)                                            AS utilisation_pct
  FROM technicians t
  JOIN users u ON u.user_id = t.technician_id
  LEFT JOIN work_orders w ON w.technician_id = t.technician_id
 GROUP BY t.technician_id, u.full_name, t.employee_code, t.is_available, t.max_concurrent_jobs;

-- ---------------------------------------------------------------------
-- v_asset_health : predictive maintenance view.
-- Uses a WINDOW function (LAG) to compute the gap between consecutive
-- failures -> Mean Time Between Failures (MTBF) -> predicted next failure.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_asset_health AS
WITH failures AS (
    SELECT i.asset_id,
           i.reported_at,
           i.reported_at - LAG(i.reported_at) OVER (PARTITION BY i.asset_id ORDER BY i.reported_at) AS gap
      FROM incidents i
     WHERE i.asset_id IS NOT NULL
       AND i.incident_type = 'REACTIVE'
       AND i.status NOT IN ('DUPLICATE','CANCELLED')
),
failure_stats AS (
    SELECT asset_id,
           COUNT(*)                                                         AS total_failures,
           COUNT(*) FILTER (WHERE reported_at >= now() - INTERVAL '180 days') AS failures_180d,
           MAX(reported_at)                                                 AS last_failure_at,
           ROUND(EXTRACT(EPOCH FROM AVG(gap)) / 86400.0, 1)                 AS mtbf_days
      FROM failures
     GROUP BY asset_id
),
costs AS (
    SELECT asset_id, SUM(total_cost) AS maintenance_cost, COUNT(*) AS maintenance_count
      FROM maintenance_records GROUP BY asset_id
)
SELECT a.asset_id,
       a.asset_tag,
       a.asset_name,
       a.status,
       a.criticality,
       c.category_name,
       b.building_name,
       r.room_number,
       a.install_date,
       a.last_maintenance_date,
       CURRENT_DATE - COALESCE(a.last_maintenance_date, a.install_date)      AS days_since_maintenance,
       c.maintenance_interval_days,
       COALESCE(fs.total_failures, 0)                                        AS total_failures,
       COALESCE(fs.failures_180d, 0)                                         AS failures_180d,
       fs.last_failure_at,
       fs.mtbf_days,
       CASE WHEN fs.mtbf_days IS NOT NULL
            THEN (fs.last_failure_at + make_interval(days => fs.mtbf_days::INT))::DATE END AS predicted_next_failure,
       COALESCE(co.maintenance_cost, 0)                                      AS maintenance_cost,
       fn_asset_risk_score(a.asset_id)                                       AS risk_score,
       CASE WHEN fn_asset_risk_score(a.asset_id) >= 75 THEN 'HIGH'
            WHEN fn_asset_risk_score(a.asset_id) >= 50 THEN 'MEDIUM'
            ELSE 'LOW' END                                                   AS risk_band
  FROM assets a
  JOIN asset_categories c ON c.category_id = a.category_id
  JOIN rooms r            ON r.room_id = a.room_id
  JOIN buildings b        ON b.building_id = r.building_id
  LEFT JOIN failure_stats fs ON fs.asset_id = a.asset_id
  LEFT JOIN costs co         ON co.asset_id = a.asset_id
 WHERE a.status <> 'DECOMMISSIONED';

-- ---------------------------------------------------------------------
-- v_maintenance_cost_summary : cost per month / building / category
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_maintenance_cost_summary AS
SELECT date_trunc('month', m.performed_on)::DATE AS month,
       b.building_name,
       c.category_name,
       COUNT(*)                 AS jobs,
       SUM(m.labour_cost)       AS labour_cost,
       SUM(m.parts_cost)        AS parts_cost,
       SUM(m.total_cost)        AS total_cost
  FROM maintenance_records m
  JOIN assets a           ON a.asset_id = m.asset_id
  JOIN asset_categories c ON c.category_id = a.category_id
  JOIN rooms r            ON r.room_id = a.room_id
  JOIN buildings b        ON b.building_id = r.building_id
 GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------
-- v_sla_compliance : % of resolved incidents finished within SLA
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sla_compliance AS
SELECT i.priority_level,
       sp.label,
       sp.resolution_hours                                          AS target_hours,
       COUNT(*)                                                     AS resolved_count,
       COUNT(*) FILTER (WHERE i.resolved_at <= i.sla_due_at)        AS within_sla,
       ROUND(100.0 * COUNT(*) FILTER (WHERE i.resolved_at <= i.sla_due_at) / COUNT(*), 1) AS compliance_pct,
       ROUND(AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.reported_at)) / 3600.0), 1)        AS avg_resolution_hours
  FROM incidents i
  JOIN sla_policies sp ON sp.priority_level = i.priority_level
 WHERE i.status IN ('RESOLVED','CLOSED')
 GROUP BY i.priority_level, sp.label, sp.resolution_hours
 ORDER BY i.priority_level;

-- ---------------------------------------------------------------------
-- v_low_stock_parts
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_low_stock_parts AS
SELECT p.part_id, p.part_code, p.part_name, c.category_name,
       p.quantity_in_stock, p.reorder_level, p.unit_cost,
       (p.reorder_level * 2 - p.quantity_in_stock) * p.unit_cost AS estimated_reorder_cost
  FROM spare_parts p
  JOIN asset_categories c ON c.category_id = p.category_id
 WHERE p.quantity_in_stock <= p.reorder_level
 ORDER BY p.quantity_in_stock;

-- ---------------------------------------------------------------------
-- MATERIALIZED VIEW : monthly statistics (refreshed on demand with
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_incident_stats;)
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_monthly_incident_stats AS
SELECT date_trunc('month', i.reported_at)::DATE                              AS month,
       c.category_name,
       COUNT(*)                                                              AS incidents,
       COUNT(*) FILTER (WHERE i.priority_level = 'P1')                       AS p1_incidents,
       COUNT(*) FILTER (WHERE i.status IN ('RESOLVED','CLOSED'))             AS resolved,
       ROUND(AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.reported_at)) / 3600.0)
             FILTER (WHERE i.resolved_at IS NOT NULL), 1)                    AS avg_resolution_hours
  FROM incidents i
  JOIN asset_categories c ON c.category_id = i.category_id
 WHERE i.status NOT IN ('DUPLICATE','CANCELLED')
 GROUP BY 1, 2
WITH DATA;

CREATE UNIQUE INDEX uq_mv_monthly ON mv_monthly_incident_stats(month, category_name);
