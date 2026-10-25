-- =====================================================================
-- ResolveX : 05_triggers.sql
-- TRIGGERS : database-level validation, automation and auditing.
--
--  Trigger                         Table               When
--  ------------------------------  ------------------  ------------------------------
--  trg_incident_validate           incidents           BEFORE INSERT/UPDATE  (cross-table checks)
--  trg_incident_priority           incidents           BEFORE INSERT/UPDATE  (auto priority + SLA)
--  trg_incident_status_guard       incidents           BEFORE UPDATE OF status (state machine)
--  trg_incident_status_log         incidents           AFTER INSERT/UPDATE OF status (history + notify)
--  trg_incident_reporter_guard     incident_reporters  BEFORE INSERT
--  trg_incident_reporter_count     incident_reporters  AFTER INSERT/DELETE (affected_users +/- 1)
--  trg_technician_role             technicians         BEFORE INSERT/UPDATE
--  trg_work_order_validate         work_orders         BEFORE INSERT (skill + capacity)
--  trg_work_order_assigned_alert   work_orders         AFTER INSERT
--  trg_work_order_sync             work_orders         AFTER UPDATE OF status
--  trg_low_stock_alert             spare_parts         AFTER UPDATE OF quantity_in_stock
--  trg_audit_*                     several tables      AFTER INSERT/UPDATE/DELETE
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cross-table validation of an incident
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_incident_validate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_asset assets%ROWTYPE;
BEGIN
    IF NEW.asset_id IS NOT NULL THEN
        SELECT * INTO v_asset FROM assets WHERE asset_id = NEW.asset_id;
        IF v_asset.room_id <> NEW.room_id THEN
            RAISE EXCEPTION 'Asset % is not located in the selected room', v_asset.asset_tag
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_asset.category_id <> NEW.category_id THEN
            RAISE EXCEPTION 'Incident category must match the category of asset %', v_asset.asset_tag
                USING ERRCODE = 'check_violation';
        END IF;
        IF TG_OP = 'INSERT' AND v_asset.status = 'DECOMMISSIONED' THEN
            RAISE EXCEPTION 'Asset % is decommissioned and cannot receive new incidents', v_asset.asset_tag
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- a user with an inactive account cannot report
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.reported_by AND is_active) THEN
        RAISE EXCEPTION 'Inactive users cannot report incidents' USING ERRCODE = 'check_violation';
    END IF;

    NEW.title := trim(NEW.title);
    NEW.description := trim(NEW.description);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_incident_validate
BEFORE INSERT OR UPDATE OF asset_id, room_id, category_id ON incidents
FOR EACH ROW EXECUTE FUNCTION trgfn_incident_validate();

-- ---------------------------------------------------------------------
-- 2. Automatic priority scoring + SLA deadline
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_incident_priority()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_hours SMALLINT;
BEGIN
    NEW.priority_score := fn_priority_score(NEW.severity, NEW.affected_users, NEW.asset_id,
                                            NEW.room_id, NEW.category_id, NEW.escalation_level,
                                            NEW.reported_at,
                                            CASE WHEN TG_OP = 'UPDATE' THEN NEW.incident_id END);
    NEW.priority_level := fn_priority_level(NEW.priority_score);

    SELECT resolution_hours INTO v_hours FROM sla_policies WHERE priority_level = NEW.priority_level;
    NEW.sla_due_at := NEW.reported_at + make_interval(hours => v_hours);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_incident_priority
BEFORE INSERT OR UPDATE OF severity, affected_users, asset_id, room_id, category_id, escalation_level
ON incidents
FOR EACH ROW EXECUTE FUNCTION trgfn_incident_priority();

-- ---------------------------------------------------------------------
-- 3. State machine guard: only transitions listed in
--    incident_status_transitions are allowed. Also maintains resolved_at.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_incident_status_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT EXISTS (SELECT 1 FROM incident_status_transitions
                        WHERE from_status = OLD.status AND to_status = NEW.status) THEN
            RAISE EXCEPTION 'Invalid status change for incident %: % -> %', OLD.incident_id, OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;

        IF NEW.status = 'RESOLVED' THEN
            NEW.resolved_at := COALESCE(NEW.resolved_at, now());
        ELSIF NEW.status NOT IN ('RESOLVED','CLOSED') THEN
            NEW.resolved_at := NULL;          -- re-opened
            NEW.feedback_rating := NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_incident_status_guard
BEFORE UPDATE ON incidents
FOR EACH ROW EXECUTE FUNCTION trgfn_incident_status_guard();

