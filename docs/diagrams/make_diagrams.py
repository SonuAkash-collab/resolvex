"""
Generates the ER diagram (Chen notation) and the relational schema diagram
with Graphviz.  Usage:  python docs/diagrams/make_diagrams.py
Output: docs/diagrams/er_diagram.png/.svg, relational_schema.png/.svg
"""
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent

INK = "#1b2422"
ENT_FILL = "#fff7d6"
REL_FILL = "#e6eeea"
ATTR_FILL = "#ffffff"

# ------------------------------------------------------------------ Chen ER diagram
entities = {
    # name: (weak?, [attributes]) ; attribute prefix: * key, ~ partial key, / derived, + multivalued(none), # composite(none)
    "USER": (False, ["*user_id", "full_name", "email", "password_hash", "phone", "is_active"]),
    "ROLE": (False, ["*role_id", "role_name"]),
    "TECHNICIAN": (False, ["employee_code", "hourly_rate", "max_concurrent_jobs", "is_available"]),
    "BUILDING": (False, ["*building_id", "building_code", "building_name", "building_type", "importance_level"]),
    "ROOM": (True, ["~room_number", "floor_no", "room_type", "capacity"]),
    "ASSET_CATEGORY": (False, ["*category_id", "category_name", "default_sla_hours", "maintenance_interval_days"]),
    "ASSET": (False, ["*asset_id", "asset_tag", "asset_name", "criticality", "status", "install_date", "/risk_score"]),
    "INCIDENT": (False, ["*incident_id", "title", "description", "severity", "affected_users", "status", "/priority_score", "/sla_due_at", "reported_at"]),
    "SLA_POLICY": (False, ["*priority_level", "min_score", "response_hours", "resolution_hours"]),
    "INCIDENT_EMBEDDING": (True, ["embedding vector(384)", "model_name", "source_text"]),
    "STATUS_HISTORY": (True, ["~history_id", "old_status", "new_status", "changed_at"]),
    "WORK_ORDER": (False, ["*work_order_id", "status", "assigned_at", "completed_at", "labour_hours", "resolution_notes"]),
    "SPARE_PART": (False, ["*part_id", "part_code", "part_name", "unit_cost", "quantity_in_stock", "reorder_level"]),
    "MAINTENANCE_RECORD": (False, ["*record_id", "maintenance_type", "performed_on", "labour_cost", "parts_cost", "/total_cost"]),
    "ALERT": (False, ["*alert_id", "alert_type", "message", "is_read"]),
}

# (name, entity A, card A, entity B, card B, identifying?, [relationship attributes], total participation of A?, of B?)
relationships = [
    ("HAS_ROLE", "USER", "N", "ROLE", "1", False, [], True, False),
    ("SKILLED_IN", "TECHNICIAN", "M", "ASSET_CATEGORY", "N", False, ["skill_level"], True, False),
    ("CONTAINS", "BUILDING", "1", "ROOM", "N", True, [], False, True),
    ("LOCATED_IN", "ASSET", "N", "ROOM", "1", False, [], True, False),
    ("BELONGS_TO", "ASSET", "N", "ASSET_CATEGORY", "1", False, [], True, False),
    ("REPORTS", "USER", "1", "INCIDENT", "N", False, [], False, True),
    ("CONFIRMS", "USER", "M", "INCIDENT", "N", False, ["joined_at"], False, False),
    ("OCCURS_IN", "INCIDENT", "N", "ROOM", "1", False, [], True, False),
    ("CONCERNS", "INCIDENT", "N", "ASSET", "1", False, [], False, False),
    ("CLASSIFIED_AS", "INCIDENT", "N", "ASSET_CATEGORY", "1", False, [], True, False),
    ("GOVERNED_BY", "INCIDENT", "N", "SLA_POLICY", "1", False, [], True, False),
    ("DUPLICATE_OF", "INCIDENT", "N", "INCIDENT", "1", False, [], False, False),
    ("HAS_VECTOR", "INCIDENT", "1", "INCIDENT_EMBEDDING", "1", True, [], False, True),
    ("LOGS", "INCIDENT", "1", "STATUS_HISTORY", "N", True, [], False, True),
    ("RESOLVED_BY", "INCIDENT", "1", "WORK_ORDER", "N", False, [], False, True),
    ("PERFORMS", "TECHNICIAN", "1", "WORK_ORDER", "N", False, [], False, True),
    ("USES", "WORK_ORDER", "M", "SPARE_PART", "N", False, ["quantity_used", "unit_cost_at_use"], False, False),
    ("STOCKED_FOR", "SPARE_PART", "N", "ASSET_CATEGORY", "1", False, [], True, False),
    ("PRODUCES", "WORK_ORDER", "1", "MAINTENANCE_RECORD", "1", False, [], False, False),
    ("SERVICED_IN", "ASSET", "1", "MAINTENANCE_RECORD", "N", False, [], False, True),
    ("NOTIFIES", "ALERT", "N", "USER", "1", False, [], False, False),
]


