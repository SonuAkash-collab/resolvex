-- =====================================================================
-- ResolveX : 04_functions_procedures.sql
-- STORED FUNCTIONS and STORED PROCEDURES (PL/pgSQL).
-- The "intelligence" of ResolveX lives here, inside the database:
--   * fn_priority_breakdown      explainable priority factors
--   * fn_priority_score          dynamic priority scoring (0..100)
--   * fn_priority_level          score -> P1..P4 using sla_policies
--   * fn_asset_risk_score        predictive-maintenance risk (0..100)
--   * fn_similar_incidents       pgvector cosine similarity search
--   * fn_detect_duplicates       duplicate detection (vector + location)
--   * fn_hybrid_search           semantic + full-text (Reciprocal Rank Fusion)
--   * sp_assign_technician       transactional auto/manual assignment
--   * sp_complete_work_order     transactional repair close-out (parts, stock, costs)
--   * sp_mark_duplicate          merge duplicate report into original
--   * sp_escalate_overdue        SLA breach escalation
--   * sp_schedule_preventive_maintenance   risk based preventive work
--   * sp_restock_part            inventory restock
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: id of the application user performing the current request.
-- The Next.js API sets it per transaction with
--     SELECT set_config('app.current_user_id', '<id>', true);
-- so triggers (audit log, status history) know WHO made a change.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_current_app_user()
RETURNS INT
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::INT;
$$;

-- ---------------------------------------------------------------------
-- FUNCTION: fn_priority_breakdown   (explainable priority scoring)
-- Returns one row per factor so the UI can show WHY an incident got its
-- priority. Weighted points out of 100:
--   severity (1-5)                 -> up to 30
--   affected users (log scale)     -> up to 15
--   asset criticality (1-5)        -> up to 20  (no asset -> 8)
--   building importance (1-5)      -> up to 15
--   failure frequency (90 days)    -> up to 10
--   category SLA urgency           -> up to 10
--   SLA escalation                 -> +10 per level
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_priority_breakdown(
    p_severity       SMALLINT,
    p_affected       INT,
    p_asset_id       INT,
    p_room_id        INT,
    p_category_id    INT,
    p_escalation     SMALLINT DEFAULT 0,
    p_reported_at    TIMESTAMPTZ DEFAULT now(),
    p_exclude_id     INT DEFAULT NULL)
