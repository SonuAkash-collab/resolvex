// =====================================================================
// ResolveX - MongoDB (document store) design
//
// MongoDB holds the data that does NOT fit fixed relational columns:
//   inspection_templates  one document per equipment category; each has a
//                         DIFFERENT set of reading fields and checks
//   incident_notes        the discussion thread and technicians' field
//                         inspection logs of every incident; inspection
//                         readings have a different shape per category
//   search_events         an append-only log of searches, expired
//                         automatically after 90 days by a TTL index
//
// PostgreSQL stays the system of record for incidents, work orders, stock
// and money (ACID, foreign keys, RLS). A note refers to its incident by
// incident_id (a reference, not a foreign key: the app checks it).
//
// This file is used by scripts/setup-mongo.mjs (npm run db:setup).
// =====================================================================

export const ROLES = ["STUDENT_STAFF", "TECHNICIAN", "FACILITY_MANAGER", "ADMIN"];
export const VERDICTS = ["FIXED_ON_SITE", "NEEDS_PARTS", "NEEDS_VENDOR", "MONITOR", "NO_FAULT_FOUND"];
export const SEARCH_LOG_TTL_DAYS = 90;

// field types: number (min/max = allowed input, normal = healthy range), enum, bool, text
// (keys without a value are left out of the document instead of being stored as null)
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const num = (key, label, unit, min, max, normal) => defined({ key, label, type: "number", unit, min, max, normal_min: normal?.[0], normal_max: normal?.[1] });
const choice = (key, label, options, normal) => defined({ key, label, type: "enum", options, normal_values: normal });
const bool = (key, label, normal) => defined({ key, label, type: "bool", normal_value: normal });
const text = (key, label, max = 40) => ({ key, label, type: "text", max_length: max });

