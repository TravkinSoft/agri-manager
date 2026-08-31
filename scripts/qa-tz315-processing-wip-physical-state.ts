import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831085530_tz315_processing_wip_physical_state_handoff_v1.sql",
  import.meta.url,
);
const sourceDebitMigrationUrl = new URL(
  "../supabase/migrations/20260830211041_tz315_processing_output_source_debit_v1.sql",
  import.meta.url,
);

const COMPANY = "31553000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31553000-0000-4000-8000-000000000002";
const ACTOR = "31553000-0000-4000-8100-000000000001";
const SESSION_PERSON = "31553000-0000-4000-8100-000000000002";
const SHIFT = "31553000-0000-4000-8100-000000000003";
const SEASON = "31553000-0000-4000-8200-000000000001";
const LOT = "31553000-0000-4000-8300-000000000001";
const CLEANER = "31553000-0000-4000-8400-000000000001";
const DRYER = "31553000-0000-4000-8400-000000000002";
const CLEANER_UPSTREAM = "31553000-0000-4000-8500-000000000001";
const DRYER_UPSTREAM = "31553000-0000-4000-8500-000000000002";
const CLEANER_TICKET = "31553000-0000-4000-8600-000000000001";
const DRYER_TICKET = "31553000-0000-4000-8600-000000000002";
const STALE_TICKET = "31553000-0000-4000-8600-000000000003";
const CLEANER_LINE = "31553000-0000-4000-8700-000000000001";
const DRYER_LINE = "31553000-0000-4000-8700-000000000002";
const STALE_LINE = "31553000-0000-4000-8700-000000000003";
const STALE_BATCH = "31553000-0000-4000-8800-000000000001";
const STALE_OUTPUT = "31553000-0000-4000-8900-000000000001";
const CLEANER_SOURCE_BATCH = "31553000-0000-4000-8a00-000000000001";
const DRYER_SOURCE_BATCH = "31553000-0000-4000-8a00-000000000002";

async function rows(db: PGlite, sql: string) {
  return (await db.query<Record<string, any>>(sql)).rows;
}

async function scalar(db: PGlite, sql: string) {
  return (await rows(db, sql))[0]?.value;
}

async function asRole<T>(db: PGlite, role: string, action: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await db.exec("reset role");
  }
}

async function closeAndCommit(db: PGlite, ticketId: string) {
  await db.exec("set role authenticated");
  try {
    await db.exec("begin");
    await db.exec(`
      select public.close_processing_output_ticket_atomic_v1(
        '${ticketId}', 'fixture', 20, null, false, 'fixture'
      )
    `);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.exec("reset role");
  }
}