-- ---------------------------------------------------------------------
-- 4. Status history + reporter notification
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_incident_status_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, changed_at)
        VALUES (NEW.incident_id, NULL, NEW.status, COALESCE(fn_current_app_user(), NEW.reported_by), NEW.reported_at);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by)
        VALUES (NEW.incident_id, OLD.status, NEW.status, fn_current_app_user());

        IF NEW.status NOT IN ('DUPLICATE') THEN
            INSERT INTO alerts (alert_type, alert_level, message, target_user_id, incident_id)
            VALUES ('STATUS_CHANGE', 'INFO',
                    format('Incident #%s "%s" changed from %s to %s', NEW.incident_id, NEW.title, OLD.status, NEW.status),
                    NEW.reported_by, NEW.incident_id);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_incident_status_log
AFTER INSERT OR UPDATE OF status ON incidents
FOR EACH ROW EXECUTE FUNCTION trgfn_incident_status_log();

-- ---------------------------------------------------------------------
-- 5. "Me too" co-reporters
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_incident_reporter_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_inc incidents%ROWTYPE;
BEGIN
    SELECT * INTO v_inc FROM incidents WHERE incident_id = NEW.incident_id;
    IF v_inc.reported_by = NEW.user_id THEN
        RAISE EXCEPTION 'You are already the original reporter of this incident' USING ERRCODE = 'check_violation';
    END IF;
    IF v_inc.status NOT IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD') THEN
        RAISE EXCEPTION 'Incident #% is % and no longer accepts confirmations', v_inc.incident_id, v_inc.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_incident_reporter_guard
BEFORE INSERT ON incident_reporters
FOR EACH ROW EXECUTE FUNCTION trgfn_incident_reporter_guard();

CREATE OR REPLACE FUNCTION trgfn_incident_reporter_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- fires trg_incident_priority -> priority is recomputed automatically
    IF TG_OP = 'INSERT' THEN
        UPDATE incidents SET affected_users = LEAST(affected_users + 1, 5000)
         WHERE incident_id = NEW.incident_id;
    ELSE  -- DELETE: a co-reporter withdrew their confirmation
        UPDATE incidents SET affected_users = GREATEST(affected_users - 1, 1)
         WHERE incident_id = OLD.incident_id
           AND status IN ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD');
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_incident_reporter_count
AFTER INSERT OR DELETE ON incident_reporters
FOR EACH ROW EXECUTE FUNCTION trgfn_incident_reporter_count();

-- ---------------------------------------------------------------------
-- 6. A technician row may only belong to a user whose role is TECHNICIAN
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_technician_role()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.role_id = u.role_id
                    WHERE u.user_id = NEW.technician_id AND r.role_name = 'TECHNICIAN') THEN
        RAISE EXCEPTION 'User % does not have the TECHNICIAN role', NEW.technician_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_technician_role
BEFORE INSERT OR UPDATE ON technicians
FOR EACH ROW EXECUTE FUNCTION trgfn_technician_role();

-- ---------------------------------------------------------------------
-- 7. Work order validation: technician must be available, have the skill
--    for the incident category and be below the concurrent job limit
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_work_order_validate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_tech    technicians%ROWTYPE;
    v_cat     INT;
    v_active  INT;
BEGIN
    SELECT * INTO v_tech FROM technicians WHERE technician_id = NEW.technician_id;
    SELECT category_id INTO v_cat FROM incidents WHERE incident_id = NEW.incident_id;

    IF NOT v_tech.is_available THEN
        RAISE EXCEPTION 'Technician % is currently unavailable', v_tech.employee_code USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM technician_skills
                    WHERE technician_id = NEW.technician_id AND category_id = v_cat) THEN
        RAISE EXCEPTION 'Technician % is not skilled for this incident category', v_tech.employee_code
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT COUNT(*) INTO v_active FROM work_orders
     WHERE technician_id = NEW.technician_id AND status IN ('ASSIGNED','IN_PROGRESS');
    IF v_active >= v_tech.max_concurrent_jobs THEN
        RAISE EXCEPTION 'Technician % already has % active jobs (limit %)', v_tech.employee_code, v_active, v_tech.max_concurrent_jobs
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_order_validate
BEFORE INSERT ON work_orders
FOR EACH ROW EXECUTE FUNCTION trgfn_work_order_validate();

CREATE OR REPLACE FUNCTION trgfn_work_order_assigned_alert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO alerts (alert_type, alert_level, message, target_user_id, incident_id)
    SELECT 'ASSIGNMENT', CASE WHEN i.priority_level IN ('P1','P2') THEN 'WARNING' ELSE 'INFO' END,
           format('New work order #%s for incident #%s "%s" (%s)', NEW.work_order_id, i.incident_id, i.title, i.priority_level),
           NEW.technician_id, i.incident_id
      FROM incidents i WHERE i.incident_id = NEW.incident_id;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_work_order_assigned_alert
