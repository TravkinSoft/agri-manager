import type { TruthEnvironment, TruthSnapshot } from "./types";
import { normalizeTruthSnapshot } from "./normalize";

const PROJECTS: Record<Exclude<TruthEnvironment, "fixture">, { projectId: string; defaultCompanyId: string; defaultCompanyName: string }> = {
  qa: {
    projectId: "gsglkmudcwkdetqtocae",
    defaultCompanyId: "8a0f2c0e-6638-4a31-99a8-cab4237d287d",
    defaultCompanyName: "Астык-STEM QA",
  },
  production: {
    projectId: "bhsemlvmkikpntabctml",
    defaultCompanyId: "10000000-0000-0000-0000-000000000001",
    defaultCompanyName: "ТОО \"Астык-STEM\"",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_NO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;

export interface TruthSelection {
  environment: "qa" | "production";
  company?: string;
  ticket?: string;
  lot?: string;
  batch?: string;
  all?: boolean;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function resolveCompany(selection: TruthSelection): { id: string; name: string } {
  const defaults = PROJECTS[selection.environment];
  const input = selection.company?.trim();
  if (!input || ["astyk-stem", "астык-stem", "астык-stem qa", "astyk-stem-qa"].includes(input.toLowerCase())) {
    return { id: defaults.defaultCompanyId, name: defaults.defaultCompanyName };
  }
  if (!UUID.test(input)) throw new Error("--company must be a UUID or the canonical astyk-stem alias");
  return { id: input, name: input };
}

function validateTarget(name: string, value: string | undefined, allowTicketNo = false): void {
  if (!value) return;
  if (UUID.test(value)) return;
  if (allowTicketNo && TICKET_NO.test(value)) return;
  throw new Error(`${name} must be a UUID${allowTicketNo ? " or a safe ticket number" : ""}`);
}

export function assertReadOnlySql(sql: string): void {
  const normalized = sql.replace(/--.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim().toLowerCase();
  if (!normalized.startsWith("with") && !normalized.startsWith("select")) throw new Error("Truth Engine source accepts SELECT/CTE only");
  if (/\b(insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|call|do|copy)\b/.test(normalized)) {
    throw new Error("Truth Engine refused a non-read-only SQL token");
  }
}

export function buildTruthSnapshotSql(selection: TruthSelection): string {
  validateTarget("--ticket", selection.ticket, true);
  validateTarget("--lot", selection.lot);
  validateTarget("--batch", selection.batch);
  const company = resolveCompany(selection);
  const ticketPredicate = selection.ticket
    ? UUID.test(selection.ticket)
      ? `t.id = ${sqlLiteral(selection.ticket)}::uuid`
      : `t.ticket_no = ${sqlLiteral(selection.ticket)}`
    : "false";
  const lotPredicate = selection.lot ? `hl.id = ${sqlLiteral(selection.lot)}::uuid` : "false";
  const batchPredicate = selection.batch ? `ib.id = ${sqlLiteral(selection.batch)}::uuid` : "false";
  const defaultSweep = selection.all || (!selection.ticket && !selection.lot && !selection.batch);
  const companyId = sqlLiteral(company.id);
  const environment = sqlLiteral(selection.environment);
  const selectionJson = sqlLiteral(JSON.stringify({
    ...(selection.ticket ? { ticketId: selection.ticket } : {}),
    ...(selection.lot ? { lotId: selection.lot } : {}),
    ...(selection.batch ? { batchId: selection.batch } : {}),
    ...(defaultSweep ? { all: true } : {}),
  }));

  const sql = `
with
latest_finalized as (
  select t.id
  from public.tickets t
  where t.company_id = ${companyId}::uuid
    and coalesce(t.is_finalized, false) = true
  order by coalesce(t.finalized_at, t.updated_at, t.created_at) desc
  limit 100
),
target_lot_tickets as (
  select distinct hlb.source_ticket_id as id
  from public.harvest_lot_batches hlb
  where hlb.company_id = ${companyId}::uuid
    and ${selection.lot ? `hlb.harvest_lot_id = ${sqlLiteral(selection.lot)}::uuid` : "false"}
    and hlb.source_ticket_id is not null
),
target_batch_tickets as (
  select distinct ib.source_ticket_id as id
  from public.inventory_batches ib
  where ib.company_id = ${companyId}::uuid
    and ${selection.batch ? `ib.id = ${sqlLiteral(selection.batch)}::uuid` : "false"}
    and ib.source_ticket_id is not null
),
base_tickets as (
  select t.*
  from public.tickets t
  where t.company_id = ${companyId}::uuid
    and (
      ${ticketPredicate}
      or t.id in (select id from target_lot_tickets)
      or t.id in (select id from target_batch_tickets)
      or (${defaultSweep ? "true" : "false"} and (
        (coalesce(t.is_finalized, false) = false and coalesce(t.is_voided, false) = false)
        or t.id in (select id from latest_finalized)
        or t.correction_of_ticket_id is not null
        or t.replacement_ticket_id is not null
        or coalesce(t.is_voided, false) = true
      ))
    )
),
selected_tickets as (
  select distinct t.*
  from public.tickets t
  where t.company_id = ${companyId}::uuid
    and (
      t.id in (select id from base_tickets)
      or t.id in (select correction_of_ticket_id from base_tickets where correction_of_ticket_id is not null)
      or t.id in (select replacement_ticket_id from base_tickets where replacement_ticket_id is not null)
      or t.correction_of_ticket_id in (select id from base_tickets)
    )
),
selected_batches as (
  select distinct ib.*
  from public.inventory_batches ib
  where ib.company_id = ${companyId}::uuid
    and (
      ${batchPredicate}
      or ib.source_ticket_id in (select id from selected_tickets)
      or ib.id in (
        select hlb.inventory_batch_id from public.harvest_lot_batches hlb
        where hlb.company_id = ${companyId}::uuid
          and hlb.source_ticket_id in (select id from selected_tickets)
      )
    )
),
selected_lots as (
  select distinct hl.*
  from public.harvest_lots hl
  where hl.company_id = ${companyId}::uuid
    and (
      ${lotPredicate}
      or hl.id in (
        select hlb.harvest_lot_id from public.harvest_lot_batches hlb
        where hlb.company_id = ${companyId}::uuid
          and (hlb.inventory_batch_id in (select id from selected_batches) or hlb.source_ticket_id in (select id from selected_tickets))
      )
    )
),
selected_transformations as (
  select distinct bt.*
  from public.batch_transformations bt
  where bt.company_id = ${companyId}::uuid
    and (
      bt.source_ticket_id in (select id from selected_tickets)
      or bt.id in (
        select bti.transformation_id from public.batch_transformation_inputs bti
        where bti.company_id = ${companyId}::uuid and bti.batch_id in (select id from selected_batches)
      )
      or bt.id in (
        select bto.transformation_id from public.batch_transformation_outputs bto
        where bto.company_id = ${companyId}::uuid and bto.output_batch_id in (select id from selected_batches)
      )
    )
),
selected_ledger_base as (
  select row.*
  from public.stock_ledger_entries row
  where row.company_id = ${companyId}::uuid
    and (
      row.ticket_id in (select id from selected_tickets)
      or row.inventory_batch_id in (select id from selected_batches)
      or row.batch_id in (select id::text from selected_batches)
    )
),
selected_ledger as (
  select distinct row.*
  from public.stock_ledger_entries row
  where row.company_id = ${companyId}::uuid
    and (
      row.id in (select id from selected_ledger_base)
      or row.storno_of_entry_id in (select id from selected_ledger_base)
      or row.id in (select storno_of_entry_id from selected_ledger_base where storno_of_entry_id is not null)
    )
)
select jsonb_build_object(
  'metadata', jsonb_build_object(
    'environment', ${environment},
    'project_id', ${sqlLiteral(PROJECTS[selection.environment].projectId)},
    'company_id', ${companyId},
    'company_name', coalesce((select c.name from public.companies c where c.id = ${companyId}::uuid), ${sqlLiteral(company.name)}),
    'generated_at', now(),
    'selection', ${selectionJson}::jsonb
  ),
  'tickets', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from selected_tickets row), '[]'::jsonb),
  'ticket_lines', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from public.ticket_lines row where row.company_id = ${companyId}::uuid and row.ticket_id in (select id from selected_tickets)), '[]'::jsonb),
  'ticket_weighings', coalesce((select jsonb_agg(to_jsonb(row) order by row.measured_at) from public.ticket_weighings row where row.company_id = ${companyId}::uuid and row.ticket_id in (select id from selected_tickets)), '[]'::jsonb),
  'stock_ledger_entries', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from selected_ledger row), '[]'::jsonb),
  'inventory_batches', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from selected_batches row), '[]'::jsonb),
  'harvest_lots', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from selected_lots row), '[]'::jsonb),
  'harvest_lot_batches', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from public.harvest_lot_batches row where row.company_id = ${companyId}::uuid and (row.inventory_batch_id in (select id from selected_batches) or row.source_ticket_id in (select id from selected_tickets))), '[]'::jsonb),
  'batch_transformations', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from selected_transformations row), '[]'::jsonb),
  'batch_transformation_inputs', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from public.batch_transformation_inputs row where row.company_id = ${companyId}::uuid and row.transformation_id in (select id from selected_transformations)), '[]'::jsonb),
  'batch_transformation_outputs', coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at) from public.batch_transformation_outputs row where row.company_id = ${companyId}::uuid and row.transformation_id in (select id from selected_transformations)), '[]'::jsonb),
  'weighbridge_shifts', coalesce((select jsonb_agg(to_jsonb(row) order by row.opened_at) from public.weighbridge_shifts row where row.company_id = ${companyId}::uuid and row.id in (select shift_id from selected_tickets where shift_id is not null)), '[]'::jsonb),
  'company_people', coalesce((select jsonb_agg(to_jsonb(row) order by row.full_name) from public.company_people row where row.company_id = ${companyId}::uuid), '[]'::jsonb),
  'seasons', coalesce((select jsonb_agg(to_jsonb(row) order by row.year) from public.seasons row where row.company_id = ${companyId}::uuid), '[]'::jsonb)
) as snapshot;
`;
  assertReadOnlySql(sql);
  return sql;
}

function unwrapManagementResult(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload) && payload.length > 0 && payload[0] && typeof payload[0] === "object") {
    const row = payload[0] as Record<string, unknown>;
    const snapshot = row.snapshot ?? row.jsonb_build_object;
    if (snapshot && typeof snapshot === "object") return snapshot as Record<string, unknown>;
  }
  throw new Error("Supabase Management API returned an unexpected read-only query shape");
}

export async function fetchTruthSnapshot(selection: TruthSelection, token = process.env.SUPABASE_ACCESS_TOKEN): Promise<TruthSnapshot> {
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required for a live read-only audit; it is never printed or persisted");
  const projectId = PROJECTS[selection.environment].projectId;
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildTruthSnapshotSql(selection) }),
  });
  if (!response.ok) throw new Error(`Supabase read-only query failed with HTTP ${response.status}`);
  return normalizeTruthSnapshot(unwrapManagementResult(await response.json()));
}

export const TRUTH_PROJECTS = PROJECTS;