def attr_label(a):
    if a.startswith("*"):
        return f"<<U>{a[1:]}</U>>", "solid"
    if a.startswith("~"):
        return f"<<U>{a[1:]}</U>>", "dashed-underline"
    if a.startswith("/"):
        return f'"{a[1:]}"', "dashed"
    return f'"{a}"', "solid"


def chen():
    L = []
    w = L.append
    w("graph ER {")
    w('  graph [layout=neato, overlap=false, splines=true, sep="+14,14", esep="+6", fontname="Helvetica", bgcolor="white", pad=0.4, outputorder=edgesfirst];')
    w(f'  node [fontname="Helvetica", fontsize=11, color="{INK}", penwidth=1.2];')
    w(f'  edge [color="{INK}", penwidth=1.1, fontname="Helvetica-Bold", fontsize=12];')
    w('  label=<<B>ResolveX - Entity Relationship Diagram (Chen notation)</B><BR/><FONT POINT-SIZE="11">Rectangles = entities (double = weak), diamonds = relationships (double = identifying), ellipses = attributes (underlined = key; underlined in a weak entity = partial key; dashed ellipse = derived). Thick line = total participation. Triangle = ISA specialisation.</FONT>>; labelloc=t; fontsize=18;')
    # TECHNICIAN ISA
    for e, (weak, attrs) in entities.items():
        per = "peripheries=2" if weak else ""
        w(f'  "{e}" [shape=box, style="filled,bold", fillcolor="{ENT_FILL}", fontsize=13, fontname="Helvetica-Bold", width=1.6, height=0.55, {per}];')
        for i, a in enumerate(attrs):
            nid = f"{e}__{i}"
            lab, kind = attr_label(a)
            style = "filled,dashed" if kind == "dashed" else "filled"
            w(f'  "{nid}" [shape=ellipse, label={lab}, style="{style}", fillcolor="{ATTR_FILL}", fontsize=10, height=0.3];')
            w(f'  "{e}" -- "{nid}" [len=1.15, penwidth=0.8];')
    # ISA
    w(f'  "ISA" [shape=invtriangle, label="ISA", style=filled, fillcolor="{REL_FILL}", fontsize=11, width=0.7, height=0.55];')
    w('  "USER" -- "ISA" [len=1.2];')
    w('  "ISA" -- "TECHNICIAN" [len=1.2, penwidth=2.6];')
    for (name, a, ca, b, cb, ident, rattrs, tot_a, tot_b) in relationships:
        rid = f"R_{name}"
        per = "peripheries=2" if ident else ""
        w(f'  "{rid}" [shape=diamond, label="{name}", style=filled, fillcolor="{REL_FILL}", fontsize=10, {per}];')
        w(f'  "{a}" -- "{rid}" [label="{ca}", len=1.6 {", penwidth=2.8" if tot_a else ""}];')
        w(f'  "{rid}" -- "{b}" [label="{cb}", len=1.6 {", penwidth=2.8" if tot_b else ""}];')
        for i, ra in enumerate(rattrs):
            nid = f"{rid}__{i}"
            w(f'  "{nid}" [shape=ellipse, label="{ra}", style=filled, fillcolor="{ATTR_FILL}", fontsize=10, height=0.3];')
            w(f'  "{rid}" -- "{nid}" [len=1.0, penwidth=0.8];')
    w("}")
    return "\n".join(L)


