-- =====================================================================
-- ResolveX : 01_schema.sql
-- DDL - CREATE TABLE statements with primary keys, foreign keys and
-- column/table level constraints (NOT NULL, UNIQUE, CHECK, DEFAULT).
-- Normal form: every table is in 3NF / BCNF (see docs/DATABASE_DESIGN.md).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector  : vector type + ANN indexes
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- pgcrypto  : bcrypt hashing for seed users

-- ---------------------------------------------------------------------
-- 1. ROLES  (lookup table for role based access control)
-- ---------------------------------------------------------------------
CREATE TABLE roles (
    role_id      SMALLSERIAL  PRIMARY KEY,
    role_name    VARCHAR(30)  NOT NULL UNIQUE,
    description  VARCHAR(200),
    CONSTRAINT chk_role_name CHECK (role_name IN ('STUDENT_STAFF','TECHNICIAN','FACILITY_MANAGER','ADMIN'))
);

-- ---------------------------------------------------------------------
-- 2. USERS
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id        SERIAL        PRIMARY KEY,
    full_name      VARCHAR(100)  NOT NULL,
    email          VARCHAR(120)  NOT NULL UNIQUE,
    password_hash  VARCHAR(100)  NOT NULL,              -- bcrypt hash, never plain text
    role_id        SMALLINT      NOT NULL REFERENCES roles(role_id) ON UPDATE CASCADE,
    phone          VARCHAR(15),
    is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_user_name_len  CHECK (char_length(trim(full_name)) >= 3),
    CONSTRAINT chk_user_email_fmt CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT chk_user_phone_fmt CHECK (phone IS NULL OR phone ~ '^[6-9][0-9]{9}$'),
    CONSTRAINT chk_password_is_hash CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$')
);

-- ---------------------------------------------------------------------
-- 3. BUILDINGS
-- ---------------------------------------------------------------------
CREATE TABLE buildings (
    building_id       SERIAL       PRIMARY KEY,
    building_code     VARCHAR(10)  NOT NULL UNIQUE,
    building_name     VARCHAR(100) NOT NULL,
    building_type     VARCHAR(20)  NOT NULL,
    importance_level  SMALLINT     NOT NULL DEFAULT 3,   -- 1 (low) .. 5 (mission critical)
    total_floors      SMALLINT     NOT NULL,
    CONSTRAINT chk_building_type  CHECK (building_type IN ('ACADEMIC','LAB','HOSTEL','LIBRARY','ADMIN','AUDITORIUM','CAFETERIA','SPORTS')),
    CONSTRAINT chk_importance     CHECK (importance_level BETWEEN 1 AND 5),
    CONSTRAINT chk_floors         CHECK (total_floors BETWEEN 1 AND 30)
);

-- ---------------------------------------------------------------------
-- 4. ROOMS   (weak entity identified by building + room number)
-- ---------------------------------------------------------------------
CREATE TABLE rooms (
    room_id      SERIAL       PRIMARY KEY,
    building_id  INT          NOT NULL REFERENCES buildings(building_id) ON DELETE CASCADE,
    room_number  VARCHAR(10)  NOT NULL,
    floor_no     SMALLINT     NOT NULL,
    room_type    VARCHAR(20)  NOT NULL,
    capacity     SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT uq_room_in_building UNIQUE (building_id, room_number),
    CONSTRAINT chk_room_type CHECK (room_type IN ('CLASSROOM','LAB','OFFICE','HOSTEL_ROOM','WASHROOM','CORRIDOR','HALL','SERVER_ROOM','KITCHEN','READING_ROOM')),
    CONSTRAINT chk_floor_no  CHECK (floor_no BETWEEN 0 AND 30),
    CONSTRAINT chk_capacity  CHECK (capacity >= 0)
);

-- ---------------------------------------------------------------------
-- 5. ASSET CATEGORIES  (also used as incident category & skill area)
-- ---------------------------------------------------------------------
CREATE TABLE asset_categories (
    category_id                SERIAL       PRIMARY KEY,
    category_name              VARCHAR(50)  NOT NULL UNIQUE,
    default_sla_hours          SMALLINT     NOT NULL,
    maintenance_interval_days  SMALLINT     NOT NULL,
    CONSTRAINT chk_cat_sla      CHECK (default_sla_hours BETWEEN 1 AND 720),
    CONSTRAINT chk_cat_interval CHECK (maintenance_interval_days BETWEEN 7 AND 730)
);

