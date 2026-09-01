import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901123759_tz315_supplier_batch_warehouse_trace_v1.sql",
  import.meta.url,
);

const COMPANY = "31500000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31500000-0000-4000-8000-000000000002";
const WAREHOUSE = "31500000-0000-4000-8000-000000000011";
const OTHER_WAREHOUSE = "31500000-0000-4000-8000-000000000012";
const SUPPLIER_TICKET = "31500000-0000-4000-8000-000000000021";
const HARVEST_TICKET = "31500000-0000-4000-8000-000000000022";

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
    finalized_at timestamptz
  );
  create table public.inventory_batches (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null,
    origin_type text,
    source_ticket_id uuid,
    warehouse_id uuid,
    received_at timestamptz,
    source_type text
  );
`);

const migration = await readFile(migrationUrl, "utf8");
await db.exec(migration);

await db.exec(`
  insert into public.tickets(id, company_id, op_type, warehouse_to_id, finalized_at)
  values
    ('${SUPPLIER_TICKET}', '${COMPANY}', 'supplier_receipt', '${WAREHOUSE}', '2026-09-01T00:00:00Z'),
    ('${HARVEST_TICKET}', '${COMPANY}', 'harvest_incoming', '${WAREHOUSE}', '2026-09-01T00:00:00Z');
`);

const inserted = await db.query<Record<string, unknown>>(`
  insert into public.inventory_batches(company_id, origin_type, source_ticket_id)
  values ('${COMPANY}', 'supplier', '${SUPPLIER_TICKET}')
  returning warehouse_id::text, source_type, received_at::text
`);
assert.equal(inserted.rows[0]?.warehouse_id, WAREHOUSE);
assert.equal(inserted.rows[0]?.source_type, "weighbridge_ticket");
assert.match(String(inserted.rows[0]?.received_at), /^2026-09-01/);

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