# ------------------------------------------------------------------ relational schema diagram
tables = {
    "roles": ["role_id PK", "role_name UQ", "description"],
    "users": ["user_id PK", "full_name", "email UQ", "password_hash", "role_id FK", "phone", "is_active", "created_at"],
    "technicians": ["technician_id PK,FK", "employee_code UQ", "hourly_rate", "max_concurrent_jobs", "is_available"],
    "technician_skills": ["technician_id PK,FK", "category_id PK,FK", "skill_level"],
    "buildings": ["building_id PK", "building_code UQ", "building_name", "building_type", "importance_level", "total_floors"],
    "rooms": ["room_id PK", "building_id FK", "room_number", "floor_no", "room_type", "capacity"],
    "asset_categories": ["category_id PK", "category_name UQ", "default_sla_hours", "maintenance_interval_days"],
    "assets": ["asset_id PK", "asset_tag UQ", "asset_name", "category_id FK", "room_id FK", "manufacturer", "install_date", "criticality", "status", "last_maintenance_date", "risk_score"],
    "sla_policies": ["priority_level PK", "label UQ", "min_score UQ", "response_hours", "resolution_hours"],
    "incident_status_transitions": ["from_status PK", "to_status PK"],
    "incidents": ["incident_id PK", "title", "description", "incident_type", "reported_by FK", "room_id FK", "asset_id FK", "category_id FK", "severity", "affected_users", "escalation_level", "status", "priority_score", "priority_level FK", "sla_due_at", "reported_at", "resolved_at", "updated_at", "duplicate_of FK", "search_vector (tsvector)", "feedback_rating"],
    "incident_embeddings": ["incident_id PK,FK", "embedding vector(384)", "model_name", "source_text", "embedded_at"],
    "incident_reporters": ["incident_id PK,FK", "user_id PK,FK", "joined_at"],
    "incident_status_history": ["history_id PK", "incident_id FK", "old_status", "new_status", "changed_by FK", "changed_at"],
    "work_orders": ["work_order_id PK", "incident_id FK", "technician_id FK", "assigned_by FK", "status", "assigned_at", "started_at", "completed_at", "labour_hours", "resolution_notes"],
    "spare_parts": ["part_id PK", "part_code UQ", "part_name", "category_id FK", "unit_cost", "quantity_in_stock", "reorder_level"],
    "work_order_parts": ["work_order_id PK,FK", "part_id PK,FK", "quantity_used", "unit_cost_at_use"],
    "maintenance_records": ["record_id PK", "asset_id FK", "work_order_id FK,UQ", "maintenance_type", "performed_on", "labour_cost", "parts_cost", "total_cost (generated)", "notes"],
    "alerts": ["alert_id PK", "alert_type", "alert_level", "message", "target_role", "target_user_id FK", "incident_id FK", "part_id FK", "asset_id FK", "is_read", "created_at"],
    "audit_log": ["audit_id PK", "table_name", "operation", "row_pk", "old_data JSONB", "new_data JSONB", "changed_by", "changed_at"],
}
fks = [
    ("users", "role_id", "roles", "role_id"),
    ("technicians", "technician_id", "users", "user_id"),
    ("technician_skills", "technician_id", "technicians", "technician_id"),
    ("technician_skills", "category_id", "asset_categories", "category_id"),
    ("rooms", "building_id", "buildings", "building_id"),
    ("assets", "category_id", "asset_categories", "category_id"),
    ("assets", "room_id", "rooms", "room_id"),
    ("incidents", "reported_by", "users", "user_id"),
    ("incidents", "room_id", "rooms", "room_id"),
    ("incidents", "asset_id", "assets", "asset_id"),
    ("incidents", "category_id", "asset_categories", "category_id"),
    ("incidents", "priority_level", "sla_policies", "priority_level"),
    ("incidents", "duplicate_of", "incidents", "incident_id"),
    ("incident_embeddings", "incident_id", "incidents", "incident_id"),
    ("incident_reporters", "incident_id", "incidents", "incident_id"),
    ("incident_reporters", "user_id", "users", "user_id"),
    ("incident_status_history", "incident_id", "incidents", "incident_id"),
    ("incident_status_history", "changed_by", "users", "user_id"),
    ("work_orders", "incident_id", "incidents", "incident_id"),
    ("work_orders", "technician_id", "technicians", "technician_id"),
    ("work_orders", "assigned_by", "users", "user_id"),
    ("spare_parts", "category_id", "asset_categories", "category_id"),
    ("work_order_parts", "work_order_id", "work_orders", "work_order_id"),
    ("work_order_parts", "part_id", "spare_parts", "part_id"),
    ("maintenance_records", "asset_id", "assets", "asset_id"),
    ("maintenance_records", "work_order_id", "work_orders", "work_order_id"),
    ("alerts", "target_user_id", "users", "user_id"),
    ("alerts", "incident_id", "incidents", "incident_id"),
    ("alerts", "part_id", "spare_parts", "part_id"),
    ("alerts", "asset_id", "assets", "asset_id"),
]

