import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830211041_tz315_processing_output_source_debit_v1.sql",
  import.meta.url,
);

const scalar = async (db: PGlite, sql: string) =>
  Object.values(((await db.query(sql)).rows[0] ?? {}) as Record<string, unknown>)[0];

export async function bootstrapProcessingSourceDebit(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema private;
    create type public.ledger_direction as enum ('in','out');
    create table public.batch_transformations(
      id uuid primary key, company_id uuid not null, processing_state text not null,
      status text not null, shadow_mode boolean default true,
      season_id uuid, harvest_lot_id uuid, source_physical_state text,
      transformation_type text default 'drying',
      input_weight_total_kg numeric, output_weight_total_kg numeric,
      input_moisture_percent numeric, output_moisture_percent numeric,
      input_moisture_coverage_kg numeric, output_moisture_coverage_kg numeric,
      mass_difference_kg numeric, unexplained_variance_kg numeric,
      shadow_status text, updated_at timestamptz default now()
    );
    create table public.tickets(
      id uuid primary key, company_id uuid not null, status text not null default 'finalized',
      is_voided boolean not null default false, is_finalized boolean not null default true,
      linked_processing_id uuid, season_id uuid, updated_at timestamptz default now()
    );
    create table public.field_material_consumptions(
      id uuid primary key default gen_random_uuid(), ticket_id uuid, notes text,
      updated_at timestamptz default now()
    );
    create table public.inventory_batches(
      id uuid primary key, company_id uuid not null, warehouse_id uuid not null,
      season_id uuid,
      product_id uuid, crop_id uuid, variety_id uuid, reproduction_id uuid,
      batch_class text, current_quantity numeric default 0, current_weight_kg numeric default 0,
      mass_kg numeric default 0, initial_quantity numeric default 0,
      initial_weight_kg numeric default 0, updated_at timestamptz default now()
    );
    create table public.batch_transformation_inputs(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      transformation_id uuid not null, batch_id uuid not null,
      warehouse_from_id uuid not null, input_weight_kg numeric not null,
      moisture_percent numeric,
      created_at timestamptz default now()
    );
    create table public.batch_transformation_outputs(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      transformation_id uuid not null, output_batch_id uuid, warehouse_to_id uuid,
      output_type text not null, output_weight_kg numeric not null,
      moisture_percent numeric, source_ticket_id uuid, physical_state text,
      activated_at timestamptz, created_at timestamptz default now()
    );
    create table public.batch_transformation_losses(
      id uuid primary key default gen_random_uuid(),transformation_id uuid not null,
      loss_type text not null,qty_kg numeric not null
    );
    create table public.harvest_lot_batches(inventory_batch_id uuid primary key);
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      ticket_id uuid, processing_id uuid, product_id uuid, crop_id uuid,
      variety_id uuid, reproduction_id uuid, batch_id text, batch_id_text text,
      batch_class text, warehouse_id uuid not null, direction public.ledger_direction not null,
      quantity numeric not null, uom text, delta_qty_signed numeric not null,
      reason_type text not null, reason_ref_id uuid, occurred_at timestamptz default now(),
      created_by uuid, inventory_batch_id uuid, notes text, mass_kg numeric,
      unit_source text, unit_contract_version integer, is_storno boolean default false,
      storno_of_entry_id uuid
    );
    create or replace function private.reconcile_warehouse_local_batch_balance_v1(p_batch_id uuid)
    returns numeric language plpgsql security definer set search_path='' as $$
    declare v_balance numeric;
    begin
      select coalesce(sum(s.delta_qty_signed),0) into v_balance
      from public.stock_ledger_entries s where s.inventory_batch_id=p_batch_id;
      update public.inventory_batches set current_quantity=v_balance,current_weight_kg=v_balance,
        mass_kg=v_balance,updated_at=now() where id=p_batch_id;
      return v_balance;
    end $$;
    create or replace function private.reconcile_harvest_lot_batch_balance_v1(p_batch_id uuid)
    returns numeric language sql security definer set search_path='' as $$
      select private.reconcile_warehouse_local_batch_balance_v1(p_batch_id)
    $$;
    create or replace function private.processing_reversal_blockers_v1(p_transformation_id uuid)
    returns jsonb language sql stable security definer set search_path='' as $$
      with transformation as (
        select t.id,t.company_id from public.batch_transformations t where t.id=p_transformation_id
      ),
      output_tickets as (
        select distinct o.source_ticket_id as ticket_id
        from public.batch_transformation_outputs o
        join transformation t on t.id=o.transformation_id and t.company_id=o.company_id
        where o.source_ticket_id is not null
      ),
      output_batches as (
        select distinct o.output_batch_id as batch_id
        from public.batch_transformation_outputs o
        join transformation t on t.id=o.transformation_id and t.company_id=o.company_id
        where o.output_batch_id is not null
        union
        select i.batch_id from public.batch_transformation_inputs i join transformation t on t.id=i.transformation_id
      )
      select jsonb_build_object(
        'ticket_count',(select count(*) from output_tickets),
        'batch_count',(select count(*) from output_batches)
      )
    $$;
    create or replace function public.close_processing_output_ticket_atomic_v1(
      p_ticket_id uuid,p_lock_token text,p_tare_weight numeric,p_moisture_percent numeric,
      p_manual_weight boolean,p_idempotency_key text
    ) returns jsonb language plpgsql as $$
    declare v_ticket public.tickets%rowtype; v_transformation public.batch_transformations%rowtype;
      v_stock_output_kg numeric;
    begin
      select * into v_ticket from public.tickets where id=p_ticket_id;
      select * into v_transformation from public.batch_transformations where id=v_ticket.linked_processing_id;
      select round(coalesce(sum(output_weight_kg) filter (
        where output_type in ('main_product','byproduct','stock_waste')
      ), 0), 3)
      into v_stock_output_kg
      from public.batch_transformation_outputs
      where company_id = v_ticket.company_id
        and transformation_id = v_transformation.id;
      select round(coalesce(sum(output_weight_kg) filter (
        where output_type in ('main_product','byproduct','stock_waste')
      ), 0), 3)
      into v_stock_output_kg
      from public.batch_transformation_outputs
      where company_id = v_ticket.company_id and transformation_id = v_transformation.id;
      return jsonb_build_object('sum',v_stock_output_kg);
    end $$;
    create or replace function public.reverse_processing_material_balance_v1(
      p_transformation_id uuid,p_company_id uuid,p_season_id uuid,p_actor_user_id uuid,
      p_reason text,p_idempotency_key text,p_audit_run_code text default null
    ) returns jsonb language plpgsql as $$
    declare v_t public.batch_transformations%rowtype;
    begin
      select * into v_t from public.batch_transformations where id=p_transformation_id;
      if exists (
        select 1 from public.batch_transformation_outputs o
        left join public.tickets tk on tk.id = o.source_ticket_id
        where o.transformation_id = v_t.id
          and o.output_type in ('main_product','byproduct','stock_waste')
          and coalesce(o.output_weight_kg, 0) > 0
          and (
            o.source_ticket_id is null
            or 1 <> (
              select count(*)
              from public.stock_ledger_entries sle
              where not coalesce(sle.is_storno, false)
                and sle.ticket_id = o.source_ticket_id
            )
          )
      ) or abs(
        coalesce((select sum(l.qty_kg) from public.batch_transformation_losses l
          where l.transformation_id=v_t.id and l.loss_type<>'moisture_loss'),0)
        - coalesce((select sum(-sle.delta_qty_signed) from public.stock_ledger_entries sle
          where sle.processing_id=v_t.id and sle.ticket_id is null
            and not coalesce(sle.is_storno,false)
            and sle.reason_type='processing_loss'
            and sle.direction='out'::public.ledger_direction),0)
      ) > 0.001 then raise exception 'trace'; end if;
      return '{}'::jsonb;
    end $$;
    create or replace function public.void_ticket_with_storno_v2(
      p_ticket_id uuid,p_actor_user_id uuid,p_reason text
    ) returns uuid language plpgsql as $$
    declare
      v_ticket public.tickets%rowtype;
      v_entry public.stock_ledger_entries%rowtype;
      v_actor_role text;
      v_reconcile_batch_id uuid;
    begin
      -- WEIGHBRIDGE_VOID_PROCESSING_CYCLE
      select * into v_ticket from public.tickets where id=p_ticket_id for update;
      if v_ticket.is_voided or v_ticket.status = 'voided' then
        return p_ticket_id;
      end if;
      if v_ticket.linked_processing_id is not null
         and exists(select 1 from public.batch_transformation_outputs o
           where o.transformation_id=v_ticket.linked_processing_id
             and o.company_id=v_ticket.company_id and o.source_ticket_id=v_ticket.id)
         and exists(select 1 from public.stock_ledger_entries base
           where base.ticket_id=v_ticket.id and not coalesce(base.is_storno,false)
             and not exists(select 1 from public.stock_ledger_entries reversal
               where reversal.storno_of_entry_id=base.id))
      then
        raise exception 'PROCESSING_OUTPUT_CYCLE_REVERSAL_REQUIRED' using errcode='23514';
      end if;
      for v_entry in select * from public.stock_ledger_entries
        where ticket_id=p_ticket_id and not coalesce(is_storno,false)
      loop
        if exists(select 1 from public.stock_ledger_entries where storno_of_entry_id=v_entry.id) then
          continue;
        end if;
        insert into public.stock_ledger_entries(
          company_id,ticket_id,processing_id,product_id,warehouse_id,direction,quantity,uom,
          delta_qty_signed,reason_type,reason_ref_id,inventory_batch_id,is_storno,storno_of_entry_id
        ) values(
          v_entry.company_id,v_entry.ticket_id,v_entry.processing_id,v_entry.product_id,v_entry.warehouse_id,
          case when v_entry.direction='in' then 'out'::public.ledger_direction else 'in'::public.ledger_direction end,
          v_entry.quantity,v_entry.uom,-v_entry.delta_qty_signed,'storno_'||v_entry.reason_type,
          v_entry.reason_ref_id,v_entry.inventory_batch_id,true,v_entry.id
        );
      end loop;

      for v_reconcile_batch_id in
        select distinct inventory_batch_id from public.stock_ledger_entries
        where ticket_id=p_ticket_id and not coalesce(is_storno,false)
          and inventory_batch_id is not null
      loop
        if exists(select 1 from public.harvest_lot_batches where inventory_batch_id=v_reconcile_batch_id) then
          perform private.reconcile_harvest_lot_batch_balance_v1(v_reconcile_batch_id);
        else
          perform private.reconcile_warehouse_local_batch_balance_v1(v_reconcile_batch_id);
        end if;
      end loop;

      update public.field_material_consumptions set notes=p_reason,updated_at=now()
      where ticket_id=p_ticket_id;
      update public.tickets set is_voided=true,status='voided',updated_at=now() where id=p_ticket_id;
      return p_ticket_id;
    end $$;
  `);
}

async function seedOutput(db: PGlite, ticket: string, output: string) {
  await db.exec(`
    begin;
    insert into public.tickets(id,company_id,linked_processing_id,season_id) values(
      '${ticket}','31510000-0000-4000-8000-000000000001','31510000-0000-4000-8000-000000000010',
      '31510000-0000-4000-8000-000000000002'
    );
    insert into public.batch_transformation_outputs(
      company_id,transformation_id,output_batch_id,warehouse_to_id,output_type,output_weight_kg,source_ticket_id
    ) values (
      '31510000-0000-4000-8000-000000000001','31510000-0000-4000-8000-000000000010',
      '${output}','31510000-0000-4000-8000-000000000031','main_product',26050,'${ticket}'
    );
    insert into public.stock_ledger_entries(
      company_id,ticket_id,processing_id,product_id,warehouse_id,direction,quantity,uom,
      delta_qty_signed,reason_type,reason_ref_id,inventory_batch_id,mass_kg
    ) values (
      '31510000-0000-4000-8000-000000000001','${ticket}',
      '31510000-0000-4000-8000-000000000010','31510000-0000-4000-8000-000000000041',
      '31510000-0000-4000-8000-000000000031','in',26050,'kg',26050,
      'processing_output_in','${ticket}','${output}',26050
    );
    commit;
  `);
}

async function main() {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  await bootstrapProcessingSourceDebit(db);
  await db.exec(migration);
  await db.exec(migration);

  await db.exec(`
    insert into public.batch_transformations(id,company_id,processing_state,status,season_id) values(
      '31510000-0000-4000-8000-000000000010','31510000-0000-4000-8000-000000000001',
      'in_processing','completed','31510000-0000-4000-8000-000000000002'
    );
    insert into public.inventory_batches(
      id,company_id,warehouse_id,season_id,product_id,batch_class,current_quantity,current_weight_kg,mass_kg
    ) values
      ('31510000-0000-4000-8000-000000000011','31510000-0000-4000-8000-000000000001',
       '31510000-0000-4000-8000-000000000021','31510000-0000-4000-8000-000000000002','31510000-0000-4000-8000-000000000041','commodity',10000,10000,10000),
      ('31510000-0000-4000-8000-000000000012','31510000-0000-4000-8000-000000000001',
       '31510000-0000-4000-8000-000000000021','31510000-0000-4000-8000-000000000002','31510000-0000-4000-8000-000000000041','commodity',17000,17000,17000),
      ('31510000-0000-4000-8000-000000000013','31510000-0000-4000-8000-000000000001',
       '31510000-0000-4000-8000-000000000031','31510000-0000-4000-8000-000000000002','31510000-0000-4000-8000-000000000041','commodity',0,0,0),
      ('31510000-0000-4000-8000-000000000014','31510000-0000-4000-8000-000000000001',
       '31510000-0000-4000-8000-000000000031','31510000-0000-4000-8000-000000000002','31510000-0000-4000-8000-000000000041','commodity',0,0,0);
    insert into public.batch_transformation_inputs(company_id,transformation_id,batch_id,warehouse_from_id,input_weight_kg,created_at)
    values
      ('31510000-0000-4000-8000-000000000001','31510000-0000-4000-8000-000000000010',
       '31510000-0000-4000-8000-000000000011','31510000-0000-4000-8000-000000000021',10000,'2026-08-30'),
      ('31510000-0000-4000-8000-000000000001','31510000-0000-4000-8000-000000000010',
       '31510000-0000-4000-8000-000000000012','31510000-0000-4000-8000-000000000021',17000,'2026-08-31');
    insert into public.stock_ledger_entries(company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,inventory_batch_id)
    values
      ('31510000-0000-4000-8000-000000000001','31510000-0000-4000-8000-000000000041',
       '31510000-0000-4000-8000-000000000021','in',10000,'kg',10000,'harvest_in','31510000-0000-4000-8000-000000000011'),
      ('31510000-0000-4000-8000-000000000001','31510000-0000-4000-8000-000000000041',
       '31510000-0000-4000-8000-000000000021','in',17000,'kg',17000,'harvest_in','31510000-0000-4000-8000-000000000012');
  `);

  await seedOutput(db, "31510000-0000-4000-8000-000000000101", "31510000-0000-4000-8000-000000000013");
  assert.equal(Number(await scalar(db, `select sum(-delta_qty_signed) from public.stock_ledger_entries where reason_type='processing_output_source_out' and not is_storno`)), 26050);
  assert.equal(Number(await scalar(db, `select current_quantity from public.inventory_batches where id='31510000-0000-4000-8000-000000000011'`)), 0);
  assert.equal(Number(await scalar(db, `select current_quantity from public.inventory_batches where id='31510000-0000-4000-8000-000000000012'`)), 950);

  await assert.rejects(
    db.query(`select public.void_ticket_with_storno_v2($1,$2,$3)`, [
      "31510000-0000-4000-8000-000000000101",
      "31510000-0000-4000-8000-000000000099",
      "direct output void must be blocked",
    ]),
    /PROCESSING_OUTPUT_CYCLE_REVERSAL_REQUIRED/,
  );
  await db.exec(`
    insert into public.stock_ledger_entries(
      company_id,ticket_id,processing_id,product_id,warehouse_id,direction,quantity,uom,
      delta_qty_signed,reason_type,reason_ref_id,inventory_batch_id,is_storno,storno_of_entry_id
    )
    select company_id,ticket_id,processing_id,product_id,warehouse_id,
      case when direction='in' then 'out'::public.ledger_direction else 'in'::public.ledger_direction end,
      quantity,uom,-delta_qty_signed,'storno_'||reason_type,reason_ref_id,inventory_batch_id,true,id
    from public.stock_ledger_entries
    where ticket_id='31510000-0000-4000-8000-000000000101' and not is_storno;
    select public.void_ticket_with_storno_v2(
      '31510000-0000-4000-8000-000000000101',
      '31510000-0000-4000-8000-000000000099','whole cycle reversal'
    );
  `);
  await db.query(`select public.recompute_grain_processing_shadow_v1($1)`, [
    "31510000-0000-4000-8000-000000000010",
  ]);
  assert.equal(Number(await scalar(db, `select output_weight_total_kg from public.batch_transformations where id='31510000-0000-4000-8000-000000000010'`)), 0);
  assert.equal(Number(await scalar(db, `select current_quantity from public.inventory_batches where id='31510000-0000-4000-8000-000000000011'`)), 10000);
  assert.equal(Number(await scalar(db, `select current_quantity from public.inventory_batches where id='31510000-0000-4000-8000-000000000012'`)), 17000);
  assert.equal(Number(await scalar(db, `
    select sum(-delta_qty_signed) from public.stock_ledger_entries
    where processing_id='31510000-0000-4000-8000-000000000010'
      and (
        reason_type='processing_output_source_out'
        or storno_of_entry_id in (
          select id from public.stock_ledger_entries where reason_type='processing_output_source_out'
        )
      )
  `)), 0);
  const closeDefinition = String(await scalar(db, `select pg_get_functiondef('public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)'::regprocedure)`));
  assert.equal((closeDefinition.match(/output_ticket\.status::text <> 'voided'/g) || []).length, 2);
  const reverseDefinition = String(await scalar(db, `select pg_get_functiondef('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure)`));
  assert.match(reverseDefinition, /processing_output_ticket_trace_valid_v2/);
  assert.match(reverseDefinition, /processing_moisture_loss/);
  const voidDefinition = String(await scalar(db, `select pg_get_functiondef('public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure)`));
  assert.match(voidDefinition, /WEIGHBRIDGE_VOID_PROCESSING_CYCLE/);
  assert.match(voidDefinition, /PROCESSING_OUTPUT_CYCLE_REVERSAL_REQUIRED/);
  assert.equal(Number(await scalar(db, `select count(*) from pg_trigger where tgname='trg_processing_output_source_debit_v1' and not tgisinternal`)), 1);
  console.log("TZ315 PROCESSING SOURCE DEBIT: PASS");
  await db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("TZ315 PROCESSING SOURCE DEBIT: FAIL");
    console.error(error);
    process.exitCode = 1;
  });
}