-- ---------------------------------------------------------------------
-- 6. ASSETS
-- ---------------------------------------------------------------------
CREATE TABLE assets (
    asset_id               SERIAL        PRIMARY KEY,
    asset_tag              VARCHAR(20)   NOT NULL UNIQUE,
    asset_name             VARCHAR(100)  NOT NULL,
    category_id            INT           NOT NULL REFERENCES asset_categories(category_id),
    room_id                INT           NOT NULL REFERENCES rooms(room_id) ON DELETE RESTRICT,
    manufacturer           VARCHAR(60),
    install_date           DATE          NOT NULL,
    criticality            SMALLINT      NOT NULL DEFAULT 3,  -- 1..5
    status                 VARCHAR(20)   NOT NULL DEFAULT 'OPERATIONAL',
    last_maintenance_date  DATE,
    CONSTRAINT chk_asset_tag_fmt   CHECK (asset_tag ~ '^[A-Z]{2,4}-[A-Z0-9]{2,6}-[0-9]{3}$'),
    CONSTRAINT chk_asset_crit      CHECK (criticality BETWEEN 1 AND 5),
    CONSTRAINT chk_asset_status    CHECK (status IN ('OPERATIONAL','UNDER_REPAIR','DECOMMISSIONED')),
    CONSTRAINT chk_install_date    CHECK (install_date <= CURRENT_DATE),
    CONSTRAINT chk_maint_after_install CHECK (last_maintenance_date IS NULL OR last_maintenance_date >= install_date)
);

-- ---------------------------------------------------------------------
-- 7. TECHNICIANS  (ISA specialisation of USERS : 1-to-1, shared PK)
-- ---------------------------------------------------------------------
CREATE TABLE technicians (
    technician_id        INT           PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    employee_code        VARCHAR(12)   NOT NULL UNIQUE,
    hourly_rate          NUMERIC(8,2)  NOT NULL,
    max_concurrent_jobs  SMALLINT      NOT NULL DEFAULT 4,
    is_available         BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_emp_code   CHECK (employee_code ~ '^TECH[0-9]{3,6}$'),
    CONSTRAINT chk_rate       CHECK (hourly_rate > 0 AND hourly_rate <= 5000),
    CONSTRAINT chk_max_jobs   CHECK (max_concurrent_jobs BETWEEN 1 AND 10)
);

-- ---------------------------------------------------------------------
-- 8. TECHNICIAN SKILLS  (M:N between technicians and categories)
-- ---------------------------------------------------------------------
CREATE TABLE technician_skills (
    technician_id  INT       NOT NULL REFERENCES technicians(technician_id) ON DELETE CASCADE,
    category_id    INT       NOT NULL REFERENCES asset_categories(category_id) ON DELETE CASCADE,
    skill_level    SMALLINT  NOT NULL DEFAULT 3,
    PRIMARY KEY (technician_id, category_id),
    CONSTRAINT chk_skill_level CHECK (skill_level BETWEEN 1 AND 5)
);

-- ---------------------------------------------------------------------
-- 9. SLA POLICIES  (priority level -> response / resolution targets)
-- ---------------------------------------------------------------------
CREATE TABLE sla_policies (
    priority_level    CHAR(2)       PRIMARY KEY,
    label             VARCHAR(20)   NOT NULL UNIQUE,
    min_score         NUMERIC(5,2)  NOT NULL UNIQUE,
    response_hours    SMALLINT      NOT NULL,
    resolution_hours  SMALLINT      NOT NULL,
    CONSTRAINT chk_priority_code CHECK (priority_level IN ('P1','P2','P3','P4')),
    CONSTRAINT chk_min_score     CHECK (min_score BETWEEN 0 AND 100),
    CONSTRAINT chk_sla_order     CHECK (response_hours > 0 AND resolution_hours >= response_hours)
);

-- ---------------------------------------------------------------------
-- 10. INCIDENT STATUS TRANSITIONS  (data-driven state machine)
-- ---------------------------------------------------------------------
CREATE TABLE incident_status_transitions (
    from_status  VARCHAR(15) NOT NULL,
    to_status    VARCHAR(15) NOT NULL,
    PRIMARY KEY (from_status, to_status),
    CONSTRAINT chk_not_self CHECK (from_status <> to_status)
);

