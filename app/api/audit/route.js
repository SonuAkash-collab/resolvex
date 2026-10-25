// GET /api/audit?table=   audit trail written by trgfn_audit (Admin)
import { ok, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";

const TABLES = ["users", "assets", "spare_parts", "work_orders", "sla_policies", "technicians"];

export const GET = route(async (req) => {
  await requireRole("ADMIN");
  const table = req.nextUrl.searchParams.get("table");
  const params = TABLES.includes(table) ? [table] : [];
  const rows = await query(
    `SELECT a.audit_id, a.table_name, a.operation, a.row_pk, a.old_data, a.new_data, a.changed_at,
            COALESCE(u.full_name, 'system / setup') AS changed_by
       FROM audit_log a LEFT JOIN users u ON u.user_id = a.changed_by
      ${params.length ? "WHERE a.table_name = $1" : ""}
      ORDER BY a.audit_id DESC LIMIT 100`,
    params
  );
  return ok({ audit: rows, tables: TABLES });
});
