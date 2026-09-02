import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901123759_tz315_supplier_batch_warehouse_trace_v1.sql",
  import.meta.url,
);
const constraintMigrationUrl = new URL(
  "../supabase/migrations/20260901125144_tz315_material_ledger_batch_class_corrective_v1.sql",
  import.meta.url,
);
const directTraceCorrectiveMigrationUrl = new URL(
  "../supabase/migrations/20260902193824_tz315_supplier_direct_batch_warehouse_trace_corrective_v1.sql",
  import.meta.url,
);

const COMPANY = "31500000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31500000-0000-4000-8000-000000000002";
const WAREHOUSE = "31500000-0000-4000-8000-000000000011";
const OTHER_WAREHOUSE = "31500000-0000-4000-8000-000000000012";
const SUPPLIER_TICKET = "31500000-0000-4000-8000-000000000021";
const HARVEST_TICKET = "31500000-0000-4000-8000-000000000022";
const DIRECT_TICKET = "31500000-0000-4000-8000-000000000023";
const DIRECT_LINE = "31500000-0000-4000-8000-000000000031";
const DIRECT_PRODUCT = "31500000-0000-4000-8000-000000000041";
const DIRECT_PRODUCT_2 = "31500000-0000-4000-8000-000000000042";
const DIRECT_PRODUCT_3 = "31500000-0000-4000-8000-000000000043";