async function expectDeferredSourceDebitReject(
  db: PGlite,
  ticketId: string,
  upstreamId: string,
  mutation: string,
) {
  await db.exec("begin");
  try {
    await db.exec(mutation);
    await db.exec(`
      insert into public.stock_ledger_entries(
        company_id,ticket_id,processing_id,warehouse_id,direction,
        quantity,uom,delta_qty_signed,reason_type,reason_ref_id,
        inventory_batch_id,mass_kg
      )
      select output.company_id,'${ticketId}','${upstreamId}',
             output.warehouse_to_id,'in',output.output_weight_kg,'kg',
             output.output_weight_kg,'processing_output_in','${ticketId}',
             output.output_batch_id,output.output_weight_kg
      from public.batch_transformation_outputs output
      where output.source_ticket_id='${ticketId}'
    `);
    await assert.rejects(
      () => db.exec("commit"),
      /PROCESSING_OUTPUT_SOURCE_TICKET_CONTEXT_MISMATCH/i,
    );
  } finally {
    await db.exec("rollback").catch(() => undefined);
  }
}

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema private;
    create type public.ledger_direction as enum ('in','out');

    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key);
    create table private.weighbridge_operator_sessions(person_id uuid);
    create table public.weighbridge_shifts(id uuid primary key);
    create table public.warehouses(
      id uuid primary key,
      company_id uuid not null,
      place_type text not null,
      archived boolean not null default false,
      is_archived boolean not null default false
    );
    create table public.harvest_lots(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid not null,
      crop_id uuid,
      status text not null default 'active'
    );
    create table public.crop_categories(
      id uuid primary key,
      slug text,
      name_ru text
    );
    create table public.crops(
      id uuid primary key,
      slug text,
      category_id uuid,
      crop_category text,
      category text,
      subcategory text,
      crop_subcategory text
    );
    create table public.tickets(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid,
      status text not null default 'draft',
      is_finalized boolean not null default false,
      is_voided boolean not null default false,
      batch_id uuid,
      source_kind text not null default 'processing_output',
      source_id text,
      processing_output_role text,
      destination_kind text not null default 'warehouse',
      destination_id text,
      warehouse_from_id uuid,
      warehouse_to_id uuid,
      processing_node_id uuid,
      harvest_lot_id uuid,
      source_physical_state text,
      linked_processing_id uuid,
      tare_weight_kg numeric,
      net_weight_kg numeric,
      physical_net_kg numeric,
      accepted_weight_kg numeric,
      explicit_deductions_kg numeric,
      closed_by uuid,
      finalized_by_person_id uuid,
      weighing_2_at timestamptz,
      finalized_at timestamptz,
      audit_json jsonb,
      updated_at timestamptz not null default now()
    );
    create table public.ticket_lines(
      id uuid primary key,
      ticket_id uuid not null,
      company_id uuid not null,
      destination_batch_id uuid,
      batch_id text,
      warehouse_from_id uuid,
      warehouse_to_id uuid,
      net_line_weight_kg numeric,
      quantity_kg numeric,
      mass_kg numeric,
      quantity numeric
    );
    create table public.batch_transformations(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      season_id uuid,
      node_warehouse_id uuid,
      processing_node_id uuid,
      transformation_type text not null,
      processing_method text,
      status text not null default 'draft',
      processing_state text not null default 'in_processing',
      shadow_mode boolean not null default true,
      harvest_lot_id uuid,
      source_physical_state text,
      source_ticket_id uuid
    );
    create table public.inventory_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      season_id uuid,
      source_ticket_id uuid,
      source_transformation_id uuid,
      warehouse_id uuid,
      physical_state text,
      product_id uuid,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      batch_class text,
      current_quantity numeric not null default 0,
      current_weight_kg numeric not null default 0,
      mass_kg numeric not null default 0,
      initial_quantity numeric not null default 0,
      initial_weight_kg numeric not null default 0,
      updated_at timestamptz not null default now()
    );
    create table public.harvest_lot_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      harvest_lot_id uuid not null,
      inventory_batch_id uuid not null
    );
    create table public.batch_transformation_outputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      output_batch_id uuid,
      warehouse_to_id uuid,
      line_type text,
      output_weight_kg numeric,
      output_quality_json jsonb,
      batch_class text,
      source_ticket_id uuid,
      output_role text,
      is_projected_child boolean,
      physical_state text,
      output_type text
    );
    create table public.batch_transformation_inputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      batch_id uuid,
      warehouse_from_id uuid,
      input_weight_kg numeric,
      source_ticket_id uuid,
      source_ticket_line_id uuid,
      node_warehouse_id uuid,
      created_at timestamptz not null default now()
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      ticket_id uuid,
      processing_id uuid,
      product_id uuid,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      batch_id text,
      batch_id_text text,
      batch_class text,
      warehouse_id uuid,
      direction public.ledger_direction,
      quantity numeric,
      uom text,
      delta_qty_signed numeric not null default 0,
      reason_type text not null default 'fixture',
      reason_ref_id uuid,
      occurred_at timestamptz not null default now(),
      created_by uuid,
      inventory_batch_id uuid,
      notes text,
      mass_kg numeric,
      unit_source text,
      unit_contract_version integer,
      is_storno boolean not null default false,
      storno_of_entry_id uuid
    );
    create table private.source_debit_commit_probe(
      ledger_id uuid primary key,
      ticket_id uuid not null,
      upstream_transformation_id uuid not null
    );
    create or replace function private.reconcile_warehouse_local_batch_balance_v1(
      p_batch_id uuid
    )
    returns numeric
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      v_balance numeric;
    begin
      select coalesce(sum(ledger.delta_qty_signed),0) into v_balance
      from public.stock_ledger_entries ledger
      where ledger.inventory_batch_id=p_batch_id;
      update public.inventory_batches
      set current_quantity=v_balance,
          current_weight_kg=v_balance,
          mass_kg=v_balance,
          updated_at=now()
      where id=p_batch_id;
      return v_balance;
    end
    $$;
    create or replace function private.reconcile_harvest_lot_batch_balance_v1(
      p_batch_id uuid
    )
    returns numeric
    language sql
    security definer
    set search_path = ''
    as $$
      select private.reconcile_warehouse_local_batch_balance_v1(p_batch_id)
    $$;
    create unique index uq_tz315_wip_fixture_source_line
      on public.batch_transformation_inputs(source_ticket_line_id)
      where source_ticket_line_id is not null;

    create or replace function private.post_processing_output_source_debit_v1()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $function$
    declare
      v_t public.batch_transformations%rowtype;
      v_ticket public.tickets%rowtype;
    begin
      if new.reason_type<>'processing_output_in'
         or new.direction<>'in'::public.ledger_direction
         or coalesce(new.is_storno,false)
         or new.ticket_id is null
         or new.processing_id is null
      then
        return new;
      end if;
      select * into v_ticket
      from public.tickets tk
      where tk.id=new.ticket_id and tk.company_id=new.company_id;
      select * into v_t
      from public.batch_transformations t
      where t.id=new.processing_id and t.company_id=new.company_id;
      if not found then
        raise exception 'PROCESSING_OUTPUT_SOURCE_CONTEXT_CHANGED';
      end if;
      if v_ticket.linked_processing_id is distinct from v_t.id
         or v_ticket.season_id is distinct from v_t.season_id
      then
        raise exception 'PROCESSING_OUTPUT_SOURCE_TICKET_CONTEXT_MISMATCH' using errcode='23514';
      end if;
      perform 1
      from public.batch_transformation_outputs o
      where o.company_id=new.company_id and o.transformation_id=v_t.id
        and o.source_ticket_id=new.ticket_id;
      if not found then
        raise exception 'PROCESSING_OUTPUT_SOURCE_DOCUMENT_MISMATCH';
      end if;
      insert into private.source_debit_commit_probe(
        ledger_id,ticket_id,upstream_transformation_id
      ) values (new.id,new.ticket_id,v_t.id);
      if not exists (
        select 1 from private.source_debit_commit_probe probe
        where probe.ledger_id=new.id
      ) then
        raise exception 'PROCESSING_OUTPUT_SOURCE_POSTCONDITION';
      end if;
      return new;
    end
    $function$;
    alter function private.post_processing_output_source_debit_v1()
      owner to postgres;
    revoke all on function private.post_processing_output_source_debit_v1()
      from public, anon, authenticated, service_role;
    create constraint trigger trg_processing_output_source_debit_v1
    after insert on public.stock_ledger_entries
    deferrable initially deferred
    for each row execute function private.post_processing_output_source_debit_v1();

    create or replace function public.attach_processing_input_ticket_live_v1(
      p_ticket_id uuid
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      v_ticket public.tickets%rowtype;
      v_line public.ticket_lines%rowtype;
      v_existing uuid;
      v_transformation uuid;
      v_place_type text;
      v_type text;
      v_method text;
    begin
      select * into v_ticket from public.tickets where id=p_ticket_id;
      select transformation_id into v_existing
      from public.batch_transformation_inputs
      where source_ticket_id=p_ticket_id
      order by id
      limit 1;
      if v_existing is not null then
        update public.tickets
        set linked_processing_id=v_existing
        where id=p_ticket_id and linked_processing_id is distinct from v_existing;
        return v_existing;
      end if;

      select place_type into v_place_type
      from public.warehouses
      where id=v_ticket.warehouse_to_id and company_id=v_ticket.company_id;
      v_type := case when v_place_type='CLEANER' then 'cleaning' else 'drying' end;
      v_method := case when v_place_type='CLEANER' then 'CLEANING' else 'MECHANICAL_DRYING' end;
      insert into public.batch_transformations(
        company_id, season_id, node_warehouse_id, processing_node_id,
        transformation_type, processing_method, shadow_mode, harvest_lot_id,
        source_physical_state, source_ticket_id
      ) values (
        v_ticket.company_id, v_ticket.season_id, v_ticket.warehouse_to_id,
        v_ticket.processing_node_id, v_type, v_method, true,
        v_ticket.harvest_lot_id, v_ticket.source_physical_state, v_ticket.id
      ) returning id into v_transformation;

      select * into v_line from public.ticket_lines where ticket_id=p_ticket_id;
      insert into public.batch_transformation_inputs(
        company_id, transformation_id, batch_id, warehouse_from_id,
        input_weight_kg, source_ticket_id, source_ticket_line_id, node_warehouse_id
      ) values (
        v_ticket.company_id, v_transformation, v_line.destination_batch_id,
        v_ticket.warehouse_to_id, v_line.net_line_weight_kg, v_ticket.id,
        v_line.id, v_ticket.warehouse_to_id
      );
      update public.tickets
      set linked_processing_id=v_transformation
      where id=p_ticket_id;
      return v_transformation;
    end
    $$;
    alter function public.attach_processing_input_ticket_live_v1(uuid) owner to postgres;
    revoke all on function public.attach_processing_input_ticket_live_v1(uuid)
      from public, anon, authenticated;
    grant execute on function public.attach_processing_input_ticket_live_v1(uuid)
      to service_role;

    create or replace function public.attach_route_processing_input_ticket_v1(
      p_ticket_id uuid
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      v_place_type text;
      v_crop_slug text;
      v_category_slug text;
      v_category_name text;
      v_subcategory text;
    begin
      select
        upper(coalesce(w.place_type, 'WAREHOUSE')),
        lower(coalesce(c.slug, '')),
        lower(coalesce(cc.slug, '')),
        lower(coalesce(cc.name_ru, c.crop_category, c.category, '')),
        lower(coalesce(c.subcategory, c.crop_subcategory, ''))
      into
        v_place_type,
        v_crop_slug,
        v_category_slug,
        v_category_name,
        v_subcategory
      from public.tickets t
      join public.warehouses w
        on w.id = t.warehouse_to_id
       and w.company_id = t.company_id
      left join public.harvest_lots hl
        on hl.id = t.harvest_lot_id
       and hl.company_id = t.company_id
      left join public.crops c on c.id = hl.crop_id
      left join public.crop_categories cc on cc.id = c.category_id
      where t.id = p_ticket_id;

      if coalesce(v_place_type, 'WAREHOUSE') not in ('DRYER', 'CLEANER') then
        return null;
      end if;

      if v_category_slug = 'vegetable'
         or v_category_name like '%овощ%'
         or v_subcategory in ('tuber', 'root')
         or v_crop_slug in ('potato', 'carrot')
      then
        raise exception using
          errcode = '23514',
          message = 'VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED';
      end if;

      return public.attach_processing_input_ticket_live_v1(p_ticket_id);
    end;
    $$;
    alter function public.attach_route_processing_input_ticket_v1(uuid)
      owner to postgres;
    revoke all on function public.attach_route_processing_input_ticket_v1(uuid)
      from public, anon, authenticated;
    grant execute on function public.attach_route_processing_input_ticket_v1(uuid)
      to service_role;

    create or replace function public.tg_sync_grain_movement_shadow_v1()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $$
    begin
      if new.source_kind='processing_wip'
         and new.linked_processing_id is not null
         and new.is_finalized
         and not new.is_voided
         and new.status='finalized'
      then
        perform public.attach_route_processing_input_ticket_v1(new.id);
      end if;
      return new;
    end
    $$;
    alter function public.tg_sync_grain_movement_shadow_v1() owner to postgres;
    revoke all on function public.tg_sync_grain_movement_shadow_v1()
      from public, anon, authenticated, service_role;
    grant execute on function public.tg_sync_grain_movement_shadow_v1()
      to service_role;
    create trigger trg_tickets_grain_movement_shadow_v1
    after update on public.tickets
    for each row execute function public.tg_sync_grain_movement_shadow_v1();

    create or replace function public.close_processing_output_ticket_atomic_v1(
      p_ticket_id uuid,
      p_session_token text,
      p_tare_weight_kg numeric,
      p_moisture_percent numeric default null,
      p_tare_variance_confirmed boolean default false,
      p_idempotency_key text default null
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = pg_catalog, public, private, extensions
    as $function$
    declare
      v_actor public.profiles%rowtype;
      v_session private.weighbridge_operator_sessions%rowtype;
      v_shift public.weighbridge_shifts%rowtype;
      v_ticket public.tickets%rowtype;
      v_transformation public.batch_transformations%rowtype;
      v_lot public.harvest_lots%rowtype;
      v_destination public.warehouses%rowtype;
      v_destination_batch public.inventory_batches%rowtype;
      v_role text;
      v_physical_state text;
      v_tare numeric := 20;
      v_net numeric := 100;
      v_remaining_before numeric := 100;
    begin
      select * into v_actor from public.profiles limit 1;
      select * into v_session from private.weighbridge_operator_sessions limit 1;
      select * into v_shift from public.weighbridge_shifts limit 1;
      select * into v_ticket from public.tickets where id=p_ticket_id;
      select * into v_transformation
      from public.batch_transformations where id=v_ticket.linked_processing_id;
      select * into v_lot from public.harvest_lots where id=v_ticket.harvest_lot_id;
      select * into v_destination
      from public.warehouses where id=v_ticket.warehouse_to_id;
      v_role := v_ticket.processing_output_role;
      v_physical_state := case
        when v_role = 'GRAIN' and v_transformation.transformation_type = 'drying'
          then 'AFTER_DRYING'
        when v_role = 'GRAIN' then 'AFTER_CLEANING'
        when v_role in ('SCREENINGS','FEED') then 'SCREENINGS'
        when v_role = 'TRIER_WASTE' then 'TRIER_WASTE'
        else 'OTHER'
      end;

      insert into public.inventory_batches(
        company_id, season_id, source_ticket_id, source_transformation_id,
        warehouse_id, physical_state
      ) values (
        v_ticket.company_id, v_transformation.season_id, v_ticket.id,
        v_transformation.id, v_destination.id, v_physical_state
      ) returning * into v_destination_batch;
      insert into public.harvest_lot_batches(
        company_id, harvest_lot_id, inventory_batch_id
      ) values (
        v_ticket.company_id, v_lot.id, v_destination_batch.id
      );
      update public.ticket_lines
      set destination_batch_id=v_destination_batch.id,
          warehouse_from_id=v_transformation.node_warehouse_id,
          warehouse_to_id=v_destination.id,
          net_line_weight_kg=v_net
      where ticket_id=v_ticket.id;
      insert into public.batch_transformation_outputs(
        company_id, transformation_id, output_batch_id, warehouse_to_id,
        line_type, output_weight_kg, output_quality_json, batch_class,
        source_ticket_id, output_role, is_projected_child, physical_state, output_type
      ) values (
        v_ticket.company_id, v_transformation.id, v_destination_batch.id,
        v_destination.id, 'commodity', v_net, '{}'::jsonb, 'commodity',
        v_ticket.id, v_role, false, v_physical_state, 'main_product'
      );
      insert into public.stock_ledger_entries(
        company_id,ticket_id,processing_id,warehouse_id,direction,
        quantity,uom,delta_qty_signed,reason_type,reason_ref_id,
        inventory_batch_id,mass_kg
      ) values (
        v_ticket.company_id,v_ticket.id,v_transformation.id,v_destination.id,
        'in',v_net,'kg',v_net,'processing_output_in',v_ticket.id,
        v_destination_batch.id,v_net
      );
      perform 1
      from public.batch_transformation_outputs o
      join public.tickets output_ticket
        on output_ticket.id=o.source_ticket_id
       and output_ticket.company_id=o.company_id
      where output_ticket.status::text <> 'voided';

      update public.tickets
      set batch_id = null,
          harvest_lot_id = v_lot.id,
          season_id = v_transformation.season_id,
          source_kind = 'processing_wip',
          source_id = v_transformation.id::text,
          destination_kind = 'warehouse',
          destination_id = v_destination.id::text,
          tare_weight_kg = v_tare,
          net_weight_kg = v_net,
          physical_net_kg = v_net,
          accepted_weight_kg = v_net,
          explicit_deductions_kg = 0,
          status = 'finalized',
          is_finalized = true,
          closed_by = v_actor.id,
          finalized_by_person_id = v_session.person_id,
          weighing_2_at = now(),
          finalized_at = now(),
          audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
            'processing_output_close', jsonb_build_object(
              'contract_version', 'tz297_wip_source_v1',
              'idempotency_key', nullif(btrim(coalesce(p_idempotency_key, '')), ''),
              'transformation_id', v_transformation.id,
              'remaining_before_kg', v_remaining_before,
              'physical_net_kg', v_net,
              'destination_warehouse_id', v_destination.id,
              'destination_batch_id', v_destination_batch.id,
              'operator_person_id', v_session.person_id,
              'shift_id', v_shift.id
            )
          ),
          updated_at = now()
      where id = v_ticket.id;

      return jsonb_build_object(
        'ok', true,
        'ticket_id', v_ticket.id,
        'destination_batch_id', v_destination_batch.id
      );
    end
    $function$;
    alter function public.close_processing_output_ticket_atomic_v1(
      uuid, text, numeric, numeric, boolean, text
    ) owner to postgres;
    revoke all on function public.close_processing_output_ticket_atomic_v1(
      uuid, text, numeric, numeric, boolean, text
    ) from public, anon;
    grant execute on function public.close_processing_output_ticket_atomic_v1(
      uuid, text, numeric, numeric, boolean, text
    ) to authenticated, service_role;

    insert into public.companies values ('${COMPANY}'),('${OTHER_COMPANY}');
    insert into public.profiles values ('${ACTOR}');
    insert into private.weighbridge_operator_sessions values ('${SESSION_PERSON}');
    insert into public.weighbridge_shifts values ('${SHIFT}');
    insert into public.warehouses(id,company_id,place_type) values
      ('${CLEANER}','${COMPANY}','CLEANER'),
      ('${DRYER}','${COMPANY}','DRYER');
    insert into public.harvest_lots(id,company_id,season_id) values
      ('${LOT}','${COMPANY}','${SEASON}');
    insert into public.batch_transformations(
      id,company_id,season_id,node_warehouse_id,transformation_type,
      processing_method,harvest_lot_id,source_physical_state
    ) values
      ('${CLEANER_UPSTREAM}','${COMPANY}','${SEASON}','${CLEANER}',
       'cleaning','CLEANING','${LOT}','SOURCE'),
      ('${DRYER_UPSTREAM}','${COMPANY}','${SEASON}','${DRYER}',
       'drying','MECHANICAL_DRYING','${LOT}','SOURCE');
    insert into public.inventory_batches(
      id,company_id,season_id,warehouse_id,physical_state,batch_class,
      current_quantity,current_weight_kg,mass_kg,
      initial_quantity,initial_weight_kg
    ) values
      ('${CLEANER_SOURCE_BATCH}','${COMPANY}','${SEASON}','${CLEANER}',
       'SOURCE','commodity',100,100,100,100,100),
      ('${DRYER_SOURCE_BATCH}','${COMPANY}','${SEASON}','${DRYER}',
       'SOURCE','commodity',100,100,100,100,100);
    insert into public.batch_transformation_inputs(
      company_id,transformation_id,batch_id,warehouse_from_id,
      input_weight_kg,node_warehouse_id,created_at
    ) values
      ('${COMPANY}','${CLEANER_UPSTREAM}','${CLEANER_SOURCE_BATCH}',
       '${CLEANER}',100,'${CLEANER}','2026-08-31'),
      ('${COMPANY}','${DRYER_UPSTREAM}','${DRYER_SOURCE_BATCH}',
       '${DRYER}',100,'${DRYER}','2026-08-31');
    insert into public.stock_ledger_entries(
      company_id,warehouse_id,direction,quantity,uom,delta_qty_signed,
      reason_type,inventory_batch_id,mass_kg
    ) values
      ('${COMPANY}','${CLEANER}','in',100,'kg',100,'harvest_in',
       '${CLEANER_SOURCE_BATCH}',100),
      ('${COMPANY}','${DRYER}','in',100,'kg',100,'harvest_in',
       '${DRYER_SOURCE_BATCH}',100);
    insert into public.tickets(
      id,company_id,season_id,source_kind,processing_output_role,
      destination_kind,warehouse_from_id,warehouse_to_id,harvest_lot_id,
      source_physical_state,linked_processing_id,audit_json
    ) values
      ('${CLEANER_TICKET}','${COMPANY}','${SEASON}','processing_output','GRAIN',
       'warehouse','${CLEANER}','${DRYER}','${LOT}','SOURCE',
       '${CLEANER_UPSTREAM}','{}'::jsonb),
      ('${DRYER_TICKET}','${COMPANY}','${SEASON}','processing_output','GRAIN',
       'warehouse','${DRYER}','${CLEANER}','${LOT}','SOURCE',
       '${DRYER_UPSTREAM}','{}'::jsonb);
    insert into public.ticket_lines(
      id,ticket_id,company_id,warehouse_from_id,warehouse_to_id,
      net_line_weight_kg
    ) values
      ('${CLEANER_LINE}','${CLEANER_TICKET}','${COMPANY}',
       '${CLEANER}','${DRYER}',100),
      ('${DRYER_LINE}','${DRYER_TICKET}','${COMPANY}',
       '${DRYER}','${CLEANER}',100);
  `);

  const sourceDebitMigration = await readFile(sourceDebitMigrationUrl, "utf8");
  const sourceDebitStart = sourceDebitMigration.indexOf(
    "create or replace function private.post_processing_output_source_debit_v1()",
  );
  const sourceDebitEndMarker = "\n$function$;";
  const sourceDebitEnd = sourceDebitMigration.indexOf(
    sourceDebitEndMarker,
    sourceDebitStart,
  );
  assert.ok(sourceDebitStart >= 0 && sourceDebitEnd > sourceDebitStart);
  await db.exec(sourceDebitMigration.slice(
    sourceDebitStart,
    sourceDebitEnd + sourceDebitEndMarker.length,
  ));
  await db.exec(`
    alter function private.post_processing_output_source_debit_v1()
      owner to postgres;
    revoke all on function private.post_processing_output_source_debit_v1()
      from public, anon, authenticated, service_role;
  `);
}

async function main() {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /bb9bcaee449556b065767b6885c4a4f7/);
  assert.match(migration, /e531c4ed2fd93776ca4136867f58716f/);
  assert.match(migration, /TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1/);
  assert.match(migration, /TZ315_PROCESSING_WIP_PHYSICAL_STATE_ROUTE_GUARD_V1/);
  assert.match(migration, /TZ315_PROCESSING_WIP_SOURCE_DEBIT_DOWNSTREAM_V1/);
  assert.match(migration, /PROCESSING_WIP_PHYSICAL_STATE_MISMATCH/);
  assert.match(migration, /c9de372f5c7e19dbe5bfb70003aaa685/);
  assert.match(migration, /b2a51d601f4f7cb18d2eb44fab3726a1/);
  assert.match(migration, /6835a7bd2b7742886c82232a361b3f70/);
  assert.match(migration, /06faea79fabc74d7e4f9440bd6cea749/);
  assert.match(migration, /0187db7dfb3b6db3cd4950cc0571dc65/);
  assert.match(migration, /e59b8782c4b0ddc873dbdd45bf3d7af9/);
  assert.doesNotMatch(migration, /\b(?:delete\s+from|truncate|drop\s+table)\b/i);

  const db = new PGlite();
  await bootstrap(db);
  await db.exec(migration);
  await db.exec(migration);

  const closeContract = (await rows(db, `
    select pg_get_userbyid(proc.proowner) owner,
           proc.prosecdef security_definer,
           proc.proconfig,
           has_function_privilege('anon',proc.oid,'EXECUTE') anon_execute,
           has_function_privilege('authenticated',proc.oid,'EXECUTE') authenticated_execute,
           has_function_privilege('service_role',proc.oid,'EXECUTE') service_execute,
           pg_get_functiondef(proc.oid) definition
    from pg_proc proc
    where proc.oid =
      'public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)'::regprocedure
  `))[0];
  assert.equal(closeContract.owner, "postgres");
  assert.equal(closeContract.security_definer, true);
  assert.deepEqual(
    closeContract.proconfig,
    ["search_path=pg_catalog, public, private, extensions"],
  );
  assert.equal(closeContract.anon_execute, false);
  assert.equal(closeContract.authenticated_execute, true);
  assert.equal(closeContract.service_execute, true);
  assert.match(closeContract.definition, /TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1/);
  assert.match(closeContract.definition, /source_physical_state = v_physical_state/);

  const sourceDebitContract = (await rows(db, `
    select pg_get_userbyid(proc.proowner) owner,
           proc.prosecdef security_definer,
           proc.proconfig,
           has_function_privilege('anon',proc.oid,'EXECUTE') anon_execute,
           has_function_privilege('authenticated',proc.oid,'EXECUTE') authenticated_execute,
           has_function_privilege('service_role',proc.oid,'EXECUTE') service_execute,
           pg_get_functiondef(proc.oid) definition,
           trigger_row.tgdeferrable,
           trigger_row.tginitdeferred
    from pg_proc proc
    join pg_trigger trigger_row
      on trigger_row.tgfoid=proc.oid
     and trigger_row.tgname='trg_processing_output_source_debit_v1'
    where proc.oid='private.post_processing_output_source_debit_v1()'::regprocedure
  `))[0];
  assert.equal(sourceDebitContract.owner, "postgres");
  assert.equal(sourceDebitContract.security_definer, true);
  assert.deepEqual(sourceDebitContract.proconfig, ['search_path=""']);
  assert.equal(sourceDebitContract.anon_execute, false);
  assert.equal(sourceDebitContract.authenticated_execute, false);
  assert.equal(sourceDebitContract.service_execute, false);
  assert.equal(sourceDebitContract.tgdeferrable, true);
  assert.equal(sourceDebitContract.tginitdeferred, true);
  assert.match(
    sourceDebitContract.definition,
    /TZ315_PROCESSING_WIP_SOURCE_DEBIT_DOWNSTREAM_V1/,
  );

  for (const scenario of [
    { ticket: CLEANER_TICKET, expected: "AFTER_CLEANING" },
    { ticket: DRYER_TICKET, expected: "AFTER_DRYING" },
  ]) {
    await closeAndCommit(db, scenario.ticket);
    const graph = (await rows(db, `
      select ticket.source_physical_state ticket_state,
             output.physical_state output_state,
             batch.physical_state batch_state,
             downstream.source_physical_state downstream_state,
             input.batch_id::text input_batch,
             output.output_batch_id::text output_batch
      from public.tickets ticket
      join public.batch_transformation_outputs output
        on output.source_ticket_id=ticket.id
      join public.inventory_batches batch
        on batch.id=output.output_batch_id
      join public.batch_transformations downstream
        on downstream.id=ticket.linked_processing_id
      join public.batch_transformation_inputs input
        on input.transformation_id=downstream.id
       and input.source_ticket_id=ticket.id
      where ticket.id='${scenario.ticket}'
    `))[0];
    assert.deepEqual(
      [
        graph.ticket_state,
        graph.output_state,
        graph.batch_state,
        graph.downstream_state,
      ],
      [scenario.expected, scenario.expected, scenario.expected, scenario.expected],
    );
    assert.equal(graph.input_batch, graph.output_batch);
  }

  assert.equal(
    Number(await scalar(db, `
      select count(*) value
      from public.stock_ledger_entries
      where reason_type='processing_output_source_out'
        and not is_storno
    `)),
    2,
  );
  const cleanerDownstream = String(await scalar(db, `
    select linked_processing_id::text value
    from public.tickets where id='${CLEANER_TICKET}'
  `));
  await expectDeferredSourceDebitReject(
    db,
    CLEANER_TICKET,
    CLEANER_UPSTREAM,
    `update public.batch_transformation_inputs
     set transformation_id='${CLEANER_UPSTREAM}'
     where source_ticket_id='${CLEANER_TICKET}'`,
  );
  await expectDeferredSourceDebitReject(
    db,
    CLEANER_TICKET,
    CLEANER_UPSTREAM,
    `update public.batch_transformation_inputs
     set company_id='${OTHER_COMPANY}'
     where source_ticket_id='${CLEANER_TICKET}'`,
  );
  await expectDeferredSourceDebitReject(
    db,
    CLEANER_TICKET,
    CLEANER_UPSTREAM,
    `update public.batch_transformation_outputs
     set output_batch_id=gen_random_uuid()
     where source_ticket_id='${CLEANER_TICKET}'`,
  );
  await expectDeferredSourceDebitReject(
    db,
    CLEANER_TICKET,
    CLEANER_UPSTREAM,
    `update public.batch_transformations
     set processing_method='NATURAL_DRYING'
     where id='${cleanerDownstream}'`,
  );
  assert.equal(
    String(await scalar(db, `
      select linked_processing_id::text value
      from public.tickets where id='${CLEANER_TICKET}'
    `)),
    cleanerDownstream,
  );

  await db.exec(`
    insert into public.inventory_batches(
      id,company_id,season_id,source_ticket_id,source_transformation_id,
      warehouse_id,physical_state
    ) values (
      '${STALE_BATCH}','${COMPANY}','${SEASON}','${STALE_TICKET}',
      '${CLEANER_UPSTREAM}','${DRYER}','AFTER_CLEANING'
    );
    insert into public.harvest_lot_batches(
      company_id,harvest_lot_id,inventory_batch_id
    ) values ('${COMPANY}','${LOT}','${STALE_BATCH}');
    insert into public.tickets(
      id,company_id,season_id,status,is_finalized,is_voided,batch_id,
      source_kind,source_id,processing_output_role,destination_kind,
      warehouse_from_id,warehouse_to_id,harvest_lot_id,
      source_physical_state,linked_processing_id,net_weight_kg,audit_json
    ) values (
      '${STALE_TICKET}','${COMPANY}','${SEASON}','finalized',true,false,null,
      'processing_wip','${CLEANER_UPSTREAM}','GRAIN','warehouse',
      '${CLEANER}','${DRYER}','${LOT}','SOURCE','${CLEANER_UPSTREAM}',100,
      '{}'::jsonb
    );
    insert into public.ticket_lines(
      id,ticket_id,company_id,destination_batch_id,warehouse_from_id,
      warehouse_to_id,net_line_weight_kg
    ) values (
      '${STALE_LINE}','${STALE_TICKET}','${COMPANY}','${STALE_BATCH}',
      '${CLEANER}','${DRYER}',100
    );
    insert into public.batch_transformation_outputs(
      id,company_id,transformation_id,output_batch_id,warehouse_to_id,
      line_type,output_weight_kg,batch_class,source_ticket_id,output_role,
      is_projected_child,physical_state,output_type
    ) values (
      '${STALE_OUTPUT}','${COMPANY}','${CLEANER_UPSTREAM}','${STALE_BATCH}',
      '${DRYER}','commodity',100,'commodity','${STALE_TICKET}','GRAIN',
      false,'AFTER_CLEANING','main_product'
    );
  `);
  await assert.rejects(
    () => asRole(db, "service_role", () => db.exec(`
      select public.attach_route_processing_input_ticket_v1('${STALE_TICKET}')
    `)),
    /PROCESSING_WIP_PHYSICAL_STATE_MISMATCH/i,
  );
  await db.exec(`
    update public.inventory_batches
    set physical_state='SOURCE'
    where id='${STALE_BATCH}';
    update public.batch_transformation_outputs
    set physical_state='SOURCE'
    where id='${STALE_OUTPUT}';
  `);
  await assert.rejects(
    () => asRole(db, "service_role", () => db.exec(`
      select public.attach_route_processing_input_ticket_v1('${STALE_TICKET}')
    `)),
    /PROCESSING_WIP_PHYSICAL_STATE_MISMATCH/i,
  );
  assert.equal(
    Number(await scalar(db, `
      select count(*) value
      from public.batch_transformation_inputs
      where source_ticket_id='${STALE_TICKET}'
    `)),
    0,
  );

  await db.exec("begin");
  await db.exec(`
    do $mutation$
    declare
      v_definition text;
    begin
      select pg_get_functiondef(
        'public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)'::regprocedure
      ) into v_definition;
      execute replace(
        v_definition,
        'updated_at = now()',
        'updated_at = statement_timestamp()'
      );
    end
    $mutation$
  `);
  await assert.rejects(
    () => db.exec(migration),
    /TZ315_WIP_PHYSICAL_STATE_REPEAT_STATE_INVALID/i,
  );
  await db.exec("rollback");
  await db.exec(migration);

  await db.exec("begin");
  await db.exec(`
    do $mutation$
    declare
      v_definition text;
    begin
      select pg_get_functiondef(
        'private.post_processing_output_source_debit_v1()'::regprocedure
      ) into v_definition;
      execute replace(
        v_definition,
        'begin',
        E'begin\\n  return new;'
      );
    end
    $mutation$
  `);
  await assert.rejects(
    () => db.exec(migration),
    /TZ315_WIP_SOURCE_DEBIT_REPEAT_HASH_MISMATCH/i,
  );
  await db.exec("rollback");
  await db.exec(migration);

  await db.exec("begin");
  await db.exec(`
    do $mutation$
    declare
      v_definition text;
    begin
      select pg_get_functiondef(
        'public.attach_route_processing_input_ticket_v1(uuid)'::regprocedure
      ) into v_definition;
      execute replace(
        v_definition,
        'begin',
        E'begin\\n  return public.attach_processing_input_ticket_live_v1(p_ticket_id);'
      );
    end
    $mutation$
  `);
  await assert.rejects(
    () => db.exec(migration),
    /TZ315_WIP_PHYSICAL_STATE_ROUTE_REPEAT_STATE_INVALID/i,
  );
  await db.exec("rollback");
  await db.exec(migration);

  console.log("TZ315 PROCESSING WIP PHYSICAL STATE: PASS");
  console.log(JSON.stringify({
    close_patch_repeat_safe: true,
    cleaner_source_to_after_cleaning: "PASS",
    dryer_source_to_after_drying: "PASS",
    stale_source_attach: "BLOCKED",
    deferred_source_debit_commit: "PASS",
    crosswire_foreign_corrupt: "BLOCKED",
    full_hash_bypass_mutations: "BLOCKED",
    metadata_and_acl: "PASS",
    no_business_backfill: true,
  }, null, 2));
  await db.close();
}

main().catch((error) => {
  console.error("TZ315 PROCESSING WIP PHYSICAL STATE: FAIL");
  console.error(error);
  process.exitCode = 1;
});
