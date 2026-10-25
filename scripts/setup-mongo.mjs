// =====================================================================
// ResolveX MongoDB setup (document store)
//   1. creates a least-privilege role + login for the web app
//   2. (re)creates the collections with $jsonSchema validators
//   3. creates the indexes (compound, multikey, partial, text, TTL)
//   4. loads the inspection templates and generates realistic notes and
//      search events from the incidents / work orders in PostgreSQL
// Runs as part of `npm run db:setup`, or alone with `npm run db:mongo`.
// =====================================================================
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { MongoClient } from "mongodb";
import { TEMPLATES, INDEXES, notesValidator, templatesValidator, searchEventsValidator } from "../database/mongodb/schema.mjs";

dotenv.config({ path: ".env.local" });
dotenv.config();

// ---------------------------------------------------------- deterministic random
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(42);
const chance = (p) => rnd() < p;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b, dec = 0) => Number((a + rnd() * (b - a)).toFixed(dec));
const H = 3600e3;
const MIN = 60e3;

// ---------------------------------------------------------- inspection scenarios
// Each scenario matches incident titles and produces readings that are
// typical for that fault, the checks that failed, tags and the technician's note.
const S = (re, tags, fails, set, text) => ({ re, tags, fails, set, text });
const SCENARIOS = {
  HVAC: [
    S(/drip|water/i, ["drain", "condensate"], ["Drain line clear"], () => ({ filter_condition: "Dusty" }), () => "Condensate drain line choked; water overflowing from the indoor unit tray."),
    S(/noise|rattl/i, ["fan-motor", "noise"], ["Outdoor fan running"], () => ({}), () => "Outdoor fan motor bearing worn: loud rattling and the fan stalls now and then."),
    S(/switches off/i, ["thermostat", "tripping"], ["Thermostat responding"], () => ({ compressor_running: false, room_temp_c: between(28, 31, 1) }), (r) => `Unit shuts down after about 10 minutes; thermostat sensor reads wrongly. Room at ${r.room_temp_c} °C.`),
    S(/cool|hot|warm|oven|temperature/i, ["refrigerant", "gas-leak"], [], () => ({ supply_air_temp_c: between(19, 26, 1), room_temp_c: between(28, 34, 1), suction_pressure_psi: between(60, 98) }), (r) => `Supply air only ${r.supply_air_temp_c} °C at ${r.suction_pressure_psi} psi suction: refrigerant low, leak suspected at the flare joint.`),
    S(/cool|hot|warm|oven|temperature/i, ["filter", "airflow"], ["Filter clean"], () => ({ supply_air_temp_c: between(17, 21, 1), room_temp_c: between(27, 30, 1), filter_condition: "Blocked" }), (r) => `Filter completely blocked with dust and airflow very weak; supply air ${r.supply_air_temp_c} °C.`),
  ],
  ELECTRICAL: [
    S(/ups|backup/i, ["ups", "battery"], [], () => ({ load_current_a: between(8, 20, 1) }), (r) => `UPS batteries swollen; backup time under 2 minutes at ${r.load_current_a} A load.`),
    S(/spark/i, ["arcing", "switchboard"], ["Insulation intact", "No overheating at terminals"], () => ({ earth_resistance_ohm: between(6, 15, 1) }), (r) => `Loose terminal arcing inside the switch board; insulation melted. Earth resistance ${r.earth_resistance_ohm} Ω.`),
    S(/tube|light/i, ["lighting", "choke"], [], () => ({ load_current_a: between(0.5, 3, 1) }), () => "Two tube light chokes failed and the holders are burnt."),
    S(/voltage|fluctuat/i, ["voltage", "loose-neutral"], ["No overheating at terminals"], () => ({ voltage_v: between(188, 212) }), (r) => `Loose neutral at the distribution board; voltage drops to ${r.voltage_v} V under load.`),
    S(/current|outage|power/i, ["mcb", "overload"], [], () => ({ breaker_tripped: true, load_current_a: between(33, 48, 1) }), (r) => `Breaker tripped on overload: ${r.load_current_a} A on a 32 A circuit (room heaters plugged in).`),
  ],
  PLUMBING: [
    S(/salty|taste/i, ["ro-plant", "water-quality"], [], () => ({}), () => "RO membrane exhausted, TDS high at the dispenser; membrane and carbon filter due for replacement."),
    S(/hot water/i, ["geyser", "heating-element"], [], () => ({}), () => "Geyser heating element is open circuit; thermostat is fine."),
    S(/pressure/i, ["pressure", "pump"], ["Supply valve operable"], () => ({ water_pressure_bar: between(0.3, 1.2, 1), tank_level_pct: between(3, 15) }), (r) => `Overhead tank at ${r.tank_level_pct}% and the pump is not starting; only ${r.water_pressure_bar} bar at the tap.`),
    S(/leak|tap/i, ["leak", "washer"], ["Joints and seals intact"], () => ({ leak_rate_lpm: between(0.4, 4, 1) }), (r) => `Tap spindle washer worn; leaking about ${r.leak_rate_lpm} L/min.`),
    S(/drain|block|overflow/i, ["blockage", "drain"], ["Drain flowing freely"], () => ({}), () => "Drain choked with debris about 2 m from the trap."),
    S(/./, ["seepage"], ["No damp on walls"], () => ({ leak_rate_lpm: between(0.2, 1, 1) }), () => "Concealed pipe seeping behind the wall tiles; damp patch spreading."),
  ],
  NETWORK: [
    S(/biometric|fingerprint/i, ["biometric", "sensor"], ["Firmware up to date"], () => ({ ping_ms: between(10, 40) }), (r) => `Fingerprint sensor glass scratched and firmware outdated; device reachable at ${r.ping_ms} ms.`),
    S(/slow/i, ["wifi", "congestion"], [], () => ({ clients_connected: between(75, 140), ping_ms: between(140, 650), packet_loss_pct: between(3, 12, 1), signal_dbm: between(-74, -66) }), (r) => `Access point overloaded with ${r.clients_connected} clients: ${r.ping_ms} ms ping and ${r.packet_loss_pct}% packet loss.`),
    S(/network|computers/i, ["switch", "uplink"], ["Uplink cable tested"], () => ({ ping_ms: 5000, packet_loss_pct: 100, clients_connected: 0 }), () => "Uplink fibre patch cord to the lab switch damaged; the whole lab is offline."),
    S(/./, ["access-point", "poe"], ["Device powered (PoE)"], () => ({ signal_dbm: between(-95, -85), ping_ms: between(2000, 5000), packet_loss_pct: between(80, 100), clients_connected: 0 }), () => "Access point does not power up: the PoE port on the floor switch is faulty."),
  ],
  LAB: [
    S(/fume|exhaust/i, ["fume-hood", "blower"], ["Cooling fan working"], () => ({}), () => "Exhaust blower belt slipping; face velocity well below the safe limit."),
    S(/probe|oscillo/i, ["probes", "calibration"], ["Calibration verified"], () => ({ calibration_valid: false }), () => "Probe tips broken and probe compensation off; calibration overdue."),
    S(/./, ["3d-printer", "nozzle"], [], () => ({ error_code: "E-07" }), (r) => `Nozzle clogged with burnt filament; heater error ${r.error_code}.`),
  ],
  AV: [
    S(/mic|speaker|audio|sound/i, ["audio", "amplifier"], ["Cables and adapters OK"], () => ({ audio_ok: false }), () => "Amplifier channel dead and mic cable shorted at the XLR connector."),
    S(/smart board|touch/i, ["smart-board", "usb"], ["Cables and adapters OK"], () => ({}), () => "Touch frame USB cable loose; driver re-installed on the podium PC."),
    S(/dim|cannot see/i, ["lamp", "filter"], ["Air filter clean"], () => ({ lamp_hours: between(4300, 7900), image_quality: "Dim" }), (r) => `Lamp at ${r.lamp_hours} hours, past its rated life; air filter clogged.`),
    S(/./, ["hdmi", "cable"], ["Cables and adapters OK"], () => ({ image_quality: "No signal", input_tested: "HDMI" }), () => "HDMI cable damaged inside the conduit; projector input works with a new cable."),
  ],
  CIVIL: [
    S(/bench|chair|desk|table/i, ["furniture", "welding"], ["Fixings secure", "Area safe to use"], () => ({ damage_type: "Broken", affected_area_sq_m: between(0.5, 2, 1), safety_risk: true }), () => "Bench frame welds cracked on several benches; unsafe to sit on."),
    S(/./, ["door-lock", "fixings"], ["Fixings secure"], () => ({ damage_type: "Broken", affected_area_sq_m: between(0.1, 0.3, 1) }), () => "Mortise lock body broken and the strike plate misaligned."),
  ],
  FIRE: [
    S(/alarm|beep/i, ["detector", "false-alarm"], ["Panel shows no fault", "Detector test passed"], () => ({ detector_ok: false }), (r) => `Dusty smoke detector in zone ${r.panel_zone} causing false alarms; panel shows a fault.`),
    S(/./, ["extinguisher", "refill"], ["Extinguisher seal intact"], () => ({ extinguisher_pressure_bar: between(6, 11, 1) }), (r) => `Pressure gauge in the red at ${r.extinguisher_pressure_bar} bar; refill and pressure test due.`),
  ],
  LIFT: [
    S(/stuck/i, ["levelling", "brake"], ["Brake holds"], () => ({ leveling_error_mm: between(18, 45), door_faults_7d: between(3, 9) }), (r) => `Car stopped ${r.leveling_error_mm} mm off the landing; brake lining worn, encoder reset.`),
    S(/./, ["door-sensor"], ["Door sensors clean"], () => ({ door_faults_7d: between(9, 34) }), (r) => `Door light curtain dirty and misaligned; ${r.door_faults_7d} door faults logged this week.`),
  ],
};

