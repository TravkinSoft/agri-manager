import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { counterpartyMatchesSearch } from "../lib/counterparties/catalog";

const COMPANY = "10000000-0000-4000-8000-000000000001";
const ACTOR = "10000000-0000-4000-8000-000000000002";
const SOURCE = "10000000-0000-4000-8000-000000000003";
const DESTINATION = "10000000-0000-4000-8000-000000000004";
const PRODUCT = "10000000-0000-4000-8000-000000000005";
const TRANSFER = "10000000-0000-4000-8000-000000000006";
const INVENTORY = "10000000-0000-4000-8000-000000000007";

async function rows(db: PGlite, sql: string) {
  return (await db.query(sql)).rows as Array<Record<string, unknown>>;
}

async function main() {
  for (const query of ["Syngenta", "Сингента", "СИНГЕНТА", "050140002800"]) {
    assert.equal(counterpartyMatchesSearch({
      legalName: "ТОО «СИНГЕНТА КАЗАХСТАН»",
      taxId: "050140002800",
      query,
    }), true, `supplier search failed: ${query}`);
  }
  for (const query of ["Swissgrow", "Свиссгроу", "130840006340"]) {
    assert.equal(counterpartyMatchesSearch({
      legalName: "ТОО «СВИССГРОУ»",
      taxId: "130840006340",
      query,
    }), true, `supplier search failed: ${query}`);
  }
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create type public.ledger_direction as enum ('in', 'out');
    create table public.companies(id uuid primary key, name text);
    create table public.profiles(id uuid primary key, company_id uuid, role text, status text, full_name text, email text);
    create table public.warehouses(
      id uuid primary key, company_id uuid, name text, warehouse_type text,
      archived boolean default false, is_archived boolean default false
    );
    create table public.products(
      id uuid primary key, company_id uuid, master_product_id uuid, name text not null,
      trade_name text, product_type text, type text, category text, base_uom text,
      unit text, archived boolean default false, is_active boolean default true,
      created_at timestamptz default now()
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, product_id uuid not null,
      warehouse_id uuid not null, direction public.ledger_direction not null, quantity numeric not null,
      uom text not null, delta_qty_signed numeric not null, reason_type text, reason_ref_id uuid,
      batch_id text, batch_id_text text, batch_class text, occurred_at timestamptz, created_at timestamptz default now(),
      created_by uuid, notes text, mass_kg numeric, unit_source text, unit_contract_version integer
    );
    create table public.warehouse_issue_requests(
      id uuid primary key, company_id uuid, source_warehouse_id uuid, status text, warehouse_request_status text
    );
    create table public.warehouse_issue_request_items(
      id uuid primary key, request_id uuid, company_id uuid, product_id uuid, actual_product_id uuid,
      prepared_quantity numeric, issued_quantity numeric, prepared_unit text, issued_unit text, unit text
    );
    create table public.tickets(id uuid primary key, company_id uuid, audit_json jsonb);
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create or replace function public.canonical_stock_uom(value text) returns text language sql immutable as
      $$ select case lower(coalesce(value,'')) when 'kg' then 'kg' when 'l' then 'l' when 'pcs' then 'pcs' else lower(value) end $$;
    create or replace function public.create_warehouse_receipt_atomic_v2(
      uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
    ) returns jsonb language sql as $$ select jsonb_build_object('receipt_id', $9, 'receipt_no', 'TEST') $$;
  `);

  const migration = await readFile(
    new URL("../supabase/migrations/20260721151313_warehouse_v11_inventory_transfers.sql", import.meta.url),
    "utf8"
  );
  await db.exec(migration);
  await db.exec(`
    insert into public.companies values ('${COMPANY}', 'QA');
    insert into public.profiles values ('${ACTOR}', '${COMPANY}', 'warehouse', 'active', 'QA Storekeeper', 'qa@example.test');
    insert into public.warehouses values
      ('${SOURCE}', '${COMPANY}', 'Main', 'agrochemical', false, false),
      ('${DESTINATION}', '${COMPANY}', 'Field', 'agrochemical', false, false);
    insert into public.products(id,company_id,name,trade_name,product_type,type,base_uom,unit)
      values ('${PRODUCT}', null, 'Celest Top', 'Celest Top', 'pesticide', 'pesticide', 'l', 'l');
    insert into public.stock_ledger_entries(
      company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,
      reason_type,batch_id_text,batch_class,occurred_at,created_by,unit_contract_version
    ) values ('${COMPANY}','${PRODUCT}','${SOURCE}','in',1000,'l',1000,'supplier_receipt','LOT-A','material',now(),'${ACTOR}',2);
    select set_config('app.uid', '${ACTOR}', false);
  `);

  const transfer = await rows(db, `select public.create_warehouse_transfer_atomic_v1(
    '${COMPANY}','${SOURCE}','${DESTINATION}','${PRODUCT}',10,'QA transfer','${TRANSFER}'
  ) as result`);
  assert.equal((transfer[0].result as any).ledger_rows, 2);
  const balances = await rows(db, `
    select warehouse_id::text, sum(delta_qty_signed)::numeric as quantity
    from public.stock_ledger_entries group by warehouse_id order by warehouse_id
  `);
  assert.deepEqual(balances.map((row) => Number(row.quantity)).sort((a, b) => a - b), [10, 990]);

  const replay = await rows(db, `select public.create_warehouse_transfer_atomic_v1(
    '${COMPANY}','${SOURCE}','${DESTINATION}','${PRODUCT}',10,'QA transfer','${TRANSFER}'
  ) as result`);
  assert.equal((replay[0].result as any).idempotent_replay, true);
  assert.equal(Number((await rows(db, "select count(*) as count from public.stock_ledger_entries"))[0].count), 3);

  await assert.rejects(
    db.query(`select public.create_warehouse_transfer_atomic_v1(
      '${COMPANY}','${SOURCE}','${DESTINATION}','${PRODUCT}',991,null,'10000000-0000-4000-8000-000000000008'
    )`),
    /Недостаточно доступного остатка/
  );
  assert.equal(Number((await rows(db, "select count(*) as count from public.stock_ledger_entries"))[0].count), 3);

  await db.query(`select public.start_warehouse_inventory_v1('${COMPANY}','${SOURCE}',null,'${INVENTORY}')`);
  await assert.rejects(
    db.query(`insert into public.stock_ledger_entries(
      company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type
    ) values ('${COMPANY}','${PRODUCT}','${SOURCE}','in',1,'l',1,'supplier_receipt')`),
    /На складе проводится инвентаризация/
  );
  const item = (await rows(db, `select id::text from public.warehouse_inventory_items where inventory_id='${INVENTORY}'`))[0];
  await db.query(`select public.save_warehouse_inventory_v1(
    '${COMPANY}','${INVENTORY}',
    '[{"item_id":"${item.id}","actual_quantity":985}]'::jsonb
  )`);
  const complete = await rows(db, `select public.complete_warehouse_inventory_v1('${COMPANY}','${INVENTORY}') as result`);
  assert.equal((complete[0].result as any).ledger_rows, 1);
  const sourceBalance = Number((await rows(db, `select sum(delta_qty_signed) as quantity from public.stock_ledger_entries where warehouse_id='${SOURCE}'`))[0].quantity);
  assert.equal(sourceBalance, 985);
  const inventoryRow = (await rows(db, `select status,difference_count from public.warehouse_inventory_documents where id='${INVENTORY}'`))[0];
  assert.equal(inventoryRow.status, "completed");
  assert.equal(Number(inventoryRow.difference_count), 1);

  console.log(JSON.stringify({
    parser: "PASS",
    transfer_atomic: "PASS",
    transfer_idempotent: "PASS",
    overtransfer_blocked: "PASS",
    inventory_lock: "PASS",
    inventory_adjustment: "PASS",
    supplier_search: "PASS",
    source_balance: sourceBalance,
  }, null, 2));
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
