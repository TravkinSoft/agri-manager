import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260908165627_p0_weighbridge_harvest_correction_atomic.sql",
  import.meta.url,
);
const finalizeRouteUrl = new URL(
  "../app/api/weighbridge/tickets/[id]/finalize/route.ts",
  import.meta.url,
);

const COMPANY = "90000000-0000-4000-8000-000000000001";
const ACTOR = "90000000-0000-4000-8000-000000000002";
const PERSON = "90000000-0000-4000-8000-000000000003";
const SHIFT = "90000000-0000-4000-8000-000000000004";
const PRODUCT = "90000000-0000-4000-8000-000000000005";
const CROP = "90000000-0000-4000-8000-000000000006";
const VARIETY = "90000000-0000-4000-8000-000000000007";
const REPRODUCTION = "90000000-0000-4000-8000-000000000008";
const SEASON = "90000000-0000-4000-8000-000000000009";
const FIELD = "90000000-0000-4000-8000-000000000010";
const WAREHOUSE = "90000000-0000-4000-8000-000000000011";
const LOT = "90000000-0000-4000-8000-000000000012";
const ORIGINAL = "90000000-0000-4000-8000-000000000013";
const CORRECTION = "90000000-0000-4000-8000-000000000014";
const SOURCE_BATCH = "90000000-0000-4000-8000-000000000015";
const ORIGINAL_LINE = "90000000-0000-4000-8000-000000000016";
const CORRECTION_LINE = "90000000-0000-4000-8000-000000000017";
const EXTERNAL = "90000000-0000-4000-8000-000000000018";
const TRANSFER_ORIGINAL = "90000000-0000-4000-8000-000000000019";
const TRANSFER_CORRECTION = "90000000-0000-4000-8000-000000000020";

type Row = Record<string, unknown>;
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows as Row[];
const scalar = async (db: PGlite, sql: string) =>
  Object.values((await rows(db, sql))[0] ?? {})[0];

function stripDollarQuotedBodies(sql: string) {
  return sql.replace(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, "$BODY$");
}