RETURNS TABLE (factor VARCHAR, points NUMERIC, max_points NUMERIC, detail TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_crit        SMALLINT;
    v_importance  SMALLINT;
    v_building    VARCHAR;
    v_sla_hours   SMALLINT;
    v_recent      INT;
BEGIN
    SELECT a.criticality INTO v_crit FROM assets a WHERE a.asset_id = p_asset_id;

    SELECT b.importance_level, b.building_name INTO v_importance, v_building
      FROM rooms r JOIN buildings b ON b.building_id = r.building_id
     WHERE r.room_id = p_room_id;

    SELECT c.default_sla_hours INTO v_sla_hours
      FROM asset_categories c WHERE c.category_id = p_category_id;

    -- historical failure frequency: same asset (or same room+category when
    -- no asset is linked) in the 90 days before this report
    SELECT COUNT(*) INTO v_recent
      FROM incidents i
     WHERE (i.incident_id <> p_exclude_id OR p_exclude_id IS NULL)
       AND i.status NOT IN ('DUPLICATE','CANCELLED')
       AND i.reported_at BETWEEN p_reported_at - INTERVAL '90 days' AND p_reported_at
       AND ( (p_asset_id IS NOT NULL AND i.asset_id = p_asset_id)
          OR (p_asset_id IS NULL AND i.room_id = p_room_id AND i.category_id = p_category_id) );

    RETURN QUERY VALUES
      ('Severity'::VARCHAR,          (p_severity * 6)::NUMERIC, 30::NUMERIC,
           format('severity %s of 5', p_severity)),
      ('People affected'::VARCHAR,   ROUND(LEAST(15, 15 * ln(GREATEST(p_affected, 1)) / ln(50))::NUMERIC, 2), 15::NUMERIC,
           format('%s people (log scale, 50+ = max)', p_affected)),
      ('Asset criticality'::VARCHAR, (COALESCE(v_crit, 2) * 4)::NUMERIC, 20::NUMERIC,
           CASE WHEN v_crit IS NULL THEN 'no registered asset (default 2 of 5)'
                ELSE format('criticality %s of 5', v_crit) END),
      ('Location importance'::VARCHAR, (COALESCE(v_importance, 3) * 3)::NUMERIC, 15::NUMERIC,
           format('%s, importance %s of 5', v_building, v_importance)),
      ('Repeat failures'::VARCHAR,   LEAST(10, v_recent * 2.5)::NUMERIC, 10::NUMERIC,
           format('%s earlier incident(s) here in 90 days', v_recent)),
      ('Category urgency'::VARCHAR,  (CASE WHEN v_sla_hours <= 4  THEN 10
                                          WHEN v_sla_hours <= 24 THEN 6
                                          WHEN v_sla_hours <= 72 THEN 3
                                          ELSE 1 END)::NUMERIC, 10::NUMERIC,
           format('category target %s h', v_sla_hours)),
      ('SLA escalation'::VARCHAR,    (COALESCE(p_escalation, 0) * 10)::NUMERIC, 30::NUMERIC,
           format('escalation level %s', COALESCE(p_escalation, 0)));
END;
$$;

-- ---------------------------------------------------------------------
-- FUNCTION: fn_priority_score
-- Sum of fn_priority_breakdown, capped at 100.
-- Safety rule: severity 5 (danger to people) is never below 70 (High).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_priority_score(
    p_severity       SMALLINT,
    p_affected       INT,
    p_asset_id       INT,
    p_room_id        INT,
    p_category_id    INT,
    p_escalation     SMALLINT DEFAULT 0,
    p_reported_at    TIMESTAMPTZ DEFAULT now(),
    p_exclude_id     INT DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_score NUMERIC;
BEGIN
    SELECT SUM(points) INTO v_score
      FROM fn_priority_breakdown(p_severity, p_affected, p_asset_id, p_room_id,
                                 p_category_id, p_escalation, p_reported_at, p_exclude_id);
    IF p_severity = 5 THEN
        v_score := GREATEST(v_score, 70);
    END IF;
    RETURN ROUND(LEAST(100, GREATEST(0, v_score)), 2);
END;
$$;

-- ---------------------------------------------------------------------
-- FUNCTION: fn_priority_level  (score -> P1/P2/P3/P4 from sla_policies)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_priority_level(p_score NUMERIC)
RETURNS CHAR(2)
LANGUAGE sql STABLE AS $$
    SELECT priority_level
      FROM sla_policies
     WHERE min_score <= p_score
     ORDER BY min_score DESC
     LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- FUNCTION: fn_asset_risk_score  (predictive maintenance indicator)
--   failures in last 180 days           -> up to 40
--   overdue-ness vs maintenance interval -> up to 25
--   asset age                            -> up to 15
--   criticality                          -> up to 20
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_asset_risk_score(p_asset_id INT)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_asset     assets%ROWTYPE;
    v_interval  SMALLINT;
    v_failures  INT;
    v_days      INT;
    v_age_years NUMERIC;
    v_score     NUMERIC;
BEGIN
    SELECT * INTO v_asset FROM assets WHERE asset_id = p_asset_id;
    IF NOT FOUND OR v_asset.status = 'DECOMMISSIONED' THEN
        RETURN 0;
    END IF;

    SELECT maintenance_interval_days INTO v_interval
      FROM asset_categories WHERE category_id = v_asset.category_id;

    SELECT COUNT(*) INTO v_failures
      FROM incidents
     WHERE asset_id = p_asset_id
       AND incident_type = 'REACTIVE'
       AND status NOT IN ('DUPLICATE','CANCELLED')
       AND reported_at >= now() - INTERVAL '180 days';

    v_days      := CURRENT_DATE - COALESCE(v_asset.last_maintenance_date, v_asset.install_date);
    v_age_years := (CURRENT_DATE - v_asset.install_date) / 365.0;

    v_score := LEAST(40, v_failures * 8)
             + LEAST(25, 25.0 * v_days / v_interval)
             + LEAST(15, v_age_years * 2)
             + v_asset.criticality * 4;

    RETURN ROUND(LEAST(100, v_score), 2);
END;
$$;

-- ---------------------------------------------------------------------
-- FUNCTION: fn_similar_incidents   (VECTOR SIMILARITY SEARCH)
-- Uses the pgvector cosine-distance operator <=> . The ORDER BY ... LIMIT
-- pattern lets PostgreSQL use the HNSW index. similarity = 1 - distance.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_similar_incidents(
    p_embedding       vector(384),
    p_limit           INT     DEFAULT 5,
    p_min_similarity  NUMERIC DEFAULT 0.35,
    p_exclude_id      INT     DEFAULT NULL)
RETURNS TABLE (
    incident_id      INT,
    title            VARCHAR,
    description      TEXT,
    status           VARCHAR,
    category_name    VARCHAR,
    building_id      INT,
    building_name    VARCHAR,
    room_number      VARCHAR,
    asset_tag        VARCHAR,
    reported_at      TIMESTAMPTZ,
    resolution_notes TEXT,
    similarity       NUMERIC)
LANGUAGE sql STABLE AS $$
    WITH nearest AS (
        SELECT e.incident_id, 1 - (e.embedding <=> p_embedding) AS sim
          FROM incident_embeddings e
         ORDER BY e.embedding <=> p_embedding
         LIMIT p_limit * 4 + 5
    )
    SELECT i.incident_id, i.title, i.description, i.status, c.category_name,
           b.building_id, b.building_name, r.room_number, a.asset_tag, i.reported_at,
           (SELECT w.resolution_notes FROM work_orders w
             WHERE w.incident_id = i.incident_id AND w.status = 'COMPLETED'
             ORDER BY w.completed_at DESC LIMIT 1),
           ROUND(n.sim::NUMERIC, 4)
      FROM nearest n
      JOIN incidents i        ON i.incident_id = n.incident_id
      JOIN rooms r            ON r.room_id = i.room_id
      JOIN buildings b        ON b.building_id = r.building_id
      JOIN asset_categories c ON c.category_id = i.category_id
      LEFT JOIN assets a      ON a.asset_id = i.asset_id
     WHERE n.sim >= p_min_similarity
       AND i.status NOT IN ('DUPLICATE','CANCELLED')
       AND (p_exclude_id IS NULL OR i.incident_id <> p_exclude_id)
     ORDER BY n.sim DESC
     LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------
-- FUNCTION: fn_detect_duplicates
-- Used while a user is typing a new report. Looks only at ACTIVE incidents
-- of the last 14 days and boosts the semantic similarity when the location
-- also matches:  +0.15 same asset, +0.10 same room, +0.05 same building.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_detect_duplicates(
    p_embedding  vector(384),
    p_room_id    INT,
    p_asset_id   INT DEFAULT NULL,
    p_limit      INT DEFAULT 5,
    p_min_score  NUMERIC DEFAULT 0.55)
RETURNS TABLE (
    incident_id    INT,
    title          VARCHAR,
    status         VARCHAR,
    priority_level CHAR(2),
    building_name  VARCHAR,
    room_number    VARCHAR,
    affected_users INT,
    reported_at    TIMESTAMPTZ,
    similarity     NUMERIC,
    location_match TEXT,
    match_score    NUMERIC)
LANGUAGE sql STABLE AS $$
    WITH target AS (
        SELECT r.room_id, r.building_id FROM rooms r WHERE r.room_id = p_room_id
    ),
    candidates AS (
        SELECT i.*, 1 - (e.embedding <=> p_embedding) AS sim,
               CASE WHEN p_asset_id IS NOT NULL AND i.asset_id = p_asset_id THEN 'SAME_ASSET'
                    WHEN i.room_id = t.room_id                            THEN 'SAME_ROOM'
                    WHEN r.building_id = t.building_id                    THEN 'SAME_BUILDING'
                    ELSE 'OTHER' END AS loc
          FROM incidents i
          JOIN incident_embeddings e ON e.incident_id = i.incident_id
          JOIN rooms r               ON r.room_id = i.room_id
          CROSS JOIN target t
         WHERE i.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')
           AND i.reported_at >= now() - INTERVAL '14 days'
    )
    SELECT c.incident_id, c.title, c.status, c.priority_level, b.building_name, r.room_number,
           c.affected_users, c.reported_at, ROUND(c.sim::NUMERIC, 4), c.loc,
           ROUND((c.sim + CASE c.loc WHEN 'SAME_ASSET' THEN 0.15 WHEN 'SAME_ROOM' THEN 0.10
                                    WHEN 'SAME_BUILDING' THEN 0.05 ELSE 0 END)::NUMERIC, 4) AS score
      FROM candidates c
      JOIN rooms r     ON r.room_id = c.room_id
      JOIN buildings b ON b.building_id = r.building_id
     WHERE (c.sim + CASE c.loc WHEN 'SAME_ASSET' THEN 0.15 WHEN 'SAME_ROOM' THEN 0.10
                               WHEN 'SAME_BUILDING' THEN 0.05 ELSE 0 END) >= p_min_score
     ORDER BY score DESC
     LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------
-- FUNCTION: fn_hybrid_search
-- Combines VECTOR search (meaning) with FULL-TEXT search (exact words)
-- using Reciprocal Rank Fusion:  score = sum( 1 / (60 + rank) ).
-- p_mode: 'hybrid' | 'semantic' | 'keyword'
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_hybrid_search(
    p_query      TEXT,
    p_embedding  vector(384),
    p_limit      INT  DEFAULT 10,
    p_mode       TEXT DEFAULT 'hybrid')
RETURNS TABLE (
    incident_id    INT,
    title          VARCHAR,
    description    TEXT,
    status         VARCHAR,
    priority_level CHAR(2),
    category_name  VARCHAR,
    building_name  VARCHAR,
    room_number    VARCHAR,
    reported_at    TIMESTAMPTZ,
    semantic_rank  BIGINT,
    keyword_rank   BIGINT,
    similarity     NUMERIC,
    rrf_score      NUMERIC)
LANGUAGE sql STABLE AS $$
    WITH semantic AS (
        SELECT e.incident_id,
               1 - (e.embedding <=> p_embedding) AS sim,
               ROW_NUMBER() OVER (ORDER BY e.embedding <=> p_embedding) AS rnk
          FROM incident_embeddings e
         WHERE p_mode IN ('hybrid','semantic') AND p_embedding IS NOT NULL
         ORDER BY e.embedding <=> p_embedding
         LIMIT 50
    ),
    keyword AS (
        SELECT i.incident_id,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(i.search_vector, q) DESC) AS rnk
          FROM incidents i, websearch_to_tsquery('english', p_query) q
         WHERE p_mode IN ('hybrid','keyword') AND i.search_vector @@ q
         ORDER BY ts_rank_cd(i.search_vector, q) DESC
         LIMIT 50
    ),
    fused AS (
        SELECT COALESCE(s.incident_id, k.incident_id) AS incident_id,
               s.rnk AS s_rnk, k.rnk AS k_rnk, s.sim,
               COALESCE(1.0 / (60 + s.rnk), 0) + COALESCE(1.0 / (60 + k.rnk), 0) AS rrf
          FROM semantic s
          FULL OUTER JOIN keyword k ON k.incident_id = s.incident_id
    )
    SELECT i.incident_id, i.title, i.description, i.status, i.priority_level,
           c.category_name, b.building_name, r.room_number, i.reported_at,
           f.s_rnk, f.k_rnk, ROUND(f.sim::NUMERIC, 4), ROUND(f.rrf::NUMERIC * 1000, 3)
      FROM fused f
      JOIN incidents i        ON i.incident_id = f.incident_id
      JOIN rooms r            ON r.room_id = i.room_id
      JOIN buildings b        ON b.building_id = r.building_id
      JOIN asset_categories c ON c.category_id = i.category_id
     WHERE i.status <> 'CANCELLED'
       AND (f.k_rnk IS NOT NULL OR f.sim >= 0.30)       -- drop weak semantic-only noise
     ORDER BY f.rrf DESC
     LIMIT p_limit;
$$;

-- =====================================================================
-- STORED PROCEDURES  (called with CALL ... inside a transaction)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PROCEDURE: sp_assign_technician
-- Auto-assigns the best technician (matching skill, available, lowest
-- current workload, highest skill) unless one is given explicitly.
-- Row locks (FOR UPDATE) prevent two managers assigning concurrently.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_assign_technician(
    p_incident_id    INT,
    p_assigned_by    INT,
    p_technician_id  INT DEFAULT NULL,
    INOUT p_work_order_id INT DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE
    v_inc   incidents%ROWTYPE;
    v_tech  INT := p_technician_id;
BEGIN
    SELECT * INTO v_inc FROM incidents WHERE incident_id = p_incident_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Incident % does not exist', p_incident_id;
    END IF;
    IF v_inc.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Only OPEN incidents can be assigned (incident % is %)', p_incident_id, v_inc.status;
    END IF;

    IF v_tech IS NULL THEN
        SELECT t.technician_id INTO v_tech
          FROM technicians t
          JOIN technician_skills s ON s.technician_id = t.technician_id
                                  AND s.category_id   = v_inc.category_id
          JOIN users u             ON u.user_id = t.technician_id AND u.is_active
          LEFT JOIN LATERAL (
                SELECT COUNT(*) AS active_jobs
                  FROM work_orders w
                 WHERE w.technician_id = t.technician_id
                   AND w.status IN ('ASSIGNED','IN_PROGRESS')) wl ON TRUE
         WHERE t.is_available
           AND wl.active_jobs < t.max_concurrent_jobs
         ORDER BY wl.active_jobs ASC, s.skill_level DESC, t.technician_id
         LIMIT 1
           FOR UPDATE OF t;

        IF v_tech IS NULL THEN
            RAISE EXCEPTION 'No available technician with the required skill for incident %', p_incident_id;
        END IF;
    END IF;

    -- trigger trg_work_order_validate re-checks skill and capacity
    INSERT INTO work_orders (incident_id, technician_id, assigned_by)
    VALUES (p_incident_id, v_tech, p_assigned_by)
    RETURNING work_order_id INTO p_work_order_id;

    UPDATE incidents SET status = 'ASSIGNED' WHERE incident_id = p_incident_id;
END;
$$;

-- ---------------------------------------------------------------------
-- PROCEDURE: sp_complete_work_order   (core TRANSACTION of the system)
-- In ONE atomic unit:
--   1. lock the work order, validate owner and state
--   2. for every spare part used: lock row, check stock, deduct stock,
--      record usage at today's unit cost
--   3. compute labour + parts cost, insert maintenance record
--   4. mark the work order COMPLETED (trigger resolves the incident and
--      returns the asset to OPERATIONAL)
-- If ANY step fails (e.g. insufficient stock) everything is rolled back.
-- p_parts format: '[{"part_id": 3, "quantity": 2}, ...]'
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_complete_work_order(
    p_work_order_id  INT,
    p_technician_id  INT,
    p_labour_hours   NUMERIC,
    p_notes          TEXT,
    p_parts          JSONB DEFAULT '[]'::JSONB)
LANGUAGE plpgsql AS $$
DECLARE
    v_wo         work_orders%ROWTYPE;
    v_inc        incidents%ROWTYPE;
    v_rate       NUMERIC;
    v_part       RECORD;
    v_stock      spare_parts%ROWTYPE;
    v_parts_cost NUMERIC := 0;
BEGIN
    SELECT * INTO v_wo FROM work_orders WHERE work_order_id = p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % does not exist', p_work_order_id;
    END IF;
    IF v_wo.technician_id <> p_technician_id THEN
        RAISE EXCEPTION 'Work order % is not assigned to this technician', p_work_order_id;
    END IF;
    IF v_wo.status NOT IN ('ASSIGNED','IN_PROGRESS') THEN
        RAISE EXCEPTION 'Work order % is already %', p_work_order_id, v_wo.status;
    END IF;
    IF p_notes IS NULL OR char_length(trim(p_notes)) < 10 THEN
        RAISE EXCEPTION 'Resolution notes must be at least 10 characters';
    END IF;

    -- make sure the work order passed through IN_PROGRESS (fires sync trigger)
    IF v_wo.status = 'ASSIGNED' THEN
        UPDATE work_orders SET status = 'IN_PROGRESS', started_at = now()
         WHERE work_order_id = p_work_order_id;
    END IF;

    -- consume spare parts
    FOR v_part IN
        SELECT (x->>'part_id')::INT AS part_id, (x->>'quantity')::INT AS qty
          FROM jsonb_array_elements(p_parts) AS x
    LOOP
        IF v_part.qty IS NULL OR v_part.qty <= 0 THEN
            RAISE EXCEPTION 'Quantity for part % must be positive', v_part.part_id;
        END IF;

        SELECT * INTO v_stock FROM spare_parts WHERE part_id = v_part.part_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Spare part % does not exist', v_part.part_id;
        END IF;
        IF v_stock.quantity_in_stock < v_part.qty THEN
            RAISE EXCEPTION 'Insufficient stock for % (available %, requested %)',
                v_stock.part_name, v_stock.quantity_in_stock, v_part.qty;
        END IF;

        INSERT INTO work_order_parts (work_order_id, part_id, quantity_used, unit_cost_at_use)
        VALUES (p_work_order_id, v_part.part_id, v_part.qty, v_stock.unit_cost)
        ON CONFLICT (work_order_id, part_id)
        DO UPDATE SET quantity_used = work_order_parts.quantity_used + EXCLUDED.quantity_used;

        UPDATE spare_parts
           SET quantity_in_stock = quantity_in_stock - v_part.qty      -- low-stock trigger may fire
         WHERE part_id = v_part.part_id;

        v_parts_cost := v_parts_cost + v_part.qty * v_stock.unit_cost;
    END LOOP;

    SELECT hourly_rate INTO v_rate FROM technicians WHERE technician_id = p_technician_id;
    SELECT * INTO v_inc FROM incidents WHERE incident_id = v_wo.incident_id;

    IF v_inc.asset_id IS NOT NULL THEN
        INSERT INTO maintenance_records (asset_id, work_order_id, maintenance_type, performed_on,
                                         labour_cost, parts_cost, notes)
        VALUES (v_inc.asset_id, p_work_order_id,
                CASE WHEN v_inc.incident_type = 'PREVENTIVE' THEN 'PREVENTIVE' ELSE 'CORRECTIVE' END,
                CURRENT_DATE, ROUND(p_labour_hours * v_rate, 2), v_parts_cost, p_notes);
    END IF;

    UPDATE work_orders
       SET status = 'COMPLETED', completed_at = now(),
           labour_hours = p_labour_hours, resolution_notes = p_notes
     WHERE work_order_id = p_work_order_id;      -- trg_work_order_sync -> incident RESOLVED

    IF v_inc.asset_id IS NOT NULL THEN
        UPDATE assets SET risk_score = fn_asset_risk_score(asset_id) WHERE asset_id = v_inc.asset_id;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- PROCEDURE: sp_mark_duplicate
-- Marks an incident as a duplicate of an original one. The reporter of
-- the duplicate is added as a co-reporter of the original, which (via
-- trigger) increases affected_users and therefore its priority score.
-- A recursive CTE always resolves to the ROOT original incident.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_mark_duplicate(
    p_duplicate_id INT,
    p_original_id  INT,
    p_user_id      INT)
LANGUAGE plpgsql AS $$
DECLARE
    v_root     INT;
    v_dup      incidents%ROWTYPE;
BEGIN
    WITH RECURSIVE chain AS (
        SELECT incident_id, duplicate_of, 1 AS depth FROM incidents WHERE incident_id = p_original_id
        UNION ALL
        SELECT i.incident_id, i.duplicate_of, c.depth + 1
          FROM incidents i JOIN chain c ON i.incident_id = c.duplicate_of
         WHERE c.depth < 20
    )
    SELECT incident_id INTO v_root FROM chain WHERE duplicate_of IS NULL LIMIT 1;

    IF v_root IS NULL THEN
        RAISE EXCEPTION 'Original incident % does not exist', p_original_id;
    END IF;
    IF v_root = p_duplicate_id THEN
        RAISE EXCEPTION 'An incident cannot be a duplicate of itself';
    END IF;

    SELECT * INTO v_dup FROM incidents WHERE incident_id = p_duplicate_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Incident % does not exist', p_duplicate_id;
    END IF;

    UPDATE incidents SET status = 'DUPLICATE', duplicate_of = v_root
     WHERE incident_id = p_duplicate_id;

    INSERT INTO incident_reporters (incident_id, user_id)
    SELECT v_root, v_dup.reported_by
     WHERE v_dup.reported_by <> (SELECT reported_by FROM incidents WHERE incident_id = v_root)
    ON CONFLICT DO NOTHING;

    INSERT INTO alerts (alert_type, alert_level, message, target_user_id, incident_id)
    VALUES ('DUPLICATE', 'INFO',
            format('Your report #%s was merged into incident #%s, which is already being tracked.', p_duplicate_id, v_root),
            v_dup.reported_by, v_root);
END;
$$;

-- ---------------------------------------------------------------------
-- PROCEDURE: sp_escalate_overdue
-- Escalates every active incident whose SLA deadline has passed (at most
-- once per 12 hours, max level 3). Escalation raises the priority score
-- through the priority trigger and alerts facility managers.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_escalate_overdue(INOUT p_escalated INT DEFAULT 0)
LANGUAGE plpgsql AS $$
DECLARE
    v_row RECORD;
BEGIN
    p_escalated := 0;
    FOR v_row IN
        SELECT i.incident_id, i.title, i.sla_due_at, i.escalation_level
          FROM incidents i
         WHERE i.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')
           AND i.sla_due_at < now()
           AND i.escalation_level < 3
           AND NOT EXISTS (SELECT 1 FROM alerts a
                            WHERE a.incident_id = i.incident_id
                              AND a.alert_type = 'SLA_BREACH'
                              AND a.created_at > now() - INTERVAL '12 hours')
         FOR UPDATE OF i
    LOOP
        UPDATE incidents SET escalation_level = escalation_level + 1
         WHERE incident_id = v_row.incident_id;

        INSERT INTO alerts (alert_type, alert_level, message, target_role, incident_id)
        VALUES ('SLA_BREACH', 'CRITICAL',
                format('SLA breached for #%s "%s" (due %s). Escalated to level %s.',
                       v_row.incident_id, v_row.title,
                       to_char(v_row.sla_due_at, 'DD Mon HH24:MI'), v_row.escalation_level + 1),
                'FACILITY_MANAGER', v_row.incident_id);
        p_escalated := p_escalated + 1;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- PROCEDURE: sp_schedule_preventive_maintenance
-- Recomputes every asset's risk score; for high-risk assets without an
-- active incident it raises a PREVENTIVE incident and an alert.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_schedule_preventive_maintenance(
    p_manager_id  INT,
    p_threshold   NUMERIC DEFAULT 75,
    INOUT p_created INT DEFAULT 0)
LANGUAGE plpgsql AS $$
DECLARE
    v_asset RECORD;
    v_new   INT;
BEGIN
    p_created := 0;
    UPDATE assets SET risk_score = fn_asset_risk_score(asset_id)
     WHERE status <> 'DECOMMISSIONED';

    FOR v_asset IN
        SELECT a.* FROM assets a
         WHERE a.status = 'OPERATIONAL'
           AND a.risk_score >= p_threshold
           AND NOT EXISTS (SELECT 1 FROM incidents i
                            WHERE i.asset_id = a.asset_id
                              AND i.status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD'))
         ORDER BY a.risk_score DESC
    LOOP
        INSERT INTO incidents (title, description, incident_type, reported_by, room_id,
                               asset_id, category_id, severity, affected_users)
        VALUES (format('Preventive maintenance: %s (%s)', v_asset.asset_name, v_asset.asset_tag),
                format('System generated preventive maintenance. Asset risk score %s is above threshold %s based on recent failures, time since last service and age.',
                       v_asset.risk_score, p_threshold),
                'PREVENTIVE', p_manager_id, v_asset.room_id, v_asset.asset_id,
                v_asset.category_id, 2, 1)
        RETURNING incident_id INTO v_new;

        INSERT INTO alerts (alert_type, alert_level, message, target_role, asset_id, incident_id)
        VALUES ('HIGH_RISK_ASSET', 'WARNING',
                format('Asset %s has risk score %s - preventive incident #%s created.',
                       v_asset.asset_tag, v_asset.risk_score, v_new),
                'FACILITY_MANAGER', v_asset.asset_id, v_new);
        p_created := p_created + 1;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- PROCEDURE: sp_restock_part
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_restock_part(p_part_id INT, p_quantity INT)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
        RAISE EXCEPTION 'Restock quantity must be between 1 and 10000';
    END IF;
    UPDATE spare_parts SET quantity_in_stock = quantity_in_stock + p_quantity
     WHERE part_id = p_part_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Spare part % does not exist', p_part_id;
    END IF;
END;
$$;