GROUP = {
    "roles": "#e8eef3", "users": "#e8eef3", "technicians": "#e8eef3", "technician_skills": "#e8eef3",
    "buildings": "#eef3e8", "rooms": "#eef3e8", "asset_categories": "#eef3e8", "assets": "#eef3e8",
    "sla_policies": "#fff3d6", "incident_status_transitions": "#fff3d6", "incidents": "#fff3d6",
    "incident_embeddings": "#f6e3f0", "incident_reporters": "#fff3d6", "incident_status_history": "#fff3d6",
    "work_orders": "#f3e8e4", "spare_parts": "#f3e8e4", "work_order_parts": "#f3e8e4", "maintenance_records": "#f3e8e4",
    "alerts": "#ececec", "audit_log": "#ececec",
}


def schema():
    L = []
    w = L.append
    w("digraph Schema {")
    w('  graph [rankdir=LR, splines=true, nodesep=0.35, ranksep=1.1, fontname="Helvetica", pad=0.4, concentrate=false];')
    w('  label=<<B>ResolveX - Relational Schema (PostgreSQL)</B><BR/><FONT POINT-SIZE="11">PK = primary key, FK = foreign key, UQ = unique. Arrows point from the foreign key to the referenced primary key. Purple = pgvector table.</FONT>>; labelloc=t; fontsize=18;')
    w('  node [shape=plaintext, fontname="Helvetica"];')
    w(f'  edge [color="#3e5a57", arrowhead=normal, arrowsize=0.7, penwidth=1.0];')
    for t, cols in tables.items():
        rows = []
        for col in cols:
            name = col.split(" ")[0]
            tag = col[len(name):].strip()
            bold = "PK" in tag
            txt = f"<B>{name}</B>" if bold else name
            tagtxt = f'<FONT COLOR="#7a5300" POINT-SIZE="9">{tag}</FONT>' if tag else ""
            rows.append(f'<TR><TD PORT="{name}" ALIGN="LEFT" BALIGN="LEFT">{txt}  {tagtxt}</TD></TR>')
        html = (f'<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="3" COLOR="{INK}" BGCOLOR="white">'
                f'<TR><TD BGCOLOR="{GROUP[t]}"><B>{t}</B></TD></TR>' + "".join(rows) + "</TABLE>>")
        w(f'  "{t}" [label={html}];')
    for a, ac, b, bc in fks:
        w(f'  "{a}":"{ac}" -> "{b}":"{bc}";')
    w("}")
    return "\n".join(L)


def render(dot_src, name, engine):
    (HERE / f"{name}.dot").write_text(dot_src)
    for fmt in ("png", "svg"):
        args = [engine, f"-T{fmt}", str(HERE / f"{name}.dot"), "-o", str(HERE / f"{name}.{fmt}")]
        if fmt == "png":
            args.insert(1, "-Gdpi=130")
        subprocess.run(args, check=True)
    print("rendered", name)


if __name__ == "__main__":
    render(chen(), "er_diagram", "neato")
    render(schema(), "relational_schema", "dot")