async function main() {
  const migration = await readFile(migrationUrl, "utf8");
  const finalizeRoute = await readFile(finalizeRouteUrl, "utf8");

  assert.match(migration, /P0_HARVEST_CORRECTION_SELF_REFERENCE_V1/);
  assert.match(migration, /t\.correction_of_ticket_id is distinct from p_ticket_id/i);
  assert.match(migration, /finalize_harvest_correction_accounting_v1/);
  assert.match(migration, /P0_HARVEST_CORRECTION_PROCESSING_GATE_V1/);
  assert.match(migration, /P0_HARVEST_CORRECTION_ATOMIC_V1/);
  assert.match(migration, /P0_HARVEST_CORRECTION_AUDIT_CONTRACT_V1/);
  assert.match(migration, /pg_get_userbyid\(v_owner_before\) <> 'postgres'/);
  assert.match(migration, /has_function_privilege\('service_role', v_signature, 'EXECUTE'\)/);
  assert.match(migration, /replacement aggregate lot lineage changed/i);
  assert.doesNotMatch(migration, /disable\s+trigger/i);
  const topLevelMigration = stripDollarQuotedBodies(migration);
  assert.doesNotMatch(topLevelMigration, /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\./i);
  assert.doesNotMatch(topLevelMigration, /\b(?:truncate|alter\s+table|drop\s+table)\b/i);

  const committedBranchStart = finalizeRoute.indexOf(
    "// The correction RPC commits the document",
  );
  const legacyWritesStart = finalizeRoute.indexOf(
    "try {\n      await Promise.all([",
    committedBranchStart,
  );
  assert.ok(committedBranchStart > 0 && legacyWritesStart > committedBranchStart);
  const committedBranch = finalizeRoute.slice(committedBranchStart, legacyWritesStart);
  assert.match(committedBranch, /if \(isCorrectionFinalize\)/);
  assert.match(committedBranch, /committed: true/);
  assert.match(committedBranch, /refresh_required: committed\.refreshRequired/);
  assert.doesNotMatch(committedBranch, /syncHarvestBatchMoisture/);
  assert.doesNotMatch(committedBranch, /reference_vehicles/);
  assert.doesNotMatch(committedBranch, /warehouse_issue_request/);
  const replayBranch = finalizeRoute.slice(
    finalizeRoute.indexOf("if (ticketBefore.is_finalized"),
    finalizeRoute.indexOf("if (ticketBefore.op_type === \"harvest_incoming\")", finalizeRoute.indexOf("if (ticketBefore.is_finalized")),
  );
  assert.match(replayBranch, /if \(isCorrectionFinalize\)/);
  assert.match(replayBranch, /idempotent_replay: true/);
  assert.doesNotMatch(replayBranch, /syncHarvestBatchMoisture/);

  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema private;
    create type public.ledger_direction as enum ('in','out');
    create type public.ticket_status as enum ('draft','active','ready_to_close','finalized','voided');
    create type public.ticket_direction as enum ('incoming','outgoing','transfer');

    create table public.profiles(
      id uuid primary key,
      company_id uuid,
      role text,
      status text
    );
    create table public.tickets(
      id uuid primary key,
      company_id uuid not null,
      ticket_no text not null,
      direction public.ticket_direction not null,
      op_type text not null,
      status public.ticket_status not null,
      is_finalized boolean not null default false,
      is_voided boolean not null default false,
      warehouse_from_id uuid,
      warehouse_to_id uuid,
      season_id uuid,
      field_id uuid,
      gross_weight_kg numeric(18,3),
      tare_weight_kg numeric(18,3),
      net_weight_kg numeric(18,3),
      physical_net_kg numeric(18,3),
      explicit_deductions_kg numeric(18,3),
      accepted_weight_kg numeric(18,3),
      harvest_lot_id uuid,
      batch_id uuid,
      lot_id text,
      processing_allocation_ready boolean not null default false,
      correction_of_ticket_id uuid,
      correction_reason text,
      replacement_ticket_id uuid,
      correction_completed_at timestamptz,
      finalized_by_person_id uuid,
      created_by_person_id uuid,
      created_by uuid,
      closed_by uuid,
      finalized_at timestamptz,
      voided_by uuid,
      voided_at timestamptz,
      void_reason text,
      notes text,
      audit_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.ticket_lines(
      id uuid primary key,
      ticket_id uuid not null,
      company_id uuid not null,
      product_id uuid not null,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      gross_line_weight_kg numeric(18,3),
      tare_line_weight_kg numeric(18,3),
      net_line_weight_kg numeric(18,3),
      quantity numeric(18,6),
      quantity_kg numeric(18,6),
      mass_kg numeric(18,6),
      uom text not null default 'kg',
      moisture_percent numeric(8,3),
      dirt_tare_percent numeric(8,4),
      batch_id text,
      lot_id text,
      batch_class text,
      warehouse_to_id uuid,
      quality_json jsonb not null default '{}'::jsonb,
      unit_source text,
      unit_contract_version smallint,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.ticket_weighings(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null,
      company_id uuid not null,
      weighing_no integer not null,
      measured_weight_kg numeric(18,3) not null,
      unique(ticket_id, weighing_no)
    );
    create table public.inventory_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      season_id uuid,
      product_id uuid,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      source_field_id uuid,
      source_ticket_id uuid,
      batch_code text not null,
      status text not null default 'commodity',
      batch_class text not null default 'commodity',
      origin_type text,
      origin_ref_id uuid,
      initial_weight_kg numeric(18,6),
      current_weight_kg numeric(18,6),
      moisture_percent numeric(8,3),
      treatment_status text,
      initial_quantity numeric(18,6),
      current_quantity numeric(18,6),
      uom text,
      mass_kg numeric(18,6),
      unit_source text,
      unit_contract_version smallint,
      warehouse_id uuid,
      received_at timestamptz,
      parent_batch_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(company_id, batch_code)
    );
    create table public.harvest_lots(
      id uuid primary key,
      company_id uuid not null,
      status text not null default 'active'
    );
    create table public.harvest_lot_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      harvest_lot_id uuid not null,
      inventory_batch_id uuid not null unique,
      source_ticket_id uuid,
      created_at timestamptz not null default now()
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      ticket_id uuid,
      processing_id uuid,
      product_id uuid,
      warehouse_id uuid,
      direction public.ledger_direction not null,
      quantity numeric(18,6),
      uom text,
      delta_qty_signed numeric(18,6),
      reason_type text,
      reason_ref_id uuid,
      batch_id text,
      occurred_at timestamptz not null default now(),
      created_by uuid,
      is_storno boolean not null default false,
      storno_of_entry_id uuid,
      notes text,
      variety_id uuid,
      reproduction_id uuid,
      batch_id_text text,
      batch_class text,
      operation_line_id uuid,
      mass_kg numeric(18,6),
      density_kg_per_l numeric(18,6),
      density_unit text,
      density_source text,
      density_verification_status text,
      density_verified_at timestamptz,
      unit_source text,
      unit_contract_version smallint,
      warehouse_issue_allocation_id uuid,
      crop_id uuid,
      inventory_batch_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.batch_transformation_inputs(
      id uuid primary key default gen_random_uuid(),
      batch_id uuid
    );
    create table public.field_history_entries(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      harvest_ticket_id uuid not null,
      source text not null,
      unique(harvest_ticket_id, source)
    );
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      company_id uuid,
      who uuid,
      entity_type text,
      entity_id text,
      action text,
      old_values jsonb,
      new_values jsonb,
      reason text
    );
    create table private.processing_gate_calls(
      ticket_id uuid not null,
      called_at timestamptz not null default now()
    );

    create or replace function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

    create or replace function public.canonical_stock_uom(value text)
    returns text language sql immutable
    as $$ select lower(trim(value)) $$;

    create or replace function public.backfill_ticket_operation_line_links_v1(uuid)
    returns void language sql as $$ select $$;

    create or replace function private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id uuid)
    returns void language plpgsql security definer set search_path = pg_catalog, public, private
    as $$ begin insert into private.processing_gate_calls(ticket_id) values (p_ticket_id); end $$;

    create or replace function private.assert_weighbridge_ticket_correction_actor_v1(uuid,uuid,uuid)
    returns public.profiles language plpgsql security definer set search_path = pg_catalog, public, private
    as $$
    declare v_actor public.profiles%rowtype;
    begin
      select * into v_actor from public.profiles where id = auth.uid();
      if not found then raise exception 'actor missing'; end if;
      return v_actor;
    end $$;

    create or replace function private.reconcile_warehouse_local_batch_balance_v1(p_batch_id uuid)
    returns numeric language plpgsql security definer set search_path = pg_catalog, public, private
    as $$
    declare v_batch public.inventory_batches%rowtype; v_balance numeric;
    begin
      select * into v_batch from public.inventory_batches where id=p_batch_id for update;
      select coalesce(sum(delta_qty_signed),0) into v_balance
      from public.stock_ledger_entries
      where company_id=v_batch.company_id and inventory_batch_id=v_batch.id;
      update public.inventory_batches
      set current_quantity=greatest(v_balance,0), current_weight_kg=greatest(v_balance,0),
          mass_kg=greatest(v_balance,0), updated_at=now()
      where id=v_batch.id;
      return greatest(v_balance,0);
    end $$;

    create or replace function private.reconcile_harvest_lot_batch_balance_v1(p_batch_id uuid)
    returns numeric language plpgsql security definer set search_path = pg_catalog, public, private
    as $$
    declare v_batch public.inventory_batches%rowtype; v_balance numeric;
    begin
      select * into v_batch from public.inventory_batches where id=p_batch_id for update;
      select coalesce(sum(delta_qty_signed),0) into v_balance
      from public.stock_ledger_entries
      where company_id=v_batch.company_id and inventory_batch_id=v_batch.id;
      if v_balance < -0.001 then raise exception 'negative batch'; end if;
      update public.inventory_batches
      set current_quantity=greatest(v_balance,0), current_weight_kg=greatest(v_balance,0),
          mass_kg=greatest(v_balance,0), updated_at=now()
      where id=v_batch.id;
      return greatest(v_balance,0);
    end $$;

    create or replace function public.ensure_harvest_lot_for_batch_v1(p_batch_id uuid)
    returns uuid language plpgsql security definer set search_path = pg_catalog, public
    as $$
    declare v_batch public.inventory_batches%rowtype; v_lot_id uuid;
    begin
      select * into v_batch from public.inventory_batches where id=p_batch_id;
      select harvest_lot_id into v_lot_id
      from public.harvest_lot_batches where inventory_batch_id=p_batch_id;
      if v_lot_id is not null then return v_lot_id; end if;
      select id into v_lot_id from public.harvest_lots
      where company_id=v_batch.company_id and status='active' limit 1;
      if v_lot_id is null then raise exception 'lot missing'; end if;
      insert into public.harvest_lot_batches(
        company_id,harvest_lot_id,inventory_batch_id,source_ticket_id
      ) values(v_batch.company_id,v_lot_id,v_batch.id,v_batch.source_ticket_id);
      return v_lot_id;
    end $$;

    create or replace function public.finalize_weighbridge_ticket_for_session_v1(uuid)
    returns uuid language plpgsql security definer set search_path = pg_catalog, public, private
    as $$ begin raise exception 'GENERIC_FINALIZER_MUST_NOT_RUN_FOR_HARVEST_CORRECTION'; end $$;

    create or replace function private.repair_legacy_transfer_batch_trace_v1(uuid)
    returns void language sql as $$ select $$;

    create or replace function private.sync_transfer_correction_lineage_v2(uuid,boolean)
    returns jsonb language sql as $$ select '{}'::jsonb $$;

    create or replace function private.weighbridge_ticket_has_downstream_dependencies_v1(
      p_ticket_id uuid
    ) returns boolean language sql stable security definer
    set search_path = pg_catalog, public, private
    as $$
      with source_batches as (
        select ib.id,ib.batch_code from public.inventory_batches ib
        where ib.source_ticket_id=p_ticket_id
      )
      select exists(
        select 1 from public.batch_transformation_inputs bti
        join source_batches sb on sb.id=bti.batch_id
      ) or exists(
        select 1 from public.stock_ledger_entries sle
        where not coalesce(sle.is_storno,false)
          and sle.ticket_id is distinct from p_ticket_id
          and (sle.inventory_batch_id in(select id from source_batches)
            or sle.batch_id_text in(select id::text from source_batches)
            or sle.batch_id_text in(select batch_code from source_batches))
      ) or exists(
        select 1 from public.ticket_lines tl join public.tickets t on t.id=tl.ticket_id
        where tl.ticket_id <> p_ticket_id and not coalesce(t.is_voided,false)
          and (tl.batch_id in(select id::text from source_batches)
            or tl.batch_id in(select batch_code from source_batches)
            or tl.lot_id in(select id::text from source_batches)
            or tl.lot_id in(select batch_code from source_batches))
      )
    $$;

    create or replace function public.test_record_finalized_harvest_trace()
    returns trigger language plpgsql as $$
    begin
      if new.op_type='harvest_incoming' and new.is_finalized and new.status='finalized'
         and not coalesce(old.is_finalized,false) then
        if not exists(select 1 from public.inventory_batches where source_ticket_id=new.id)
           or not exists(select 1 from public.stock_ledger_entries
                         where ticket_id=new.id and not is_storno and direction='in') then
          raise exception 'ticket finalized before accounting lineage';
        end if;
        insert into public.field_history_entries(company_id,harvest_ticket_id,source)
        values(new.company_id,new.id,'weighbridge_harvest') on conflict do nothing;
      end if;
      return new;
    end $$;
    create trigger test_record_finalized_harvest_trace
      after update on public.tickets for each row
      execute function public.test_record_finalized_harvest_trace();

    create or replace function public.finalize_weighbridge_ticket_correction_v1(
      p_ticket_id uuid,
      p_operator_person_id uuid default null,
      p_shift_id uuid default null
    ) returns uuid language plpgsql security definer
    set search_path = pg_catalog, public, private
    as $$
    declare
      v_actor public.profiles%rowtype;
      v_new public.tickets%rowtype;
      v_old public.tickets%rowtype;
      v_entry public.stock_ledger_entries%rowtype;
      v_lineage jsonb;
    begin
      select * into v_new from public.tickets where id = p_ticket_id for update;
      if not found then raise exception 'Ticket not found'; end if;
      select * into v_old from public.tickets where id=v_new.correction_of_ticket_id for update;
      if not found then raise exception 'Original ticket not found'; end if;
      v_actor := private.assert_weighbridge_ticket_correction_actor_v1(
        v_new.company_id,p_operator_person_id,p_shift_id
      );
      if v_new.is_finalized and v_new.status='finalized'
         and v_old.is_voided and v_old.status='voided'
         and v_old.replacement_ticket_id=v_new.id then return v_new.id; end if;
      if private.weighbridge_ticket_has_downstream_dependencies_v1(v_old.id) then
        raise exception 'downstream dependency';
      end if;
      for v_entry in
        select * from public.stock_ledger_entries sle
        where sle.ticket_id=v_old.id and not sle.is_storno
          and not exists(select 1 from public.stock_ledger_entries x where x.storno_of_entry_id=sle.id)
        order by sle.created_at,sle.id for update
      loop
        insert into public.stock_ledger_entries(
          company_id,ticket_id,processing_id,product_id,warehouse_id,direction,
          quantity,uom,delta_qty_signed,reason_type,reason_ref_id,batch_id,
          occurred_at,created_by,is_storno,storno_of_entry_id,notes,variety_id,
          reproduction_id,batch_id_text,batch_class,operation_line_id,mass_kg,
          density_kg_per_l,density_unit,density_source,density_verification_status,
          density_verified_at,unit_source,unit_contract_version,
          warehouse_issue_allocation_id,crop_id,inventory_batch_id
        ) values(
          v_entry.company_id,v_entry.ticket_id,v_entry.processing_id,v_entry.product_id,
          v_entry.warehouse_id,
          case when v_entry.direction='in' then 'out'::public.ledger_direction else 'in'::public.ledger_direction end,
          v_entry.quantity,v_entry.uom,-v_entry.delta_qty_signed,
          'storno_'||v_entry.reason_type,v_entry.reason_ref_id,v_entry.batch_id,now(),
          v_actor.id,true,v_entry.id,'correction',v_entry.variety_id,
          v_entry.reproduction_id,v_entry.batch_id_text,v_entry.batch_class,
          v_entry.operation_line_id,v_entry.mass_kg,v_entry.density_kg_per_l,
          v_entry.density_unit,v_entry.density_source,v_entry.density_verification_status,
          v_entry.density_verified_at,v_entry.unit_source,v_entry.unit_contract_version,
          v_entry.warehouse_issue_allocation_id,v_entry.crop_id,v_entry.inventory_batch_id
        );
        perform private.reconcile_warehouse_local_batch_balance_v1(v_entry.inventory_batch_id);
      end loop;
      update public.tickets set is_voided=true,status='voided',voided_by=v_actor.id,
        voided_at=now(),replacement_ticket_id=v_new.id,correction_completed_at=now(),updated_at=now()
      where id=v_old.id;
      update public.tickets set harvest_lot_id=coalesce(harvest_lot_id,v_old.harvest_lot_id),
        processing_allocation_ready=false,updated_at=now() where id=v_new.id;
      perform public.finalize_weighbridge_ticket_for_session_v1(v_new.id);
      update public.tickets set correction_completed_at=now(),
        finalized_by_person_id=coalesce(p_operator_person_id,finalized_by_person_id),updated_at=now()
      where id=v_new.id;
      -- TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1
      if v_old.direction::text = 'transfer' and abs(coalesce((
        select sum(delta_qty_signed) from public.stock_ledger_entries
        where ticket_id in(v_old.id,v_new.id)
      ),0)) > 0.001 then raise exception 'Transfer correction changed total company stock'; end if;
      insert into public.audit_log(company_id,who,entity_type,entity_id,action,new_values)
      values(v_new.company_id,v_actor.id,'weighbridge_ticket',v_old.id::text,
        'ticket_replaced',jsonb_build_object(
          'shift_id', p_shift_id, 'accounting_contract', 'warehouse_local_transfer_v2',
          'lineage',v_lineage
        ));
      return v_new.id;
    end $$;
    revoke all on function public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)
      from public,anon;
    grant execute on function public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)
      to authenticated;
  `);

  await db.exec(migration);

  const patchedDefinition = String(await scalar(db, `
    select pg_get_functiondef(
      'public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)'::regprocedure
    )
  `));
  assert.match(patchedDefinition, /P0_HARVEST_CORRECTION_PROCESSING_GATE_V1/);
  assert.match(patchedDefinition, /P0_HARVEST_CORRECTION_ATOMIC_V1/);
  assert.match(patchedDefinition, /P0_HARVEST_CORRECTION_AUDIT_CONTRACT_V1/);
  assert.match(
    patchedDefinition,
    /coalesce\(v_lineage ->> 'accounting_contract', 'warehouse_local_transfer_v2'\)/,
  );
  assert.match(patchedDefinition, /finalize_harvest_correction_accounting_v1/);
  assert.match(patchedDefinition, /TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1/);
  const functionSecurity = (await rows(db, `
    select p.prosecdef,p.proconfig,p.proacl,r.rolname owner
    from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid='public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)'::regprocedure
  `))[0];
  assert.equal(functionSecurity.prosecdef, true);
  assert.deepEqual(functionSecurity.proconfig, ["search_path=pg_catalog, public, private"]);
  assert.equal(functionSecurity.owner, "postgres");
  const privateAcl = (await rows(db, `
    select
      has_function_privilege('anon','private.finalize_harvest_correction_accounting_v1(uuid,uuid,uuid,uuid)','execute') anon_execute,
      has_function_privilege('authenticated','private.finalize_harvest_correction_accounting_v1(uuid,uuid,uuid,uuid)','execute') authenticated_execute,
      has_function_privilege('service_role','private.finalize_harvest_correction_accounting_v1(uuid,uuid,uuid,uuid)','execute') service_execute
  `))[0];
  assert.equal(privateAcl.anon_execute, false);
  assert.equal(privateAcl.authenticated_execute, false);
  assert.equal(privateAcl.service_execute, false);

  // A clean migration replay is allowed, but any ACL drift on the already
  // patched canonical function must abort before accepting the marker.
  await db.exec(migration);
  await db.exec(`
    grant execute on function public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)
      to service_role
  `);
  await assert.rejects(
    () => db.exec(migration),
    /P0 harvest correction replay verification failed/,
  );
  await db.exec("rollback");
  await db.exec(`
    revoke execute on function public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)
      from service_role
  `);

  await db.exec(`
    insert into public.profiles values('${ACTOR}','${COMPANY}','global_admin','active');
    insert into public.harvest_lots values('${LOT}','${COMPANY}','active');
    insert into public.tickets(
      id,company_id,ticket_no,direction,op_type,status,is_finalized,is_voided,
      warehouse_to_id,season_id,field_id,gross_weight_kg,tare_weight_kg,
      net_weight_kg,physical_net_kg,explicit_deductions_kg,accepted_weight_kg,
      harvest_lot_id,batch_id,lot_id,created_by_person_id,created_by
    ) values(
      '${ORIGINAL}','${COMPANY}','WB-100000-J7MI','incoming','harvest_incoming',
      'finalized',true,false,'${WAREHOUSE}','${SEASON}','${FIELD}',12080,5520,
      6560,6560,0,6560,'${LOT}','${SOURCE_BATCH}','HAR-J7MI','${PERSON}','${ACTOR}'
    ),(
      '${CORRECTION}','${COMPANY}','WB-100000-J7MI-R1','incoming','harvest_incoming',
      'ready_to_close',false,false,'${WAREHOUSE}','${SEASON}','${FIELD}',11640,5520,
      6120,6560,0,6560,'${LOT}',null,null,'${PERSON}','${ACTOR}'
    );
    update public.tickets set correction_of_ticket_id='${ORIGINAL}',
      correction_reason='Исправлено брутто по бумажному талону'
    where id='${CORRECTION}';
    insert into public.ticket_lines(
      id,ticket_id,company_id,product_id,crop_id,variety_id,reproduction_id,
      gross_line_weight_kg,tare_line_weight_kg,net_line_weight_kg,quantity,
      quantity_kg,mass_kg,uom,moisture_percent,batch_id,lot_id,batch_class,
      warehouse_to_id
    ) values(
      '${ORIGINAL_LINE}','${ORIGINAL}','${COMPANY}','${PRODUCT}','${CROP}',
      '${VARIETY}','${REPRODUCTION}',12080,5520,6560,6560,6560,6560,'kg',18,
      '${SOURCE_BATCH}','HAR-J7MI','commodity','${WAREHOUSE}'
    ),(
      '${CORRECTION_LINE}','${CORRECTION}','${COMPANY}','${PRODUCT}','${CROP}',
      '${VARIETY}','${REPRODUCTION}',12080,5520,6120,6120,6560,6120,'kg',18,
      '${SOURCE_BATCH}','HAR-J7MI','commodity','${WAREHOUSE}'
    );
    insert into public.inventory_batches(
      id,company_id,season_id,product_id,crop_id,variety_id,reproduction_id,
      source_field_id,source_ticket_id,batch_code,status,batch_class,origin_type,
      origin_ref_id,initial_weight_kg,current_weight_kg,moisture_percent,
      treatment_status,initial_quantity,current_quantity,uom,mass_kg,
      unit_source,unit_contract_version,warehouse_id
    ) values(
      '${SOURCE_BATCH}','${COMPANY}','${SEASON}','${PRODUCT}','${CROP}',
      '${VARIETY}','${REPRODUCTION}','${FIELD}','${ORIGINAL}','HAR-J7MI',
      'commodity','commodity','harvest','${ORIGINAL}',6560,6560,18,
      'not_applicable',6560,6560,'kg',6560,'weighbridge_atomic_harvest',2,
      '${WAREHOUSE}'
    );
    insert into public.harvest_lot_batches(
      company_id,harvest_lot_id,inventory_batch_id,source_ticket_id
    ) values('${COMPANY}','${LOT}','${SOURCE_BATCH}','${ORIGINAL}');
    insert into public.stock_ledger_entries(
      company_id,ticket_id,product_id,crop_id,variety_id,reproduction_id,
      warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,
      reason_ref_id,batch_id,batch_id_text,batch_class,inventory_batch_id,
      mass_kg,unit_source,unit_contract_version
    ) values(
      '${COMPANY}','${ORIGINAL}','${PRODUCT}','${CROP}','${VARIETY}',
      '${REPRODUCTION}','${WAREHOUSE}','in',6560,'kg',6560,
      'harvest_incoming_in','${ORIGINAL}','${SOURCE_BATCH}','${SOURCE_BATCH}',
      'commodity','${SOURCE_BATCH}',6560,'weighbridge_atomic_harvest',2
    );
    insert into public.ticket_weighings(ticket_id,company_id,weighing_no,measured_weight_kg)
    values('${CORRECTION}','${COMPANY}',1,11640),('${CORRECTION}','${COMPANY}',2,5520);
    insert into public.field_history_entries(company_id,harvest_ticket_id,source)
    values('${COMPANY}','${ORIGINAL}','weighbridge_harvest');
    select set_config('app.uid','${ACTOR}',false);
  `);

  assert.equal(
    await scalar(db, `select private.weighbridge_ticket_has_downstream_dependencies_v1('${ORIGINAL}')`),
    false,
    "the correction's copied source batch is not a downstream movement",
  );
  await db.exec(`
    insert into public.tickets(
      id,company_id,ticket_no,direction,op_type,status,is_finalized,is_voided
    ) values('${EXTERNAL}','${COMPANY}','WB-EXTERNAL','outgoing','warehouse_outgoing','active',false,false);
    insert into public.ticket_lines(
      id,ticket_id,company_id,product_id,batch_id,lot_id,uom
    ) values(gen_random_uuid(),'${EXTERNAL}','${COMPANY}','${PRODUCT}','${SOURCE_BATCH}','HAR-J7MI','kg');
  `);
  assert.equal(
    await scalar(db, `select private.weighbridge_ticket_has_downstream_dependencies_v1('${ORIGINAL}')`),
    true,
    "a real active downstream ticket must block correction",
  );
  await db.exec(`update public.tickets set is_voided=true,status='voided' where id='${EXTERNAL}'`);
  assert.equal(
    await scalar(db, `select private.weighbridge_ticket_has_downstream_dependencies_v1('${ORIGINAL}')`),
    false,
    "a voided downstream draft does not block correction",
  );

  await db.exec(`
    create or replace function public.test_reject_replacement_harvest_ledger()
    returns trigger language plpgsql as $$
    begin
      if new.ticket_id='${CORRECTION}' and not new.is_storno then
        raise exception 'FORCED_REPLACEMENT_LEDGER_FAILURE';
      end if;
      return new;
    end $$;
    create trigger test_reject_replacement_harvest_ledger
      before insert on public.stock_ledger_entries for each row
      execute function public.test_reject_replacement_harvest_ledger();
  `);
  await assert.rejects(
    () => rows(db, `select public.finalize_weighbridge_ticket_correction_v1('${CORRECTION}','${PERSON}','${SHIFT}')`),
    /FORCED_REPLACEMENT_LEDGER_FAILURE/,
  );
  const rolledBack = (await rows(db, `
    select
      (select status from public.tickets where id='${ORIGINAL}') original_status,
      (select is_voided from public.tickets where id='${ORIGINAL}') original_voided,
      (select status from public.tickets where id='${CORRECTION}') replacement_status,
      (select count(*) from public.stock_ledger_entries where is_storno) storno_count,
      (select count(*) from public.stock_ledger_entries where ticket_id='${CORRECTION}') replacement_ledgers,
      (select count(*) from public.inventory_batches where source_ticket_id='${CORRECTION}') replacement_batches,
      (select current_quantity from public.inventory_batches where id='${SOURCE_BATCH}') source_balance
  `))[0];
  assert.equal(rolledBack.original_status, "finalized");
  assert.equal(rolledBack.original_voided, false);
  assert.equal(rolledBack.replacement_status, "ready_to_close");
  assert.equal(Number(rolledBack.storno_count), 0);
  assert.equal(Number(rolledBack.replacement_ledgers), 0);
  assert.equal(Number(rolledBack.replacement_batches), 0);
  assert.equal(Number(rolledBack.source_balance), 6560);
  await db.exec(`drop trigger test_reject_replacement_harvest_ledger on public.stock_ledger_entries`);

  await rows(db, `select public.finalize_weighbridge_ticket_correction_v1('${CORRECTION}','${PERSON}','${SHIFT}')`);
  const countsAfterFirstFinalize = (await rows(db, `
    select
      (select count(*) from public.stock_ledger_entries where is_storno) storno_count,
      (select count(*) from public.stock_ledger_entries where ticket_id='${CORRECTION}') replacement_ledgers,
      (select count(*) from public.inventory_batches where source_ticket_id='${CORRECTION}') replacement_batches,
      (select count(*) from public.field_history_entries where harvest_ticket_id='${CORRECTION}') history_count
  `))[0];
  await rows(db, `select public.finalize_weighbridge_ticket_correction_v1('${CORRECTION}','${PERSON}','${SHIFT}')`);
  const countsAfterReplay = (await rows(db, `
    select
      (select count(*) from public.stock_ledger_entries where is_storno) storno_count,
      (select count(*) from public.stock_ledger_entries where ticket_id='${CORRECTION}') replacement_ledgers,
      (select count(*) from public.inventory_batches where source_ticket_id='${CORRECTION}') replacement_batches,
      (select count(*) from public.field_history_entries where harvest_ticket_id='${CORRECTION}') history_count
  `))[0];
  assert.deepEqual(countsAfterReplay, countsAfterFirstFinalize);

  const final = (await rows(db, `
    select
      (select status from public.tickets where id='${ORIGINAL}') original_status,
      (select replacement_ticket_id from public.tickets where id='${ORIGINAL}') replacement_ticket_id,
      (select status from public.tickets where id='${CORRECTION}') replacement_status,
      (select net_weight_kg from public.tickets where id='${CORRECTION}') replacement_net,
      (select physical_net_kg from public.tickets where id='${CORRECTION}') replacement_physical,
      (select accepted_weight_kg from public.tickets where id='${CORRECTION}') replacement_accepted,
      (select current_quantity from public.inventory_batches where id='${SOURCE_BATCH}') source_balance,
      (select id from public.inventory_batches where source_ticket_id='${CORRECTION}') replacement_batch_id,
      (select current_quantity from public.inventory_batches where source_ticket_id='${CORRECTION}') replacement_batch_balance,
      (select initial_weight_kg from public.inventory_batches where source_ticket_id='${CORRECTION}') replacement_batch_initial,
      (select harvest_lot_id from public.harvest_lot_batches where source_ticket_id='${CORRECTION}') replacement_lot_id,
      (select delta_qty_signed from public.stock_ledger_entries where ticket_id='${CORRECTION}' and not is_storno) replacement_ledger_delta,
      (select inventory_batch_id from public.stock_ledger_entries where ticket_id='${CORRECTION}' and not is_storno) replacement_ledger_batch_id,
      (select gross_line_weight_kg from public.ticket_lines where ticket_id='${CORRECTION}') line_gross,
      (select tare_line_weight_kg from public.ticket_lines where ticket_id='${CORRECTION}') line_tare,
      (select net_line_weight_kg from public.ticket_lines where ticket_id='${CORRECTION}') line_net,
      (select quantity_kg from public.ticket_lines where ticket_id='${CORRECTION}') line_quantity,
      (select mass_kg from public.ticket_lines where ticket_id='${CORRECTION}') line_mass,
      (select count(*) from public.ticket_weighings where ticket_id='${CORRECTION}') weighing_count,
      (select count(*) from public.field_history_entries where harvest_ticket_id='${CORRECTION}') history_count,
      (select sum(delta_qty_signed) from public.stock_ledger_entries where ticket_id in('${ORIGINAL}','${CORRECTION}')) combined_delta,
      (select new_values->>'accounting_contract' from public.audit_log
       where entity_id='${ORIGINAL}' and action='ticket_replaced' limit 1) replacement_audit_contract,
      (select count(*) from private.processing_gate_calls where ticket_id='${CORRECTION}') gate_calls
  `))[0];
  assert.equal(final.original_status, "voided");
  assert.equal(final.replacement_ticket_id, CORRECTION);
  assert.equal(final.replacement_status, "finalized");
  for (const key of [
    "replacement_net",
    "replacement_physical",
    "replacement_accepted",
    "replacement_batch_balance",
    "replacement_batch_initial",
    "replacement_ledger_delta",
    "line_net",
    "line_quantity",
    "line_mass",
    "combined_delta",
  ]) assert.equal(Number(final[key]), 6120, key);
  assert.equal(Number(final.source_balance), 0);
  assert.equal(Number(final.line_gross), 11640);
  assert.equal(Number(final.line_tare), 5520);
  assert.notEqual(final.replacement_batch_id, SOURCE_BATCH);
  assert.equal(final.replacement_ledger_batch_id, final.replacement_batch_id);
  assert.equal(final.replacement_lot_id, LOT);
  assert.equal(Number(final.weighing_count), 2);
  assert.equal(Number(final.history_count), 1);
  assert.equal(final.replacement_audit_contract, "p0_harvest_correction_v1");
  assert.equal(Number(final.gate_calls), 2);
  assert.equal(Number(countsAfterReplay.storno_count), 1);
  assert.equal(Number(countsAfterReplay.replacement_ledgers), 1);
  assert.equal(Number(countsAfterReplay.replacement_batches), 1);
  assert.equal(Number(countsAfterReplay.history_count), 1);

  // The unchanged non-harvest branch keeps the historical transfer contract
  // when its lineage payload has no explicit accounting_contract.
  await db.exec(`
    create or replace function public.finalize_weighbridge_ticket_for_session_v1(p_ticket_id uuid)
    returns uuid language plpgsql security definer set search_path = pg_catalog, public, private
    as $$
    begin
      update public.tickets
      set is_finalized=true,status='finalized',finalized_at=now(),updated_at=now()
      where id=p_ticket_id;
      return p_ticket_id;
    end $$;
    insert into public.tickets(
      id,company_id,ticket_no,direction,op_type,status,is_finalized,is_voided,
      warehouse_from_id,warehouse_to_id,net_weight_kg,created_by
    ) values(
      '${TRANSFER_ORIGINAL}','${COMPANY}','WB-TRANSFER','transfer',
      'transfer_between_warehouses','finalized',true,false,'${WAREHOUSE}',
      '${WAREHOUSE}',1000,'${ACTOR}'
    ),(
      '${TRANSFER_CORRECTION}','${COMPANY}','WB-TRANSFER-R1','transfer',
      'transfer_between_warehouses','ready_to_close',false,false,'${WAREHOUSE}',
      '${WAREHOUSE}',1000,'${ACTOR}'
    );
    update public.tickets
    set correction_of_ticket_id='${TRANSFER_ORIGINAL}',correction_reason='transfer correction QA'
    where id='${TRANSFER_CORRECTION}';
  `);
  await rows(db, `
    select public.finalize_weighbridge_ticket_correction_v1(
      '${TRANSFER_CORRECTION}','${PERSON}','${SHIFT}'
    )
  `);
  assert.equal(
    await scalar(db, `
      select new_values->>'accounting_contract'
      from public.audit_log
      where entity_id='${TRANSFER_ORIGINAL}' and action='ticket_replaced'
      limit 1
    `),
    "warehouse_local_transfer_v2",
  );

  console.log("P0 harvest correction lineage regression: PASS");
  console.log("J7MI old=6560 replacement=6120 source_batch=0 new_batch=6120");
  console.log("rollback=PASS self_reference=PASS downstream_guard=PASS replay=PASS audit_contract=PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