// second sentence of an inspection note, depends on the verdict (varied wording, like real notes)
const NEXT_STEP = {
  FIXED_ON_SITE: ["Fixed during the visit and tested for 15 minutes.", "Repaired on the spot; working normally now.", "Fixed and checked with the user present."],
  NEEDS_PARTS: ["Spare part requested from stores.", "Part must be replaced; stores request raised.", "Temporary fix done until the new part arrives."],
  NEEDS_VENDOR: ["Beyond in-house repair; AMC vendor visit requested.", "Vendor ticket raised with photos attached."],
  MONITOR: ["Will monitor it for two days.", "Keeping an eye on it this week before replacing anything."],
  NO_FAULT_FOUND: [""],
};

const TEXT_VALUES = {
  circuit_id: () => `DB-${between(1, 6)}/C${between(1, 12)}`,
  access_point_id: () => `AP-${pick(["A", "B", "C", "L", "H"])}${between(0, 4)}-${String(between(1, 9)).padStart(2, "0")}`,
  error_code: () => "none",
  panel_zone: () => `Z${between(1, 8)}`,
};

function normalReadings(t) {
  const r = {};
  for (const f of t.fields) {
    if (f.type === "number") {
      const lo = f.normal_min ?? f.min;
      const hi = f.normal_max ?? Math.min(f.max, f.min + (f.max - f.min) * 0.1);
      r[f.key] = between(lo, hi, f.unit === "°C" || f.unit === "bar" || f.unit === "%" || f.unit === "Ω" ? 1 : 0);
    } else if (f.type === "enum") r[f.key] = f.normal_values ? pick(f.normal_values) : pick(f.options);
    else if (f.type === "bool") r[f.key] = f.normal_value ?? true;
    else r[f.key] = TEXT_VALUES[f.key]?.() ?? "-";
  }
  return r;
}

