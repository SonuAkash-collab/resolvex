-- =====================================================================
-- ResolveX : 09_queries.sql
-- IMPORTANT QUERIES used by the application and the demo.
-- Every block starts with a header line:
--     -- @q <id> | <title> | <concepts>
-- The "DB Showcase" page of the web app reads this file and runs each
-- query live, so the SQL shown in the demo is exactly this SQL.
-- (read-only SELECT statements only)
-- =====================================================================

-- @q q01 | Incident queue for the facility manager | 5-table JOIN, WHERE IN, ORDER BY multiple keys
SELECT i.incident_id, i.title, i.priority_level, i.priority_score, i.status,
       b.building_name, r.room_number, c.category_name,
       to_char(i.sla_due_at, 'DD Mon HH24:MI') AS sla_due
  FROM incidents i
  JOIN rooms r            ON r.room_id = i.room_id
  JOIN buildings b        ON b.building_id = r.building_id
  JOIN asset_categories c ON c.category_id = i.category_id
  JOIN users u            ON u.user_id = i.reported_by
 WHERE i.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')
 ORDER BY i.priority_score DESC, i.reported_at ASC;

-- @q q02 | Recurring failures: assets with 3+ incidents in 180 days | GROUP BY, HAVING, COUNT, MAX
SELECT a.asset_tag, a.asset_name, COUNT(*) AS incidents_180d,
       MAX(i.reported_at)::DATE AS last_incident
  FROM incidents i
  JOIN assets a ON a.asset_id = i.asset_id
 WHERE i.reported_at >= now() - INTERVAL '180 days'
   AND i.status NOT IN ('DUPLICATE','CANCELLED')
 GROUP BY a.asset_id, a.asset_tag, a.asset_name
HAVING COUNT(*) >= 3
 ORDER BY incidents_180d DESC;

-- @q q03 | Buildings with above-average incident load | GROUP BY, HAVING with scalar SUBQUERY, AVG
SELECT b.building_name, COUNT(*) AS total_incidents,
       ROUND(AVG(i.priority_score), 1) AS avg_priority
  FROM incidents i
  JOIN rooms r     ON r.room_id = i.room_id
  JOIN buildings b ON b.building_id = r.building_id
 WHERE i.status <> 'DUPLICATE'
 GROUP BY b.building_name
HAVING COUNT(*) > (SELECT COUNT(*)::NUMERIC / COUNT(DISTINCT r2.building_id)
                     FROM incidents i2 JOIN rooms r2 ON r2.room_id = i2.room_id
                    WHERE i2.status <> 'DUPLICATE')
 ORDER BY total_incidents DESC;

-- @q q04 | Reliable assets: no failure in the last 90 days | NOT EXISTS correlated SUBQUERY
SELECT a.asset_tag, a.asset_name, c.category_name, a.last_maintenance_date
  FROM assets a
  JOIN asset_categories c ON c.category_id = a.category_id
 WHERE a.status = 'OPERATIONAL'
   AND NOT EXISTS (SELECT 1
                     FROM incidents i
                    WHERE i.asset_id = a.asset_id
                      AND i.incident_type = 'REACTIVE'
                      AND i.reported_at >= now() - INTERVAL '90 days')
 ORDER BY c.category_name, a.asset_tag;

-- @q q05 | Monthly maintenance spend with running total | aggregate + WINDOW function SUM() OVER
SELECT to_char(month, 'Mon YYYY') AS month_label,
       SUM(total_cost) AS month_cost,
       SUM(SUM(total_cost)) OVER (ORDER BY month) AS running_total
  FROM v_maintenance_cost_summary
 GROUP BY month
 ORDER BY month;

-- @q q06 | Top 3 most expensive assets per category | CTE + RANK() OVER (PARTITION BY)
WITH asset_cost AS (
    SELECT c.category_name, a.asset_tag, a.asset_name, SUM(m.total_cost) AS cost,
           RANK() OVER (PARTITION BY c.category_name ORDER BY SUM(m.total_cost) DESC) AS rnk
      FROM maintenance_records m
      JOIN assets a           ON a.asset_id = m.asset_id
      JOIN asset_categories c ON c.category_id = a.category_id
     GROUP BY c.category_name, a.asset_tag, a.asset_name
)
SELECT category_name, rnk, asset_tag, asset_name, cost
  FROM asset_cost
 WHERE rnk <= 3
 ORDER BY category_name, rnk;