# ------------------------------------------------------------------ architecture + state machine
ARCH = r'''
digraph Arch {
  graph [rankdir=LR, fontname="Helvetica", pad=0.4, nodesep=0.4, ranksep=0.9,
         label=<<B>ResolveX - System Architecture</B>>, labelloc=t, fontsize=18];
  node [fontname="Helvetica", fontsize=12, shape=box, style="rounded,filled", color="#1b2422", fillcolor="white"];
  edge [color="#3e5a57", fontname="Helvetica", fontsize=10];

  subgraph cluster_client { label="Browser"; style="rounded,dashed"; color="#7a8582"; fontsize=13;
    ui [label=<<B>Next.js React pages</B><BR/><FONT POINT-SIZE="10">Student/Staff: report, my reports, search<BR/>Technician: work orders, parts<BR/>Facility Manager: queue, analytics, assets<BR/>Admin: users, campus, audit, showcase</FONT>>, fillcolor="#fff7d6"];
  }
  subgraph cluster_server { label="Next.js server (Node.js)"; style="rounded"; color="#1b2422"; fontsize=13;
    mw [label=<<B>middleware.js</B><BR/><FONT POINT-SIZE="10">JWT cookie check, role based page access</FONT>>];
    api [label=<<B>Route Handlers /api/*</B><BR/><FONT POINT-SIZE="10">26 route handlers, requireRole(), input validation,<BR/>parameterised SQL, transactions</FONT>>, fillcolor="#e6eeea"];
    emb [label=<<B>lib/embeddings.js</B><BR/><FONT POINT-SIZE="10">Transformers.js, all-MiniLM-L6-v2<BR/>384-d normalised sentence vectors</FONT>>, fillcolor="#f6e3f0"];
    auth [label=<<B>lib/auth.js</B><BR/><FONT POINT-SIZE="10">bcrypt verify, jose JWT (HS256)</FONT>>];
    db [label=<<B>lib/db.js</B><BR/><FONT POINT-SIZE="10">pg connection pool, withTransaction()<BR/>credentials from .env.local</FONT>>];
  }
  subgraph cluster_pg { label="PostgreSQL 16 + pgvector"; style="rounded"; color="#1b2422"; fontsize=13;
    rel [label=<<B>Relational core</B><BR/><FONT POINT-SIZE="10">20 tables, 30 FKs, 57 CHECKs, UNIQUE,<BR/>generated columns, state machine table</FONT>>, fillcolor="#eef3e8"];
    logic [label=<<B>Database logic</B><BR/><FONT POINT-SIZE="10">17 triggers (12 trigger functions), 6 procedures,<BR/>9 functions,<BR/>7 views + 1 materialized view</FONT>>, fillcolor="#fff3d6"];
    vec [label=<<B>Vector store</B><BR/><FONT POINT-SIZE="10">incident_embeddings vector(384)<BR/>HNSW index, cosine distance &lt;=&gt;</FONT>>, fillcolor="#f6e3f0"];
    fts [label=<<B>Full-text search</B><BR/><FONT POINT-SIZE="10">tsvector column + GIN index</FONT>>, fillcolor="#eef3e8"];
    sec [label=<<B>Security</B><BR/><FONT POINT-SIZE="10">resolvex_app role (least privilege),<BR/>append-only audit log, SECURITY DEFINER</FONT>>, fillcolor="#ececec"];
  }
  ui -> mw [label="HTTPS + httpOnly cookie"];
  mw -> api;
  api -> auth;
  api -> emb [label="text"];
  emb -> api [label="vector", style=dashed];
  api -> db;
  db -> rel [label="SQL / CALL"];
  rel -> logic [dir=both, style=dashed, label="fires"];
  db -> vec [label="fn_similar_incidents\nfn_detect_duplicates"];
  db -> fts [label="fn_hybrid_search (RRF)"];
  rel -> sec [style=invis];
}
'''

STATES = r'''
digraph SM {
  graph [rankdir=LR, fontname="Helvetica", pad=0.3, label=<<B>Incident lifecycle (incident_status_transitions + trg_incident_status_guard)</B>>, labelloc=t, fontsize=15];
  node [fontname="Helvetica", shape=box, style="rounded,filled", fillcolor="white", color="#1b2422", fontsize=12];
  edge [color="#3e5a57", fontname="Helvetica", fontsize=9];
  OPEN [fillcolor="#dde8f3"]; ASSIGNED [fillcolor="#e9e3f5"]; IN_PROGRESS [fillcolor="#fdf0d0"]; ON_HOLD [fillcolor="#ecebe7"];
  RESOLVED [fillcolor="#dcefe3"]; CLOSED [fillcolor="#d5d9d7", peripheries=2]; DUPLICATE [fillcolor="#ece8f2", peripheries=2]; CANCELLED [fillcolor="#eeeeee", peripheries=2];
  OPEN -> ASSIGNED [label="sp_assign_technician"];
  OPEN -> DUPLICATE [label="sp_mark_duplicate"];
  OPEN -> CANCELLED;
  ASSIGNED -> IN_PROGRESS [label="work order started"];
  ASSIGNED -> OPEN [label="work order cancelled"];
  ASSIGNED -> ON_HOLD; ASSIGNED -> CANCELLED;
  IN_PROGRESS -> ON_HOLD [label="waiting for parts"];
  IN_PROGRESS -> RESOLVED [label="sp_complete_work_order"];
  IN_PROGRESS -> OPEN;
  ON_HOLD -> IN_PROGRESS; ON_HOLD -> ASSIGNED; ON_HOLD -> OPEN; ON_HOLD -> RESOLVED;
  RESOLVED -> CLOSED [label="reporter confirms"];
  RESOLVED -> OPEN [label="reopened"];
}
'''

if __name__ == "__main__":
    render(ARCH, "architecture", "dot")
    render(STATES, "incident_lifecycle", "dot")
