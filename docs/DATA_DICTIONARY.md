# Data dictionary

Generated from the live PostgreSQL catalog by `scripts/generate_data_dictionary.py`.
Key: PK primary key, FK foreign key, UQ unique, NN not null.

## roles

Lookup of the four application roles used for role based access control.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| role_id | smallint | NN | serial | PK |
| role_name | varchar(30) | NN |  | UQ |
| description | varchar(200) |  |  |  |

CHECK constraints:

- `chk_role_name`: `CHECK (((role_name)::text = ANY ((ARRAY['STUDENT_STAFF'::character varying, 'TECHNICIAN'::character varying, 'FACILITY_MANAGER'::character varying, 'ADMIN'::character varying])::text[])))`

## users

Every person who can log in. Passwords are stored only as bcrypt hashes.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| user_id | integer | NN | serial | PK |
| full_name | varchar(100) | NN |  |  |
| email | varchar(120) | NN |  | UQ |
| password_hash | varchar(100) | NN |  |  |
| role_id | smallint | NN |  | FK -> roles(role_id) |
| phone | varchar(15) |  |  |  |
| is_active | boolean | NN | true |  |
| created_at | timestamptz | NN | now() |  |

CHECK constraints:

- `chk_password_is_hash`: `CHECK (((password_hash)::text ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'::text))`
- `chk_user_email_fmt`: `CHECK (((email)::text ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text))`
- `chk_user_name_len`: `CHECK ((char_length(TRIM(BOTH FROM full_name)) >= 3))`
- `chk_user_phone_fmt`: `CHECK (((phone IS NULL) OR ((phone)::text ~ '^[6-9][0-9]{9}$'::text)))`

## technicians

Specialisation (ISA) of users with the TECHNICIAN role: rate, job limit, availability.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| technician_id | integer | NN |  | PK, FK -> users(user_id) |
| employee_code | varchar(12) | NN |  | UQ |
| hourly_rate | numeric(8,2) | NN |  |  |
| max_concurrent_jobs | smallint | NN | 4 |  |
| is_available | boolean | NN | true |  |

CHECK constraints:

- `chk_emp_code`: `CHECK (((employee_code)::text ~ '^TECH[0-9]{3,6}$'::text))`
- `chk_max_jobs`: `CHECK (((max_concurrent_jobs >= 1) AND (max_concurrent_jobs <= 10)))`
- `chk_rate`: `CHECK (((hourly_rate > (0)::numeric) AND (hourly_rate <= (5000)::numeric)))`

## technician_skills

M:N between technicians and asset categories, with a skill level.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| technician_id | integer | NN |  | PK, FK -> technicians(technician_id) |
| category_id | integer | NN |  | PK, FK -> asset_categories(category_id) |
| skill_level | smallint | NN | 3 |  |

CHECK constraints:

- `chk_skill_level`: `CHECK (((skill_level >= 1) AND (skill_level <= 5)))`

## buildings

Campus buildings with an importance level used in priority scoring.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| building_id | integer | NN | serial | PK |
| building_code | varchar(10) | NN |  | UQ |
| building_name | varchar(100) | NN |  |  |
| building_type | varchar(20) | NN |  |  |
| importance_level | smallint | NN | 3 |  |
| total_floors | smallint | NN |  |  |

CHECK constraints:

- `chk_building_type`: `CHECK (((building_type)::text = ANY ((ARRAY['ACADEMIC'::character varying, 'LAB'::character varying, 'HOSTEL'::character varying, 'LIBRARY'::character varying, 'ADMIN'::character varying, 'AUDITORIUM'::character varying,`
- `chk_floors`: `CHECK (((total_floors >= 1) AND (total_floors <= 30)))`
- `chk_importance`: `CHECK (((importance_level >= 1) AND (importance_level <= 5)))`

## rooms

Rooms / areas inside a building (unique room number per building).

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| room_id | integer | NN | serial | PK |
| building_id | integer | NN |  | UQ, FK -> buildings(building_id) |
| room_number | varchar(10) | NN |  | UQ |
| floor_no | smallint | NN |  |  |
| room_type | varchar(20) | NN |  |  |
| capacity | smallint | NN | 0 |  |

CHECK constraints:

- `chk_capacity`: `CHECK ((capacity >= 0))`
- `chk_floor_no`: `CHECK (((floor_no >= 0) AND (floor_no <= 30)))`
- `chk_room_type`: `CHECK (((room_type)::text = ANY ((ARRAY['CLASSROOM'::character varying, 'LAB'::character varying, 'OFFICE'::character varying, 'HOSTEL_ROOM'::character varying, 'WASHROOM'::character varying, 'CORRIDOR'::character varyin`