async function main() {
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create table public.tickets (
    id uuid primary key,
    company_id uuid not null,
    op_type text not null,
    warehouse_to_id uuid,
    receipt_mode text,
    finalized_at timestamptz
  );
  create table public.ticket_lines (
    id uuid primary key,
    ticket_id uuid not null,
    company_id uuid not null,
    product_id uuid not null,
    warehouse_to_id uuid,
    lot_id text,
    created_at timestamptz not null default now()
  );
  create table public.inventory_batches (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null,
    product_id uuid,
    origin_type text,
    source_ticket_id uuid,
    batch_code text,
    warehouse_id uuid,
    received_at timestamptz,
    source_type text
  );
  create table public.stock_ledger_entries (
    id uuid primary key default gen_random_uuid(),
    batch_class text,
    constraint stock_ledger_entries_batch_class_check
      check (batch_class in ('commodity','seed','feed','waste','processing','rejected'))
  );
`);

const migration = await readFile(migrationUrl, "utf8");
await db.exec(migration);
const constraintMigration = await readFile(constraintMigrationUrl, "utf8");
await db.exec(constraintMigration);
const directTraceCorrectiveMigration = await readFile(directTraceCorrectiveMigrationUrl, "utf8");
await db.exec(directTraceCorrectiveMigration);

await db.exec(`insert into public.stock_ledger_entries(batch_class) values ('material')`);
const materialConstraint = await db.query<{ definition: string }>(`
  select pg_get_constraintdef(oid) definition
  from pg_constraint
  where conrelid='public.stock_ledger_entries'::regclass
    and conname='stock_ledger_entries_batch_class_check'
`);
assert.match(String(materialConstraint.rows[0]?.definition), /material/i);
assert.match(String(materialConstraint.rows[0]?.definition), /batch_class IS NULL/i);

await db.exec(`
  insert into public.tickets(id, company_id, op_type, warehouse_to_id, finalized_at)
  values
    ('${SUPPLIER_TICKET}', '${COMPANY}', 'supplier_receipt', '${WAREHOUSE}', '2026-09-01T00:00:00Z'),
    ('${HARVEST_TICKET}', '${COMPANY}', 'harvest_incoming', '${WAREHOUSE}', '2026-09-01T00:00:00Z');
`);

await db.exec(`
  insert into public.tickets(id, company_id, op_type, warehouse_to_id, receipt_mode, finalized_at)
  values ('${DIRECT_TICKET}', '${COMPANY}', 'supplier_receipt', null, 'direct', '2026-09-03T00:00:00Z');
  insert into public.ticket_lines(id, ticket_id, company_id, product_id, warehouse_to_id, lot_id)
  values
    ('${DIRECT_LINE}', '${DIRECT_TICKET}', '${COMPANY}', '${DIRECT_PRODUCT}', '${WAREHOUSE}', null),
    ('31500000-0000-4000-8000-000000000032', '${DIRECT_TICKET}', '${COMPANY}', '${DIRECT_PRODUCT_2}', '${OTHER_WAREHOUSE}', 'DIRECT-LOT-2');
`);

const inserted = await db.query<Record<string, unknown>>(`
  insert into public.inventory_batches(company_id, origin_type, source_ticket_id)
  values ('${COMPANY}', 'supplier', '${SUPPLIER_TICKET}')
  returning warehouse_id::text, source_type, received_at::text
`);
assert.equal(inserted.rows[0]?.warehouse_id, WAREHOUSE);
assert.equal(inserted.rows[0]?.source_type, "weighbridge_ticket");
assert.match(String(inserted.rows[0]?.received_at), /^2026-09-01/);

const directGeneratedLot = await db.query<Record<string, unknown>>(`
  insert into public.inventory_batches(company_id, product_id, origin_type, source_ticket_id, batch_code)
  values ('${COMPANY}', '${DIRECT_PRODUCT}', 'supplier', '${DIRECT_TICKET}', 'SUP-20260903000000-${DIRECT_LINE.slice(0, 8)}')
  returning warehouse_id::text, source_type, received_at::text
`);
assert.equal(directGeneratedLot.rows[0]?.warehouse_id, WAREHOUSE);
assert.equal(directGeneratedLot.rows[0]?.source_type, "weighbridge_ticket");

const directExplicitLot = await db.query<Record<string, unknown>>(`
  insert into public.inventory_batches(company_id, product_id, origin_type, source_ticket_id, batch_code)
  values ('${COMPANY}', '${DIRECT_PRODUCT_2}', 'supplier', '${DIRECT_TICKET}', 'DIRECT-LOT-2')
  returning warehouse_id::text
`);
assert.equal(directExplicitLot.rows[0]?.warehouse_id, OTHER_WAREHOUSE);

await assert.rejects(
  () => db.exec(`
    insert into public.inventory_batches(company_id, product_id, origin_type, source_ticket_id, batch_code, warehouse_id)
    values ('${COMPANY}', '${DIRECT_PRODUCT}', 'supplier', '${DIRECT_TICKET}', 'SUP-20260903000001-${DIRECT_LINE.slice(0, 8)}', '${OTHER_WAREHOUSE}')
  `),
  /warehouse does not match/i,
);

await db.exec(`
  insert into public.ticket_lines(id, ticket_id, company_id, product_id, warehouse_to_id, lot_id)
  values
    ('31500000-0000-4000-8000-000000000033', '${DIRECT_TICKET}', '${COMPANY}', '${DIRECT_PRODUCT_3}', '${WAREHOUSE}', 'AMBIGUOUS-LOT'),
    ('31500000-0000-4000-8000-000000000034', '${DIRECT_TICKET}', '${COMPANY}', '${DIRECT_PRODUCT_3}', '${OTHER_WAREHOUSE}', 'AMBIGUOUS-LOT');
`);
await assert.rejects(
  () => db.exec(`
    insert into public.inventory_batches(company_id, product_id, origin_type, source_ticket_id, batch_code)
    values ('${COMPANY}', '${DIRECT_PRODUCT_3}', 'supplier', '${DIRECT_TICKET}', 'AMBIGUOUS-LOT')
  `),
  /cannot be resolved unambiguously/i,
);

const nonSupplier = await db.query<Record<string, unknown>>(`
  insert into public.inventory_batches(company_id, origin_type, source_ticket_id)
  values ('${COMPANY}', 'harvest', '${HARVEST_TICKET}')
  returning warehouse_id::text
`);
assert.equal(nonSupplier.rows[0]?.warehouse_id, null);

await assert.rejects(
  () => db.exec(`
    insert into public.inventory_batches(company_id, origin_type, source_ticket_id, warehouse_id)
    values ('${COMPANY}', 'supplier', '${SUPPLIER_TICKET}', '${OTHER_WAREHOUSE}')
  `),
  /warehouse does not match/i,
);

await assert.rejects(
  () => db.exec(`
    insert into public.inventory_batches(company_id, origin_type, source_ticket_id)
    values ('${OTHER_COMPANY}', 'supplier', '${SUPPLIER_TICKET}')
  `),
  /missing or belongs to another company/i,
);

const privileges = await db.query<{ role_name: string; allowed: boolean }>(`
  select role_name,
         has_function_privilege(role_name, 'public.populate_supplier_batch_warehouse_trace_v1()', 'EXECUTE') allowed
  from unnest(array['anon','authenticated','service_role']) role_name
  order by role_name
`);
assert.deepEqual(privileges.rows, [
  { role_name: "anon", allowed: false },
  { role_name: "authenticated", allowed: false },
  { role_name: "service_role", allowed: false },
]);

console.log("TZ315 supplier batch warehouse trace: PASS");
await db.close();
}

main().catch((error) => {
  console.error("TZ315 supplier batch warehouse trace: FAIL");
  console.error(error);
  process.exitCode = 1;
});