function inspectionFor(t, title, preventive) {
  const readings = normalReadings(t);
  if (preventive) {
    const minor = chance(0.25) ? pick(t.checks) : null;
    return {
      readings,
      checklist: t.checks.map((item) => ({ item, ok: item !== minor })),
      tags: ["preventive"],
      verdict: minor ? "FIXED_ON_SITE" : "NO_FAULT_FOUND",
      text: `Routine preventive inspection: all readings within the normal range${minor ? `; "${minor}" failed and was fixed during the visit` : ""}.`,
    };
  }
  // a scenario written for this kind of title; the catch-all /./ only when nothing specific matches
  const all = SCENARIOS[t._id];
  const specific = all.filter((s) => s.re.source !== "." && s.re.test(title));
  const fallback = all.filter((s) => s.re.source === ".");
  const sc = pick(specific.length ? specific : fallback.length ? fallback : all);
  Object.assign(readings, sc.set());
  return {
    readings,
    checklist: t.checks.map((item) => ({ item, ok: !sc.fails.includes(item) })),
    tags: sc.tags,
    text: sc.text(readings),
  };
}

// ---------------------------------------------------------- comment texts
const FOLLOW_UPS = [
  "Still not working as of this morning.",
  "Any update on this? We have a lab session here tomorrow.",
  "It has become worse since yesterday.",
  "Please fix this soon, many of us are affected.",
  "We had to move the class to another room because of this.",
];
const ME_TOO = ["Same problem here.", "Facing this in the next room as well.", "Confirming, it is still happening."];
const TECH_PUBLIC = [
  "I will check this today afternoon. Please keep the room unlocked.",
  "On my way, will be there in about 30 minutes.",
  "Inspected the unit; repair needs a spare part, I will be back once it arrives.",
];
const TECH_DONE = ["Work done. Please confirm if the problem is solved.", "Fixed and tested. Let us know if it happens again."];
const THANKS_GOOD = ["Working fine now, thank you!", "All good now, thanks for the quick fix.", "Problem solved, thanks."];
const THANKS_BAD = ["It was fixed, but the problem came back after two days.", "Took too long to fix, we lost two lab sessions."];
const MANAGER_STAFF = [
  ["Spare part on order with the vendor, expected in 3 days.", ["vendor", "spare-part"]],
  ["Escalated: exams are scheduled in this block next week.", ["escalation"]],
  ["Asked the AMC vendor for a quotation before approving the repair.", ["vendor", "amc"]],
];

