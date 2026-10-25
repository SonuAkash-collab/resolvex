-- =====================================================================
-- ResolveX : 03_indexes.sql
-- INDEXING strategy. Each index is justified by a real query pattern
-- used by the application (see docs/DATABASE_DESIGN.md -> Indexes).
-- =====================================================================

-- B-tree indexes on foreign keys / frequent filters -------------------
CREATE INDEX idx_rooms_building          ON rooms(building_id);
CREATE INDEX idx_assets_room             ON assets(room_id);
CREATE INDEX idx_assets_category         ON assets(category_id);
CREATE INDEX idx_incidents_room          ON incidents(room_id);
CREATE INDEX idx_incidents_asset         ON incidents(asset_id);
CREATE INDEX idx_incidents_reporter      ON incidents(reported_by);
CREATE INDEX idx_incidents_reported_at   ON incidents(reported_at DESC);
CREATE INDEX idx_wo_technician_status    ON work_orders(technician_id, status);
CREATE INDEX idx_wo_incident             ON work_orders(incident_id);
CREATE INDEX idx_history_incident        ON incident_status_history(incident_id, changed_at);
CREATE INDEX idx_mr_asset_date           ON maintenance_records(asset_id, performed_on DESC);
CREATE INDEX idx_alerts_target           ON alerts(target_user_id, is_read);
CREATE INDEX idx_alerts_role             ON alerts(target_role, is_read);
CREATE INDEX idx_audit_table_time        ON audit_log(table_name, changed_at DESC);

-- Composite index : manager queue "status = X ORDER BY priority_score DESC"
CREATE INDEX idx_incidents_status_priority ON incidents(status, priority_score DESC);

-- PARTIAL index : only active incidents (small, hot subset of the table)
CREATE INDEX idx_incidents_active_sla ON incidents(sla_due_at)
    WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD');

-- PARTIAL UNIQUE index : at most ONE active work order per incident
CREATE UNIQUE INDEX uq_one_active_work_order ON work_orders(incident_id)
    WHERE status IN ('ASSIGNED','IN_PROGRESS');

-- EXPRESSION index : case-insensitive login lookup
CREATE UNIQUE INDEX uq_users_email_lower ON users(lower(email));

-- GIN index : full-text keyword search on incidents
CREATE INDEX idx_incidents_fts ON incidents USING GIN (search_vector);

-- GIN index : JSONB search inside the audit trail
CREATE INDEX idx_audit_new_data ON audit_log USING GIN (new_data jsonb_path_ops);

-- HNSW index (pgvector) : approximate nearest-neighbour search using
-- COSINE distance on 384-d embeddings.  m = graph degree,
-- ef_construction = build-time candidate list size.
CREATE INDEX idx_incident_embeddings_hnsw
    ON incident_embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
