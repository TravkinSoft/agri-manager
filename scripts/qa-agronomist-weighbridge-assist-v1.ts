import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let checks = 0;

function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
}

const migration = read("supabase/migrations/20260826140927_agronomist_weighbridge_assist_v1.sql");
const shell = read("lib/assistant/shell.ts");
const serverSession = read("lib/auth/server-session.ts");
const roleAccess = read("lib/auth/role-access.ts");
const notificationCenter = read("components/notifications/notification-center.tsx");
const notificationSettings = read("app/api/settings/notifications/route.ts");
const proactiveRoute = read("app/api/assistant/proactive/route.ts");
const assistantTools = read("lib/assistant/engine/tools.ts");
const assistantQuery = read("lib/assistant/engine/query.ts");
const assistantContext = read("lib/assistant/context-engine.ts");
const prompt = read("lib/assistant/prompts/travkin-core-prompt.ts");
const bootstrap = read("app/api/weighbridge/bootstrap/route.ts");
const weighbridge = read("app/(dashboard)/weighbridge/page.tsx");

check("migration is additive and preserves operational truth", () => {
  assert.match(migration, /add column if not exists weighbridge_updates_enabled/i);
  assert.match(migration, /add column if not exists proactive_assist_enabled/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.(tickets|ticket_lines|ticket_weighings|stock_ledger_entries|inventory_batches)/i);
  assert.doesNotMatch(migration, /update public\.(tickets|ticket_lines|ticket_weighings|stock_ledger_entries|inventory_batches)/i);
});

check("notification category and preferences cover Weighbridge and Assist", () => {
  assert.match(migration, /category in \('operation', 'warehouse', 'weighbridge', 'assistant', 'system'\)/);
  assert.match(notificationSettings, /weighbridge_updates_enabled/);
  assert.match(notificationSettings, /proactive_assist_enabled/);
  assert.match(notificationSettings, /proactive_assist_cadence/);
});

check("ticket events are company scoped, recipient scoped and idempotent", () => {
  assert.match(migration, /lower\(profile\.role\) in \('agronomist', 'company_admin'\)/);
  assert.match(migration, /profile\.company_id = new\.company_id/);
  assert.match(migration, /concat\('ticket:', new\.id, ':', v_event_type, ':', v_recipient\)/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/i);
});

check("new, finalized, corrected, voided and field-complete events exist", () => {
  for (const event of [
    "ticket_created",
    "ticket_finalized",
    "ticket_correction_started",
    "ticket_correction_finalized",
    "ticket_voided",
    "harvest_field_completed",
  ]) assert.match(migration, new RegExp(event));
  assert.match(migration, /after insert on public\.ticket_lines/i);
  assert.match(migration, /after update of status on public\.weighbridge_active_harvests/i);
});

check("notification payload carries agronomic and physical context", () => {
  for (const field of [
    "field_name",
    "crop_name",
    "variety_name",
    "reproduction_name",
    "vehicle_name",
    "operator_name",
    "physical_net_kg",
    "accepted_weight_kg",
    "moisture_percent",
    "requires_review",
  ]) assert.match(migration, new RegExp(`'${field}'`));
  assert.match(migration, /'\/weighbridge\?ticket=' \|\| new\.id::text/);
});

check("proactive Assist is silent and idempotent when no new signal exists", () => {
  assert.match(migration, /if not exists \([\s\S]*?idempotency_key = concat\('assist:stale-ticket:/);
  assert.match(migration, /v_created := v_created \+ 1/);
  assert.match(migration, /return v_created/);
  assert.match(notificationCenter, /Number\(payload\?\.signals \|\| 0\) > 0/);
});

check("proactive RPC is authenticated, role and company scoped", () => {
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /v_profile\.role not in \('agronomist', 'global_admin'\)/);
  assert.match(migration, /v_profile\.company_id is distinct from p_company_id/);
  assert.match(migration, /grant execute on function public\.run_my_proactive_assist_audit_v1\(uuid\)\s+to authenticated/i);
  assert.match(proactiveRoute, /ensureAssistantRole\(actor\)/);
  assert.match(proactiveRoute, /resolveCompanyForActor/);
  assert.match(proactiveRoute, /getUserScopedClientFromRequest/);
});

check("agronomist receives Assist without Company Admin access", () => {
  assert.match(shell, /"global_admin" \| "agronomist"/);
  assert.match(serverSession, /ASSISTANT_ALLOWED_ROLES[\s\S]*?"global_admin",[\s\S]*?"agronomist"/);
  assert.match(roleAccess, /AGRONOMIST_ALLOWED_EXACT = \["\/warehouses", "\/settings"\]/);
  assert.doesNotMatch(roleAccess.match(/const AGRONOMIST_ALLOWED_PREFIXES[\s\S]*?\];/)?.[0] || "", /\/platform|\/users/);
});

check("Assist uses one rich canonical ticket DTO", () => {
  assert.match(assistantTools, /ASSISTANT_WEIGHBRIDGE_TICKET_SELECT/);
  assert.match(assistantTools, /mapAssistantWeighbridgeTicket/);
  assert.match(assistantTools, /physical_net_kg/);
  assert.match(assistantTools, /accepted_weight_kg/);
  assert.match(assistantTools, /correction_of_ticket_id/);
  assert.match(assistantTools, /processing_output_role/);
});

check("Assist resolves current people, vehicles and machines", () => {
  assert.match(assistantTools, /from\("company_people"\)/);
  assert.match(assistantTools, /from\("reference_vehicles"\)/);
  assert.match(assistantTools, /from\("reference_machines"\)/);
  assert.match(assistantTools, /resolveTransportIdentity\(row\)/);
  assert.doesNotMatch(assistantTools.match(/const getTicketDetailsToolAlias[\s\S]*?\n};/)?.[0] || "", /eq\("is_voided", false\)/);
});

check("Assist answers agronomists with weights, moisture and review state", () => {
  assert.match(assistantQuery, /физическое нетто/);
  assert.match(assistantQuery, /принято/);
  assert.match(assistantQuery, /влажность/);
  assert.match(assistantContext, /today_harvest_accepted_kg/);
  assert.match(assistantContext, /today_average_moisture_percent/);
  assert.match(assistantContext, /stale_over_6h/);
});

check("core prompt contains the complete Weighbridge contract", () => {
  for (const contract of [
    "Weighbridge operating model",
    "Weighbridge weights",
    "Processing model",
    "Lot and batch model",
    "Correction model",
    "Agronomist weighbridge answer",
  ]) assert.match(prompt, new RegExp(contract));
});

check("lightweight bootstrap removes duplicate startup reads", () => {
  assert.doesNotMatch(bootstrap, /from\("processing_nodes"\)/);
  assert.match(bootstrap, /includeSummary[\s\S]*?Promise\.resolve\(\{ data: \[\], error: null \} as any\)/);
  assert.match(weighbridge, /setShiftCounters\(\(current\) => includeSummary/);
  assert.match(weighbridge, /activeTickets: activeRows\.length/);
  assert.match(weighbridge, /stuckTickets: stuckRows\.length/);
});

console.log(`AGRONOMIST WEIGHBRIDGE ASSIST QA PASS: ${checks}/${checks}`);