-- ---------------------------------------------------------------------
-- 11. INCIDENTS
-- ---------------------------------------------------------------------
CREATE TABLE incidents (
    incident_id      SERIAL        PRIMARY KEY,
    title            VARCHAR(150)  NOT NULL,
    description      TEXT          NOT NULL,
    incident_type    VARCHAR(12)   NOT NULL DEFAULT 'REACTIVE',
    reported_by      INT           NOT NULL REFERENCES users(user_id),
    room_id          INT           NOT NULL REFERENCES rooms(room_id),
    asset_id         INT           REFERENCES assets(asset_id) ON DELETE SET NULL,
    category_id      INT           NOT NULL REFERENCES asset_categories(category_id),
    severity         SMALLINT      NOT NULL,
    affected_users   INT           NOT NULL DEFAULT 1,
    escalation_level SMALLINT      NOT NULL DEFAULT 0,
    status           VARCHAR(15)   NOT NULL DEFAULT 'OPEN',
    priority_score   NUMERIC(5,2)  NOT NULL DEFAULT 0,     -- computed by trigger
    priority_level   CHAR(2)       REFERENCES sla_policies(priority_level),
    sla_due_at       TIMESTAMPTZ,                           -- computed by trigger
    reported_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    resolved_at      TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_title_len     CHECK (char_length(trim(title)) BETWEEN 5 AND 150),
    CONSTRAINT chk_desc_len      CHECK (char_length(trim(description)) >= 10),
    CONSTRAINT chk_inc_type      CHECK (incident_type IN ('REACTIVE','PREVENTIVE')),
    CONSTRAINT chk_severity      CHECK (severity BETWEEN 1 AND 5),
    CONSTRAINT chk_affected      CHECK (affected_users BETWEEN 1 AND 5000),
    CONSTRAINT chk_escalation    CHECK (escalation_level BETWEEN 0 AND 3),
    CONSTRAINT chk_inc_status    CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD','RESOLVED','CLOSED','DUPLICATE','CANCELLED')),
    CONSTRAINT chk_score_range   CHECK (priority_score BETWEEN 0 AND 100),
    CONSTRAINT chk_resolved_time CHECK (resolved_at IS NULL OR resolved_at >= reported_at),
    CONSTRAINT chk_resolved_state CHECK (
        (status IN ('RESOLVED','CLOSED') AND resolved_at IS NOT NULL) OR
        (status NOT IN ('RESOLVED','CLOSED') AND resolved_at IS NULL))
);