-- @q q07 | Spare part consumption vs stock | LEFT JOIN, COALESCE, SUM, CASE
SELECT p.part_code, p.part_name, p.quantity_in_stock, p.reorder_level,
       COALESCE(SUM(wp.quantity_used), 0) AS used_total,
       CASE WHEN p.quantity_in_stock <= p.reorder_level THEN 'REORDER' ELSE 'OK' END AS stock_state
  FROM spare_parts p
  LEFT JOIN work_order_parts wp ON wp.part_id = p.part_id
 GROUP BY p.part_id
 ORDER BY used_total DESC;

-- @q q08 | Incidents slower than their category average | correlated SUBQUERY in WHERE
SELECT i.incident_id, i.title, c.category_name,
       ROUND(EXTRACT(EPOCH FROM (i.resolved_at - i.reported_at)) / 3600, 1) AS hours_taken
  FROM incidents i
  JOIN asset_categories c ON c.category_id = i.category_id
 WHERE i.resolved_at IS NOT NULL
   AND (i.resolved_at - i.reported_at) > 2 * (
        SELECT AVG(i2.resolved_at - i2.reported_at)
          FROM incidents i2
         WHERE i2.category_id = i.category_id AND i2.resolved_at IS NOT NULL)
 ORDER BY hours_taken DESC
 LIMIT 10;

-- @q q09 | Duplicate chains (report -> original) | RECURSIVE CTE, self-referencing FK
WITH RECURSIVE chain AS (
    SELECT incident_id, duplicate_of, incident_id AS root_id, 0 AS depth
      FROM incidents WHERE duplicate_of IS NULL
    UNION ALL
    SELECT i.incident_id, i.duplicate_of, c.root_id, c.depth + 1
      FROM incidents i JOIN chain c ON i.duplicate_of = c.incident_id
)
SELECT root_id AS original_incident, COUNT(*) - 1 AS merged_duplicates,
       (SELECT title FROM incidents WHERE incident_id = root_id) AS title
  FROM chain
 GROUP BY root_id
HAVING COUNT(*) > 1
 ORDER BY merged_duplicates DESC, root_id;

-- @q q10 | Incident counts by status and priority | GROUP BY ROLLUP (subtotals)
SELECT COALESCE(status, 'ALL STATUSES') AS status,
       COALESCE(priority_level, '--')   AS priority,
       COUNT(*) AS incidents
  FROM incidents
 GROUP BY ROLLUP (status, priority_level)
 ORDER BY status NULLS LAST, priority NULLS LAST;

-- @q q11 | Mean time between failures per asset | LAG() window function, AVG of intervals
SELECT asset_tag, total_failures, mtbf_days, predicted_next_failure, risk_score, risk_band
  FROM v_asset_health
 WHERE mtbf_days IS NOT NULL
 ORDER BY risk_score DESC
 LIMIT 10;

-- @q q12 | Full-text keyword search ('geyser OR heater') | tsvector, websearch_to_tsquery, ts_rank_cd, GIN index
SELECT incident_id, title,
       ROUND(ts_rank_cd(search_vector, websearch_to_tsquery('english', 'geyser OR heater'))::NUMERIC, 3) AS rank
  FROM incidents
 WHERE search_vector @@ websearch_to_tsquery('english', 'geyser OR heater')
 ORDER BY rank DESC
 LIMIT 8;

-- @q q13 | Vector similarity: incidents most similar to incident #1 | pgvector cosine distance <=>, HNSW index
SELECT i.incident_id, i.title,
       ROUND((1 - (e.embedding <=> (SELECT embedding FROM incident_embeddings WHERE incident_id = 1)))::NUMERIC, 4) AS similarity
  FROM incident_embeddings e
  JOIN incidents i ON i.incident_id = e.incident_id
 WHERE e.incident_id <> 1
 ORDER BY e.embedding <=> (SELECT embedding FROM incident_embeddings WHERE incident_id = 1)
 LIMIT 5;