async function loadFromPostgres(pgUrl) {
  const c = new pg.Client({ connectionString: pgUrl });
  await c.connect();
  const q = async (sql) => (await c.query(sql)).rows;
  const data = {
    incidents: await q(`SELECT i.incident_id, i.category_id, i.status, i.title, i.reported_at, i.resolved_at, i.feedback_rating,
                               i.escalation_level, i.duplicate_of, i.reported_by, u.full_name, r.role_name
                          FROM incidents i JOIN users u ON u.user_id = i.reported_by JOIN roles r ON r.role_id = u.role_id
                         ORDER BY i.incident_id`),
    workOrders: await q(`SELECT w.work_order_id, w.incident_id, w.technician_id, u.full_name, w.status, w.assigned_at, w.started_at, w.completed_at,
                                EXISTS (SELECT 1 FROM work_order_parts p WHERE p.work_order_id = w.work_order_id) AS used_parts
                           FROM work_orders w JOIN users u ON u.user_id = w.technician_id ORDER BY w.work_order_id`),
    coReporters: await q(`SELECT ir.incident_id, ir.user_id, u.full_name, ir.joined_at FROM incident_reporters ir JOIN users u ON u.user_id = ir.user_id`),
    staff: await q(`SELECT u.user_id, u.full_name, r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id
                     WHERE r.role_name IN ('FACILITY_MANAGER','ADMIN','TECHNICIAN') AND u.is_active ORDER BY u.user_id`),
  };
  await c.end();
  return data;
}

