// =====================================================================
// Management reports (aggregate SQL, like "average salary per department").
// $1 = period in days (NULL = all time). Every report is a single
// parameterised SELECT using JOIN + GROUP BY (+ HAVING) + aggregates.
// =====================================================================
const PERIOD = "($1::INT IS NULL OR i.reported_at >= now() - make_interval(days => $1::INT))";

export const REPORTS = [
  {
    id: "category-resolution",
    title: "Average resolution time and SLA compliance by category",
    concepts: "JOIN, GROUP BY, AVG, COUNT FILTER, ORDER BY",
    sql: `SELECT c.category_name                                                         AS category,
       COUNT(*)                                                                AS resolved_incidents,
       ROUND(AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.reported_at)) / 3600), 1) AS avg_resolution_hours,
       ROUND(100.0 * COUNT(*) FILTER (WHERE i.resolved_at <= i.sla_due_at) / COUNT(*), 1) AS within_sla_pct
  FROM incidents i
  JOIN asset_categories c ON c.category_id = i.category_id
 WHERE i.resolved_at IS NOT NULL AND ${PERIOD}
 GROUP BY c.category_name
 ORDER BY avg_resolution_hours DESC`,
  },
  {
    id: "building-cost",
    title: "Maintenance cost by building",
    concepts: "4-table JOIN, GROUP BY, SUM, AVG",
    sql: `SELECT b.building_name                         AS building,
       COUNT(*)                                AS repair_jobs,
       SUM(m.labour_cost)                      AS labour_cost_inr,
       SUM(m.parts_cost)                       AS parts_cost_inr,
       SUM(m.total_cost)                       AS total_cost_inr,
       ROUND(AVG(m.total_cost), 0)             AS avg_cost_per_job_inr
  FROM maintenance_records m
  JOIN assets a    ON a.asset_id = m.asset_id
  JOIN rooms r     ON r.room_id = a.room_id
  JOIN buildings b ON b.building_id = r.building_id
 WHERE ($1::INT IS NULL OR m.performed_on >= CURRENT_DATE - $1::INT)
 GROUP BY b.building_name
 ORDER BY total_cost_inr DESC`,
  },
  {
    id: "technician-performance",
    title: "Technician performance",
    concepts: "JOIN, LEFT JOIN, GROUP BY, COUNT, AVG, SUM",
    sql: `SELECT u.full_name                                                            AS technician,
       t.employee_code                                                        AS code,
       COUNT(w.work_order_id)                                                 AS jobs_completed,
       ROUND(AVG(EXTRACT(EPOCH FROM (w.completed_at - w.assigned_at)) / 3600), 1) AS avg_turnaround_hours,
       ROUND(SUM(w.labour_hours), 1)                                          AS labour_hours,
       ROUND(SUM(w.labour_hours) * t.hourly_rate, 0)                          AS labour_cost_inr,
       ROUND(AVG(i.feedback_rating), 2)                                       AS avg_reporter_rating
  FROM technicians t
  JOIN users u            ON u.user_id = t.technician_id
  LEFT JOIN work_orders w ON w.technician_id = t.technician_id AND w.status = 'COMPLETED'
  LEFT JOIN incidents i   ON i.incident_id = w.incident_id
 WHERE w.work_order_id IS NULL OR ${PERIOD}
 GROUP BY u.full_name, t.employee_code, t.hourly_rate
 ORDER BY jobs_completed DESC`,
  },
  {
    id: "monthly-priority",
    title: "Incidents per month by priority",
    concepts: "date_trunc, GROUP BY, conditional COUNT (pivot)",
    sql: `SELECT to_char(date_trunc('month', i.reported_at), 'Mon YYYY')  AS month,
       COUNT(*) FILTER (WHERE i.priority_level = 'P1')           AS p1_critical,
       COUNT(*) FILTER (WHERE i.priority_level = 'P2')           AS p2_high,
       COUNT(*) FILTER (WHERE i.priority_level = 'P3')           AS p3_medium,
       COUNT(*) FILTER (WHERE i.priority_level = 'P4')           AS p4_low,
       COUNT(*)                                                  AS total
  FROM incidents i
 WHERE i.status <> 'DUPLICATE' AND ${PERIOD}
 GROUP BY date_trunc('month', i.reported_at)
 ORDER BY date_trunc('month', i.reported_at)`,
  },
  {
    id: "parts-by-category",
    title: "Spare-part usage and stock value by category",
    concepts: "LEFT JOIN, GROUP BY, SUM, COALESCE, correlated subquery",
    sql: `SELECT c.category_name                                                      AS category,
       COUNT(DISTINCT p.part_id)                                            AS part_types,
       COALESCE(SUM(wp.quantity_used), 0)                                   AS units_used,
       COALESCE(SUM(wp.quantity_used * wp.unit_cost_at_use), 0)             AS cost_of_parts_used_inr,
       (SELECT SUM(p2.quantity_in_stock * p2.unit_cost) FROM spare_parts p2
         WHERE p2.category_id = c.category_id)                              AS stock_value_inr,
       (SELECT COUNT(*) FROM spare_parts p3
         WHERE p3.category_id = c.category_id AND p3.quantity_in_stock <= p3.reorder_level) AS parts_to_reorder
  FROM asset_categories c
  JOIN spare_parts p             ON p.category_id = c.category_id
  LEFT JOIN work_order_parts wp  ON wp.part_id = p.part_id
  LEFT JOIN work_orders w        ON w.work_order_id = wp.work_order_id
 WHERE wp.part_id IS NULL OR ($1::INT IS NULL OR w.completed_at >= now() - make_interval(days => $1::INT))
 GROUP BY c.category_id, c.category_name
 ORDER BY cost_of_parts_used_inr DESC`,
  },
  {
    id: "busy-buildings",
    title: "Buildings with 10 or more incidents",
    concepts: "GROUP BY, HAVING, AVG, MAX",
    sql: `SELECT b.building_name                        AS building,
       COUNT(*)                               AS incidents,
       ROUND(AVG(i.priority_score), 1)        AS avg_priority_score,
       COUNT(*) FILTER (WHERE i.priority_level = 'P1') AS critical,
       MAX(i.reported_at)::DATE               AS latest_report
  FROM incidents i
  JOIN rooms r     ON r.room_id = i.room_id
  JOIN buildings b ON b.building_id = r.building_id
 WHERE i.status <> 'DUPLICATE' AND ${PERIOD}
 GROUP BY b.building_name
HAVING COUNT(*) >= 10
 ORDER BY incidents DESC`,
  },
  {
    id: "repeat-assets",
    title: "Assets that failed 3 or more times",
    concepts: "JOIN, GROUP BY, HAVING, SUM over a second table",
    sql: `SELECT a.asset_tag, a.asset_name,
       COUNT(*)                                                  AS failures,
       MAX(i.reported_at)::DATE                                  AS last_failure,
       (SELECT COALESCE(SUM(m.total_cost), 0) FROM maintenance_records m
         WHERE m.asset_id = a.asset_id)                          AS lifetime_repair_cost_inr
  FROM incidents i
  JOIN assets a ON a.asset_id = i.asset_id
 WHERE i.incident_type = 'REACTIVE' AND i.status NOT IN ('DUPLICATE','CANCELLED') AND ${PERIOD}
 GROUP BY a.asset_id, a.asset_tag, a.asset_name
HAVING COUNT(*) >= 3
 ORDER BY failures DESC`,
  },
  {
    id: "satisfaction",
    title: "Reporter satisfaction by building",
    concepts: "JOIN, GROUP BY, AVG, COUNT, NULL handling",
    sql: `SELECT b.building_name                                 AS building,
       COUNT(i.feedback_rating)                        AS ratings,
       ROUND(AVG(i.feedback_rating), 2)                AS avg_rating_out_of_5,
       COUNT(*) FILTER (WHERE i.feedback_rating <= 2)  AS unhappy_reporters
  FROM incidents i
  JOIN rooms r     ON r.room_id = i.room_id
  JOIN buildings b ON b.building_id = r.building_id
 WHERE i.feedback_rating IS NOT NULL AND ${PERIOD}
 GROUP BY b.building_name
 ORDER BY avg_rating_out_of_5 DESC`,
  },
];
