import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

type Row = Record<string, unknown>;

const ID = {
  companyA: "51000000-0000-4000-8000-000000000001",
  companyB: "51000000-0000-4000-8000-000000000002",
  warehouseA: "51000000-0000-4000-8000-000000000003",
  warehouseB: "51000000-0000-4000-8000-000000000004",
  batchA: "51000000-0000-4000-8000-000000000005",
  batchB: "51000000-0000-4000-8000-000000000006",
  otherWarehouseBatch: "51000000-0000-4000-8000-000000000007",
} as const;

const rows = async (db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as Row[];

async function expectDatabaseError(run: () => Promise<unknown>, pattern: RegExp) {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, `expected database error matching ${pattern}`);
  assert.match(thrown.message, pattern);
}

async function main() {
  const migrationPath = join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260914151525_p0_weighbridge_batch_ledger_summary_v1.sql",
  );
  const migration = await readFile(migrationPath, "utf8");
  const route = await readFile(
    join(process.cwd(), "app", "api", "weighbridge", "harvest-batches", "route.ts"),
    "utf8",
  );

  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(
    migration,
    /revoke all on function public\.weighbridge_batch_ledger_summary_v1\(uuid, uuid, uuid\[\]\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.weighbridge_batch_ledger_summary_v1\(uuid, uuid, uuid\[\]\)[\s\S]*to service_role/i,
  );
  assert.match(route, /HARVEST_BATCH_LEDGER_SUMMARY_RPC = "weighbridge_batch_ledger_summary_v1"/);
  assert.match(route, /p_company_id: companyId[\s\S]*p_warehouse_id: warehouseId[\s\S]*p_inventory_batch_ids: chunk/);
  assert.match(
    route,
    /loadInChunks<HarvestBatchLedgerSummaryRow>[\s\S]*p_inventory_batch_ids: chunk[\s\S]*retryTransientStockRead: true/,
  );
  assert.match(route, /code === "PGRST202"[\s\S]*code === "42883"/);
  assert.match(route, /if \(isMissingHarvestBatchLedgerSummaryRpc\(error\)\) return null;[\s\S]*throw error;/);
  assert.match(route, /if \(ledgerSummaryRows !== null\)[\s\S]*else \{[\s\S]*await loadLedgerFallback\(\)/);

  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create table public.inventory_batches (
      id uuid primary key,
      company_id uuid not null,
      warehouse_id uuid
    );

    create table public.stock_ledger_entries (
      id uuid primary key,
      company_id uuid not null,
      warehouse_id uuid not null,
      inventory_batch_id uuid,
      batch_id_text text,
      batch_id text,
      delta_qty_signed numeric(14,3) not null,
      uom text
    );

    grant select on public.inventory_batches, public.stock_ledger_entries
      to authenticated, service_role;
  `);
  await db.exec(migration);

  await db.query(
    `insert into public.inventory_batches(id, company_id, warehouse_id)
     values
       ($1::uuid, $2::uuid, $3::uuid),
       ($4::uuid, $2::uuid, $3::uuid),
       ($5::uuid, $2::uuid, $6::uuid)`,
    [ID.batchA, ID.companyA, ID.warehouseA, ID.batchB, ID.otherWarehouseBatch, ID.warehouseB],
  );

  const ledgerValues: Array<[string, string, string, string | null, string | null, string | null, number, string]> = [
    ["51000000-0000-4000-8000-000000000101", ID.companyA, ID.warehouseA, ID.batchA, null, null, 100, "kg"],
    ["51000000-0000-4000-8000-000000000102", ID.companyA, ID.warehouseA, ID.batchA, ID.batchA, ID.batchA, 20, "kg"],
    ["51000000-0000-4000-8000-000000000103", ID.companyA, ID.warehouseA, null, ID.batchA, null, 10, "g"],
    ["51000000-0000-4000-8000-000000000104", ID.companyA, ID.warehouseA, null, null, ID.batchA, 5, "кг"],
    ["51000000-0000-4000-8000-000000000105", ID.companyA, ID.warehouseA, ID.batchA, null, null, 2, "l"],
    ["51000000-0000-4000-8000-000000000106", ID.companyA, ID.warehouseA, null, "different", ID.batchA, 500, "kg"],
    ["51000000-0000-4000-8000-000000000107", ID.companyA, ID.warehouseB, ID.batchA, null, null, 1000, "kg"],
    ["51000000-0000-4000-8000-000000000108", ID.companyB, ID.warehouseA, ID.batchA, null, null, 2000, "kg"],
    ["51000000-0000-4000-8000-000000000109", ID.companyA, ID.warehouseB, ID.otherWarehouseBatch, null, null, 40, "kg"],
  ];
  for (const value of ledgerValues) {
    await db.query(
      `insert into public.stock_ledger_entries(
         id, company_id, warehouse_id, inventory_batch_id, batch_id_text,
         batch_id, delta_qty_signed, uom
       ) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8)`,
      value,
    );
  }

  await db.exec("set role service_role");
  const summary = await rows(
    db,
    `select inventory_batch_id::text, balance_kg::text, has_invalid_uom
     from public.weighbridge_batch_ledger_summary_v1($1::uuid,$2::uuid,$3::uuid[])`,
    [ID.companyA, ID.warehouseA, [ID.batchA, ID.batchB, ID.otherWarehouseBatch, ID.batchA]],
  );
  assert.deepEqual(summary, [
    { inventory_batch_id: ID.batchA, balance_kg: "137.000", has_invalid_uom: true },
    { inventory_batch_id: ID.batchB, balance_kg: "0.000", has_invalid_uom: false },
  ]);

  const allWarehouses = await rows(
    db,
    `select inventory_batch_id::text, balance_kg::text, has_invalid_uom
     from public.weighbridge_batch_ledger_summary_v1($1::uuid,null,$2::uuid[])`,
    [ID.companyA, [ID.batchA, ID.batchB, ID.otherWarehouseBatch]],
  );
  assert.deepEqual(allWarehouses, [
    { inventory_batch_id: ID.batchA, balance_kg: "137.000", has_invalid_uom: true },
    { inventory_batch_id: ID.batchB, balance_kg: "0.000", has_invalid_uom: false },
    { inventory_batch_id: ID.otherWarehouseBatch, balance_kg: "40.000", has_invalid_uom: false },
  ]);
  await db.exec("reset role");

  await db.exec("set role authenticated");
  await expectDatabaseError(
    () => rows(
      db,
      `select * from public.weighbridge_batch_ledger_summary_v1($1::uuid,$2::uuid,$3::uuid[])`,
      [ID.companyA, ID.warehouseA, [ID.batchA]],
    ),
    /permission denied for function weighbridge_batch_ledger_summary_v1/i,
  );
  await db.exec("reset role");

  const empty = await rows(
    db,
    `select * from public.weighbridge_batch_ledger_summary_v1($1::uuid,$2::uuid,$3::uuid[])`,
    [ID.companyA, ID.warehouseA, []],
  );
  assert.deepEqual(empty, []);

  console.log("P0 weighbridge ledger summary RPC: PASS");
}

void main();