function generate({ incidents, workOrders, coReporters, staff }) {
  rnd = mulberry32(42);
  const now = Date.now();
  const tplById = Object.fromEntries(TEMPLATES.map((t) => [t.category_id, t]));
  const managers = staff.filter((s) => s.role_name !== "TECHNICIAN");
  const techs = staff.filter((s) => s.role_name === "TECHNICIAN");
  const woByIncident = new Map();
  for (const w of workOrders) (woByIncident.get(w.incident_id) || woByIncident.set(w.incident_id, []).get(w.incident_id)).push(w);
  const coByIncident = new Map();
  for (const r of coReporters) (coByIncident.get(r.incident_id) || coByIncident.set(r.incident_id, []).get(r.incident_id)).push(r);

  const notes = [];
  // anchor + offset; if that would be in the future (or after `cap`), place it at a random
  // point between the anchor and the cap instead, so recent incidents get realistic times
  const at = (anchor, offset, cap = now - MIN) => {
    const t = anchor + offset;
    return new Date(t <= cap ? t : anchor + Math.max(0, cap - anchor) * between(0.25, 0.9, 3));
  };
  const add = (n) => {
    if (n.created_at.getTime() > now) n.created_at = new Date(now - MIN);
    n.updated_at ??= n.created_at;
    notes.push(n);
  };
  const author = (id, name, role) => ({ user_id: id, name, role });

  for (const i of incidents) {
    const t = tplById[i.category_id];
    const reported = new Date(i.reported_at).getTime();
    const reporter = author(i.reported_by, i.full_name, i.role_name);
    const active = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(i.status);

    if (i.status === "DUPLICATE" && i.duplicate_of) {
      const m = pick(managers);
      add({ incident_id: i.incident_id, kind: "COMMENT", visibility: "STAFF", author: author(m.user_id, m.full_name, m.role_name),
            text: `Merged into #${i.duplicate_of}: the same fault was already reported there.`, tags: ["duplicate"],
            created_at: at(reported, between(1, 4, 2) * H), helpful: [] });
      continue;
    }

    // the reporter follows up while the incident is still open
    if (active && chance(0.75)) {
      const text = pick(FOLLOW_UPS);
      const created = at(reported, between(3, 30, 2) * H);
      const note = { incident_id: i.incident_id, kind: "COMMENT", visibility: "PUBLIC", author: reporter, text, created_at: created, helpful: [] };
      if (chance(0.3)) {
        note.edits = [{ text: text.replace(/\.$/, "").replace(/,.*$/, ""), edited_at: new Date(created.getTime() + 4 * MIN) }];
        note.updated_at = note.edits[0].edited_at;
      }
      add(note);
    }
    for (const co of coByIncident.get(i.incident_id) || []) {
      if (chance(0.6)) add({ incident_id: i.incident_id, kind: "COMMENT", visibility: "PUBLIC", author: author(co.user_id, co.full_name, "STUDENT_STAFF"),
                             text: pick(ME_TOO), created_at: at(new Date(co.joined_at).getTime(), between(0.5, 6, 2) * H), helpful: [] });
    }

    for (const w of woByIncident.get(i.incident_id) || []) {
      const tech = author(w.technician_id, w.full_name, "TECHNICIAN");
      const assigned = new Date(w.assigned_at).getTime();
      const done = w.completed_at ? new Date(w.completed_at).getTime() : null;
      if (chance(0.45)) add({ incident_id: i.incident_id, kind: "COMMENT", visibility: "PUBLIC", author: tech, text: pick(TECH_PUBLIC),
                              created_at: at(assigned, between(5, 40) * MIN, done ? done - 30 * MIN : now - MIN), helpful: [] });

      if (w.status !== "ASSIGNED" && w.status !== "CANCELLED") {
        const start = w.started_at ? new Date(w.started_at).getTime() : assigned + 20 * MIN;
        const insp = inspectionFor(t, i.title, /^Preventive maintenance/i.test(i.title));
        const verdict =
          insp.verdict ||
          (w.status === "COMPLETED" ? (w.used_parts ? "NEEDS_PARTS" : chance(0.12) ? "NEEDS_VENDOR" : "FIXED_ON_SITE") : pick(["NEEDS_PARTS", "MONITOR"]));
        const voters = [...new Set([pick(managers).user_id, ...(chance(0.4) ? [pick(techs).user_id] : [])])].filter((u) => u !== w.technician_id);
        const step = insp.verdict ? "" : pick(NEXT_STEP[verdict]);
        add({
          incident_id: i.incident_id, kind: "INSPECTION", visibility: "STAFF", author: tech, text: step ? `${insp.text} ${step}` : insp.text, tags: insp.tags,
          category_key: t._id, readings: insp.readings, checklist: insp.checklist, verdict,
          created_at: at(start, between(15, 75) * MIN, done ? done - 5 * MIN : now - MIN),
          helpful: chance(0.55) ? voters : [],
        });
      }
      if (done && chance(0.3)) add({ incident_id: i.incident_id, kind: "COMMENT", visibility: "PUBLIC", author: tech, text: pick(TECH_DONE),
                                     created_at: new Date(done - 2 * MIN), helpful: [] });
      if (w.status === "ON_HOLD" || (w.status === "IN_PROGRESS" && chance(0.5))) {
        const m = pick(managers);
        const [text, tags] = pick(MANAGER_STAFF);
        add({ incident_id: i.incident_id, kind: "COMMENT", visibility: "STAFF", author: author(m.user_id, m.full_name, m.role_name), text, tags,
              created_at: at(assigned, between(2, 20, 2) * H), helpful: [] });
      }
    }

    if (i.escalation_level > 0) {
      const m = pick(managers);
      add({ incident_id: i.incident_id, kind: "COMMENT", visibility: "STAFF", author: author(m.user_id, m.full_name, m.role_name),
            text: "SLA breached and escalated; please prioritise this job today.", tags: ["escalation"], created_at: at(reported, between(8, 30, 2) * H), helpful: [] });
    }

    // the reporter comments after the fix
    if (i.resolved_at && chance(0.35)) {
      const good = (i.feedback_rating ?? 5) >= 3;
      const note = { incident_id: i.incident_id, kind: "COMMENT", visibility: "PUBLIC", author: reporter, text: pick(good ? THANKS_GOOD : THANKS_BAD),
                     created_at: at(new Date(i.resolved_at).getTime(), between(2, 20, 2) * H), helpful: [] };
      add(note);
    }
  }
  for (const n of notes) if (!n.helpful.length) delete n.helpful;
  notes.sort((a, b) => a.created_at - b.created_at);
  return notes;
}

