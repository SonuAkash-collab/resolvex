"""
ResolveX - seed data generator.

Generates database/08_seed.sql : reference data (roles, SLA policies,
state machine), campus master data (buildings, rooms, assets, users,
technicians, spare parts) and ~6 months of realistic incident history
(incidents, work orders, parts used, maintenance records) plus a set of
currently active incidents for the live demo.

All timestamps are written RELATIVE to now() so the dashboards always
show recent data, whenever the database is created.

Usage:  python scripts/generate_seed.py
"""
import random
from pathlib import Path

random.seed(42)
OUT = Path(__file__).resolve().parent.parent / "database" / "08_seed.sql"

HVAC, ELEC, PLUMB, IT, LAB, AV, FURN, SAFE, LIFT = range(1, 10)


def q(s):
    """SQL string literal."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def ago(minutes):
    return f"now() - interval '{int(minutes)} minutes'"


def ago_date(days):
    return f"CURRENT_DATE - {int(days)}"


# ------------------------------------------------------------------ master data
buildings = [
    # id, code, name, type, importance, floors
    (1, "ACB-A", "Academic Block A", "ACADEMIC", 4, 6),
    (2, "LAB-B", "Engineering Labs Block B", "LAB", 5, 5),
    (3, "LIB", "Central Library", "LIBRARY", 4, 3),
    (4, "ADM", "Administration Block", "ADMIN", 3, 3),
    (5, "H1", "Men's Hostel H1", "HOSTEL", 3, 8),
    (6, "H2", "Women's Hostel H2", "HOSTEL", 3, 8),
    (7, "AUD", "Main Auditorium", "AUDITORIUM", 4, 2),
    (8, "CAF", "Food Court", "CAFETERIA", 3, 2),
]

rooms = [
    # id, building, number, floor, type, capacity, friendly name
    (1, 1, "101", 1, "CLASSROOM", 60, "classroom A-101"),
    (2, 1, "201", 2, "CLASSROOM", 60, "classroom A-201"),
    (3, 1, "205", 2, "HALL", 150, "the seminar hall (A-205)"),
    (4, 1, "301", 3, "CLASSROOM", 72, "classroom A-301"),
    (5, 1, "G-WR", 0, "WASHROOM", 0, "the ground floor washroom of Block A"),
    (6, 1, "110", 1, "OFFICE", 12, "the faculty room A-110"),
    (7, 1, "G-LOBBY", 0, "CORRIDOR", 0, "the Block A lobby"),
    (8, 2, "001", 0, "SERVER_ROOM", 0, "the server room (B-001)"),
    (9, 2, "101", 1, "LAB", 40, "the Electronics Lab (B-101)"),
    (10, 2, "204", 2, "LAB", 36, "the Chemistry Lab (B-204)"),
    (11, 2, "301", 3, "LAB", 60, "Computer Lab 1 (B-301)"),
    (12, 2, "302", 3, "LAB", 60, "Computer Lab 2 (B-302)"),
    (13, 2, "1-WR", 1, "WASHROOM", 0, "the first floor washroom of Block B"),
    (14, 3, "G01", 0, "READING_ROOM", 200, "the main reading hall of the library"),
    (15, 3, "101", 1, "READING_ROOM", 120, "the library first floor reading room"),
    (16, 3, "102", 1, "OFFICE", 6, "the library office"),
    (17, 4, "001", 0, "OFFICE", 20, "the admin front office"),
    (18, 4, "105", 1, "OFFICE", 10, "the exam cell"),
    (19, 5, "214", 2, "HOSTEL_ROOM", 3, "hostel room H1-214"),
    (20, 5, "315", 3, "HOSTEL_ROOM", 3, "hostel room H1-315"),
    (21, 5, "3-WR", 3, "WASHROOM", 0, "the H1 third floor bathroom"),
    (22, 5, "G-CORR", 0, "CORRIDOR", 0, "the H1 ground floor corridor"),
    (23, 6, "108", 1, "HOSTEL_ROOM", 2, "hostel room H2-108"),
    (24, 6, "412", 4, "HOSTEL_ROOM", 2, "hostel room H2-412"),
    (25, 6, "4-WR", 4, "WASHROOM", 0, "the H2 fourth floor bathroom"),
    (26, 6, "G-LOBBY", 0, "CORRIDOR", 0, "the H2 lobby"),
    (27, 7, "MAIN", 0, "HALL", 800, "the main auditorium"),
    (28, 7, "BACK", 0, "OFFICE", 20, "the auditorium backstage"),
    (29, 8, "KIT", 0, "KITCHEN", 0, "the food court kitchen"),
    (30, 8, "DINE", 0, "HALL", 300, "the food court dining hall"),
]
room_name = {r[0]: r[6] for r in rooms}

categories = [
    # id, name, default sla hours, maintenance interval days
    (HVAC, "HVAC / Air Conditioning", 24, 90),
    (ELEC, "Electrical", 8, 120),
    (PLUMB, "Plumbing & Water", 12, 120),
    (IT, "IT & Network", 8, 60),
    (LAB, "Lab Equipment", 24, 90),
    (AV, "AV & Projectors", 12, 60),
    (FURN, "Furniture & Civil", 72, 365),
    (SAFE, "Fire & Safety", 4, 30),
    (LIFT, "Lifts & Elevators", 4, 30),
]

assets = [
    # id, tag, name, category, room, manufacturer, age_years, criticality, maint_days_ago
    (1, "AC-LABB-001", "Split AC 2 Ton - Computer Lab 1", HVAC, 11, "Daikin", 6.5, 4, 150),
    (2, "AC-LABB-002", "Split AC 2 Ton - Computer Lab 2", HVAC, 12, "Daikin", 3, 4, 40),
    (3, "AC-SRV-001", "Precision AC - Server Room", HVAC, 8, "Vertiv", 4, 5, 70),
    (4, "AC-ACBA-001", "Cassette AC - Seminar Hall", HVAC, 3, "Blue Star", 5, 3, 60),
    (5, "AC-LIB-001", "Ducted AC - Library Reading Hall", HVAC, 14, "Voltas", 8.5, 3, 200),
    (6, "AC-AUD-001", "Central AC Plant - Auditorium", HVAC, 27, "Carrier", 7, 4, 85),
    (7, "ELC-LABB-001", "Main Distribution Board - Labs Block", ELEC, 8, "Schneider", 9, 5, 100),
    (8, "ELC-ACBA-001", "UPS 10 kVA - Academic Block", ELEC, 6, "APC", 5, 4, 130),
    (9, "ELC-HSTM-001", "Corridor Lighting Circuit - H1", ELEC, 22, "Havells", 6, 2, 90),
    (10, "ELC-LIB-001", "Generator Changeover Panel - Library", ELEC, 16, "L&T", 10, 5, 60),
    (11, "PLB-HSTM-001", "Water Heater (Geyser) - H1 3rd Floor", PLUMB, 21, "Racold", 5, 3, 170),
    (12, "PLB-HSTW-001", "Water Heater (Geyser) - H2 4th Floor", PLUMB, 25, "AO Smith", 3, 3, 50),
    (13, "PLB-ACBA-001", "RO Water Cooler - Block A", PLUMB, 5, "Blue Star", 4, 3, 110),
    (14, "PLB-CAF-001", "Kitchen Drainage Line", PLUMB, 29, "Supreme", 8, 3, 140),
    (15, "IT-LABB-001", "Core Network Switch", IT, 8, "Cisco", 4, 5, 30),
    (16, "IT-LIB-001", "Wi-Fi Access Point - Library", IT, 14, "Aruba", 3, 3, 45),
    (17, "IT-HSTM-001", "Wi-Fi Access Point - H1 Block", IT, 22, "Aruba", 3, 3, 95),
    (18, "IT-LABB-030", "Lab Desktop Cluster (60 PCs)", IT, 11, "Dell", 5, 4, 50),
    (19, "LAB-LABB-001", "Digital Storage Oscilloscope Set", LAB, 9, "Tektronix", 6, 3, 80),
    (20, "LAB-LABB-002", "Fume Hood - Chemistry Lab", LAB, 10, "Labconco", 9, 5, 120),
    (21, "LAB-LABB-003", "3D Printer", LAB, 12, "Ultimaker", 2, 2, 30),
    (22, "AV-ACBA-001", "Projector - Classroom A-101", AV, 1, "Epson", 4, 3, 50),
    (23, "AV-ACBA-002", "Projector - Seminar Hall", AV, 3, "Sony", 6, 3, 130),
    (24, "AV-AUD-001", "PA Sound System - Auditorium", AV, 27, "Bose", 5, 4, 40),
    (25, "AV-ACBA-003", "Smart Board - Classroom A-201", AV, 2, "BenQ", 2, 2, 60),
    (26, "FUR-ACBA-001", "Classroom Benches - A-301", FURN, 4, "Godrej", 7, 1, 300),
    (27, "FUR-HSTW-001", "Room Door and Lock - H2-412", FURN, 24, "Godrej", 6, 2, 250),
    (28, "SAF-LABB-001", "Fire Alarm Panel - Labs Block", SAFE, 8, "Honeywell", 5, 5, 25),
    (29, "SAF-AUD-001", "Fire Extinguisher Set - Auditorium", SAFE, 27, "Ceasefire", 2, 4, 40),
    (30, "LFT-ACBA-001", "Passenger Lift - Academic Block A", LIFT, 7, "Otis", 8, 5, 35),
    (31, "LFT-HSTW-001", "Passenger Lift - Women's Hostel", LIFT, 26, "Kone", 4, 4, 20),
    (32, "AC-ADM-001", "Split AC - Exam Cell", HVAC, 18, "LG", 4, 3, 75),
    (33, "IT-ADM-001", "Biometric Attendance Terminal", IT, 17, "ZKTeco", 3, 2, 90),
    (34, "ELC-CAF-001", "Kitchen Exhaust and Induction Panel", ELEC, 29, "Havells", 4, 3, 60),
    (35, "PLB-HSTW-002", "Washbasins and Taps - H2 4th Floor", PLUMB, 25, "Jaquar", 6, 2, 160),
]
asset_by_id = {a[0]: a for a in assets}

ADMIN, STUDENT, TECH, FM = "ADMIN", "STUDENT_STAFF", "TECHNICIAN", "FACILITY_MANAGER"
users = [
    # id, name, email, role, phone, active
    (1, "Kavya Raman", "admin@resolvex.edu", ADMIN, "9845012345", True),
    (2, "Arjun Mehta", "manager@resolvex.edu", FM, "9845022222", True),
    (3, "Sneha Kulkarni", "sneha.kulkarni@resolvex.edu", FM, "9886033333", True),
    (4, "Ravi Kumar", "tech@resolvex.edu", TECH, "9900044444", True),
    (5, "Manjunath Gowda", "manjunath.g@resolvex.edu", TECH, "9900055555", True),
    (6, "Suresh Naidu", "suresh.naidu@resolvex.edu", TECH, "9900066666", True),
    (7, "Priya Shetty", "priya.shetty@resolvex.edu", TECH, "9900077777", True),
    (8, "Imran Khan", "imran.khan@resolvex.edu", TECH, "9900088888", True),
    (9, "Deepak Joshi", "deepak.joshi@resolvex.edu", TECH, "9900099999", True),
    (10, "Lakshmi Prasad", "lakshmi.prasad@resolvex.edu", TECH, "9900010101", True),
    (11, "Aditya Rao", "student@resolvex.edu", STUDENT, "9731011111", True),
    (12, "Ananya Iyer", "ananya.iyer@resolvex.edu", STUDENT, "9731012121", True),
    (13, "Rahul Nair", "rahul.nair@resolvex.edu", STUDENT, None, True),
    (14, "Meghana Reddy", "meghana.reddy@resolvex.edu", STUDENT, "9731014141", True),
    (15, "Vikram Singh", "vikram.singh@resolvex.edu", STUDENT, None, True),
    (16, "Divya Menon", "divya.menon@resolvex.edu", STUDENT, "9731016161", True),
    (17, "Dr. Harish Bhat", "staff@resolvex.edu", STUDENT, "9741017171", True),
    (18, "Dr. Sunil Patil", "sunil.patil@resolvex.edu", STUDENT, "9741018181", True),
    (19, "Karthik Srinivas", "karthik.s@resolvex.edu", STUDENT, None, True),
    (20, "Pooja Desai", "pooja.desai@resolvex.edu", STUDENT, "9731020202", True),
    (21, "Nikhil Jain", "nikhil.jain@resolvex.edu", STUDENT, None, False),
]
reporters = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

technicians = [
    # user id, code, hourly rate, max jobs, skills {category: level}
    (4, "TECH001", 350, 4, {HVAC: 5, ELEC: 3}),
    (5, "TECH002", 400, 4, {ELEC: 5, LIFT: 4, SAFE: 3}),
    (6, "TECH003", 300, 5, {PLUMB: 5, FURN: 3}),
    (7, "TECH004", 450, 4, {IT: 5, AV: 4}),
    (8, "TECH005", 380, 3, {LAB: 5, ELEC: 3, SAFE: 4}),
    (9, "TECH006", 320, 4, {AV: 5, IT: 3, FURN: 2}),
    (10, "TECH007", 360, 4, {HVAC: 4, PLUMB: 3, LIFT: 3}),
]
tech_rate = {t[0]: t[2] for t in technicians}
skilled = {}
for t in technicians:
    for c in t[4]:
        skilled.setdefault(c, []).append(t[0])

parts = [
    # id, code, name, category, cost, stock, reorder
    (1, "HV-GAS-R32", "Refrigerant Gas R32 (1 kg)", HVAC, 1800, 12, 4),
    (2, "HV-CAP-45", "AC Run Capacitor 45 uF", HVAC, 450, 3, 5),
    (3, "HV-FLT-01", "AC Air Filter Mesh", HVAC, 250, 25, 8),
    (4, "HV-FAN-MTR", "AC Indoor Fan Motor", HVAC, 3200, 2, 2),
    (5, "HV-DRN-PIPE", "AC Drain Pipe (5 m)", HVAC, 180, 15, 5),
    (6, "EL-MCB-32", "MCB 32A Double Pole", ELEC, 650, 20, 6),
    (7, "EL-LED-20", "LED Tube Light 20W", ELEC, 220, 60, 20),
    (8, "EL-CBL-2.5", "Copper Wire 2.5 sq mm (90 m)", ELEC, 2400, 4, 2),
    (9, "EL-UPS-BAT", "UPS Battery 12V 42Ah", ELEC, 5500, 6, 4),
    (10, "PL-GEY-ELEM", "Geyser Heating Element 2 kW", PLUMB, 900, 3, 3),
    (11, "PL-TAP-01", "Brass Pillar Tap", PLUMB, 750, 10, 4),
    (12, "PL-RO-MEM", "RO Membrane 75 GPD", PLUMB, 1600, 5, 2),
    (13, "PL-PVC-1IN", "PVC Pipe 1 inch (3 m)", PLUMB, 260, 30, 10),
    (14, "IT-AP-01", "Wi-Fi Access Point", IT, 14500, 3, 1),
    (15, "IT-CAT6", "CAT6 Patch Cable (3 m)", IT, 180, 80, 20),
    (16, "IT-SFP", "SFP Transceiver Module", IT, 4200, 4, 2),
    (17, "AV-LAMP", "Projector Lamp", AV, 6800, 2, 2),
    (18, "AV-HDMI", "HDMI Cable (10 m)", AV, 650, 12, 4),
    (19, "LB-PROBE", "Oscilloscope Probe Set", LAB, 2200, 8, 3),
    (20, "FR-LOCK", "Mortise Door Lock", FURN, 1350, 6, 2),
    (21, "SF-SMK-DET", "Smoke Detector Head", SAFE, 1900, 10, 4),
    (22, "LF-DOOR-SNS", "Lift Door Sensor", LIFT, 8500, 2, 1),
    (23, "SF-EXT-CO2", "CO2 Extinguisher Refill", SAFE, 950, 15, 5),
    (24, "LB-FUME-FLT", "Fume Hood Exhaust Filter", LAB, 7200, 2, 1),
]
part_cost = {p[0]: p[4] for p in parts}

# ------------------------------------------------------------------ incident templates
# (title, description, resolution, parts[(part,qty)], severity(lo,hi), affected(lo,hi),
#  candidate assets, candidate rooms when no asset)
HVAC_ASSETS = [1, 2, 3, 4, 5, 6, 32]
T = {
    HVAC: [
        ("AC not cooling", "The AC in {loc} has been running for hours but the room is not cooling at all. It feels like it is only working as a fan.",
         "Low refrigerant due to a minor leak at the flare joint. Leak brazed and R32 gas recharged; cooling restored.", [(1, 1)], (3, 4), (15, 60), HVAC_ASSETS, []),
        ("Room is extremely hot", "It is very hot and stuffy inside {loc}. Everyone is sweating and it is impossible to concentrate.",
         "Condenser coil heavily clogged with dust. Coils cleaned and air filter replaced; temperature back to 23 C.", [(3, 2)], (3, 4), (20, 80), HVAC_ASSETS, []),
        ("AC blowing warm air", "The air conditioner in {loc} is blowing warm air instead of cold air even at an 18 degree setting.",
         "Compressor was not starting because the run capacitor had failed. Replaced capacitor and checked compressor current.", [(2, 1)], (3, 4), (10, 60), HVAC_ASSETS, []),
        ("Water dripping from AC unit", "Water is leaking from the indoor AC unit in {loc} and dripping onto the desks and floor.",
         "Drain pipe choked with algae. Flushed the drain line and replaced the damaged section of pipe.", [(5, 1)], (2, 3), (5, 40), HVAC_ASSETS, []),
        ("AC making loud rattling noise", "The AC in {loc} makes a very loud rattling and grinding noise which disturbs everyone.",
         "Indoor blower fan motor bearing worn out. Replaced the indoor fan motor.", [(4, 1)], (2, 3), (10, 60), HVAC_ASSETS, []),
        ("AC switches off by itself", "The AC in {loc} turns off automatically every 10 to 15 minutes and has to be restarted.",
         "Faulty room thermistor gave wrong readings. Sensor recalibrated and loose wiring tightened.", [], (2, 3), (10, 50), HVAC_ASSETS, []),
    ],
    ELEC: [
        ("Power outage in the room", "There is no electricity in {loc}. Lights, fans and plug points are all dead.",
         "MCB tripped due to overload and was found damaged. Replaced 32A MCB and balanced the load across phases.", [(6, 1)], (4, 4), (10, 60), [7, 9, 34], [1, 2, 4, 19, 20, 23, 24]),
        ("Tube lights not working", "Several tube lights in {loc} are not working and the area is very dark in the evening.",
         "Replaced fused LED tube lights and fixed loose holder connections.", [(7, 4)], (2, 2), (10, 50), [9], [1, 4, 15, 22, 26]),
        ("Sparks from switch board", "There were sparks and a burning smell from the switch board in {loc}. This is dangerous, please fix urgently.",
         "Burnt and loose wiring inside the switch board. Rewired with new 2.5 sq mm cable and replaced the socket.", [(8, 1)], (5, 5), (2, 20), [], [6, 19, 20, 23, 24, 29]),
        ("UPS beeping with no backup", "The UPS in {loc} keeps beeping and computers shut down immediately when power goes.",
         "UPS batteries had degraded. Replaced two batteries in the bank and ran a load test.", [(9, 2)], (4, 4), (10, 40), [8], []),
        ("Frequent voltage fluctuation", "Lights in {loc} keep flickering and fans slow down, it looks like voltage fluctuation.",
         "Neutral connection loose at the distribution board. Tightened terminals and verified earthing.", [], (3, 3), (20, 80), [7, 10, 34], []),
    ],
    PLUMB: [
        ("No hot water in bathroom", "The geyser in {loc} is not heating water. Only cold water comes in the morning.",
         "Geyser heating element burnt out. Replaced the element and tested the thermostat.", [(10, 1)], (3, 3), (10, 40), [11, 12], []),
        ("Tap leaking continuously", "A tap in {loc} is leaking continuously and a lot of water is being wasted.",
         "Replaced the worn out pillar tap and washer.", [(11, 1)], (2, 2), (5, 30), [35], [5, 13, 21]),
        ("Drinking water tastes salty", "The water from the water cooler in {loc} tastes salty and has an odd smell.",
         "RO membrane exhausted. Replaced RO membrane and sanitised the storage tank.", [(12, 1)], (3, 3), (50, 200), [13], []),
        ("Drain blocked and overflowing", "The drain in {loc} is blocked and dirty water is overflowing onto the floor.",
         "Cleared the blockage with a drain rod and replaced a cracked PVC section.", [(13, 2)], (4, 4), (10, 100), [14], [5, 13, 21, 25]),
        ("Very low water pressure", "Water pressure in {loc} is very low, taps barely flow.",
         "Air lock in the supply line removed and the inlet valve cleaned.", [], (2, 2), (10, 40), [35], [5, 21, 25]),
    ],
    IT: [
        ("Wi-Fi not working", "Wi-Fi is not working in {loc}. Devices connect but there is no internet access.",
         "Access point hung due to a firmware bug. Rebooted and upgraded the firmware.", [], (3, 3), (30, 150), [16, 17], []),
        ("Internet extremely slow", "Internet is extremely slow in {loc}. Pages take minutes to load and online classes keep buffering.",
         "Uplink port negotiating at 100 Mbps due to a faulty cable. Replaced patch cables; link restored to 1 Gbps.", [(15, 2)], (3, 3), (30, 150), [15, 16, 17], []),
        ("Lab computers have no network", "Most computers in {loc} show 'No network access' and the lab session cannot be conducted.",
         "Failed SFP module on the core switch uplink. Replaced the SFP transceiver.", [(16, 1)], (4, 4), (40, 60), [15, 18], []),
        ("Wi-Fi access point dead", "The Wi-Fi access point in {loc} has no lights on and nobody can connect.",
         "Access point unit and PoE port failed. Replaced the access point.", [(14, 1)], (3, 3), (30, 150), [16, 17], []),
        ("Biometric machine not reading fingerprints", "The biometric attendance machine in {loc} does not recognise fingerprints.",
         "Sensor cleaned and device database re-synced with the server.", [], (2, 2), (20, 100), [33], []),
    ],
    LAB: [
        ("Oscilloscope probes damaged", "Many oscilloscope probes in {loc} are broken and give noisy readings during experiments.",
         "Replaced the damaged probe sets and calibrated the oscilloscopes.", [(19, 2)], (2, 2), (20, 40), [19], []),
        ("Fume hood exhaust not working", "The fume hood in {loc} is not pulling air and a chemical smell is spreading in the lab.",
         "Exhaust filter choked. Replaced the fume hood filter and verified face velocity.", [(24, 1)], (5, 5), (20, 36), [20], []),
        ("3D printer nozzle clogged", "The 3D printer in {loc} is not extruding filament and prints fail midway.",
         "Nozzle cleaned and extruder recalibrated.", [], (1, 2), (2, 10), [21], []),
    ],
    AV: [
        ("Projector display is dim", "The projector in {loc} is very dim and slides are not readable even with the lights off.",
         "Projector lamp reached end of life. Replaced the lamp and reset the lamp timer.", [(17, 1)], (3, 3), (40, 150), [22, 23], []),
        ("Projector shows no signal", "The projector in {loc} shows 'No signal' when a laptop is connected through HDMI.",
         "Damaged HDMI cable inside the conduit replaced.", [(18, 1)], (3, 3), (40, 150), [22, 23], []),
        ("Mic and speakers not working", "The microphones and speakers in {loc} are not working and the audience cannot hear the speaker.",
         "Amplifier input channel faulty. Rerouted to a spare channel and replaced XLR connectors.", [], (4, 4), (100, 800), [24], []),
        ("Smart board touch not responding", "Touch on the smart board in {loc} is not responding properly.",
         "Recalibrated the touch panel and updated the driver.", [], (2, 2), (40, 60), [25], []),
    ],
    FURN: [
        ("Broken benches", "Several benches in {loc} are broken and students are unable to sit.",
         "Repaired bench joints and replaced broken planks.", [], (2, 2), (5, 30), [26], []),
        ("Door lock broken", "The door lock of {loc} is broken and the room cannot be locked. Belongings are unsafe.",
         "Replaced the mortise door lock and issued new keys.", [(20, 1)], (3, 3), (1, 3), [27], []),
    ],
    SAFE: [
        ("Fire alarm beeping continuously", "The fire alarm panel in {loc} keeps beeping and shows a fault indication.",
         "Faulty smoke detector head on zone 3 replaced and the panel reset.", [(21, 1)], (4, 4), (50, 300), [28], []),
        ("Fire extinguishers expired", "Fire extinguishers in {loc} have crossed their refill date.",
         "Extinguishers refilled and pressure tested.", [(23, 3)], (3, 3), (100, 800), [29], []),
    ],
    LIFT: [
        ("Lift stuck between floors", "The lift in {loc} got stuck between floors with people inside for 10 minutes.",
         "Door sensor malfunction caused a safety stop. Replaced the door sensor and tested all floors.", [(22, 1)], (5, 5), (4, 12), [30, 31], []),
        ("Lift doors not closing", "The lift doors in {loc} keep opening and closing without the lift moving.",
         "Door track cleaned and sensor alignment corrected.", [], (3, 3), (20, 100), [30, 31], []),
    ],
}

# how often each category appears in history, and "problem assets" that fail more
cat_weights = {HVAC: 26, ELEC: 13, PLUMB: 16, IT: 16, LAB: 5, AV: 11, FURN: 5, SAFE: 3, LIFT: 2}
asset_weight = {1: 6, 5: 5, 11: 5, 17: 5, 23: 4, 6: 2, 14: 2}

lines = []
w = lines.append

w("-- =====================================================================")
w("-- ResolveX : 08_seed.sql   (GENERATED by scripts/generate_seed.py)")
w("-- DML - INSERT / UPDATE / DELETE : reference data, campus master data,")
w("-- ~6 months of incident history and the live demo incidents.")
w("-- All demo users have the password  Resolve@123  (stored as a bcrypt hash).")
w("-- =====================================================================")
w("")
w("BEGIN;")
w("")
w("-- reference data -------------------------------------------------------")
w("INSERT INTO roles (role_id, role_name, description) VALUES")
w("  (1, 'STUDENT_STAFF', 'Students and staff who report incidents'),")
w("  (2, 'TECHNICIAN', 'Maintenance technicians who execute work orders'),")
w("  (3, 'FACILITY_MANAGER', 'Prioritises incidents, assigns technicians, monitors SLAs'),")
w("  (4, 'ADMIN', 'Manages users, assets, buildings, inventory and policies');")
w("")
w("INSERT INTO sla_policies (priority_level, label, min_score, response_hours, resolution_hours) VALUES")
w("  ('P1', 'Critical', 80, 1, 8),")
w("  ('P2', 'High',     62, 4, 24),")
w("  ('P3', 'Medium',   45, 8, 72),")
w("  ('P4', 'Low',       0, 24, 168);")
w("")
transitions = [
    ("OPEN", "ASSIGNED"), ("OPEN", "DUPLICATE"), ("OPEN", "CANCELLED"),
    ("ASSIGNED", "IN_PROGRESS"), ("ASSIGNED", "OPEN"), ("ASSIGNED", "ON_HOLD"), ("ASSIGNED", "CANCELLED"),
    ("IN_PROGRESS", "ON_HOLD"), ("IN_PROGRESS", "RESOLVED"), ("IN_PROGRESS", "OPEN"),
    ("ON_HOLD", "IN_PROGRESS"), ("ON_HOLD", "ASSIGNED"), ("ON_HOLD", "OPEN"), ("ON_HOLD", "RESOLVED"),
    ("RESOLVED", "CLOSED"), ("RESOLVED", "OPEN"),
]
w("INSERT INTO incident_status_transitions (from_status, to_status) VALUES")
w(",\n".join(f"  ({q(a)}, {q(b)})" for a, b in transitions) + ";")
w("")
w("-- campus master data ---------------------------------------------------")
w("INSERT INTO buildings (building_id, building_code, building_name, building_type, importance_level, total_floors) VALUES")
w(",\n".join(f"  ({b[0]}, {q(b[1])}, {q(b[2])}, {q(b[3])}, {b[4]}, {b[5]})" for b in buildings) + ";")
w("")
w("INSERT INTO rooms (room_id, building_id, room_number, floor_no, room_type, capacity) VALUES")
w(",\n".join(f"  ({r[0]}, {r[1]}, {q(r[2])}, {r[3]}, {q(r[4])}, {r[5]})" for r in rooms) + ";")
w("")
w("INSERT INTO asset_categories (category_id, category_name, default_sla_hours, maintenance_interval_days) VALUES")
w(",\n".join(f"  ({c[0]}, {q(c[1])}, {c[2]}, {c[3]})" for c in categories) + ";")
w("")
under_repair = {3, 11, 20}
w("INSERT INTO assets (asset_id, asset_tag, asset_name, category_id, room_id, manufacturer, install_date, criticality, status, last_maintenance_date) VALUES")
w(",\n".join(
    f"  ({a[0]}, {q(a[1])}, {q(a[2])}, {a[3]}, {a[4]}, {q(a[5])}, {ago_date(a[6] * 365)}, {a[7]}, "
    f"{q('UNDER_REPAIR' if a[0] in under_repair else 'OPERATIONAL')}, {ago_date(a[8])})" for a in assets) + ";")
w("")
w("-- users : passwords hashed with bcrypt (pgcrypto crypt + gen_salt('bf'))")
w("INSERT INTO users (user_id, full_name, email, password_hash, role_id, phone, is_active) VALUES")
role_id = {STUDENT: 1, TECH: 2, FM: 3, ADMIN: 4}
w(",\n".join(
    f"  ({u[0]}, {q(u[1])}, {q(u[2])}, crypt('Resolve@123', gen_salt('bf', 10)), {role_id[u[3]]}, {q(u[4])}, {'TRUE' if u[5] else 'FALSE'})"
    for u in users) + ";")
w("")
w("INSERT INTO technicians (technician_id, employee_code, hourly_rate, max_concurrent_jobs, is_available) VALUES")
w(",\n".join(f"  ({t[0]}, {q(t[1])}, {t[2]}, {t[3]}, TRUE)" for t in technicians) + ";")
w("")
w("INSERT INTO technician_skills (technician_id, category_id, skill_level) VALUES")
w(",\n".join(f"  ({t[0]}, {c}, {lvl})" for t in technicians for c, lvl in t[4].items()) + ";")
w("")
w("INSERT INTO spare_parts (part_id, part_code, part_name, category_id, unit_cost, quantity_in_stock, reorder_level) VALUES")
w(",\n".join(f"  ({p[0]}, {q(p[1])}, {q(p[2])}, {p[3]}, {p[4]}, {p[5]}, {p[6]})" for p in parts) + ";")
w("")

# ------------------------------------------------------------------ incident history
incidents = []     # dicts
work_orders = []
wo_parts = []
maint = []

inc_id = 0
wo_id = 0


def pick_template(cat):
    return random.choice(T[cat])


def choose_asset(tpl):
    cands = tpl[6]
    if cands and (not tpl[7] or random.random() < 0.7):
        weights = [asset_weight.get(a, 1) for a in cands]
        return random.choices(cands, weights=weights)[0]
    return None


OPENERS = ["", "", "", "Hi, ", "Urgent: ", "Reporting again - ", "Since this morning, ", "Since yesterday evening, "]
CLOSERS = [
    "This is the second time this week.",
    "Please send someone as soon as possible.",
    "Classes are getting disturbed because of this.",
    "Many students have complained about it.",
    "It was working fine until last week.",
    "Kindly look into it before the evening.",
    "We already informed the floor in-charge.",
    "This happens every few days.",
]

N_HISTORY = 140
start_min = 178 * 24 * 60
times = sorted(random.randint(4 * 24 * 60, start_min) for _ in range(N_HISTORY))[::-1]  # oldest first

for t_ago in times:
    cat = random.choices(list(cat_weights), weights=list(cat_weights.values()))[0]
    tpl = pick_template(cat)
    asset = choose_asset(tpl)
    room = asset_by_id[asset][4] if asset else random.choice(tpl[7])
    sev = random.randint(*tpl[4])
    aff = random.randint(*tpl[5])
    title = tpl[0] + (" - " + asset_by_id[asset][2].split(" - ")[-1] if asset and random.random() < 0.5 else "")
    title = title[:150]
    desc = tpl[1].format(loc=room_name[room])
    opener = random.choice(OPENERS)
    if opener:
        desc = opener + desc[0].lower() + desc[1:]
    if random.random() < 0.6:
        desc += " " + random.choice(CLOSERS)
    inc_id += 1
    rep = random.choice(reporters)
    # resolution time depends on severity
    # roughly 80% of jobs finish inside the SLA target expected for the severity
    target = {5: 6, 4: 10, 3: 22, 2: 60, 1: 150}[sev]
    factor = random.uniform(0.15, 0.95) if random.random() < 0.8 else random.uniform(1.05, 2.5)
    res_h = min(target * factor, t_ago / 60 - 30)
    assign_h = random.uniform(0.2, min(6, res_h / 3))
    start_h = assign_h + random.uniform(0.2, max(0.3, (res_h - assign_h) / 3))
    reported = t_ago
    assigned = reported - assign_h * 60
    started = reported - start_h * 60
    completed = reported - res_h * 60
    tech = random.choice(skilled[cat])
    closed = completed - 24 * 60 > 0 and random.random() < 0.9
    status = "CLOSED" if closed else "RESOLVED"
    rating = random.choices([5, 4, 3, 2, None], weights=[35, 30, 12, 5, 18])[0]
    incidents.append(dict(id=inc_id, title=title, desc=desc, rep=rep, room=room, asset=asset, cat=cat,
                          sev=sev, aff=aff, status=status, reported=reported, resolved=completed,
                          rating=rating, type="REACTIVE", dup=None))
    wo_id += 1
    labour = round(random.uniform(0.5, 5.5), 2)
    work_orders.append(dict(id=wo_id, inc=inc_id, tech=tech, by=random.choice([2, 3]), status="COMPLETED",
                            assigned=assigned, started=started, completed=completed, labour=labour,
                            notes=tpl[2]))
    pc = 0
    for pid, qty in tpl[3]:
        wo_parts.append((wo_id, pid, qty))
        pc += qty * part_cost[pid]
    if asset:
        maint.append(dict(asset=asset, wo=wo_id, type="CORRECTIVE", days=int(completed // (24 * 60)),
                          labour=round(labour * tech_rate[tech], 2), parts=pc, notes=tpl[2]))

# a few historical preventive maintenance jobs and duplicates
for asset in [3, 7, 15, 28, 30, 31, 6, 2]:
    t_ago = random.randint(10 * 24 * 60, 120 * 24 * 60)
    a = asset_by_id[asset]
    inc_id += 1
    res_h = random.uniform(3, 20)
    incidents.append(dict(id=inc_id, title=f"Preventive maintenance: {a[2]} ({a[1]})",
                          desc=f"Scheduled preventive maintenance and inspection of {a[2]}.",
                          rep=2, room=a[4], asset=asset, cat=a[3], sev=2, aff=1, status="CLOSED",
                          reported=t_ago, resolved=t_ago - res_h * 60, rating=None, type="PREVENTIVE", dup=None))
    wo_id += 1
    tech = random.choice(skilled[a[3]])
    labour = round(random.uniform(1, 4), 2)
    work_orders.append(dict(id=wo_id, inc=inc_id, tech=tech, by=2, status="COMPLETED", assigned=t_ago - 30,
                            started=t_ago - 90, completed=t_ago - res_h * 60, labour=labour,
                            notes="Preventive service completed: cleaned, inspected, tested and logged readings."))
    maint.append(dict(asset=asset, wo=wo_id, type="PREVENTIVE", days=int((t_ago - res_h * 60) // 1440),
                      labour=round(labour * tech_rate[tech], 2), parts=0,
                      notes="Preventive service completed."))

# historical duplicates (reports merged into an original)
hist_originals = random.sample([i for i in incidents if i["type"] == "REACTIVE" and i["aff"] > 20], 8)
dup_texts = {
    HVAC: ("Lab feels like an oven", "It is unbearably hot in {loc}, the AC does not seem to be doing anything."),
    ELEC: ("No current in the room", "Electricity is not there in {loc} since morning."),
    PLUMB: ("Bathroom water issue", "Water problem again in {loc}, please check."),
    IT: ("Cannot access internet", "Internet is not working on my laptop in {loc}."),
    AV: ("Cannot see the slides", "The slides are not visible properly in {loc}, projector issue."),
    LAB: ("Lab equipment problem", "Equipment in {loc} is not working properly."),
    FURN: ("Furniture damaged", "Furniture in {loc} is damaged."),
    SAFE: ("Safety concern", "There is a fire safety issue in {loc}."),
    LIFT: ("Lift problem", "Lift in {loc} is not working properly."),
}
for orig in hist_originals:
    inc_id += 1
    t, d = dup_texts[orig["cat"]]
    rep = random.choice([r for r in reporters if r != orig["rep"]])
    incidents.append(dict(id=inc_id, title=t, desc=d.format(loc=room_name[orig["room"]]), rep=rep,
                          room=orig["room"], asset=orig["asset"], cat=orig["cat"], sev=orig["sev"], aff=1,
                          status="DUPLICATE", reported=orig["reported"] - 45, resolved=None, rating=None,
                          type="REACTIVE", dup=orig["id"]))

# keep chronological insert order (so frequency based priority is realistic)
incidents.sort(key=lambda x: -x["reported"])
FIRST_ACTIVE = None

# ------------------------------------------------------------------ live demo incidents
H = 60
active = [
    # key, title, desc, rep, room, asset, cat, sev, aff, status, hours_ago, tech, wo_status
    ("ac_lab1", "AC not cooling in Computer Lab 1", "The AC in Computer Lab 1 (B-301) is running but there is no cooling at all. 60 students have a lab exam in the afternoon.",
     14, 11, 1, HVAC, 4, 12, "OPEN", 3, None, None),
    ("wifi_h1", "Wi-Fi down in H1 ground floor", "Wi-Fi is completely down near the H1 ground floor corridor and common room. Nobody in the block can connect to the internet.",
     13, 22, 17, IT, 3, 90, "ASSIGNED", 6, 7, "ASSIGNED"),
    ("geyser_h1", "No hot water in H1 third floor bathroom", "The geyser in the H1 third floor bathroom is not heating water again. Only cold water since two days.",
     15, 21, 11, PLUMB, 3, 30, "IN_PROGRESS", 20, 6, "IN_PROGRESS"),
    ("proj_seminar", "Seminar hall projector very dim", "The projector in the seminar hall (A-205) is very dim; slides are unreadable during the guest lecture.",
     17, 3, 23, AV, 3, 120, "OPEN", 80, None, None),
    ("lift_a", "Lift stuck between 2nd and 3rd floor", "The Block A lift got stuck between the 2nd and 3rd floor with 5 people inside. Doors opened after 10 minutes.",
     18, 7, 30, LIFT, 5, 8, "ASSIGNED", 2, 5, "ASSIGNED"),
    ("sparks_h2", "Sparks from switch board in H2-108", "Sparks and a burning smell came from the switch board near the study table in H2-108. We have switched off the mains.",
     20, 23, None, ELEC, 5, 2, "OPEN", 1, None, None),
    ("fume_hood", "Fume hood exhaust very weak", "The fume hood in the Chemistry Lab (B-204) is barely pulling air and there is a strong chemical smell in the lab.",
     18, 10, 20, LAB, 5, 30, "ON_HOLD", 50, 8, "IN_PROGRESS"),
    ("water_cooler", "Drinking water tastes salty in Block A", "The water from the RO water cooler near the Block A ground floor washroom tastes salty and smells odd.",
     14, 5, 13, PLUMB, 3, 150, "OPEN", 10, None, None),
    ("server_ac", "Server room temperature rising", "The precision AC in the server room (B-001) is showing a high temperature alarm, room temperature is 31 C and rising.",
     17, 8, 3, HVAC, 5, 5, "IN_PROGRESS", 5, 10, "IN_PROGRESS"),
    ("door_h2", "Room door lock broken in H2-412", "The door lock of H2-412 is broken, the room cannot be locked and our laptops are inside.",
     16, 24, 27, FURN, 3, 2, "OPEN", 26, None, None),
    ("benches", "Broken benches in A-301", "Four benches in classroom A-301 are broken and students are standing during lectures.",
     19, 4, 26, FURN, 2, 12, "OPEN", 70, None, None),
    ("lib_wifi", "Library Wi-Fi extremely slow", "Internet in the main reading hall of the library is extremely slow, cannot download papers or attend online classes.",
     11, 14, 16, IT, 3, 80, "OPEN", 4, None, None),
    ("exam_ac", "Exam cell AC making loud noise", "The split AC in the exam cell makes a loud rattling noise, staff cannot take phone calls.",
     17, 18, 32, HVAC, 2, 10, "RESOLVED", 30, 4, "COMPLETED"),
    ("aud_mic", "Auditorium mic and speakers not working", "Microphones and speakers in the main auditorium stopped working before the cultural event rehearsal.",
     19, 27, 24, AV, 4, 300, "CLOSED", 70, 9, "COMPLETED"),
]
active_ids = {}
next_id = len(incidents) + 1
for key, title, desc, rep, room, asset, cat, sev, aff, status, h_ago, tech, wo_status in active:
    i = dict(id=next_id, title=title, desc=desc, rep=rep, room=room, asset=asset, cat=cat, sev=sev, aff=aff,
             status=status, reported=h_ago * H, resolved=None, rating=None, type="REACTIVE", dup=None)
    if status in ("RESOLVED", "CLOSED"):
        i["resolved"] = h_ago * H - 6 * H
        if status == "CLOSED":
            i["rating"] = 5
    active_ids[key] = next_id
    if FIRST_ACTIVE is None:
        FIRST_ACTIVE = next_id
    incidents.append(i)
    if tech:
        wo_id += 1
        wo = dict(id=wo_id, inc=next_id, tech=tech, by=2, status=wo_status, assigned=h_ago * H - 30,
                  started=None, completed=None, labour=0, notes=None)
        if wo_status in ("IN_PROGRESS", "COMPLETED"):
            wo["started"] = h_ago * H - 60
        if wo_status == "COMPLETED":
            wo["completed"] = i["resolved"]
            wo["labour"] = 2.5
            wo["notes"] = ("Indoor fan motor bearing worn out; replaced fan motor and balanced the blower wheel."
                           if key == "exam_ac" else
                           "Amplifier input channel faulty; moved mics to spare channel and replaced XLR connectors.")
            pc = 0
            if key == "exam_ac":
                wo_parts.append((wo_id, 4, 1))
                pc = part_cost[4]
            maint.append(dict(asset=asset, wo=wo_id, type="CORRECTIVE", days=int(i["resolved"] // 1440),
                              labour=round(2.5 * tech_rate[tech], 2), parts=pc, notes=wo["notes"]))
        work_orders.append(wo)
    next_id += 1

# one live duplicate that has already been merged into the Lab 1 AC incident
dup_id = next_id
incidents.append(dict(id=dup_id, title="Lab is too hot, AC blowing warm air",
                      desc="Computer Lab 1 is extremely hot, the AC is blowing warm air and the systems are heating up.",
                      rep=12, room=11, asset=1, cat=HVAC, sev=3, aff=1, status="DUPLICATE",
                      reported=2 * H, resolved=None, rating=None, type="REACTIVE", dup=active_ids["ac_lab1"]))

# ------------------------------------------------------------------ emit incidents
w("-- incidents (history + live demo) - inserted in chronological order so that")
w("-- the trigger-computed priority uses the correct failure history")
# renumber ids chronologically
incidents.sort(key=lambda x: -x["reported"])
remap = {}
for n, i in enumerate(incidents, start=1):
    remap[i["id"]] = n
for i in incidents:
    i["id"] = remap[i["id"]]
    if i["dup"]:
        i["dup"] = remap[i["dup"]]
for wo in work_orders:
    wo["inc"] = remap[wo["inc"]]
active_ids = {k: remap[v] for k, v in active_ids.items()}

for i in incidents:
    w("INSERT INTO incidents (incident_id, title, description, incident_type, reported_by, room_id, asset_id, category_id, "
      "severity, affected_users, status, reported_at, resolved_at, duplicate_of, feedback_rating) VALUES "
      f"({i['id']}, {q(i['title'])}, {q(i['desc'])}, {q(i['type'])}, {i['rep']}, {i['room']}, "
      f"{i['asset'] if i['asset'] else 'NULL'}, {i['cat']}, {i['sev']}, {i['aff']}, {q(i['status'])}, "
      f"{ago(i['reported'])}, {ago(i['resolved']) if i['resolved'] is not None else 'NULL'}, "
      f"{i['dup'] if i['dup'] else 'NULL'}, {i['rating'] if i['rating'] else 'NULL'});")
w("")
w("-- co-reporters (duplicates merged into originals) - trigger raises affected_users")
for i in incidents:
    if i["dup"]:
        orig = next(x for x in incidents if x["id"] == i["dup"])
        if orig["status"] in ("OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD") and orig["rep"] != i["rep"]:
            w(f"INSERT INTO incident_reporters (incident_id, user_id, joined_at) VALUES ({i['dup']}, {i['rep']}, {ago(i['reported'])});")
w("")
w("-- work orders")
for wo in work_orders:
    w("INSERT INTO work_orders (work_order_id, incident_id, technician_id, assigned_by, status, assigned_at, started_at, "
      "completed_at, labour_hours, resolution_notes) VALUES "
      f"({wo['id']}, {wo['inc']}, {wo['tech']}, {wo['by']}, {q(wo['status'])}, {ago(wo['assigned'])}, "
      f"{ago(wo['started']) if wo['started'] is not None else 'NULL'}, "
      f"{ago(wo['completed']) if wo['completed'] is not None else 'NULL'}, {wo['labour']}, {q(wo['notes'])});")
w("")
w("-- spare parts consumed by completed work orders (price at time of use)")
w("INSERT INTO work_order_parts (work_order_id, part_id, quantity_used, unit_cost_at_use) VALUES")
w(",\n".join(f"  ({a}, {b}, {c}, {part_cost[b]})" for a, b, c in wo_parts) + ";")
w("")
w("-- maintenance records (total_cost is a GENERATED column)")
w("INSERT INTO maintenance_records (asset_id, work_order_id, maintenance_type, performed_on, labour_cost, parts_cost, notes) VALUES")
w(",\n".join(f"  ({m['asset']}, {m['wo']}, {q(m['type'])}, {ago_date(m['days'])}, {m['labour']}, {m['parts']}, {q(m['notes'])})"
             for m in maint) + ";")
w("")
w("-- rebuild a realistic status timeline from work order timestamps --------")
w("DELETE FROM incident_status_history;")
w("""INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, changed_at)
SELECT incident_id, NULL, 'OPEN', reported_by, reported_at FROM incidents;

INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, changed_at)
SELECT incident_id, 'OPEN', 'DUPLICATE', 2, reported_at + interval '20 minutes'
  FROM incidents WHERE status = 'DUPLICATE';

INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, changed_at)
SELECT w.incident_id, 'OPEN', 'ASSIGNED', w.assigned_by, w.assigned_at FROM work_orders w;

INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, changed_at)
SELECT w.incident_id, 'ASSIGNED', 'IN_PROGRESS', w.technician_id, w.started_at
  FROM work_orders w WHERE w.started_at IS NOT NULL;

INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, changed_at)
SELECT i.incident_id, 'IN_PROGRESS', 'ON_HOLD', w.technician_id, w.started_at + interval '2 hours'
  FROM incidents i JOIN work_orders w ON w.incident_id = i.incident_id WHERE i.status = 'ON_HOLD';

INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, changed_at)
SELECT w.incident_id, 'IN_PROGRESS', 'RESOLVED', w.technician_id, w.completed_at
  FROM work_orders w WHERE w.status = 'COMPLETED';

INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, changed_at)
SELECT i.incident_id, 'RESOLVED', 'CLOSED', i.reported_by,
       LEAST(now(), i.resolved_at + interval '1 day')
  FROM incidents i WHERE i.status = 'CLOSED';""")
w("")
w("-- asset maintenance dates follow the maintenance history")
w("""UPDATE assets a
   SET last_maintenance_date = m.last_done
  FROM (SELECT asset_id, MAX(performed_on) AS last_done FROM maintenance_records GROUP BY asset_id) m
 WHERE m.asset_id = a.asset_id
   AND m.last_done > COALESCE(a.last_maintenance_date, a.install_date);""")
w("")
w("-- clean up alerts/audit rows produced while loading history, keep live ones")
w(f"DELETE FROM alerts WHERE incident_id < {min(active_ids.values())};")
w("TRUNCATE audit_log;")
w("""INSERT INTO alerts (alert_type, alert_level, message, target_role, part_id)
SELECT 'LOW_STOCK', CASE WHEN quantity_in_stock = 0 THEN 'CRITICAL' ELSE 'WARNING' END,
       format('Low stock: %s (%s) has %s left, reorder level is %s', part_name, part_code, quantity_in_stock, reorder_level),
       'ADMIN', part_id
  FROM spare_parts WHERE quantity_in_stock <= reorder_level;""")
w("")
w("-- derived data")
w("UPDATE assets SET risk_score = fn_asset_risk_score(asset_id);")
w("")
w("-- keep SERIAL sequences in sync with explicitly inserted ids")
for tbl, col in [("roles", "role_id"), ("users", "user_id"), ("buildings", "building_id"), ("rooms", "room_id"),
                 ("asset_categories", "category_id"), ("assets", "asset_id"), ("incidents", "incident_id"),
                 ("work_orders", "work_order_id"), ("spare_parts", "part_id")]:
    w(f"SELECT setval(pg_get_serial_sequence('{tbl}', '{col}'), (SELECT MAX({col}) FROM {tbl}));")
w("")
w("COMMIT;")
w("")
w("REFRESH MATERIALIZED VIEW mv_monthly_incident_stats;")

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {OUT} : {len(incidents)} incidents, {len(work_orders)} work orders, {len(maint)} maintenance records")
