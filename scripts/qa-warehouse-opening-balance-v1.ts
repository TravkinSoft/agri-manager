import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260902111409_warehouse_opening_balance_v1.sql"), "utf8");
const corrective = fs.readFileSync(path.join(root, "supabase/migrations/20260902112110_warehouse_opening_balance_unknown_origin_corrective_v1.sql"), "utf8");
const indexes = fs.readFileSync(path.join(root, "supabase/migrations/20260902113857_warehouse_opening_balance_fk_indexes_v1.sql"), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/warehouses/opening-balances/route.ts"), "utf8");
const dialog = fs.readFileSync(path.join(root, "components/warehouses/warehouse-opening-balance-dialog.tsx"), "utf8");
const service = fs.readFileSync(path.join(root, "lib/services/warehouses.ts"), "utf8");
const warehousePage = fs.readFileSync(path.join(root, "app/(dashboard)/warehouses/page.tsx"), "utf8");

const checks: Array<[string, () => void]> = [
  ["01 immutable document, line and source tables exist", () => {
    assert.match(migration, /create table if not exists public\.warehouse_opening_balance_documents/i);
    assert.match(migration, /create table if not exists public\.warehouse_opening_balance_lines/i);
    assert.match(migration, /create table if not exists public\.warehouse_opening_balance_line_sources/i);
  }],
  ["02 one document per company and season", () => assert.match(migration, /unique \(company_id, season_id\)/i)],
  ["03 direct DML is revoked", () => {
    assert.match(migration, /revoke all privileges on table public\.warehouse_opening_balance_documents from public, anon, authenticated, service_role/i);
    assert.match(migration, /grant select on table public\.warehouse_opening_balance_documents to authenticated, service_role/i);
  }],
  ["04 posted rows reject update delete and truncate", () => {
    assert.match(migration, /before update or delete or truncate on public\.warehouse_opening_balance_documents/i);
    assert.match(migration, /Posted warehouse opening balance is immutable/i);
  }],
  ["05 canonical RPC is security definer", () => {
    assert.match(migration, /create or replace function public\.create_warehouse_opening_balance_atomic_v1[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
  }],
  ["06 RPC is limited to company and global admins", () => assert.match(migration, /array\['global_admin', 'company_admin'\]::text\[\]/i)],
  ["07 authenticated-only RPC execution", () => {
    assert.match(migration, /revoke all on function public\.create_warehouse_opening_balance_atomic_v1[\s\S]*?from public, anon, service_role/i);
    assert.match(migration, /grant execute on function public\.create_warehouse_opening_balance_atomic_v1[\s\S]*?to authenticated/i);
  }],
  ["08 idempotent replay checks fingerprint", () => {
    assert.match(migration, /idempotency_key = btrim\(p_idempotency_key\)/i);
    assert.match(migration, /request_fingerprint <> btrim\(p_request_fingerprint\)/i);
    assert.match(migration, /'idempotent_replay', true/i);
  }],
  ["09 duplicate season and batch codes are blocked", () => {
    assert.match(migration, /Opening balance is already posted for this company and season/i);
    assert.match(migration, /batch_code text not null/i);
  }],
  ["10 exact source FK lineage is persisted", () => {
    assert.match(migration, /crop_structure_id uuid not null references public\.crop_structure/i);
    assert.match(migration, /field_id uuid not null references public\.fields/i);
  }],
  ["11 auto source requires exactly one match", () => assert.match(migration, /v_source_count <> 1[\s\S]*?source is ambiguous or absent/i)],
  ["12 crop identity mismatch is rejected", () => {
    assert.match(migration, /cs\.crop_id is not distinct from v_crop_id/i);
    assert.match(migration, /cs\.variety_id is not distinct from v_variety_id/i);
    assert.match(migration, /cs\.reproduction_id is not distinct from v_reproduction_id/i);
  }],
  ["13 crop-structure review conflicts are rejected", () => assert.match(migration, /not coalesce\(cs\.identity_review_required, false\)/i)],
  ["14 multi-source quantities are either complete or unknown", () => {
    assert.match(migration, /source quantities must be all known or all unknown/i);
    assert.match(migration, /source quantities must equal line quantity/i);
  }],
  ["15 unknown origin is explicit and has no invented source", () => {
    assert.match(migration, /origin_mode in \('explicit', 'auto', 'unknown'\)/i);
    assert.match(migration, /opening_balance_origin_unknown/i);
    assert.match(corrective, /v_source_count > 0 and v_source_with_quantity_count = v_source_count/i);
  }],
  ["16 physical batch and ledger entry are created", () => {
    assert.match(migration, /insert into public\.inventory_batches/i);
    assert.match(migration, /insert into public\.stock_ledger_entries/i);
    assert.match(migration, /'warehouse_opening_balance'/i);
  }],
  ["17 opening balance is a harvest lot without fake ticket", () => {
    assert.match(migration, /insert into public\.harvest_lots/i);
    assert.match(migration, /insert into public\.harvest_lot_batches/i);
    assert.doesNotMatch(migration, /insert into public\.tickets/i);
    assert.doesNotMatch(migration, /insert into public\.ticket_weighings/i);
  }],
  ["18 crop structure is never mutated", () => {
    assert.doesNotMatch(migration, /(insert into|update|delete from) public\.crop_structure\b/i);
    assert.doesNotMatch(route, /\.from\(["']crop_structure["']\)\.(insert|update|delete)/i);
  }],
  ["19 API does not trust payload company without session resolution", () => {
    assert.match(route, /resolveCompanyForActor\(actor, requestedCompanyId\)/i);
    assert.match(route, /allowedRoles: \[\.\.\.ADMIN_ROLES\]/i);
  }],
  ["20 API requires idempotency", () => assert.match(route, /requireOperationIdempotency\(request, body\)/i)],
  ["21 UI is visible through the admin-only warehouse branch", () => {
    assert.match(warehousePage, /canManageWarehouses[\s\S]*?setOpeningBalanceOpen\(true\)/i);
    assert.match(warehousePage, /WarehouseOpeningBalanceDialog/i);
  }],
  ["22 UI makes unknown and multi-source choices explicit", () => {
    assert.match(dialog, /Точные участки/i);
    assert.match(dialog, /Авто — только одно совпадение/i);
    assert.match(dialog, /Неизвестно/i);
    assert.match(dialog, /Смешанная партия/i);
    assert.match(dialog, /Массы заполните для всех источников либо оставьте все неизвестными/i);
    assert.match(dialog, /quantity_kg: providedSourceQuantityCount > 0/i);
    assert.match(dialog, /UUID родительской партии/i);
  }],
  ["23 UI requires one-time confirmation", () => assert.match(dialog, /полный однократный начальный срез сезона/i)],
  ["24 every opening-balance foreign key has an additive covering index", () => {
    assert.equal((indexes.match(/create index if not exists/gi) || []).length, 15);
    assert.doesNotMatch(indexes, /\b(insert|update|delete|truncate|drop|alter table)\b/i);
  }],
  ["25 closing the dialog cancels its reference request", () => {
    assert.match(dialog, /const controller = new AbortController\(\)/i);
    assert.match(dialog, /return \(\) => controller\.abort\(\)/i);
    assert.match(service, /signal: options\?\.signal/i);
  }],
];

for (const [name, run] of checks) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`PASS ${checks.length}/${checks.length} warehouse opening balance contract checks`);