-- ---------------------------------------------------------------------
-- 12. INCIDENT EMBEDDINGS  (VECTOR DATABASE part : pgvector)
--     384-dimensional sentence embeddings (all-MiniLM-L6-v2)
-- ---------------------------------------------------------------------
CREATE TABLE incident_embeddings (
    incident_id   INT           PRIMARY KEY REFERENCES incidents(incident_id) ON DELETE CASCADE,
    embedding     vector(384)   NOT NULL,
    model_name    VARCHAR(60)   NOT NULL DEFAULT 'Xenova/all-MiniLM-L6-v2',
    source_text   TEXT          NOT NULL,          -- exact text that was embedded (metadata)
    embedded_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 13. INCIDENT REPORTERS  ("Me too" confirmations -> M:N users/incidents)
-- ---------------------------------------------------------------------
CREATE TABLE incident_reporters (
    incident_id  INT          NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
    user_id      INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    joined_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (incident_id, user_id)
);

-- ---------------------------------------------------------------------
-- 14. INCIDENT STATUS HISTORY  (filled automatically by trigger)
-- ---------------------------------------------------------------------
CREATE TABLE incident_status_history (
    history_id   BIGSERIAL    PRIMARY KEY,
    incident_id  INT          NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
    old_status   VARCHAR(15),
    new_status   VARCHAR(15)  NOT NULL,
    changed_by   INT          REFERENCES users(user_id) ON DELETE SET NULL,
    changed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 15. WORK ORDERS
-- ---------------------------------------------------------------------
CREATE TABLE work_orders (
    work_order_id     SERIAL        PRIMARY KEY,
    incident_id       INT           NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
    technician_id     INT           NOT NULL REFERENCES technicians(technician_id),
    assigned_by       INT           REFERENCES users(user_id) ON DELETE SET NULL,
    status            VARCHAR(12)   NOT NULL DEFAULT 'ASSIGNED',
    assigned_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    labour_hours      NUMERIC(5,2)  NOT NULL DEFAULT 0,
    resolution_notes  TEXT,
    CONSTRAINT chk_wo_status   CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
    CONSTRAINT chk_wo_hours    CHECK (labour_hours BETWEEN 0 AND 200),
    CONSTRAINT chk_wo_started  CHECK (started_at IS NULL OR started_at >= assigned_at),
    CONSTRAINT chk_wo_complete CHECK (completed_at IS NULL OR completed_at >= COALESCE(started_at, assigned_at)),
    CONSTRAINT chk_wo_done_has_notes CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND resolution_notes IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- 16. SPARE PARTS  (inventory)
-- ---------------------------------------------------------------------
CREATE TABLE spare_parts (
    part_id            SERIAL        PRIMARY KEY,
    part_code          VARCHAR(20)   NOT NULL UNIQUE,
    part_name          VARCHAR(100)  NOT NULL,
    category_id        INT           NOT NULL REFERENCES asset_categories(category_id),
    unit_cost          NUMERIC(10,2) NOT NULL,
    quantity_in_stock  INT           NOT NULL DEFAULT 0,
    reorder_level      INT           NOT NULL DEFAULT 5,
    CONSTRAINT chk_part_cost   CHECK (unit_cost > 0),
    CONSTRAINT chk_part_stock  CHECK (quantity_in_stock >= 0),      -- inventory can never go negative
    CONSTRAINT chk_part_reorder CHECK (reorder_level >= 0)
);

-- ---------------------------------------------------------------------
-- 17. WORK ORDER PARTS  (M:N between work orders and spare parts)
-- ---------------------------------------------------------------------
CREATE TABLE work_order_parts (
    work_order_id    INT            NOT NULL REFERENCES work_orders(work_order_id) ON DELETE CASCADE,
    part_id          INT            NOT NULL REFERENCES spare_parts(part_id),
    quantity_used    INT            NOT NULL,
    unit_cost_at_use NUMERIC(10,2)  NOT NULL,   -- historical price (cost can change later)
    PRIMARY KEY (work_order_id, part_id),
    CONSTRAINT chk_qty_used CHECK (quantity_used > 0)
);

-- ---------------------------------------------------------------------
-- 18. MAINTENANCE RECORDS
-- ---------------------------------------------------------------------
CREATE TABLE maintenance_records (
    record_id         SERIAL         PRIMARY KEY,
    asset_id          INT            NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    work_order_id     INT            UNIQUE REFERENCES work_orders(work_order_id) ON DELETE SET NULL,
    maintenance_type  VARCHAR(12)    NOT NULL,
    performed_on      DATE           NOT NULL DEFAULT CURRENT_DATE,
    labour_cost       NUMERIC(10,2)  NOT NULL DEFAULT 0,
    parts_cost        NUMERIC(10,2)  NOT NULL DEFAULT 0,
    total_cost        NUMERIC(12,2)  GENERATED ALWAYS AS (labour_cost + parts_cost) STORED,
    notes             TEXT,
    CONSTRAINT chk_mr_type  CHECK (maintenance_type IN ('CORRECTIVE','PREVENTIVE')),
    CONSTRAINT chk_mr_costs CHECK (labour_cost >= 0 AND parts_cost >= 0)
);

-- ---------------------------------------------------------------------
-- 19. ALERTS  (generated by triggers / procedures)
-- ---------------------------------------------------------------------
CREATE TABLE alerts (
    alert_id        BIGSERIAL     PRIMARY KEY,
    alert_type      VARCHAR(20)   NOT NULL,
    alert_level     VARCHAR(10)   NOT NULL DEFAULT 'INFO',
    message         TEXT          NOT NULL,
    target_role     VARCHAR(30),
    target_user_id  INT           REFERENCES users(user_id) ON DELETE CASCADE,
    incident_id     INT           REFERENCES incidents(incident_id) ON DELETE CASCADE,
    part_id         INT           REFERENCES spare_parts(part_id) ON DELETE CASCADE,
    asset_id        INT           REFERENCES assets(asset_id) ON DELETE CASCADE,
    is_read         BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_alert_type  CHECK (alert_type IN ('LOW_STOCK','SLA_BREACH','STATUS_CHANGE','ASSIGNMENT','HIGH_RISK_ASSET','DUPLICATE')),
    CONSTRAINT chk_alert_level CHECK (alert_level IN ('INFO','WARNING','CRITICAL')),
    CONSTRAINT chk_alert_target CHECK (target_role IS NOT NULL OR target_user_id IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 20. AUDIT LOG  (generic row-level audit trail, JSONB snapshots)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    audit_id     BIGSERIAL    PRIMARY KEY,
    table_name   VARCHAR(60)  NOT NULL,
    operation    VARCHAR(6)   NOT NULL,
    row_pk       TEXT,
    old_data     JSONB,
    new_data     JSONB,
    changed_by   INT,
    changed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_audit_op CHECK (operation IN ('INSERT','UPDATE','DELETE'))
);