const SEARCH_TERMS = [
  ["ac not cooling", 12], ["room is too hot", 9], ["water dripping from ac", 6], ["wifi slow", 10], ["no internet in lab", 6],
  ["projector not working", 8], ["projector dim", 4], ["mic not working", 5], ["water leakage", 6], ["tap leaking", 3],
  ["drinking water salty", 4], ["low water pressure", 3], ["lift stuck", 4], ["lift door", 2], ["sparks from switch", 4],
  ["power cut", 5], ["tube light", 3], ["ups beeping", 3], ["fire alarm beeping", 3], ["fire extinguisher expired", 2],
  ["broken bench", 2], ["door lock broken", 3], ["biometric not working", 5], ["fume hood", 2], ["hot water", 3],
  ["canteen food quality", 2], ["parking gate", 2], ["hostel mess timing", 2], ["bus pass", 1], ["library book renewal", 1],
];
const OFF_TOPIC = new Set(["canteen food quality", "parking gate", "hostel mess timing", "bus pass", "library book renewal"]);

function generateSearchEvents() {
  rnd = mulberry32(7);
  const now = Date.now();
  const bag = SEARCH_TERMS.flatMap(([q, w]) => Array(w).fill(q));
  const events = [];
  for (let k = 0; k < 260; k++) {
    const q = pick(bag);
    const mode = pick(["hybrid", "hybrid", "hybrid", "hybrid", "semantic", "semantic", "keyword"]);
    const off = OFF_TOPIC.has(q);
    const results = off ? (mode === "keyword" ? 0 : between(0, 1)) : mode === "keyword" ? between(0, 9) : between(6, 15);
    events.push({
      at: new Date(now - between(0.1, 60, 3) * 24 * H),
      q,
      mode,
      results,
      top_score: results ? (mode === "keyword" ? between(0.05, 0.6, 3) : off ? between(0.3, 0.36, 3) : between(0.55, 0.93, 3)) : null,
      ms: mode === "keyword" ? between(2, 9) : between(9, 45),
      role: pick(["STUDENT_STAFF", "STUDENT_STAFF", "STUDENT_STAFF", "STUDENT_STAFF", "TECHNICIAN", "TECHNICIAN", "FACILITY_MANAGER", "ADMIN"]),
    });
  }
  return events.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------- main
export async function setupMongo({ pgUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL, log = console.log } = {}) {
  const appUri = process.env.MONGODB_URI;
  const adminUri = process.env.MONGODB_ADMIN_URI || appUri;
  if (!adminUri) {
    log("MongoDB: MONGODB_URI is not set in .env.local - skipped (notes, inspection logs and search analytics will be unavailable)");
    return false;
  }
  const dbName = appUri ? decodeURIComponent(new URL(appUri).pathname.replace(/^\//, "")) || "resolvex" : "resolvex";
  const client = new MongoClient(adminUri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const info = await db.admin().command({ buildInfo: 1 });
  log(`MongoDB ${info.version}: database '${dbName}'`);

  // 1. least-privilege role and login for the web app (like resolvex_app in PostgreSQL)
  const appUser = process.env.MONGO_APP_USER;
  const appPass = process.env.MONGO_APP_PASSWORD;
  if (appUser && appPass) {
    const privileges = [
      { resource: { db: dbName, collection: "" }, actions: ["listCollections", "listIndexes", "collStats", "dbStats"] },
      { resource: { db: dbName, collection: "incident_notes" }, actions: ["find", "insert", "update", "remove"] },
      { resource: { db: dbName, collection: "search_events" }, actions: ["find", "insert"] }, // append-only log
      { resource: { db: dbName, collection: "inspection_templates" }, actions: ["find"] }, // read-only reference data
    ];
    const roleExists = (await db.command({ rolesInfo: "resolvexAppRole" })).roles.length > 0;
    await db.command(roleExists ? { updateRole: "resolvexAppRole", privileges, roles: [] } : { createRole: "resolvexAppRole", privileges, roles: [] });
    const userExists = (await db.command({ usersInfo: appUser })).users.length > 0;
    await db.command(
      userExists
        ? { updateUser: appUser, pwd: appPass, roles: [{ role: "resolvexAppRole", db: dbName }] }
        : { createUser: appUser, pwd: appPass, roles: [{ role: "resolvexAppRole", db: dbName }] }
    );
    log(`  app login '${appUser}' ready (role resolvexAppRole: no drop, no index or validator changes, search log append-only)`);
  }

  // 2. collections with validators (drop + create, like 00_drop.sql / 01_schema.sql)
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of ["incident_notes", "inspection_templates", "search_events", "viva_demo"]) if (existing.has(name)) await db.collection(name).drop();
  const strict = { validationLevel: "strict", validationAction: "error" };
  await db.createCollection("inspection_templates", { validator: templatesValidator, ...strict });
  await db.createCollection("incident_notes", { validator: notesValidator(TEMPLATES), ...strict });
  await db.createCollection("search_events", { validator: searchEventsValidator, ...strict });

  // 3. indexes
  for (const [coll, keys, options] of INDEXES) await db.collection(coll).createIndex(keys, options);
  log(`  3 collections with $jsonSchema validators, ${INDEXES.length} indexes`);

  // 4. data
  await db.collection("inspection_templates").insertMany(TEMPLATES.map((t) => ({ ...t, updated_at: new Date() })));
  const notes = generate(await loadFromPostgres(pgUrl));
  if (notes.length) await db.collection("incident_notes").insertMany(notes);
  const events = generateSearchEvents();
  await db.collection("search_events").insertMany(events);
  const kinds = notes.reduce((m, n) => ((m[n.kind] = (m[n.kind] || 0) + 1), m), {});
  log(`  ${TEMPLATES.length} templates, ${notes.length} notes (${kinds.COMMENT || 0} comments, ${kinds.INSPECTION || 0} inspection logs), ${events.length} search events`);
  await client.close();
  return true;
}

// run directly: node scripts/setup-mongo.mjs
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  setupMongo().catch((e) => {
    console.error("\nMONGODB SETUP FAILED:", e.message);
    if (e.errInfo) console.error(JSON.stringify(e.errInfo, null, 1).slice(0, 3000));
    process.exit(1);
  });
}
