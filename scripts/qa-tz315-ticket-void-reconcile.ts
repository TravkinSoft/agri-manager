import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830204658_tz315_ticket_void_batch_reconcile_v1.sql",
  import.meta.url,
);

type Row = Record<string, unknown>;
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows as Row[];
const scalar = async (db: PGlite, sql: string) => Object.values((await rows(db, sql))[0] ?? {})[0];

const COMPANY = "31600000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31600000-0000-4000-8000-000000000002";
const ACTOR = "31600000-0000-4000-8000-000000000011";
const OTHER_ACTOR = "31600000-0000-4000-8000-000000000012";
const WEIGHMAN = "31600000-0000-4000-8000-000000000013";
const GLOBAL_ADMIN = "31600000-0000-4000-8000-000000000014";
const WAREHOUSE = "31600000-0000-4000-8000-000000000021";
const WAREHOUSE_2 = "31600000-0000-4000-8000-000000000031";
const PRODUCT = "31600000-0000-4000-8000-000000000022";
const CROP = "31600000-0000-4000-8000-000000000023";
const VARIETY = "31600000-0000-4000-8000-000000000024";
const REPRODUCTION = "31600000-0000-4000-8000-000000000025";
const OPERATION_LINE = "31600000-0000-4000-8000-000000000026";
const ALLOCATION = "31600000-0000-4000-8000-000000000027";
const TICKET = "31600000-0000-4000-8000-000000000101";
const BATCH_A = "31600000-0000-4000-8000-000000000102";
const BATCH_B = "31600000-0000-4000-8000-000000000103";
const DOWNSTREAM_TICKET = "31600000-0000-4000-8000-000000000201";
const DOWNSTREAM_BATCH = "31600000-0000-4000-8000-000000000202";
const CONSUMER_TICKET = "31600000-0000-4000-8000-000000000203";
const FOREIGN_TICKET = "31600000-0000-4000-8000-000000000301";
const WEIGHMAN_TICKET = "31600000-0000-4000-8000-000000000401";
const TRANSFER_ORIGIN_TICKET = "31600000-0000-4000-8000-000000000501";
const TRANSFER_TICKET = "31600000-0000-4000-8000-000000000502";
const TRANSFER_SOURCE_BATCH = "31600000-0000-4000-8000-000000000503";
const TRANSFER_DEST_BATCH = "31600000-0000-4000-8000-000000000504";
const SUPPLIER_TICKET = "31600000-0000-4000-8000-000000000601";
const SUPPLIER_BATCH = "31600000-0000-4000-8000-000000000602";
const IMPURITY_ORIGIN_TICKET = "31600000-0000-4000-8000-000000000701";
const IMPURITY_TICKET = "31600000-0000-4000-8000-000000000702";
const IMPURITY_BATCH = "31600000-0000-4000-8000-000000000703";
const WRAPPER_TICKET = "31600000-0000-4000-8000-000000000801";
const GLOBAL_TICKET = "31600000-0000-4000-8000-000000000802";
const PROCESSING_ID = "31600000-0000-4000-8000-000000000901";
const PROCESSING_ORIGIN_TICKET = "31600000-0000-4000-8000-000000000902";
const PROCESSING_OUTPUT_TICKET = "31600000-0000-4000-8000-000000000903";
const PROCESSING_SOURCE_BATCH = "31600000-0000-4000-8000-000000000904";
const PROCESSING_CHILD_BATCH = "31600000-0000-4000-8000-000000000905";
const PRESTORNO_TICKET = "31600000-0000-4000-8000-000000000911";
const PRESTORNO_BATCH = "31600000-0000-4000-8000-000000000912";
const CLOSED_DIRECT_TICKET = "31600000-0000-4000-8000-000000000921";
const CLOSED_DIRECT_BATCH = "31600000-0000-4000-8000-000000000922";

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;
    create type public.ledger_direction as enum ('in', 'out');

    create table public.companies(id uuid primary key, name text not null);
    create table public.profiles(
      id uuid primary key,
      company_id uuid,
      role text not null,
      status text not null default 'active'
    );
    create table public.tickets(
      id uuid primary key,
      company_id uuid not null,
      status text not null,
      is_finalized boolean not null default false,
      is_voided boolean not null default false,
      voided_by uuid,
      voided_at timestamptz,
      void_reason text,
      updated_at timestamptz not null default now()
    );
    create table public.inventory_batches(
      id uuid primary key,
      company_id uuid not null,
      warehouse_id uuid not null,
      source_ticket_id uuid,
      parent_batch_id uuid,
      current_quantity numeric,
      current_weight_kg numeric,
      mass_kg numeric,
      initial_quantity numeric,
      initial_weight_kg numeric,
      updated_at timestamptz not null default now()
    );
    create table public.harvest_lot_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      harvest_lot_id uuid not null,
      inventory_batch_id uuid not null unique,
      source_ticket_id uuid
    );
    create table public.batch_transformations(
      id uuid primary key,
      company_id uuid not null,
      processing_state text not null
    );
    create table public.batch_transformation_outputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      source_ticket_id uuid
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      ticket_id uuid,
      processing_id uuid,
      product_id uuid not null,
      warehouse_id uuid not null,
      direction public.ledger_direction not null,
      quantity numeric not null,
      uom text not null default 'kg',
      delta_qty_signed numeric not null,
      reason_type text not null,
      reason_ref_id uuid,
      batch_id text,
      occurred_at timestamptz not null default now(),
      created_by uuid,
      is_storno boolean not null default false,
      storno_of_entry_id uuid,
      notes text,
      created_at timestamptz not null default now(),
      variety_id uuid,
      reproduction_id uuid,
      batch_id_text text,
      batch_class text,
      operation_line_id uuid,
      warehouse_issue_allocation_id uuid,
      crop_id uuid,
      inventory_batch_id uuid,
      mass_kg numeric,
      density_kg_per_l numeric,
      density_unit text,
      density_source text,
      density_verification_status text,
      density_verified_at timestamptz,
      unit_source text,
      unit_contract_version smallint
    );
    create unique index uq_stock_ledger_storno_target_v1
      on public.stock_ledger_entries(storno_of_entry_id)
      where storno_of_entry_id is not null;
    create table public.field_material_consumptions(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid,
      notes text,
      updated_at timestamptz not null default now()
    );

    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create or replace function public.get_user_company_id() returns uuid
    language sql stable security definer set search_path = '' as
      $$ select company_id from public.profiles where id = auth.uid() $$;
    create or replace function private.reconcile_warehouse_local_batch_balance_v1(p_batch_id uuid)
    returns numeric language plpgsql security definer set search_path = '' as $$
    declare v_batch public.inventory_batches%rowtype; v_balance numeric(18,6);
    begin
      select * into v_batch from public.inventory_batches where id=p_batch_id for update;
      if not found then raise exception 'Inventory batch not found for reconciliation'; end if;
      select round(coalesce(sum(sle.delta_qty_signed),0),6) into v_balance
      from public.stock_ledger_entries sle
      where sle.company_id=v_batch.company_id
        and sle.warehouse_id=v_batch.warehouse_id
        and coalesce(sle.inventory_batch_id::text,nullif(sle.batch_id_text,''),nullif(sle.batch_id,''))=v_batch.id::text;
      if v_balance < -0.001 then raise exception 'WEIGHBRIDGE_STOCK_INTERNAL_NEGATIVE'; end if;
      update public.inventory_batches
      set current_quantity=greatest(v_balance,0), current_weight_kg=greatest(v_balance,0),
          mass_kg=greatest(v_balance,0),
          initial_quantity=case when parent_batch_id is null then initial_quantity else greatest(coalesce(initial_quantity,0),greatest(v_balance,0)) end,
          initial_weight_kg=case when parent_batch_id is null then initial_weight_kg else greatest(coalesce(initial_weight_kg,0),greatest(v_balance,0)) end,
          updated_at=now()
      where id=v_batch.id;
      return greatest(v_balance,0);
    end $$;
    create or replace function private.reconcile_harvest_lot_batch_balance_v1(p_batch_id uuid)
    returns numeric language plpgsql security definer set search_path = '' as $$
    declare v_batch public.inventory_batches%rowtype; v_balance numeric(18,6);
    begin
      select * into v_batch from public.inventory_batches where id=p_batch_id for update;
      if not found then raise exception 'Inventory batch not found for reconciliation'; end if;
      select round(coalesce(sum(sle.delta_qty_signed),0),6) into v_balance
      from public.stock_ledger_entries sle
      where sle.company_id=v_batch.company_id
        and sle.warehouse_id=v_batch.warehouse_id
        and (
          sle.inventory_batch_id=v_batch.id
          or (sle.inventory_batch_id is null and coalesce(nullif(sle.batch_id_text,''),nullif(sle.batch_id,''))=v_batch.id::text)
          or (sle.inventory_batch_id is null and sle.ticket_id is not null and v_batch.source_ticket_id=sle.ticket_id)
        );
      if v_balance < -0.001 then raise exception 'Harvest lot batch balance would become negative'; end if;
      update public.inventory_batches
      set current_quantity=greatest(v_balance,0), current_weight_kg=greatest(v_balance,0),
          mass_kg=greatest(v_balance,0),
          initial_quantity=case when parent_batch_id is null then initial_quantity else greatest(coalesce(initial_quantity,0),greatest(v_balance,0)) end,
          initial_weight_kg=case when parent_batch_id is null then initial_weight_kg else greatest(coalesce(initial_weight_kg,0),greatest(v_balance,0)) end,
          updated_at=now()
      where id=v_batch.id;
      return greatest(v_balance,0);
    end $$;

    insert into public.companies(id,name) values
      ('${COMPANY}','Canonical void'),('${OTHER_COMPANY}','Foreign');
    insert into public.profiles(id,company_id,role,status) values
      ('${ACTOR}','${COMPANY}','company_admin','active'),
      ('${OTHER_ACTOR}','${OTHER_COMPANY}','company_admin','active'),
      ('${WEIGHMAN}','${COMPANY}','weighman','active'),
      ('${GLOBAL_ADMIN}',null,'global_admin','active');
    select set_config('app.uid','${ACTOR}',false);
  `);
}

async function applyMigration(db: PGlite, migration: string) {
  await db.exec(migration);
}

async function seedCanonicalTicket(db: PGlite) {
  await db.exec(`
    insert into public.tickets(id,company_id,status,is_finalized)
    values('${TICKET}','${COMPANY}','finalized',true);
    insert into public.inventory_batches(
      id,company_id,warehouse_id,source_ticket_id,current_quantity,current_weight_kg,mass_kg,
      initial_quantity,initial_weight_kg
    ) values
      ('${BATCH_A}','${COMPANY}','${WAREHOUSE}','${TICKET}',100,100,100,100,100),
      ('${BATCH_B}','${COMPANY}','${WAREHOUSE}','${TICKET}',50,50,50,50,50);
    insert into public.harvest_lot_batches(company_id,harvest_lot_id,inventory_batch_id,source_ticket_id)
    values
      ('${COMPANY}','31600000-0000-4000-8000-000000000104','${BATCH_A}','${TICKET}'),
      ('${COMPANY}','31600000-0000-4000-8000-000000000104','${BATCH_B}','${TICKET}');
    insert into public.stock_ledger_entries(
      company_id,ticket_id,processing_id,product_id,crop_id,variety_id,reproduction_id,
      warehouse_id,inventory_batch_id,batch_id,batch_id_text,batch_class,
      operation_line_id,warehouse_issue_allocation_id,direction,quantity,uom,
      delta_qty_signed,mass_kg,density_kg_per_l,density_unit,density_source,
      density_verification_status,density_verified_at,unit_source,unit_contract_version,
      reason_type,reason_ref_id,notes
    ) values
      ('${COMPANY}','${TICKET}',null,'${PRODUCT}','${CROP}','${VARIETY}','${REPRODUCTION}',
       '${WAREHOUSE}','${BATCH_A}','${BATCH_A}','${BATCH_A}','harvest_trip',
       '${OPERATION_LINE}','${ALLOCATION}','in',100,'kg',100,100,0.77,'kg/l','scale',
       'verified','2026-08-30T10:00:00Z','weighbridge',2,'ticket_finalize','${TICKET}','base-a'),
      ('${COMPANY}','${TICKET}',null,'${PRODUCT}','${CROP}','${VARIETY}','${REPRODUCTION}',
       '${WAREHOUSE}',null,null,null,'harvest_trip',
       '${OPERATION_LINE}','${ALLOCATION}','in',50,'kg',50,50,0.78,'kg/l','scale',
       'verified','2026-08-30T10:01:00Z','weighbridge',2,'ticket_finalize','${TICKET}','base-b');
    insert into public.field_material_consumptions(ticket_id,notes)
    values('${TICKET}','field link');
  `);
}

async function main() {
  const db = new PGlite();
  const migration = await readFile(migrationUrl, "utf8");
  await bootstrap(db);

  await applyMigration(db, migration);
  await applyMigration(db, migration);
  console.log("PASS 01 migration compiles and is repeat-safe");

  assert.equal(
    await scalar(db, "select has_function_privilege('authenticated','public.void_ticket_with_storno_v2(uuid,uuid,text)','EXECUTE')"),
    false,
  );
  assert.equal(
    await scalar(db, "select has_function_privilege('service_role','public.void_ticket_with_storno_v2(uuid,uuid,text)','EXECUTE')"),
    true,
  );
  console.log("PASS 02 actor-explicit RPC remains server-only");

  await seedCanonicalTicket(db);
  await scalar(db, `select public.void_ticket_with_storno_v2('${TICKET}','${ACTOR}','audit void')`);

  const ticket = (await rows(db, `select status,is_voided,voided_by,void_reason from public.tickets where id='${TICKET}'`))[0];
  assert.equal(ticket.status, "voided");
  assert.equal(ticket.is_voided, true);
  assert.equal(ticket.voided_by, ACTOR);
  assert.equal(ticket.void_reason, "audit void");
  assert.equal(Number(await scalar(db, `select count(*) from public.stock_ledger_entries where ticket_id='${TICKET}' and is_storno`)), 2);
  assert.equal(Number(await scalar(db, `select coalesce(sum(delta_qty_signed),0) from public.stock_ledger_entries where ticket_id='${TICKET}'`)), 0);
  console.log("PASS 03 finalized ticket creates one storno per canonical effect");

  const invalidFidelity = Number(await scalar(db, `
    select count(*)
    from public.stock_ledger_entries b
    join public.stock_ledger_entries s on s.storno_of_entry_id=b.id
    where b.ticket_id='${TICKET}' and not b.is_storno and (
      s.company_id is distinct from b.company_id or s.ticket_id is distinct from b.ticket_id
      or s.processing_id is distinct from b.processing_id or s.product_id is distinct from b.product_id
      or s.crop_id is distinct from b.crop_id or s.variety_id is distinct from b.variety_id
      or s.reproduction_id is distinct from b.reproduction_id or s.warehouse_id is distinct from b.warehouse_id
      or s.inventory_batch_id is distinct from b.inventory_batch_id or s.batch_id is distinct from b.batch_id
      or s.batch_id_text is distinct from b.batch_id_text or s.batch_class is distinct from b.batch_class
      or s.operation_line_id is distinct from b.operation_line_id
      or s.warehouse_issue_allocation_id is distinct from b.warehouse_issue_allocation_id
      or s.quantity is distinct from b.quantity or s.uom is distinct from b.uom
      or s.mass_kg is distinct from b.mass_kg or s.density_kg_per_l is distinct from b.density_kg_per_l
      or s.density_unit is distinct from b.density_unit or s.density_source is distinct from b.density_source
      or s.density_verification_status is distinct from b.density_verification_status
      or s.density_verified_at is distinct from b.density_verified_at
      or s.unit_source is distinct from b.unit_source or s.unit_contract_version is distinct from b.unit_contract_version
      or s.reason_ref_id is distinct from b.reason_ref_id or s.delta_qty_signed is distinct from -b.delta_qty_signed
    )
  `));
  assert.equal(invalidFidelity, 0);
  console.log("PASS 04 storno preserves crop, batch and complete unit/density identity");

  for (const batchId of [BATCH_A, BATCH_B]) {
    const batch = (await rows(db, `select current_quantity,current_weight_kg,mass_kg from public.inventory_batches where id='${batchId}'`))[0];
    assert.deepEqual([Number(batch.current_quantity), Number(batch.current_weight_kg), Number(batch.mass_kg)], [0, 0, 0]);
  }
  console.log("PASS 05 every affected physical batch reconciles to canonical zero");

  const beforeReplay = (await rows(db, `
    select b.updated_at,
           (select count(*) from public.stock_ledger_entries where ticket_id='${TICKET}') ledger_count,
           (select updated_at from public.tickets where id='${TICKET}') ticket_updated_at
    from public.inventory_batches b where b.id='${BATCH_A}'
  `))[0];
  await scalar(db, `select public.void_ticket_with_storno_v2('${TICKET}','${ACTOR}','audit void replay')`);
  const afterReplay = (await rows(db, `
    select b.updated_at,
           (select count(*) from public.stock_ledger_entries where ticket_id='${TICKET}') ledger_count,
           (select updated_at from public.tickets where id='${TICKET}') ticket_updated_at
    from public.inventory_batches b where b.id='${BATCH_A}'
  `))[0];
  assert.deepEqual(afterReplay, beforeReplay);
  console.log("PASS 06 repeat request is idempotent and does not churn ticket or batch timestamps");

  await db.exec(`update public.inventory_batches set current_quantity=7,current_weight_kg=7,mass_kg=7 where id='${BATCH_A}'`);
  await scalar(db, `select public.void_ticket_with_storno_v2('${TICKET}','${ACTOR}','repair stale physical batch')`);
  assert.equal(Number(await scalar(db, `select current_weight_kg from public.inventory_batches where id='${BATCH_A}'`)), 0);
  console.log("PASS 07 idempotent replay repairs a stale physical batch without duplicate storno");

  await db.exec(`
    insert into public.tickets(id,company_id,status,is_finalized) values
      ('${DOWNSTREAM_TICKET}','${COMPANY}','finalized',true),
      ('${CONSUMER_TICKET}','${COMPANY}','finalized',true);
    insert into public.inventory_batches(
      id,company_id,warehouse_id,current_quantity,current_weight_kg,mass_kg,initial_quantity,initial_weight_kg
    ) values('${DOWNSTREAM_BATCH}','${COMPANY}','${WAREHOUSE}',60,60,60,100,100);
    insert into public.stock_ledger_entries(
      company_id,ticket_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id_text,
      direction,quantity,uom,delta_qty_signed,mass_kg,reason_type
    ) values
      ('${COMPANY}','${DOWNSTREAM_TICKET}','${PRODUCT}','${CROP}','${WAREHOUSE}','${DOWNSTREAM_BATCH}','${DOWNSTREAM_BATCH}',
       'in',100,'kg',100,100,'ticket_finalize'),
      ('${COMPANY}','${CONSUMER_TICKET}','${PRODUCT}','${CROP}','${WAREHOUSE}','${DOWNSTREAM_BATCH}','${DOWNSTREAM_BATCH}',
       'out',40,'kg',-40,40,'ticket_finalize');
  `);
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${DOWNSTREAM_TICKET}','${ACTOR}','must block')`),
    /WEIGHBRIDGE_VOID_DOWNSTREAM_USAGE/,
  );
  assert.equal(Number(await scalar(db, `select count(*) from public.stock_ledger_entries where storno_of_entry_id in (select id from public.stock_ledger_entries where ticket_id='${DOWNSTREAM_TICKET}')`)), 0);
  assert.equal(await scalar(db, `select status from public.tickets where id='${DOWNSTREAM_TICKET}'`), "finalized");
  assert.equal(Number(await scalar(db, `select current_weight_kg from public.inventory_batches where id='${DOWNSTREAM_BATCH}'`)), 60);
  console.log("PASS 08 partial downstream consumption blocks atomically without damage");

  await db.exec(`insert into public.tickets(id,company_id,status,is_finalized) values('${FOREIGN_TICKET}','${OTHER_COMPANY}','finalized',true)`);
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${FOREIGN_TICKET}','${ACTOR}','foreign')`),
    /WEIGHBRIDGE_VOID_COMPANY_MISMATCH/,
  );
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${DOWNSTREAM_TICKET}','${OTHER_ACTOR}','spoof')`),
    /WEIGHBRIDGE_VOID_FORBIDDEN/,
  );
  console.log("PASS 09 company context and actor spoofing are rejected");

  await db.exec(`
    insert into public.tickets(id,company_id,status,is_finalized) values('${WEIGHMAN_TICKET}','${COMPANY}','finalized',true);
    select set_config('app.uid','${WEIGHMAN}',false);
  `);
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${WEIGHMAN_TICKET}','${WEIGHMAN}','forbidden finalized void')`),
    /WEIGHBRIDGE_FINALIZED_VOID_FORBIDDEN/,
  );
  console.log("PASS 10 finalized void remains admin-only");

  await db.exec(`
    select set_config('app.uid','${ACTOR}',false);
    insert into public.batch_transformations(id,company_id,processing_state)
    values('${PROCESSING_ID}','${COMPANY}','processing_pending_outputs');
    insert into public.tickets(id,company_id,status,is_finalized) values
      ('${TRANSFER_ORIGIN_TICKET}','${COMPANY}','finalized',true),
      ('${TRANSFER_TICKET}','${COMPANY}','finalized',true);
    insert into public.inventory_batches(
      id,company_id,warehouse_id,source_ticket_id,parent_batch_id,current_quantity,
      current_weight_kg,mass_kg,initial_quantity,initial_weight_kg
    ) values
      ('${TRANSFER_SOURCE_BATCH}','${COMPANY}','${WAREHOUSE}','${TRANSFER_ORIGIN_TICKET}',null,0,0,0,100,100),
      ('${TRANSFER_DEST_BATCH}','${COMPANY}','${WAREHOUSE_2}','${TRANSFER_TICKET}','${TRANSFER_SOURCE_BATCH}',100,100,100,100,100);
    insert into public.harvest_lot_batches(company_id,harvest_lot_id,inventory_batch_id,source_ticket_id) values
      ('${COMPANY}','31600000-0000-4000-8000-000000000505','${TRANSFER_SOURCE_BATCH}','${TRANSFER_ORIGIN_TICKET}'),
      ('${COMPANY}','31600000-0000-4000-8000-000000000505','${TRANSFER_DEST_BATCH}','${TRANSFER_TICKET}');
    insert into public.stock_ledger_entries(
      company_id,ticket_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id_text,
      direction,quantity,uom,delta_qty_signed,mass_kg,reason_type
    ) values
      ('${COMPANY}','${TRANSFER_ORIGIN_TICKET}','${PRODUCT}','${CROP}','${WAREHOUSE}','${TRANSFER_SOURCE_BATCH}','${TRANSFER_SOURCE_BATCH}',
       'in',100,'kg',100,100,'ticket_finalize'),
      ('${COMPANY}','${TRANSFER_TICKET}','${PRODUCT}','${CROP}','${WAREHOUSE}','${TRANSFER_SOURCE_BATCH}','${TRANSFER_SOURCE_BATCH}',
       'out',100,'kg',-100,100,'warehouse_transfer'),
      ('${COMPANY}','${TRANSFER_TICKET}','${PRODUCT}','${CROP}','${WAREHOUSE_2}','${TRANSFER_DEST_BATCH}','${TRANSFER_DEST_BATCH}',
       'in',100,'kg',100,100,'warehouse_transfer');
  `);
  await scalar(db, `select public.void_ticket_with_storno_v2('${TRANSFER_TICKET}','${ACTOR}','void transfer')`);
  assert.deepEqual(
    (await rows(db, `select id,current_weight_kg from public.inventory_batches where id in ('${TRANSFER_SOURCE_BATCH}','${TRANSFER_DEST_BATCH}') order by id`))
      .map((row) => [row.id, Number(row.current_weight_kg)]),
    [[TRANSFER_SOURCE_BATCH, 100], [TRANSFER_DEST_BATCH, 0]],
  );
  assert.equal(Number(await scalar(db, `select coalesce(sum(delta_qty_signed),0) from public.stock_ledger_entries where ticket_id='${TRANSFER_TICKET}'`)), 0);
  console.log("PASS 11 transfer void restores source and zeroes the child destination batch");

  await db.exec(`
    insert into public.tickets(id,company_id,status,is_finalized)
    values('${SUPPLIER_TICKET}','${COMPANY}','finalized',true);
    insert into public.inventory_batches(
      id,company_id,warehouse_id,current_quantity,current_weight_kg,mass_kg,initial_quantity,initial_weight_kg
    ) values('${SUPPLIER_BATCH}','${COMPANY}','${WAREHOUSE}',30,30,30,30,30);
    insert into public.stock_ledger_entries(
      company_id,ticket_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id_text,
      direction,quantity,uom,delta_qty_signed,mass_kg,reason_type
    ) values('${COMPANY}','${SUPPLIER_TICKET}','${PRODUCT}','${CROP}','${WAREHOUSE}','${SUPPLIER_BATCH}','${SUPPLIER_BATCH}',
      'in',30,'kg',30,30,'ticket_finalize');
  `);
  await scalar(db, `select public.void_ticket_with_storno_v2('${SUPPLIER_TICKET}','${ACTOR}','void supplier receipt')`);
  assert.equal(Number(await scalar(db, `select current_weight_kg from public.inventory_batches where id='${SUPPLIER_BATCH}'`)), 0);
  console.log("PASS 12 supplier receipt void zeroes its exact non-harvest physical batch");

  await db.exec(`
    insert into public.tickets(id,company_id,status,is_finalized) values
      ('${IMPURITY_ORIGIN_TICKET}','${COMPANY}','finalized',true),
      ('${IMPURITY_TICKET}','${COMPANY}','finalized',true);
    insert into public.inventory_batches(
      id,company_id,warehouse_id,source_ticket_id,current_quantity,current_weight_kg,mass_kg,
      initial_quantity,initial_weight_kg
    ) values('${IMPURITY_BATCH}','${COMPANY}','${WAREHOUSE}','${IMPURITY_ORIGIN_TICKET}',40,40,40,50,50);
    insert into public.harvest_lot_batches(company_id,harvest_lot_id,inventory_batch_id,source_ticket_id)
    values('${COMPANY}','31600000-0000-4000-8000-000000000704','${IMPURITY_BATCH}','${IMPURITY_ORIGIN_TICKET}');
    insert into public.stock_ledger_entries(
      company_id,ticket_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id_text,
      direction,quantity,uom,delta_qty_signed,mass_kg,reason_type
    ) values
      ('${COMPANY}','${IMPURITY_ORIGIN_TICKET}','${PRODUCT}','${CROP}','${WAREHOUSE}','${IMPURITY_BATCH}','${IMPURITY_BATCH}',
       'in',50,'kg',50,50,'ticket_finalize'),
      ('${COMPANY}','${IMPURITY_TICKET}','${PRODUCT}','${CROP}','${WAREHOUSE}','${IMPURITY_BATCH}','${IMPURITY_BATCH}',
       'out',10,'kg',-10,10,'ticket_finalize');
  `);
  await scalar(db, `select public.void_ticket_with_storno_v2('${IMPURITY_TICKET}','${ACTOR}','void impurity')`);
  assert.equal(Number(await scalar(db, `select current_weight_kg from public.inventory_batches where id='${IMPURITY_BATCH}'`)), 50);
  console.log("PASS 13 impurity-removal void restores the exact aggregate harvest source balance");

  await db.exec(`
    create or replace function public.void_finalized_weighbridge_ticket_for_session_v1(
      p_ticket_id uuid,
      p_reason text
    ) returns uuid language plpgsql security definer set search_path = '' as $$
    declare v_auth_user_id uuid := auth.uid();
    begin
      if v_auth_user_id is null then raise exception 'Authenticated session is required'; end if;
      return public.void_ticket_with_storno_v2(p_ticket_id,v_auth_user_id,p_reason);
    end $$;
    revoke all on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid,text) from public,anon;
    grant execute on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid,text) to authenticated,service_role;
    insert into public.tickets(id,company_id,status,is_finalized)
    values('${WRAPPER_TICKET}','${COMPANY}','finalized',true);
  `);
  await scalar(db, `select public.void_finalized_weighbridge_ticket_for_session_v1('${WRAPPER_TICKET}','wrapper path')`);
  assert.equal(await scalar(db, `select status from public.tickets where id='${WRAPPER_TICKET}'`), "voided");
  assert.equal(
    await scalar(db, "select has_function_privilege('authenticated','public.void_finalized_weighbridge_ticket_for_session_v1(uuid,text)','EXECUTE')"),
    true,
  );
  console.log("PASS 14 existing authenticated session wrapper remains compatible with server-only inner ACL and auth.uid check");

  await db.exec(`
    insert into public.tickets(id,company_id,status,is_finalized)
    values('${GLOBAL_TICKET}','${OTHER_COMPANY}','finalized',true);
    select set_config('app.uid','${GLOBAL_ADMIN}',false);
  `);
  await scalar(db, `select public.void_finalized_weighbridge_ticket_for_session_v1('${GLOBAL_TICKET}','global selected-company path')`);
  assert.equal(await scalar(db, `select status from public.tickets where id='${GLOBAL_TICKET}'`), "voided");
  console.log("PASS 15 global_admin caller is not incorrectly bound to a nullable profile company");

  await db.exec(`
    select set_config('app.uid','${ACTOR}',false);
    insert into public.tickets(id,company_id,status,is_finalized) values
      ('${PROCESSING_ORIGIN_TICKET}','${COMPANY}','finalized',true),
      ('${PROCESSING_OUTPUT_TICKET}','${COMPANY}','finalized',true);
    insert into public.inventory_batches(
      id,company_id,warehouse_id,source_ticket_id,parent_batch_id,current_quantity,
      current_weight_kg,mass_kg,initial_quantity,initial_weight_kg
    ) values
      ('${PROCESSING_SOURCE_BATCH}','${COMPANY}','${WAREHOUSE}','${PROCESSING_ORIGIN_TICKET}',null,50,50,50,80,80),
      ('${PROCESSING_CHILD_BATCH}','${COMPANY}','${WAREHOUSE_2}','${PROCESSING_OUTPUT_TICKET}','${PROCESSING_SOURCE_BATCH}',30,30,30,30,30);
    insert into public.harvest_lot_batches(company_id,harvest_lot_id,inventory_batch_id,source_ticket_id) values
      ('${COMPANY}','31600000-0000-4000-8000-000000000906','${PROCESSING_SOURCE_BATCH}','${PROCESSING_ORIGIN_TICKET}'),
      ('${COMPANY}','31600000-0000-4000-8000-000000000906','${PROCESSING_CHILD_BATCH}','${PROCESSING_OUTPUT_TICKET}');
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${PROCESSING_ID}','${PROCESSING_OUTPUT_TICKET}');
    insert into public.stock_ledger_entries(
      company_id,ticket_id,processing_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id_text,
      direction,quantity,uom,delta_qty_signed,mass_kg,reason_type,reason_ref_id,unit_source,unit_contract_version
    ) values
      ('${COMPANY}','${PROCESSING_ORIGIN_TICKET}',null,'${PRODUCT}','${CROP}','${WAREHOUSE}','${PROCESSING_SOURCE_BATCH}','${PROCESSING_SOURCE_BATCH}',
       'in',80,'kg',80,80,'ticket_finalize','${PROCESSING_ORIGIN_TICKET}','weighbridge',2),
      ('${COMPANY}','${PROCESSING_OUTPUT_TICKET}','${PROCESSING_ID}','${PRODUCT}','${CROP}','${WAREHOUSE}','${PROCESSING_SOURCE_BATCH}','${PROCESSING_SOURCE_BATCH}',
       'out',30,'kg',-30,30,'processing_output_out','${PROCESSING_OUTPUT_TICKET}','processing.output_net_weight',2),
      ('${COMPANY}','${PROCESSING_OUTPUT_TICKET}','${PROCESSING_ID}','${PRODUCT}','${CROP}','${WAREHOUSE_2}','${PROCESSING_CHILD_BATCH}','${PROCESSING_CHILD_BATCH}',
       'in',30,'kg',30,30,'processing_output_in','${PROCESSING_OUTPUT_TICKET}','processing.output_net_weight',2);
  `);
  await scalar(db, `select public.void_ticket_with_storno_v2('${PROCESSING_OUTPUT_TICKET}','${ACTOR}','void processing output')`);
  assert.deepEqual(
    (await rows(db, `select id,current_weight_kg from public.inventory_batches where id in ('${PROCESSING_SOURCE_BATCH}','${PROCESSING_CHILD_BATCH}') order by id`))
      .map((row) => [row.id, Number(row.current_weight_kg)]),
    [[PROCESSING_SOURCE_BATCH, 80], [PROCESSING_CHILD_BATCH, 0]],
  );
  assert.equal(Number(await scalar(db, `select count(*) from public.stock_ledger_entries where ticket_id='${PROCESSING_OUTPUT_TICKET}' and is_storno`)), 2);
  console.log("PASS 16 future processing output source OUT plus child IN are both reversed and reconciled");

  await db.exec(`
    update public.batch_transformations
    set processing_state='processing_closed'
    where id='${PROCESSING_ID}';
    insert into public.tickets(id,company_id,status,is_finalized)
    values('${PRESTORNO_TICKET}','${COMPANY}','finalized',true);
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${PROCESSING_ID}','${PRESTORNO_TICKET}');
    insert into public.inventory_batches(
      id,company_id,warehouse_id,current_quantity,current_weight_kg,mass_kg,initial_quantity,initial_weight_kg
    ) values('${PRESTORNO_BATCH}','${COMPANY}','${WAREHOUSE_2}',0,0,0,20,20);
    with base as (
      insert into public.stock_ledger_entries(
        company_id,ticket_id,processing_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id,batch_id_text,
        direction,quantity,uom,delta_qty_signed,mass_kg,reason_type,reason_ref_id,unit_source,unit_contract_version
      ) values('${COMPANY}','${PRESTORNO_TICKET}','${PROCESSING_ID}','${PRODUCT}','${CROP}','${WAREHOUSE_2}','${PRESTORNO_BATCH}','${PRESTORNO_BATCH}','${PRESTORNO_BATCH}',
        'in',20,'kg',20,20,'processing_output_in','${PRESTORNO_TICKET}','processing.output_net_weight',2)
      returning *
    )
    insert into public.stock_ledger_entries(
      company_id,ticket_id,processing_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id,batch_id_text,
      direction,quantity,uom,delta_qty_signed,mass_kg,reason_type,reason_ref_id,unit_source,unit_contract_version,
      is_storno,storno_of_entry_id
    )
    select company_id,ticket_id,processing_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id,batch_id_text,
      'out',quantity,uom,-delta_qty_signed,mass_kg,'storno_processing_reversal',processing_id,unit_source,unit_contract_version,
      true,id
    from base;
  `);
  await scalar(db, `select public.void_ticket_with_storno_v2('${PRESTORNO_TICKET}','${ACTOR}','whole processing reversal owns storno')`);
  assert.equal(Number(await scalar(db, `select count(*) from public.stock_ledger_entries where ticket_id='${PRESTORNO_TICKET}'`)), 2);
  assert.equal(await scalar(db, `select status from public.tickets where id='${PRESTORNO_TICKET}'`), "voided");
  console.log("PASS 17 ticket void accepts the exact full-fidelity storno already owned by whole-processing reversal");

  await db.exec(`
    insert into public.tickets(id,company_id,status,is_finalized)
    values('${CLOSED_DIRECT_TICKET}','${COMPANY}','finalized',true);
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${PROCESSING_ID}','${CLOSED_DIRECT_TICKET}');
    insert into public.inventory_batches(
      id,company_id,warehouse_id,current_quantity,current_weight_kg,mass_kg,initial_quantity,initial_weight_kg
    ) values('${CLOSED_DIRECT_BATCH}','${COMPANY}','${WAREHOUSE_2}',10,10,10,10,10);
    insert into public.stock_ledger_entries(
      company_id,ticket_id,processing_id,product_id,crop_id,warehouse_id,inventory_batch_id,batch_id_text,
      direction,quantity,uom,delta_qty_signed,mass_kg,reason_type,reason_ref_id,unit_source,unit_contract_version
    ) values('${COMPANY}','${CLOSED_DIRECT_TICKET}','${PROCESSING_ID}','${PRODUCT}','${CROP}','${WAREHOUSE_2}','${CLOSED_DIRECT_BATCH}','${CLOSED_DIRECT_BATCH}',
      'in',10,'kg',10,10,'processing_output_in','${CLOSED_DIRECT_TICKET}','processing.output_net_weight',2);
  `);
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${CLOSED_DIRECT_TICKET}','${ACTOR}','direct closed output void')`),
    /WEIGHBRIDGE_VOID_PROCESSING_CYCLE_REVERSAL_REQUIRED/,
  );
  assert.equal(Number(await scalar(db, `select count(*) from public.stock_ledger_entries where ticket_id='${CLOSED_DIRECT_TICKET}'`)), 1);
  assert.equal(await scalar(db, `select status from public.tickets where id='${CLOSED_DIRECT_TICKET}'`), "finalized");
  console.log("PASS 18 direct output-ticket void after processing close is blocked atomically");

  await db.close();
  console.log("TZ315 TICKET VOID RECONCILE 18/18 PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
