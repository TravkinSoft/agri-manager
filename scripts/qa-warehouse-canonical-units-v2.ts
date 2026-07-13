import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { resolveStockUnitContract } from "@/lib/warehouse/stock-unit-contract";

const MIGRATION = new URL("../supabase/migrations/20260713183038_warehouse_canonical_units_v2.sql", import.meta.url);
const COMPANY = "00000000-0000-0000-0000-000000000001";
const WH_A = "00000000-0000-0000-0000-000000000011";
const WH_B = "00000000-0000-0000-0000-000000000012";
const KG = "00000000-0000-0000-0000-000000000101";
const L = "00000000-0000-0000-0000-000000000102";
const LD = "00000000-0000-0000-0000-000000000103";
const PCS = "00000000-0000-0000-0000-000000000104";
const SEED = "00000000-0000-0000-0000-000000000105";

function contract(product: Record<string, unknown>, quantity: number, inputUom?: string, requestedBatchClass?: string) {
  return resolveStockUnitContract({
    product: product as any,
    quantity,
    inputUom,
    requestedBatchClass,
    event: "manual_receipt",
  });
}

async function expectReject(run: () => Promise<unknown> | unknown, pattern: RegExp) {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof Error, "Expected operation to fail");
  assert.match(error.message, pattern);
}