## asset_categories

Kinds of infrastructure; also the incident category and technician skill area.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| category_id | integer | NN | serial | PK |
| category_name | varchar(50) | NN |  | UQ |
| default_sla_hours | smallint | NN |  |  |
| maintenance_interval_days | smallint | NN |  |  |

CHECK constraints:

- `chk_cat_interval`: `CHECK (((maintenance_interval_days >= 7) AND (maintenance_interval_days <= 730)))`
- `chk_cat_sla`: `CHECK (((default_sla_hours >= 1) AND (default_sla_hours <= 720)))`

## assets

Registered equipment (AC units, lifts, projectors...) located in a room.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| asset_id | integer | NN | serial | PK |
| asset_tag | varchar(20) | NN |  | UQ |
| asset_name | varchar(100) | NN |  |  |
| category_id | integer | NN |  | FK -> asset_categories(category_id) |
| room_id | integer | NN |  | FK -> rooms(room_id) |
| manufacturer | varchar(60) |  |  |  |
| install_date | date | NN |  |  |
| criticality | smallint | NN | 3 |  |
| status | varchar(20) | NN | 'OPERATIONAL'::character varying |  |
| last_maintenance_date | date |  |  |  |
| risk_score | numeric(5,2) | NN | 0 |  |

CHECK constraints:

- `chk_asset_crit`: `CHECK (((criticality >= 1) AND (criticality <= 5)))`
- `chk_asset_risk`: `CHECK (((risk_score >= (0)::numeric) AND (risk_score <= (100)::numeric)))`
- `chk_asset_status`: `CHECK (((status)::text = ANY ((ARRAY['OPERATIONAL'::character varying, 'UNDER_REPAIR'::character varying, 'DECOMMISSIONED'::character varying])::text[])))`
- `chk_asset_tag_fmt`: `CHECK (((asset_tag)::text ~ '^[A-Z]{2,4}-[A-Z0-9]{2,6}-[0-9]{3}$'::text))`
- `chk_install_date`: `CHECK ((install_date <= CURRENT_DATE))`
- `chk_maint_after_install`: `CHECK (((last_maintenance_date IS NULL) OR (last_maintenance_date >= install_date)))`

## sla_policies

Priority levels P1-P4 with the score threshold and response / resolution targets.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| priority_level | char(2) | NN |  | PK |
| label | varchar(20) | NN |  | UQ |
| min_score | numeric(5,2) | NN |  | UQ |
| response_hours | smallint | NN |  |  |
| resolution_hours | smallint | NN |  |  |

CHECK constraints:

- `chk_min_score`: `CHECK (((min_score >= (0)::numeric) AND (min_score <= (100)::numeric)))`
- `chk_priority_code`: `CHECK ((priority_level = ANY (ARRAY['P1'::bpchar, 'P2'::bpchar, 'P3'::bpchar, 'P4'::bpchar])))`
- `chk_sla_order`: `CHECK (((response_hours > 0) AND (resolution_hours >= response_hours)))`

## incident_status_transitions

Allowed incident state changes (data-driven state machine).

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| from_status | varchar(15) | NN |  | PK |
| to_status | varchar(15) | NN |  | PK |

CHECK constraints:

- `chk_not_self`: `CHECK (((from_status)::text <> (to_status)::text))`
- `chk_transition_states`: `CHECK ((((from_status)::text = ANY ((ARRAY['OPEN'::character varying, 'ASSIGNED'::character varying, 'IN_PROGRESS'::character varying, 'ON_HOLD'::character varying, 'RESOLVED'::character varying, 'CLOSED'::character vary`

## incidents

Reported infrastructure problems. Priority, level and SLA deadline are computed by trigger.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| incident_id | integer | NN | serial | PK |
| title | varchar(150) | NN |  |  |
| description | text | NN |  |  |
| incident_type | varchar(12) | NN | 'REACTIVE'::character varying |  |
| reported_by | integer | NN |  | FK -> users(user_id) |
| room_id | integer | NN |  | FK -> rooms(room_id) |
| asset_id | integer |  |  | FK -> assets(asset_id) |
| category_id | integer | NN |  | FK -> asset_categories(category_id) |
| severity | smallint | NN |  |  |
| affected_users | integer | NN | 1 |  |
| escalation_level | smallint | NN | 0 |  |
| status | varchar(15) | NN | 'OPEN'::character varying |  |
| priority_score | numeric(5,2) | NN | 0 |  |
| priority_level | char(2) |  |  | FK -> sla_policies(priority_level) |
| sla_due_at | timestamptz |  |  |  |
| reported_at | timestamptz | NN | now() |  |
| resolved_at | timestamptz |  |  |  |
| updated_at | timestamptz | NN | now() |  |
| duplicate_of | integer |  |  | FK -> incidents(incident_id) |
| search_vector | tsvector |  | GENERATED |  |
| feedback_rating | smallint |  |  |  |