-- @q q14 | Reporter activity and satisfaction | LEFT JOIN, COUNT FILTER, AVG, NULLIF
SELECT u.full_name,
       COUNT(i.incident_id) AS reported,
       COUNT(i.incident_id) FILTER (WHERE i.status = 'DUPLICATE') AS duplicates,
       ROUND(AVG(i.feedback_rating), 2) AS avg_rating
  FROM users u
  JOIN roles ro ON ro.role_id = u.role_id AND ro.role_name = 'STUDENT_STAFF'
  LEFT JOIN incidents i ON i.reported_by = u.user_id
 GROUP BY u.user_id, u.full_name
 ORDER BY reported DESC;

-- @q q15 | Index usage proof: EXPLAIN of the manager queue | EXPLAIN, composite / partial index
EXPLAIN
SELECT incident_id, title, priority_score
  FROM incidents
 WHERE status = 'OPEN'
 ORDER BY priority_score DESC
 LIMIT 10;

-- @q q16 | Rooms that never reported an incident | NOT IN / anti-join SUBQUERY
SELECT b.building_name, r.room_number, r.room_type
  FROM rooms r
  JOIN buildings b ON b.building_id = r.building_id
 WHERE r.room_id NOT IN (SELECT DISTINCT room_id FROM incidents)
 ORDER BY b.building_name, r.room_number;

-- @q q17 | Priority score explained for active incidents | stored FUNCTION call inside SELECT
SELECT incident_id, title, severity, affected_users, escalation_level,
       fn_priority_score(severity, affected_users, asset_id, room_id, category_id,
                         escalation_level, reported_at, incident_id) AS score,
       fn_priority_level(priority_score) AS level
  FROM incidents
 WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')
 ORDER BY score DESC;

-- @q q18 | Audit trail (who changed what) | JSONB operators, trigger-generated data
SELECT a.changed_at::TIMESTAMP(0) AS changed_at, a.table_name, a.operation, a.row_pk,
       COALESCE(u.full_name, 'system') AS changed_by,
       a.new_data ->> 'status' AS new_status
  FROM audit_log a
  LEFT JOIN users u ON u.user_id = a.changed_by
 ORDER BY a.audit_id DESC
 LIMIT 15;

-- @q q19 | Triggers defined in the database | system catalog (information_schema.triggers)
SELECT event_object_table AS table_name, trigger_name, action_timing AS timing,
       string_agg(event_manipulation, ' / ' ORDER BY event_manipulation) AS events
  FROM information_schema.triggers
 WHERE trigger_schema = 'public'
 GROUP BY event_object_table, trigger_name, action_timing
 ORDER BY table_name, trigger_name;

-- @q q20 | Functions and stored procedures | system catalog (pg_proc)
SELECT p.proname AS name,
       CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'f' THEN 'FUNCTION' END AS kind,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE '' END AS security
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_%' OR p.proname LIKE 'sp\_%')
 ORDER BY kind DESC, name;

-- @q q21 | Indexes and their types | system catalog (pg_indexes)
SELECT tablename, indexname,
       CASE WHEN indexdef ILIKE '%USING hnsw%' THEN 'HNSW (vector)'
            WHEN indexdef ILIKE '%USING gin%'  THEN 'GIN'
            WHEN indexdef ILIKE '%WHERE%'      THEN 'B-tree (partial)'
            ELSE 'B-tree' END AS index_type,
       indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey'
 ORDER BY tablename, indexname;

-- @q q22 | Row-Level Security policies (RBAC inside PostgreSQL) | pg_policies catalog, RLS
SELECT tablename AS table_name, policyname AS policy, cmd AS applies_to,
       COALESCE(qual, with_check) AS rule
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, cmd, policyname;

-- @q q23 | Vector store health (fresh / stale / missing embeddings) | pgvector vector_dims, vector_norm, view
SELECT vector_status, COUNT(*) AS incidents, MIN(dims) AS dims,
       ROUND(AVG(norm), 4) AS avg_norm, MAX(embedded_at)::TIMESTAMP(0) AS last_embedded
  FROM v_embedding_status
 GROUP BY vector_status
 ORDER BY vector_status;