async function main() {
  const kgContract = contract({ id: KG, base_uom: "kg", type: "fertilizer" }, 1000);
  assert.deepEqual([kgContract.baseQuantity, kgContract.baseUom, kgContract.massKg, kgContract.batchClass], [1000, "kg", 1000, "material"]);
  const literContract = contract({ id: L, base_uom: "л", type: "pesticide" }, 80);
  assert.deepEqual([literContract.baseQuantity, literContract.baseUom, literContract.massKg], [80, "l", null]);
  const densityContract = contract({
    id: LD, base_uom: "l", type: "pesticide", density_kg_per_l: 1.2, density_unit: "kg/l",
    density_source: "verified label", density_verification_status: "verified", density_verified_at: "2026-07-13T00:00:00Z",
  }, 10);
  assert.equal(densityContract.massKg, 12);
  assert.deepEqual([contract({ id: PCS, base_uom: "pcs", type: "material" }, 20).baseUom, contract({ id: PCS, base_uom: "pcs", type: "material" }, 20).massKg], ["pcs", null]);
  assert.equal(contract({ id: SEED, base_uom: "kg", type: "seed", is_seed_material: true }, 50).batchClass, "seed");
  await expectReject(() => contract({ id: KG, base_uom: "bucket", type: "fertilizer" }, 1), /Неизвестная складская единица/);
  await expectReject(() => contract({ id: SEED, base_uom: "kg", type: "seed", is_seed_material: true }, 1, "kg", "commodity"), /Семенной материал/);

  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create type public.ledger_direction as enum ('in','out');
    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key);
    create table public.warehouses(id uuid primary key, company_id uuid);
    create table public.products(
      id uuid primary key, company_id uuid, base_uom text, unit text, product_type text, type text,
      is_seed_material boolean default false
    );
    create table public.inventory_transactions(
      id uuid primary key, company_id uuid, product_id uuid, warehouse_id uuid, source_warehouse_id uuid,
      destination_warehouse_id uuid, quantity numeric, unit text, base_quantity_kg numeric,
      quantity_input numeric, input_uom text, transaction_type text, movement_type text, status text,
      operation_datetime timestamptz, confirmed_at timestamptz, created_at timestamptz default now(),
      date date, responsible_user_id uuid, user_id uuid, notes text
    );
    create table public.tickets(id uuid primary key, company_id uuid);
    create table public.ticket_lines(
      id uuid primary key, ticket_id uuid, company_id uuid, product_id uuid, crop_id uuid, variety_id uuid,
      reproduction_id uuid, batch_id text, lot_id text, batch_class text, quantity numeric, uom text,
      created_at timestamptz default now()
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(), company_id uuid, ticket_id uuid, processing_id uuid,
      product_id uuid, variety_id uuid, reproduction_id uuid, batch_id_text text, batch_id text,
      batch_class text, warehouse_id uuid, direction public.ledger_direction, quantity numeric, uom text,
      delta_qty_signed numeric, reason_type text, reason_ref_id uuid, occurred_at timestamptz default now(),
      created_by uuid, is_storno boolean default false, storno_of_entry_id uuid, notes text, created_at timestamptz default now()
    );
    create table public.inventory_batches(
      id uuid primary key default gen_random_uuid(), company_id uuid, product_id uuid, crop_id uuid,
      variety_id uuid, reproduction_id uuid, source_ticket_id uuid, batch_class text,
      initial_weight_kg numeric, current_weight_kg numeric
    );
    create table public.field_material_consumptions(
      id uuid primary key default gen_random_uuid(), company_id uuid, product_id uuid, ticket_line_id uuid,
      batch_class text, quantity_kg numeric not null check(quantity_kg > 0)
    );
    create function public.issue_warehouse_request_v2(uuid,uuid,uuid,jsonb) returns jsonb language sql as 'select jsonb_build_object()';
    create function public.confirm_warehouse_request_receipt(uuid,uuid) returns jsonb language sql as 'select jsonb_build_object()';
    create function public.finalize_ticket(uuid,uuid) returns uuid language sql as 'select $1';
    create function public.confirm_processing_document(uuid,uuid) returns uuid language sql as 'select $1';
    create view public.v_stock_movements_canonical as select
      'stock_ledger_entries'::text source_system, id source_id, company_id, warehouse_id, product_id,
      occurred_at, 'confirmed'::text status, reason_type movement_type,
      case when delta_qty_signed > 0 then delta_qty_signed else 0 end::numeric quantity_in,
      case when delta_qty_signed < 0 then -delta_qty_signed else 0 end::numeric quantity_out,
      delta_qty_signed::numeric delta_qty, uom, reason_type, ticket_id, processing_id from public.stock_ledger_entries;
    create view public.v_stock_balance_canonical as select company_id,warehouse_id,product_id,
      sum(delta_qty)::numeric(18,3) quantity,max(uom) uom,min(occurred_at) first_movement_at,max(occurred_at) last_movement_at
      from public.v_stock_movements_canonical group by company_id,warehouse_id,product_id;
    create view public.v_stock_balance_identity as select company_id,warehouse_id,product_id,variety_id,reproduction_id,
      batch_id,batch_class,sum(case when direction='in' then quantity else -quantity end) quantity,max(occurred_at) last_movement_at
      from public.stock_ledger_entries group by company_id,warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class;
    create view public.v_stock_balance_reconciliation as select company_id,warehouse_id,product_id,
      0::numeric(18,3) qty_inventory,0::numeric(18,3) qty_ledger,0::numeric(18,3) diff from public.stock_ledger_entries where false;
    create function public.get_stock_balance_canonical(uuid,uuid,uuid) returns numeric language sql stable as 'select 0::numeric';
    insert into public.companies values ('${COMPANY}');
    insert into public.warehouses values ('${WH_A}','${COMPANY}'),('${WH_B}','${COMPANY}');
    insert into public.products(id,company_id,base_uom,unit,product_type,type,is_seed_material) values
      ('${KG}','${COMPANY}','kg','kg','fertilizer','fertilizer',false),
      ('${L}','${COMPANY}','l','l','pesticide','pesticide',false),
      ('${LD}','${COMPANY}','l','l','pesticide','pesticide',false),
      ('${PCS}','${COMPANY}','pcs','pcs','material','material',false),
      ('${SEED}','${COMPANY}','kg','kg','seed','seed',true);
    insert into public.stock_ledger_entries(company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type)
      values ('${COMPANY}','${KG}','${WH_A}','in',3,'kg',3,'legacy'),('${COMPANY}','${KG}','${WH_A}','in',4,'l',4,'legacy');
  `);

  const beforeLegacy = await db.query<{ count: number }>("select count(*)::int count from stock_ledger_entries");
  await db.exec(await readFile(MIGRATION, "utf8"));
  const afterLegacy = await db.query<{ count: number }>("select count(*)::int count from stock_ledger_entries where unit_contract_version is null");
  assert.equal(beforeLegacy.rows[0].count, 2);
  assert.equal(afterLegacy.rows[0].count, 2, "Migration must not backfill legacy rows");

  let sequence = 1000;
  async function post(
    productId: string, quantity: number, uom: string, batchClass: string, movement: string,
    direction: string, from: string | null, to: string | null, massKg: number | null,
    density?: { value: number; source: string }
  ) {
    const id = `00000000-0000-0000-0001-${String(sequence++).padStart(12, "0")}`;
    await db.query(`insert into inventory_transactions(
      id,company_id,product_id,warehouse_id,source_warehouse_id,destination_warehouse_id,quantity,unit,
      base_quantity_kg,transaction_type,movement_type,status,operation_datetime,base_quantity,base_uom,mass_kg,
      batch_class,unit_source,unit_contract_version,density_kg_per_l,density_unit,density_source,
      density_verification_status,density_verified_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',now(),$7,$8,$9,$12,'qa-resolver',2,
      $13,case when $13::numeric is null then null else 'kg/l' end,$14,
      case when $13::numeric is null then null else 'verified' end,case when $13::numeric is null then null else now() end)`,
    [id, COMPANY, productId, from || to, from, to, quantity, uom, massKg, direction, movement, batchClass, density?.value ?? null, density?.source ?? null]);
    await db.query("select post_inventory_transaction_to_ledger($1)", [id]);
  }

  await post(KG, 1000, "kg", "material", "receipt", "in", null, WH_A, 1000);
  await post(KG, 100, "kg", "material", "issue", "out", WH_A, null, 100);
  await post(KG, 10, "kg", "material", "adjustment", "in", null, WH_A, 10);
  await post(L, 80, "l", "material", "receipt", "in", null, WH_A, null);
  await post(L, 20, "l", "material", "issue", "out", WH_A, null, null);
  await post(L, 5, "l", "material", "adjustment", "in", null, WH_A, null);
  await db.query("update products set density_kg_per_l=1.2,density_unit='kg/l',density_source='verified label',density_verification_status='verified',density_verified_at=now() where id=$1", [LD]);
  await post(LD, 10, "l", "material", "receipt", "in", null, WH_A, 12, { value: 1.2, source: "verified label" });
  await post(PCS, 20, "pcs", "material", "receipt", "in", null, WH_A, null);
  await post(SEED, 50, "kg", "seed", "receipt", "in", null, WH_A, 50);
  await post(KG, 10, "kg", "material", "transfer", "out", WH_A, WH_B, 10);
  await post(KG, 5, "kg", "material", "adjustment", "in", null, WH_A, 5);

  const balances = await db.query<{ product_id: string; warehouse_id: string; uom: string; batch_class: string; quantity: number }>(
    "select product_id::text,warehouse_id::text,uom,batch_class,quantity::float8 quantity from v_stock_balance_canonical order by product_id,uom"
  );
  const find = (productId: string, warehouseId: string, uom: string) => balances.rows.find((row: any) => row.product_id === productId && row.warehouse_id === warehouseId && row.uom === uom)?.quantity;
  assert.equal(find(KG, WH_A, "kg"), 905);
  assert.equal(find(KG, WH_B, "kg"), 10);
  assert.equal(find(L, WH_A, "l"), 65);
  assert.equal(find(LD, WH_A, "l"), 10);
  assert.equal(find(PCS, WH_A, "pcs"), 20);
  assert.equal(find(SEED, WH_A, "kg"), 50);
  assert.equal(find(KG, WH_A, "legacy/kg"), 3);
  assert.equal(find(KG, WH_A, "legacy/l"), 4);

  await expectReject(() => db.query(`insert into stock_ledger_entries(company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class,unit_source,unit_contract_version)
    values ($1,$2,$3,'in',2,'l',2,'qa_cross_unit','material','qa-cross-unit',2)`, [COMPANY, KG, WH_A]), /unit does not match product/i);
  const productUnits = await db.query<{ uom: string; quantity: number }>(`select uom,quantity::float8 quantity
    from v_stock_balance_canonical
    where company_id=$1 and warehouse_id=$2 and product_id=$3 and batch_class='material'
    order by uom`, [COMPANY, WH_A, KG]);
  assert.deepEqual(productUnits.rows, [{ uom: "kg", quantity: 905 }]);

  const liquidMass = await db.query<{ mass_kg: number | null }>("select mass_kg::float8 mass_kg from stock_ledger_entries where product_id=$1 and unit_contract_version=2 limit 1", [L]);
  assert.equal(liquidMass.rows[0].mass_kg, null);
  const verifiedMass = await db.query<{ mass_kg: number }>("select mass_kg::float8 mass_kg from stock_ledger_entries where product_id=$1 and unit_contract_version=2 limit 1", [LD]);
  assert.equal(verifiedMass.rows[0].mass_kg, 12);

  const ticketKg = "00000000-0000-0000-0002-000000000001";
  const lineKg = "00000000-0000-0000-0002-000000000002";
  const ticketL = "00000000-0000-0000-0002-000000000003";
  const lineL = "00000000-0000-0000-0002-000000000004";
  await db.query("insert into tickets values ($1,$2),($3,$2)", [ticketKg, COMPANY, ticketL]);
  await db.query(`insert into ticket_lines(id,ticket_id,company_id,product_id,quantity,uom,batch_class,mass_kg,unit_source,unit_contract_version)
    values ($1,$2,$3,$4,25,'kg','material',25,'qa-ticket',2),($5,$6,$3,$7,5,'l','material',null,'qa-ticket',2)`,
    [lineKg, ticketKg, COMPANY, KG, lineL, ticketL, L]);
  await db.query("insert into inventory_batches(company_id,product_id,source_ticket_id,batch_class,initial_weight_kg,current_weight_kg) values ($1,$2,$3,'material',25,25)", [COMPANY, KG, ticketKg]);
  const batch = await db.query<{ uom: string; initial_quantity: number; unit_contract_version: number }>("select uom,initial_quantity::float8 initial_quantity,unit_contract_version from inventory_batches limit 1");
  assert.deepEqual(batch.rows[0], { uom: "kg", initial_quantity: 25, unit_contract_version: 2 });

  await db.query("insert into field_material_consumptions(company_id,product_id,ticket_line_id,batch_class,quantity_kg) values ($1,$2,$3,'material',5)", [COMPANY, L, lineL]);
  const fieldFact = await db.query<{ quantity: number; uom: string; mass_kg: number | null; quantity_kg: number | null }>("select quantity::float8 quantity,uom,mass_kg::float8 mass_kg,quantity_kg::float8 quantity_kg from field_material_consumptions limit 1");
  assert.deepEqual(fieldFact.rows[0], { quantity: 5, uom: "l", mass_kg: null, quantity_kg: null });

  const ticketLedger = await db.query<{ id: string }>(`insert into stock_ledger_entries(company_id,ticket_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class)
    values ($1,$2,$3,$4,'out',5,'l',-5,'issue_to_field','material') returning id::text`, [COMPANY, ticketL, L, WH_A]);
  const sourceLedgerId = ticketLedger.rows[0].id;
  const ticketLedgerContract = await db.query<{ uom: string; unit_contract_version: number }>("select uom,unit_contract_version from stock_ledger_entries where id=$1", [sourceLedgerId]);
  assert.deepEqual(ticketLedgerContract.rows[0], { uom: "l", unit_contract_version: 2 });
  await db.query(`insert into stock_ledger_entries(company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class,is_storno,storno_of_entry_id)
    values ($1,$2,$3,'in',5,'l',5,'storno_issue_to_field','material',true,$4)`, [COMPANY, L, WH_A, sourceLedgerId]);
  const storno = await db.query<{ unit_source: string; unit_contract_version: number }>("select unit_source,unit_contract_version from stock_ledger_entries where storno_of_entry_id=$1", [sourceLedgerId]);
  assert.match(storno.rows[0].unit_source, /^storno:/);
  assert.equal(storno.rows[0].unit_contract_version, 2);

  const processingId = "00000000-0000-0000-0003-000000000001";
  await db.query("insert into inventory_batches(company_id,product_id,batch_class,initial_weight_kg,current_weight_kg) values ($1,$2,'processing',7,7)", [COMPANY, KG]);
  await db.query(`insert into stock_ledger_entries(company_id,processing_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class)
    values ($1,$2,$3,$4,'in',7,'kg',7,'processing_output','processing')`, [COMPANY, processingId, KG, WH_B]);
  const processing = await db.query<{ mass_kg: number; unit_contract_version: number }>("select mass_kg::float8 mass_kg,unit_contract_version from stock_ledger_entries where processing_id=$1", [processingId]);
  assert.deepEqual(processing.rows[0], { mass_kg: 7, unit_contract_version: 2 });
  const reconciliation = await db.query<{ count: number }>("select count(*)::int count from v_stock_balance_reconciliation");
  assert.equal(reconciliation.rows[0].count, 0);
  await expectReject(() => db.query(`insert into stock_ledger_entries(company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class,unit_source,unit_contract_version)
    values ($1,$2,$3,'in',1,'bucket',1,'qa','material','qa',2)`, [COMPANY, KG, WH_A]), /Unknown warehouse unit/);
  await expectReject(() => db.query(`insert into stock_ledger_entries(company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,unit_source,unit_contract_version)
    values ($1,$2,$3,'in',1,'kg',1,'qa','qa',2)`, [COMPANY, KG, WH_A]), /unit_contract|batch/i);

  console.log(JSON.stringify({ migration: "PASS", kg: "PASS", liter: "PASS", verifiedDensity: "PASS", pcs: "PASS", seed: "PASS", transfer: "PASS", batchCreation: "PASS", fieldMaterial: "PASS", storno: "PASS", processing: "PASS", reconciliation: "PASS", crossUnitSum: "BLOCKED", legacyRowsChanged: 0 }, null, 2));
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