// One template per asset_categories row (category_id must match PostgreSQL).
export const TEMPLATES = [
  {
    _id: "HVAC", category_id: 1, category_name: "HVAC / Air Conditioning",
    fields: [
      num("supply_air_temp_c", "Supply air temperature", "°C", 0, 45, [8, 16]),
      num("room_temp_c", "Room temperature", "°C", 5, 50, [20, 27]),
      num("suction_pressure_psi", "Suction pressure", "psi", 0, 300, [110, 145]),
      choice("filter_condition", "Filter condition", ["Clean", "Dusty", "Blocked"], ["Clean"]),
      bool("compressor_running", "Compressor running", true),
    ],
    checks: ["Filter clean", "Drain line clear", "Outdoor fan running", "Thermostat responding"],
  },
  {
    _id: "ELECTRICAL", category_id: 2, category_name: "Electrical",
    fields: [
      num("voltage_v", "Supply voltage", "V", 0, 500, [220, 245]),
      num("load_current_a", "Load current", "A", 0, 400, [0, 32]),
      num("earth_resistance_ohm", "Earth resistance", "Ω", 0, 100, [0, 5]),
      bool("breaker_tripped", "Breaker found tripped", false),
      text("circuit_id", "Circuit / DB reference"),
    ],
    checks: ["Circuit isolated and tested dead", "Insulation intact", "Earthing continuity OK", "No overheating at terminals"],
  },
  {
    _id: "PLUMBING", category_id: 3, category_name: "Plumbing & Water",
    fields: [
      num("leak_rate_lpm", "Leak rate", "L/min", 0, 100, [0, 0]),
      num("water_pressure_bar", "Water pressure", "bar", 0, 12, [1.5, 4.5]),
      choice("pipe_material", "Pipe material", ["PVC", "CPVC", "GI", "Copper"]),
      num("tank_level_pct", "Overhead tank level", "%", 0, 100, [20, 100]),
    ],
    checks: ["Supply valve operable", "Joints and seals intact", "Drain flowing freely", "No damp on walls"],
  },
  {
    _id: "NETWORK", category_id: 4, category_name: "IT & Network",
    fields: [
      num("signal_dbm", "Wi-Fi signal", "dBm", -100, 0, [-67, -30]),
      num("ping_ms", "Ping to gateway", "ms", 0, 5000, [0, 50]),
      num("packet_loss_pct", "Packet loss", "%", 0, 100, [0, 1]),
      num("clients_connected", "Clients on access point", "", 0, 500, [0, 60]),
      text("access_point_id", "Access point / switch port"),
    ],
    checks: ["Device powered (PoE)", "Uplink cable tested", "Firmware up to date", "DHCP lease received"],
  },
  {
    _id: "LAB", category_id: 5, category_name: "Lab Equipment",
    fields: [
      num("operating_temp_c", "Operating temperature", "°C", 0, 150, [15, 45]),
      num("hours_run", "Hours run", "h", 0, 100000),
      bool("calibration_valid", "Calibration certificate valid", true),
      text("error_code", "Error code shown"),
    ],
    checks: ["Safety interlocks working", "Calibration verified", "Power supply stable", "Cooling fan working"],
  },
  {
    _id: "AV", category_id: 6, category_name: "AV & Projectors",
    fields: [
      num("lamp_hours", "Lamp hours", "h", 0, 30000, [0, 4000]),
      choice("image_quality", "Image quality", ["Good", "Dim", "Flickering", "No signal"], ["Good"]),
      choice("input_tested", "Input tested", ["HDMI", "VGA", "Wireless"]),
      bool("audio_ok", "Audio working", true),
    ],
    checks: ["Cables and adapters OK", "Remote working", "Air filter clean", "Mounting secure"],
  },
  {
    _id: "CIVIL", category_id: 7, category_name: "Furniture & Civil",
    fields: [
      choice("damage_type", "Damage type", ["Crack", "Broken", "Loose", "Water damage", "Termite"]),
      num("affected_area_sq_m", "Affected area", "m²", 0, 500, [0, 1]),
      bool("safety_risk", "Safety risk to occupants", false),
    ],
    checks: ["Area safe to use", "Fixings secure", "No structural crack", "Surface finish intact"],
  },
  {
    _id: "FIRE", category_id: 8, category_name: "Fire & Safety",
    fields: [
      num("extinguisher_pressure_bar", "Extinguisher pressure", "bar", 0, 25, [12, 16]),
      bool("alarm_tested", "Alarm sounder works", true),
      bool("detector_ok", "Smoke detector responds", true),
      text("panel_zone", "Fire panel zone"),
    ],
    checks: ["Panel shows no fault", "Detector test passed", "Exit path clear", "Extinguisher seal intact"],
  },
  {
    _id: "LIFT", category_id: 9, category_name: "Lifts & Elevators",
    fields: [
      num("door_faults_7d", "Door faults in last 7 days", "", 0, 500, [0, 2]),
      num("leveling_error_mm", "Floor levelling error", "mm", 0, 200, [0, 10]),
      num("motor_temp_c", "Motor temperature", "°C", 0, 150, [20, 80]),
      bool("emergency_phone_ok", "Emergency phone works", true),
    ],
    checks: ["Door sensors clean", "Emergency alarm works", "Brake holds", "Car light and fan working"],
  },
];

// ---------------------------------------------------------------------
// $jsonSchema validators: MongoDB rejects any document that breaks them.
// The inspection part is GENERATED from the templates, so an HVAC log can
// only contain HVAC readings, of the right type and range.
// ---------------------------------------------------------------------
function readingSchema(f) {
  if (f.type === "number") return { bsonType: "number", minimum: f.min, maximum: f.max };
  if (f.type === "enum") return { bsonType: "string", enum: f.options };
  if (f.type === "bool") return { bsonType: "bool" };
  return { bsonType: "string", maxLength: f.max_length };
}