AFTER INSERT ON work_orders
FOR EACH ROW EXECUTE FUNCTION trgfn_work_order_assigned_alert();

-- ---------------------------------------------------------------------
-- 8. Keep incident + asset state in sync with the work order state
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_work_order_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_asset INT;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NULL;
    END IF;

    SELECT asset_id INTO v_asset FROM incidents WHERE incident_id = NEW.incident_id;

    IF NEW.status = 'IN_PROGRESS' THEN
        UPDATE incidents SET status = 'IN_PROGRESS'
         WHERE incident_id = NEW.incident_id AND status <> 'IN_PROGRESS';
        UPDATE assets SET status = 'UNDER_REPAIR' WHERE asset_id = v_asset AND status = 'OPERATIONAL';

    ELSIF NEW.status = 'COMPLETED' THEN
        UPDATE incidents SET status = 'RESOLVED' WHERE incident_id = NEW.incident_id;
        UPDATE assets SET status = 'OPERATIONAL', last_maintenance_date = CURRENT_DATE
         WHERE asset_id = v_asset AND status <> 'DECOMMISSIONED';

    ELSIF NEW.status = 'CANCELLED' THEN
        UPDATE incidents SET status = 'OPEN'
         WHERE incident_id = NEW.incident_id AND status IN ('ASSIGNED','IN_PROGRESS','ON_HOLD');
        UPDATE assets SET status = 'OPERATIONAL' WHERE asset_id = v_asset AND status = 'UNDER_REPAIR';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_work_order_sync
AFTER UPDATE OF status ON work_orders
FOR EACH ROW EXECUTE FUNCTION trgfn_work_order_sync();

-- ---------------------------------------------------------------------
-- 9. Low stock alert when stock crosses the reorder level
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_low_stock_alert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.quantity_in_stock <= NEW.reorder_level AND OLD.quantity_in_stock > OLD.reorder_level THEN
        INSERT INTO alerts (alert_type, alert_level, message, target_role, part_id)
        VALUES ('LOW_STOCK',
                CASE WHEN NEW.quantity_in_stock = 0 THEN 'CRITICAL' ELSE 'WARNING' END,
                format('Low stock: %s (%s) has %s left, reorder level is %s',
                       NEW.part_name, NEW.part_code, NEW.quantity_in_stock, NEW.reorder_level),
                'ADMIN', NEW.part_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_low_stock_alert
AFTER UPDATE OF quantity_in_stock ON spare_parts
FOR EACH ROW EXECUTE FUNCTION trgfn_low_stock_alert();

-- ---------------------------------------------------------------------
-- 10. Generic AUDIT trigger (JSONB before/after snapshot).
--     Password hashes are stripped from the snapshot.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trgfn_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    -- password_hash is secret; risk_score is derived data recomputed in bulk
    v_old JSONB := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'password_hash' - 'risk_score' END;
    v_new JSONB := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'password_hash' - 'risk_score' END;
    v_pk  TEXT  := TG_ARGV[0];
BEGIN
    IF TG_OP = 'UPDATE' AND v_old = v_new THEN
        RETURN NULL;                      -- nothing really changed
    END IF;
    INSERT INTO audit_log (table_name, operation, row_pk, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, TG_OP, COALESCE(v_new, v_old) ->> v_pk, v_old, v_new, fn_current_app_user());
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_users        AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION trgfn_audit('user_id');
CREATE TRIGGER trg_audit_assets       AFTER INSERT OR UPDATE OR DELETE ON assets
FOR EACH ROW EXECUTE FUNCTION trgfn_audit('asset_id');
CREATE TRIGGER trg_audit_spare_parts  AFTER INSERT OR UPDATE OR DELETE ON spare_parts
FOR EACH ROW EXECUTE FUNCTION trgfn_audit('part_id');
CREATE TRIGGER trg_audit_work_orders  AFTER INSERT OR UPDATE OR DELETE ON work_orders
FOR EACH ROW EXECUTE FUNCTION trgfn_audit('work_order_id');
CREATE TRIGGER trg_audit_sla_policies AFTER INSERT OR UPDATE OR DELETE ON sla_policies
FOR EACH ROW EXECUTE FUNCTION trgfn_audit('priority_level');
CREATE TRIGGER trg_audit_technicians  AFTER INSERT OR UPDATE OR DELETE ON technicians
FOR EACH ROW EXECUTE FUNCTION trgfn_audit('technician_id');
