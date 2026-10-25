"""
Captures application screenshots for the project report (docs/screenshots).
Requires: pip install playwright  and a running app (npm run dev / npm start).
Usage:    python scripts/take_screenshots.py [base_url]
"""
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
PW = "Resolve@123"


def login(page, email):
    page.context.clear_cookies()
    page.goto(f"{BASE}/login")
    page.fill("#email", email)
    page.fill("#password", PW)
    page.click("button.btn.signal")
    page.wait_for_load_state("networkidle")
    time.sleep(0.6)


def shot(page, name, full=True):
    page.wait_for_load_state("networkidle")
    time.sleep(0.8)
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)
    print("saved", name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    page.goto(f"{BASE}/login")
    shot(page, "01_login", full=False)

    # ---------------- student / staff
    login(page, "student@resolvex.edu")
    shot(page, "02_student_my_reports")
    page.goto(f"{BASE}/report")
    page.wait_for_selector("#b")
    page.select_option("#b", label="Engineering Labs Block B")
    page.select_option("#r", label="301 (lab, floor 3)")  # Computer Lab 1
    page.select_option("#c", label="HVAC / Air Conditioning")
    page.fill("#t", "Lab is very hot")
    page.fill("#d", "The AC in the computer lab is blowing warm air and the systems are heating up during the lab session.")
    page.wait_for_selector(".match-title", timeout=20000)
    time.sleep(1.5)
    shot(page, "03_report_duplicate_detection")
    page.locator("text=I have this problem too").first.click()
    page.wait_for_selector(".toast", timeout=10000)
    shot(page, "03b_me_too_priority_recalculated", full=False)
    page.goto(f"{BASE}/search")
    page.fill("input[type=search]", "room is too hot")
    page.click("button.btn.signal")
    page.wait_for_selector("table", timeout=20000)
    shot(page, "04_semantic_search")

    # ---------------- facility manager
    login(page, "manager@resolvex.edu")
    shot(page, "05_manager_priority_queue")
    first_open = page.locator("a[href^='/incidents/']").first.get_attribute("href")
    page.goto(f"{BASE}{first_open}")
    page.wait_for_selector("text=Why this priority")
    shot(page, "06_incident_detail_priority_breakdown")
    page.click("text=Auto-assign best technician")
    time.sleep(1.5)
    shot(page, "07_incident_after_auto_assign")
    page.goto(f"{BASE}/analytics")
    page.wait_for_selector("text=SLA compliance by priority")
    shot(page, "08_analytics_dashboard")
    page.goto(f"{BASE}/assets")
    page.wait_for_selector("table")
    shot(page, "09_asset_health_predictive")
    page.goto(f"{BASE}/showcase")
    page.click("text=Duplicate chains")
    page.wait_for_selector("pre.sql")
    shot(page, "10_db_showcase_recursive_cte")
    page.click("text=Top 3 most expensive assets per category")
    page.wait_for_selector("text=RANK() OVER")
    shot(page, "11_db_showcase_window_function")

    # ---------------- technician
    login(page, "tech@resolvex.edu")
    shot(page, "12_technician_work_orders")
    page.click("text=Complete…")
    page.fill("textarea", "Run capacitor of the outdoor unit had failed. Replaced capacitor and topped up R32 gas.")
    page.click("text=Add a part")
    page.select_option("form select", label=None, index=1)
    page.locator("form input[type=number]").nth(1).fill("99")
    page.click("text=Complete work order")
    page.wait_for_selector(".notice.err", timeout=15000)
    shot(page, "13_transaction_rollback_insufficient_stock")
    page.locator("form input[type=number]").nth(1).fill("1")
    page.click("text=Complete work order")
    time.sleep(2)
    page.click("button:has-text('Completed')")
    time.sleep(1.5)
    shot(page, "14_work_order_completed", full=False)

    # ---------------- admin
    login(page, "admin@resolvex.edu")
    page.goto(f"{BASE}/admin/users")
    page.wait_for_selector("table")
    shot(page, "15_admin_users_roles")
    page.goto(f"{BASE}/inventory")
    page.wait_for_selector("table")
    shot(page, "16_inventory_low_stock")
    page.goto(f"{BASE}/admin/audit")
    page.wait_for_selector("table")
    shot(page, "17_audit_log_trigger")
    page.goto(f"{BASE}/alerts")
    page.wait_for_selector("table")
    shot(page, "18_alerts_from_triggers")
    page.goto(f"{BASE}/admin/campus")
    page.wait_for_selector("table")
    shot(page, "19_admin_campus_sla")

    # mobile view
    m = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    m.goto(f"{BASE}/login")
    m.fill("#email", "student@resolvex.edu")
    m.fill("#password", PW)
    m.click("button.btn.signal")
    m.wait_for_load_state("networkidle")
    time.sleep(1)
    m.screenshot(path=str(OUT / "20_mobile_my_reports.png"), full_page=False)
    print("saved 20_mobile_my_reports")
    browser.close()