export function notesValidator(templates = TEMPLATES) {
  const inspectionBranch = (t) => ({
    required: ["category_key", "readings", "checklist", "verdict"],
    properties: {
      kind: { enum: ["INSPECTION"] },
      category_key: { enum: [t._id] },
      author: { bsonType: "object", properties: { role: { enum: ["TECHNICIAN", "FACILITY_MANAGER", "ADMIN"] } } },
      readings: {
        bsonType: "object",
        minProperties: 1,
        additionalProperties: false,
        properties: Object.fromEntries(t.fields.map((f) => [f.key, readingSchema(f)])),
      },
      checklist: {
        bsonType: "array",
        maxItems: 12,
        items: {
          bsonType: "object",
          required: ["item", "ok"],
          additionalProperties: false,
          properties: { item: { enum: t.checks }, ok: { bsonType: "bool" } },
        },
      },
      verdict: { enum: VERDICTS },
    },
  });

  return {
    $jsonSchema: {
      bsonType: "object",
      title: "incident_notes: a comment or a field inspection log on one incident",
      required: ["incident_id", "kind", "visibility", "author", "text", "created_at"],
      properties: {
        _id: { bsonType: "objectId" },
        incident_id: { bsonType: "int", minimum: 1, description: "incidents.incident_id in PostgreSQL" },
        kind: { enum: ["COMMENT", "INSPECTION"] },
        visibility: { enum: ["PUBLIC", "STAFF"], description: "STAFF notes are hidden from students" },
        author: {
          bsonType: "object",
          required: ["user_id", "name", "role"],
          additionalProperties: false,
          properties: { user_id: { bsonType: "int" }, name: { bsonType: "string", maxLength: 100 }, role: { enum: ROLES } },
        },
        text: { bsonType: "string", minLength: 1, maxLength: 2000 },
        tags: { bsonType: "array", maxItems: 8, uniqueItems: true, items: { bsonType: "string", pattern: "^[a-z0-9-]{2,24}$" } },
        category_key: { bsonType: "string" },
        readings: { bsonType: "object" },
        checklist: { bsonType: "array" },
        verdict: { enum: VERDICTS },
        helpful: { bsonType: "array", uniqueItems: true, items: { bsonType: "int" }, description: "user ids who found it helpful" },
        edits: {
          bsonType: "array",
          maxItems: 50,
          items: { bsonType: "object", required: ["text", "edited_at"], properties: { text: { bsonType: "string" }, edited_at: { bsonType: "date" } } },
        },
        created_at: { bsonType: "date" },
        updated_at: { bsonType: "date" },
      },
      // exactly one branch must match: a plain comment, or an inspection of ONE category
      oneOf: [
        {
          properties: { kind: { enum: ["COMMENT"] } },
          not: { anyOf: [{ required: ["readings"] }, { required: ["checklist"] }, { required: ["verdict"] }] },
        },
        ...templates.map(inspectionBranch),
      ],
    },
  };
}

export const templatesValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "category_id", "category_name", "fields", "checks"],
    properties: {
      _id: { bsonType: "string", pattern: "^[A-Z]{2,12}$" },
      category_id: { bsonType: "int", minimum: 1 },
      category_name: { bsonType: "string" },
      fields: {
        bsonType: "array",
        minItems: 1,
        items: {
          bsonType: "object",
          required: ["key", "label", "type"],
          properties: { key: { bsonType: "string", pattern: "^[a-z][a-z0-9_]{1,30}$" }, type: { enum: ["number", "enum", "bool", "text"] } },
        },
      },
      checks: { bsonType: "array", minItems: 1, items: { bsonType: "string" } },
    },
  },
};

export const searchEventsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["at", "q", "mode", "results", "role"],
    properties: {
      at: { bsonType: "date" },
      q: { bsonType: "string", minLength: 2, maxLength: 300 },
      mode: { enum: ["hybrid", "semantic", "keyword"] },
      results: { bsonType: "int", minimum: 0 },
      top_score: { bsonType: ["double", "int", "null"] },
      ms: { bsonType: "int", minimum: 0 },
      role: { enum: ROLES },
    },
  },
};

// [collection, keys, options]
export const INDEXES = [
  ["inspection_templates", { category_id: 1 }, { name: "uq_category_id", unique: true }],
  // the incident page reads one incident's thread, newest first
  ["incident_notes", { incident_id: 1, created_at: -1 }, { name: "ix_incident_thread" }],
  // "my notes" / technician activity
  ["incident_notes", { "author.user_id": 1, created_at: -1 }, { name: "ix_author" }],
  // multikey index: one entry per tag in the array
  ["incident_notes", { tags: 1 }, { name: "ix_tags" }],
  // partial index: only inspection logs are indexed by category + verdict
  ["incident_notes", { category_key: 1, verdict: 1 }, { name: "ix_inspection_verdict", partialFilterExpression: { kind: "INSPECTION" } }],
  // full-text search on note text and tags (title-like weight for tags)
  ["incident_notes", { text: "text", tags: "text" }, { name: "tx_note_text", weights: { text: 1, tags: 3 }, default_language: "english" }],
  // TTL index: MongoDB deletes search events automatically after 90 days
  ["search_events", { at: 1 }, { name: "ttl_search_events", expireAfterSeconds: SEARCH_LOG_TTL_DAYS * 86400 }],
  ["search_events", { mode: 1, at: -1 }, { name: "ix_mode_time" }],
];
