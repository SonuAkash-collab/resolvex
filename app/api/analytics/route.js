// GET /api/analytics   dashboard data, read from views (v_*) and the materialized view
import { ok, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const GET = route(async () => {
  await requireRole("FACILITY_MANAGER", "ADMIN");
  const [kpi, sla, workload, monthly, byBuilding, byCategory, costByCategory, risk, critical, lowStock] = await Promise.all([
    queryOne(`
      SELECT COUNT(*) FILTER (WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD'))::INT AS active,
             COUNT(*) FILTER (WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD') AND sla_due_at < now())::INT AS overdue,
             COUNT(*) FILTER (WHERE status IN ('RESOLVED','CLOSED') AND resolved_at >= now() - INTERVAL '30 days')::INT AS resolved_30d,
             COUNT(*) FILTER (WHERE status = 'DUPLICATE')::INT AS duplicates_caught,
             ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - reported_at)) / 3600)
                   FILTER (WHERE resolved_at >= now() - INTERVAL '30 days'), 1) AS mttr_hours,
             ROUND(100.0 * COUNT(*) FILTER (WHERE resolved_at <= sla_due_at) / NULLIF(COUNT(*) FILTER (WHERE resolved_at IS NOT NULL), 0), 1) AS sla_pct,
             ROUND(AVG(feedback_rating), 2) AS avg_rating,
             (SELECT COALESCE(SUM(total_cost), 0) FROM maintenance_records WHERE performed_on >= CURRENT_DATE - 30) AS cost_30d
        FROM incidents`),
    query("SELECT * FROM v_sla_compliance"),
    query("SELECT * FROM v_technician_workload ORDER BY active_jobs DESC, completed_30d DESC"),
    query(`SELECT to_char(month, 'Mon') AS label, month, SUM(incidents)::INT AS incidents, SUM(p1_incidents)::INT AS p1,
                  ROUND(AVG(avg_resolution_hours), 1) AS avg_hours
             FROM mv_monthly_incident_stats GROUP BY month ORDER BY month`),
    query(`SELECT b.building_name AS label, COUNT(*)::INT AS value
             FROM incidents i JOIN rooms r ON r.room_id = i.room_id JOIN buildings b ON b.building_id = r.building_id
            WHERE i.status <> 'DUPLICATE' AND i.reported_at >= now() - INTERVAL '180 days'
            GROUP BY b.building_name ORDER BY value DESC`),
    query(`SELECT c.category_name AS label, COUNT(*)::INT AS value
             FROM incidents i JOIN asset_categories c ON c.category_id = i.category_id
            WHERE i.status <> 'DUPLICATE' AND i.reported_at >= now() - INTERVAL '180 days'
            GROUP BY c.category_name ORDER BY value DESC`),
    query(`SELECT category_name AS label, SUM(total_cost)::NUMERIC AS value, SUM(labour_cost) AS labour, SUM(parts_cost) AS parts
             FROM v_maintenance_cost_summary GROUP BY category_name ORDER BY value DESC`),
    query(`SELECT asset_id, asset_tag, asset_name, building_name, failures_180d, mtbf_days, predicted_next_failure, risk_score, risk_band
             FROM v_asset_health ORDER BY risk_score DESC LIMIT 8`),
    query("SELECT * FROM v_critical_incidents LIMIT 8"),
    query("SELECT * FROM v_low_stock_parts"),
  ]);
  return ok({ kpi, sla, workload, monthly, byBuilding, byCategory, costByCategory, risk, critical, lowStock });
});
