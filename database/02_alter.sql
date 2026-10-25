-- =====================================================================
-- ResolveX : 02_alter.sql
-- DDL - ALTER TABLE statements. These evolve the base schema created in
-- 01_schema.sql (schema migration style), adding columns, a self
-- referencing foreign key, a generated full-text column and extra
-- integrity rules that span several columns.
-- =====================================================================

-- 1. Self-referencing FK: an incident may be marked as a duplicate of
--    another (original) incident. Added with ALTER because the table must
--    exist before it can reference itself.
ALTER TABLE incidents
    ADD COLUMN duplicate_of INT;

ALTER TABLE incidents
    ADD CONSTRAINT fk_incident_duplicate_of
        FOREIGN KEY (duplicate_of) REFERENCES incidents(incident_id) ON DELETE SET NULL;

ALTER TABLE incidents
    ADD CONSTRAINT chk_not_duplicate_of_self CHECK (duplicate_of IS NULL OR duplicate_of <> incident_id);

ALTER TABLE incidents
    ADD CONSTRAINT chk_duplicate_consistency
        CHECK ((status = 'DUPLICATE') = (duplicate_of IS NOT NULL));

-- 2. Generated tsvector column for FULL-TEXT SEARCH (keyword search).
--    Title words are weighted 'A' (more important) than description 'B'.
ALTER TABLE incidents
    ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B')
        ) STORED;

-- 3. Cached asset risk score (refreshed by fn_asset_risk_score / procedures).
ALTER TABLE assets
    ADD COLUMN risk_score NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE assets
    ADD CONSTRAINT chk_asset_risk CHECK (risk_score BETWEEN 0 AND 100);

-- 4. The state-machine table may only contain valid incident states.
ALTER TABLE incident_status_transitions
    ADD CONSTRAINT chk_transition_states CHECK (
        from_status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD','RESOLVED','CLOSED','DUPLICATE','CANCELLED') AND
        to_status   IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD','RESOLVED','CLOSED','DUPLICATE','CANCELLED'));

-- 5. Every incident's category must match its asset's category - enforced
--    by trigger (cross-table). Here we only tighten a default.
ALTER TABLE spare_parts
    ALTER COLUMN reorder_level SET DEFAULT 10;

-- 6. Feedback given by the reporter after resolution (1..5 stars).
ALTER TABLE incidents
    ADD COLUMN feedback_rating SMALLINT,
    ADD CONSTRAINT chk_feedback_rating CHECK (feedback_rating IS NULL OR feedback_rating BETWEEN 1 AND 5),
    ADD CONSTRAINT chk_feedback_after_resolve CHECK (feedback_rating IS NULL OR status IN ('RESOLVED','CLOSED'));

-- 7. Demonstration of DROP COLUMN / RENAME: a temporary column is added,
--    renamed and dropped again (kept here to show the syntax in the demo).
ALTER TABLE buildings ADD COLUMN temp_notes TEXT;
ALTER TABLE buildings RENAME COLUMN temp_notes TO remarks;
ALTER TABLE buildings DROP COLUMN remarks;