CHECK constraints:

- `chk_affected`: `CHECK (((affected_users >= 1) AND (affected_users <= 5000)))`
- `chk_desc_len`: `CHECK ((char_length(TRIM(BOTH FROM description)) >= 10))`
- `chk_duplicate_consistency`: `CHECK ((((status)::text = 'DUPLICATE'::text) = (duplicate_of IS NOT NULL)))`
- `chk_escalation`: `CHECK (((escalation_level >= 0) AND (escalation_level <= 3)))`
- `chk_feedback_after_resolve`: `CHECK (((feedback_rating IS NULL) OR ((status)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSED'::character varying])::text[]))))`
- `chk_feedback_rating`: `CHECK (((feedback_rating IS NULL) OR ((feedback_rating >= 1) AND (feedback_rating <= 5))))`
- `chk_inc_status`: `CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'ASSIGNED'::character varying, 'IN_PROGRESS'::character varying, 'ON_HOLD'::character varying, 'RESOLVED'::character varying, 'CLOSED'::character varying, '`
- `chk_inc_type`: `CHECK (((incident_type)::text = ANY ((ARRAY['REACTIVE'::character varying, 'PREVENTIVE'::character varying])::text[])))`
- `chk_not_duplicate_of_self`: `CHECK (((duplicate_of IS NULL) OR (duplicate_of <> incident_id)))`
- `chk_resolved_state`: `CHECK (((((status)::text = ANY ((ARRAY['RESOLVED'::character varying, 'CLOSED'::character varying])::text[])) AND (resolved_at IS NOT NULL)) OR (((status)::text <> ALL ((ARRAY['RESOLVED'::character varying, 'CLOSED'::cha`
- `chk_resolved_time`: `CHECK (((resolved_at IS NULL) OR (resolved_at >= reported_at)))`
- `chk_score_range`: `CHECK (((priority_score >= (0)::numeric) AND (priority_score <= (100)::numeric)))`
- `chk_severity`: `CHECK (((severity >= 1) AND (severity <= 5)))`
- `chk_title_len`: `CHECK (((char_length(TRIM(BOTH FROM title)) >= 5) AND (char_length(TRIM(BOTH FROM title)) <= 150)))`

## incident_embeddings

Vector store: 384-d sentence embedding of each incident (pgvector).

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| incident_id | integer | NN |  | PK, FK -> incidents(incident_id) |
| embedding | vector(384) | NN |  |  |
| model_name | varchar(60) | NN | 'Xenova/all-MiniLM-L6-v2'::character var |  |
| source_text | text | NN |  |  |
| embedded_at | timestamptz | NN | now() |  |

## incident_reporters

Users who confirmed an existing incident ('me too'), M:N users-incidents.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| incident_id | integer | NN |  | PK, FK -> incidents(incident_id) |
| user_id | integer | NN |  | PK, FK -> users(user_id) |
| joined_at | timestamptz | NN | now() |  |

## incident_status_history

Timeline of every status change, written by trigger.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| history_id | bigint | NN | serial | PK |
| incident_id | integer | NN |  | FK -> incidents(incident_id) |
| old_status | varchar(15) |  |  |  |
| new_status | varchar(15) | NN |  |  |
| changed_by | integer |  |  | FK -> users(user_id) |
| changed_at | timestamptz | NN | now() |  |

## work_orders

Assignment of an incident to a technician and the repair carried out.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| work_order_id | integer | NN | serial | PK |
| incident_id | integer | NN |  | FK -> incidents(incident_id) |
| technician_id | integer | NN |  | FK -> technicians(technician_id) |
| assigned_by | integer |  |  | FK -> users(user_id) |
| status | varchar(12) | NN | 'ASSIGNED'::character varying |  |
| assigned_at | timestamptz | NN | now() |  |
| started_at | timestamptz |  |  |  |
| completed_at | timestamptz |  |  |  |
| labour_hours | numeric(5,2) | NN | 0 |  |
| resolution_notes | text |  |  |  |

CHECK constraints:

- `chk_wo_complete`: `CHECK (((completed_at IS NULL) OR (completed_at >= COALESCE(started_at, assigned_at))))`
- `chk_wo_done_has_notes`: `CHECK ((((status)::text <> 'COMPLETED'::text) OR ((completed_at IS NOT NULL) AND (resolution_notes IS NOT NULL))))`
- `chk_wo_hours`: `CHECK (((labour_hours >= (0)::numeric) AND (labour_hours <= (200)::numeric)))`
- `chk_wo_started`: `CHECK (((started_at IS NULL) OR (started_at >= assigned_at)))`
- `chk_wo_status`: `CHECK (((status)::text = ANY ((ARRAY['ASSIGNED'::character varying, 'IN_PROGRESS'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying])::text[])))`

## spare_parts

Inventory of spare parts with stock and reorder level.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| part_id | integer | NN | serial | PK |
| part_code | varchar(20) | NN |  | UQ |
| part_name | varchar(100) | NN |  |  |
| category_id | integer | NN |  | FK -> asset_categories(category_id) |
| unit_cost | numeric(10,2) | NN |  |  |
| quantity_in_stock | integer | NN | 0 |  |
| reorder_level | integer | NN | 10 |  |

CHECK constraints:

- `chk_part_cost`: `CHECK ((unit_cost > (0)::numeric))`
- `chk_part_reorder`: `CHECK ((reorder_level >= 0))`
- `chk_part_stock`: `CHECK ((quantity_in_stock >= 0))`

## work_order_parts

M:N between work orders and spare parts with quantity and price at use.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| work_order_id | integer | NN |  | PK, FK -> work_orders(work_order_id) |
| part_id | integer | NN |  | PK, FK -> spare_parts(part_id) |
| quantity_used | integer | NN |  |  |
| unit_cost_at_use | numeric(10,2) | NN |  |  |

CHECK constraints:

- `chk_qty_used`: `CHECK ((quantity_used > 0))`

## maintenance_records

Cost record per repair / preventive service of an asset.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| record_id | integer | NN | serial | PK |
| asset_id | integer | NN |  | FK -> assets(asset_id) |
| work_order_id | integer |  |  | UQ, FK -> work_orders(work_order_id) |
| maintenance_type | varchar(12) | NN |  |  |
| performed_on | date | NN | CURRENT_DATE |  |
| labour_cost | numeric(10,2) | NN | 0 |  |
| parts_cost | numeric(10,2) | NN | 0 |  |
| total_cost | numeric(12,2) |  | GENERATED |  |
| notes | text |  |  |  |

CHECK constraints:

- `chk_mr_costs`: `CHECK (((labour_cost >= (0)::numeric) AND (parts_cost >= (0)::numeric)))`
- `chk_mr_type`: `CHECK (((maintenance_type)::text = ANY ((ARRAY['CORRECTIVE'::character varying, 'PREVENTIVE'::character varying])::text[])))`

## alerts

Notifications generated by triggers and procedures.

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| alert_id | bigint | NN | serial | PK |
| alert_type | varchar(20) | NN |  |  |
| alert_level | varchar(10) | NN | 'INFO'::character varying |  |
| message | text | NN |  |  |
| target_role | varchar(30) |  |  |  |
| target_user_id | integer |  |  | FK -> users(user_id) |
| incident_id | integer |  |  | FK -> incidents(incident_id) |
| part_id | integer |  |  | FK -> spare_parts(part_id) |
| asset_id | integer |  |  | FK -> assets(asset_id) |
| is_read | boolean | NN | false |  |
| created_at | timestamptz | NN | now() |  |

CHECK constraints:

- `chk_alert_level`: `CHECK (((alert_level)::text = ANY ((ARRAY['INFO'::character varying, 'WARNING'::character varying, 'CRITICAL'::character varying])::text[])))`
- `chk_alert_target`: `CHECK (((target_role IS NOT NULL) OR (target_user_id IS NOT NULL)))`
- `chk_alert_type`: `CHECK (((alert_type)::text = ANY ((ARRAY['LOW_STOCK'::character varying, 'SLA_BREACH'::character varying, 'STATUS_CHANGE'::character varying, 'ASSIGNMENT'::character varying, 'HIGH_RISK_ASSET'::character varying, 'DUPLIC`

## audit_log

Generic row-level audit trail (JSONB before / after).

| Column | Type | Null | Default | Keys |
|---|---|---|---|---|
| audit_id | bigint | NN | serial | PK |
| table_name | varchar(60) | NN |  |  |
| operation | varchar(6) | NN |  |  |
| row_pk | text |  |  |  |
| old_data | jsonb |  |  |  |
| new_data | jsonb |  |  |  |
| changed_by | integer |  |  |  |
| changed_at | timestamptz | NN | now() |  |

CHECK constraints:

- `chk_audit_op`: `CHECK (((operation)::text = ANY ((ARRAY['INSERT'::character varying, 'UPDATE'::character varying, 'DELETE'::character varying])::text[])))`
