import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const previousMigrationUrl = new URL(
  "../supabase/migrations/20260830224100_tz315_reversed_processing_input_ticket_void_v1.sql",
  import.meta.url,
);
const correctiveMigrationUrl = new URL(
  "../supabase/migrations/20260830224802_tz315_reversed_input_void_lock_order_corrective_v1.sql",
  import.meta.url,
);

type Row = Record<string, unknown>;
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows as Row[];
const scalar = async (db: PGlite, sql: string) => Object.values((await rows(db, sql))[0] ?? {})[0];

const COMPANY = "31800000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31800000-0000-4000-8000-000000000002";
const ACTOR = "31800000-0000-4000-8000-000000000003";
const OTHER_ACTOR = "31800000-0000-4000-8000-000000000004";
const SEASON = "31800000-0000-4000-8000-000000000011";
const OTHER_SEASON = "31800000-0000-4000-8000-000000000012";
const LOT = "31800000-0000-4000-8000-000000000021";
const OTHER_LOT = "31800000-0000-4000-8000-000000000022";

const LEGACY_TICKET = "31800000-0000-4000-8000-000000000101";
const LEGACY_TRANSFORMATION = "31800000-0000-4000-8000-000000000102";
const MIXED_TICKET = "31800000-0000-4000-8000-000000000201";
const MIXED_REVERSED = "31800000-0000-4000-8000-000000000202";
const MIXED_MUTABLE = "31800000-0000-4000-8000-000000000203";
const CROSS_SEASON_TICKET = "31800000-0000-4000-8000-000000000301";
const CROSS_SEASON_TRANSFORMATION = "31800000-0000-4000-8000-000000000302";
const CROSS_COMPANY_TICKET = "31800000-0000-4000-8000-000000000401";
const CROSS_COMPANY_TRANSFORMATION = "31800000-0000-4000-8000-000000000402";
const DRIFT_TICKET = "31800000-0000-4000-8000-000000000501";
const DRIFT_TRANSFORMATION_A = "31800000-0000-4000-8000-000000000502";
const DRIFT_TRANSFORMATION_B = "31800000-0000-4000-8000-000000000503";
const EMPTY_TICKET = "31800000-0000-4000-8000-000000000601";
const EMPTY_DRIFT_TRANSFORMATION = "31800000-0000-4000-8000-000000000602";

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;

    create or replace function auth.uid()
    returns uuid language sql stable set search_path = '' as $$
      select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.seasons(
      id uuid primary key,
      company_id uuid not null
    );
    create table public.profiles(
      id uuid primary key,
      company_id uuid,
      role text,
      status text
    );
    create table public.harvest_lots(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid
    );
    create table public.tickets(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid,
      harvest_lot_id uuid,
      source_kind text,
      linked_processing_id uuid,
      processing_output_role text,
      is_finalized boolean not null default false,
      is_voided boolean not null default false,
      status text not null,
      updated_at timestamptz not null default now()
    );
    create table public.batch_transformations(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid not null,
      harvest_lot_id uuid,
      status text not null default 'completed'
    );
    create table public.batch_transformation_inputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      source_ticket_id uuid
    );
    create table public.batch_transformation_outputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      source_ticket_id uuid
    );
    create table public.batch_processing_reversals(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      season_id uuid not null,
      transformation_id uuid not null unique,
      idempotency_key text not null,
      unique(company_id, idempotency_key)
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid
    );
    create table public.inventory_batches(
      id uuid primary key default gen_random_uuid(),
      source_ticket_id uuid
    );
    create table public.test_recompute_calls(
      transformation_id uuid not null,
      called_at timestamptz not null default now()
    );

    insert into public.seasons(id,company_id) values
      ('${SEASON}','${COMPANY}'),
      ('${OTHER_SEASON}','${OTHER_COMPANY}');
    insert into public.profiles(id,company_id,role,status) values
      ('${ACTOR}','${COMPANY}','company_admin','active'),
      ('${OTHER_ACTOR}','${OTHER_COMPANY}','company_admin','active');
    insert into public.harvest_lots(id,company_id,season_id) values
      ('${LOT}','${COMPANY}','${SEASON}'),
      ('${OTHER_LOT}','${OTHER_COMPANY}','${OTHER_SEASON}');

    create or replace function public.get_user_company_id()
    returns uuid language sql stable security definer set search_path = '' as $$
      select p.company_id from public.profiles p where p.id = auth.uid() limit 1
    $$;

    create or replace function private.enforce_processing_reversal_documents_v1()
    returns trigger language plpgsql security definer set search_path = '' as $$
    declare v_old uuid; v_new uuid;
    begin
      if tg_op <> 'INSERT' then v_old := old.transformation_id; end if;
      if tg_op <> 'DELETE' then v_new := new.transformation_id; end if;
      if exists (
        select 1 from public.batch_processing_reversals r
        where r.transformation_id = v_old or r.transformation_id = v_new
      ) then
        raise exception 'PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE' using errcode = '55000';
      end if;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end $$;
    create trigger trg_inputs_reversal_guard
      before insert or update or delete on public.batch_transformation_inputs
      for each row execute function private.enforce_processing_reversal_documents_v1();
    create trigger trg_outputs_reversal_guard
      before insert or update or delete on public.batch_transformation_outputs
      for each row execute function private.enforce_processing_reversal_documents_v1();

    create or replace function public.recompute_grain_processing_shadow_v1(p_transformation_id uuid)
    returns void language plpgsql security definer set search_path = '' as $$
    begin
      insert into public.test_recompute_calls(transformation_id) values(p_transformation_id);
    end $$;

    create or replace function public.attach_route_processing_input_ticket_v1(p_ticket_id uuid)
    returns uuid language sql security definer set search_path = '' as
      $$ select null::uuid $$;

    create or replace function public.sync_grain_movement_shadow_v1(p_ticket_id uuid)
    returns void language plpgsql security definer set search_path = public, pg_temp as $$
    declare v_ticket public.tickets%rowtype; v_id uuid; v_ids uuid[];
    begin
      select * into v_ticket from public.tickets where id=p_ticket_id;
      if not found or v_ticket.harvest_lot_id is null then return; end if;
      select array_agg(distinct transformation_id) into v_ids from (
        select transformation_id from public.batch_transformation_inputs where source_ticket_id=p_ticket_id
        union all
        select transformation_id from public.batch_transformation_outputs where source_ticket_id=p_ticket_id
      ) q;
      if not v_ticket.is_finalized or v_ticket.is_voided or v_ticket.status <> 'finalized' then
        delete from public.batch_transformation_inputs where source_ticket_id=p_ticket_id;
        delete from public.batch_transformation_outputs where source_ticket_id=p_ticket_id;
        if v_ids is not null then
          for v_id in select unnest(v_ids) loop
            perform public.recompute_grain_processing_shadow_v1(v_id);
          end loop;
        end if;
      end if;
    end $$;

    create or replace function public.tg_sync_grain_movement_shadow_v1()
    returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
    declare v_input_transformation_id uuid;
    begin
      if new.source_kind='processing_wip'
         and new.linked_processing_id is not null
         and new.processing_output_role in ('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER')
         and new.is_finalized and not new.is_voided and new.status='finalized'
      then
        perform public.attach_route_processing_input_ticket_v1(new.id);
        return new;
      end if;
      if new.harvest_lot_id is not null and (
        old.is_finalized is distinct from new.is_finalized
        or old.status is distinct from new.status
        or old.is_voided is distinct from new.is_voided
      ) then
        if new.is_finalized and not new.is_voided and new.status='finalized' then
          v_input_transformation_id := public.attach_route_processing_input_ticket_v1(new.id);
          if v_input_transformation_id is not null then return new; end if;
        end if;
        perform public.sync_grain_movement_shadow_v1(new.id);
      end if;
      return new;
    end $$;
    revoke all on function public.tg_sync_grain_movement_shadow_v1() from public,anon,authenticated;
    grant execute on function public.tg_sync_grain_movement_shadow_v1() to service_role;
    create trigger trg_tickets_grain_movement_shadow_v1
      after update of is_finalized,status,is_voided on public.tickets
      for each row execute function public.tg_sync_grain_movement_shadow_v1();

    -- Compact deterministic stand-in for the already-tested accounting core.
    -- Its lock/resource markers let this regression prove that the new wrapper
    -- runs the processing prelock before ticket/ledger/batch resources.
    create or replace function public.void_ticket_with_storno_v2(
      p_ticket_id uuid,
      p_actor_user_id uuid,
      p_reason text
    ) returns uuid language plpgsql security definer set search_path = '' as $$
    declare v_ticket public.tickets%rowtype;
    begin
      if p_ticket_id is null or p_actor_user_id is null then
        raise exception 'WEIGHBRIDGE_VOID_CONTEXT_REQUIRED' using errcode='22023';
      end if;
      if nullif(btrim(coalesce(p_reason,'')),'') is null then
        raise exception 'WEIGHBRIDGE_VOID_REASON_REQUIRED' using errcode='22023';
      end if;
      if auth.uid() is null or auth.uid() is distinct from p_actor_user_id then
        raise exception 'WEIGHBRIDGE_VOID_FORBIDDEN' using errcode='42501';
      end if;
      select * into v_ticket from public.tickets where id=p_ticket_id for update;
      if not found then raise exception 'WEIGHBRIDGE_TICKET_NOT_FOUND' using errcode='P0002'; end if;
      perform 1 from public.stock_ledger_entries where ticket_id=p_ticket_id order by id for update;
      perform 1 from public.inventory_batches where source_ticket_id=p_ticket_id order by id for update;
      if false then raise exception 'WEIGHBRIDGE_VOID_PROCESSING_CYCLE_REVERSAL_REQUIRED'; end if;
      update public.tickets
      set status='voided',is_finalized=false,is_voided=true,updated_at=now()
      where id=p_ticket_id;
      if false then raise exception 'WEIGHBRIDGE_VOID_BATCH_POSTCONDITION_FAILED'; end if;
      return p_ticket_id;
    end $$;
    revoke all on function public.void_ticket_with_storno_v2(uuid,uuid,text) from public,anon,authenticated;
    grant execute on function public.void_ticket_with_storno_v2(uuid,uuid,text) to service_role;
  `);
  await scalar(db, `select set_config('request.jwt.claim.sub','${ACTOR}',false)`);
}

async function seedTransformation(
  db: PGlite,
  ticketId: string,
  transformationId: string,
  options: {
    ticketCompany?: string;
    documentCompany?: string;
    transformationCompany?: string;
    ticketSeason?: string | null;
    transformationSeason?: string;
    ticketLot?: string;
    transformationLot?: string;
  } = {},
) {
  const ticketCompany = options.ticketCompany ?? COMPANY;
  const documentCompany = options.documentCompany ?? ticketCompany;
  const transformationCompany = options.transformationCompany ?? ticketCompany;
  const ticketSeason = options.ticketSeason === undefined ? SEASON : options.ticketSeason;
  const transformationSeason = options.transformationSeason ?? SEASON;
  const ticketLot = options.ticketLot ?? LOT;
  const transformationLot = options.transformationLot ?? ticketLot;
  await db.exec(`
    insert into public.tickets(
      id,company_id,season_id,harvest_lot_id,is_finalized,is_voided,status
    ) values(
      '${ticketId}','${ticketCompany}',${ticketSeason ? `'${ticketSeason}'` : "null"},
      '${ticketLot}',true,false,'finalized'
    );
    insert into public.batch_transformations(
      id,company_id,season_id,harvest_lot_id,status
    ) values(
      '${transformationId}','${transformationCompany}','${transformationSeason}',
      '${transformationLot}','completed'
    );
    insert into public.batch_transformation_inputs(company_id,transformation_id,source_ticket_id)
    values('${documentCompany}','${transformationId}','${ticketId}');
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${documentCompany}','${transformationId}','${ticketId}');
  `);
}

const documentFingerprint = async (db: PGlite, ticketId: string) => scalar(db, `
  select coalesce(jsonb_agg(d order by d.kind,d.id)::text,'[]')
  from (
    select 'input'::text kind,id,company_id,transformation_id,source_ticket_id
    from public.batch_transformation_inputs where source_ticket_id='${ticketId}'
    union all
    select 'output'::text kind,id,company_id,transformation_id,source_ticket_id
    from public.batch_transformation_outputs where source_ticket_id='${ticketId}'
  ) d
`);

async function main() {
  const db = new PGlite();
  const previousMigration = await readFile(previousMigrationUrl, "utf8");
  const correctiveMigration = await readFile(correctiveMigrationUrl, "utf8");
  await bootstrap(db);
  await db.exec(previousMigration);

  const triggerBefore = String(await scalar(db, `
    select pg_get_functiondef('public.tg_sync_grain_movement_shadow_v1()'::regprocedure)
  `));
  const triggerAclBefore = String(await scalar(db, `
    select coalesce(proacl::text,'') from pg_proc
    where oid='public.tg_sync_grain_movement_shadow_v1()'::regprocedure
  `));
  const canonicalBefore = String(await scalar(db, `
    select pg_get_functiondef('public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure)
  `));

  assert.match(correctiveMigration, /tr\.tgenabled in \('O', 'A'\)/);
  assert.match(correctiveMigration, /tr\.tgfoid = 'public\.tg_sync_grain_movement_shadow_v1\(\)'/);
  await db.exec(`alter table public.tickets disable trigger trg_tickets_grain_movement_shadow_v1`);
  await assert.rejects(
    () => db.exec(correctiveMigration),
    /TZ315_REVERSED_INPUT_VOID_TRIGGER_TARGET_OR_STATE_INVALID/,
  );
  assert.equal(
    await scalar(db, `select to_regprocedure('private.lock_ticket_processing_boundary_v2(uuid,boolean)') is null`),
    true,
  );
  await db.exec(`alter table public.tickets enable trigger trg_tickets_grain_movement_shadow_v1`);
  await db.exec(`
    create or replace function public.test_wrong_ticket_trigger()
    returns trigger language plpgsql as $$ begin return new; end $$;
    drop trigger trg_tickets_grain_movement_shadow_v1 on public.tickets;
    create trigger trg_tickets_grain_movement_shadow_v1
      after update of is_finalized,status,is_voided on public.tickets
      for each row execute function public.test_wrong_ticket_trigger();
  `);
  await assert.rejects(
    () => db.exec(correctiveMigration),
    /TZ315_REVERSED_INPUT_VOID_TRIGGER_TARGET_OR_STATE_INVALID/,
  );
  await db.exec(`
    drop trigger trg_tickets_grain_movement_shadow_v1 on public.tickets;
    create trigger trg_tickets_grain_movement_shadow_v1
      after update of is_finalized,status,is_voided on public.tickets
      for each row execute function public.tg_sync_grain_movement_shadow_v1();
    drop function public.test_wrong_ticket_trigger();
  `);
  console.log("PASS 01 preflight fails atomically for a disabled/wrong trigger target state");

  await db.exec(correctiveMigration);
  await db.exec(correctiveMigration);
  const triggerAfter = String(await scalar(db, `
    select pg_get_functiondef('public.tg_sync_grain_movement_shadow_v1()'::regprocedure)
  `));
  const triggerAclAfter = String(await scalar(db, `
    select coalesce(proacl::text,'') from pg_proc
    where oid='public.tg_sync_grain_movement_shadow_v1()'::regprocedure
  `));
  assert.equal(triggerAfter, triggerBefore);
  assert.equal(triggerAclAfter, triggerAclBefore);
  assert.equal(
    await scalar(db, `select has_function_privilege('authenticated','public.void_ticket_with_storno_v2(uuid,uuid,text)','EXECUTE')`),
    false,
  );
  assert.equal(
    await scalar(db, `select has_function_privilege('service_role','public.void_ticket_with_storno_v2(uuid,uuid,text)','EXECUTE')`),
    true,
  );
  assert.equal(
    await scalar(db, `select has_function_privilege('service_role','private.lock_ticket_processing_boundary_v2(uuid,boolean)','EXECUTE')`),
    false,
  );
  console.log("PASS 02 corrective compiles twice and preserves the WIP trigger body plus ACL");

  const coreAfter = String(await scalar(db, `
    select pg_get_functiondef('private.void_ticket_with_storno_v2_core_20260830_v1(uuid,uuid,text)'::regprocedure)
  `));
  assert.equal(
    coreAfter.replace(
      "private.void_ticket_with_storno_v2_core_20260830_v1",
      "public.void_ticket_with_storno_v2",
    ),
    canonicalBefore,
  );
  const wrapperDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure)
  `));
  const lockDefinition = String(await scalar(db, `
    select pg_get_functiondef('private.lock_ticket_processing_boundary_v2(uuid,boolean)'::regprocedure)
  `));
  const lockDefinitionLower = lockDefinition.toLowerCase();
  assert.ok(
    wrapperDefinition.indexOf("lock_ticket_processing_boundary_v2") <
      wrapperDefinition.lastIndexOf("void_ticket_with_storno_v2_core_20260830_v1"),
  );
  assert.match(
    lockDefinitionLower,
    /from public\.batch_transformations[\s\S]*for update;[\s\S]*lock table\s+public\.batch_transformation_inputs/,
  );
  assert.match(
    lockDefinitionLower,
    /lock table public\.batch_processing_reversals[\s\S]*from public\.tickets t\s+where t\.id = p_ticket_id\s+for update/,
  );
  assert.match(coreAfter, /from public\.stock_ledger_entries[\s\S]*for update/i);
  assert.match(coreAfter, /from public\.inventory_batches[\s\S]*for update/i);
  console.log("PASS 03 deterministic lock graph is transformation/tables before ticket/ledger/batch");

  await seedTransformation(db, LEGACY_TICKET, LEGACY_TRANSFORMATION, { ticketSeason: null });
  await db.exec(`
    insert into public.batch_processing_reversals(
      company_id,season_id,transformation_id,idempotency_key
    ) values('${COMPANY}','${SEASON}','${LEGACY_TRANSFORMATION}','legacy-null-season');
  `);
  const legacyBefore = await documentFingerprint(db, LEGACY_TICKET);
  await scalar(db, `select public.void_ticket_with_storno_v2(
    '${LEGACY_TICKET}','${ACTOR}','legacy season through harvest lot'
  )`);
  assert.equal(await scalar(db, `select status from public.tickets where id='${LEGACY_TICKET}'`), "voided");
  assert.equal(await documentFingerprint(db, LEGACY_TICKET), legacyBefore);
  await assert.rejects(
    () => db.query(`delete from public.batch_transformation_inputs where transformation_id='${LEGACY_TRANSFORMATION}'`),
    /PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE/,
  );
  console.log("PASS 04 null ticket.season_id derives canonical season from the validated harvest lot");

  await seedTransformation(db, MIXED_TICKET, MIXED_REVERSED);
  await db.exec(`
    insert into public.batch_transformations(id,company_id,season_id,harvest_lot_id,status)
    values('${MIXED_MUTABLE}','${COMPANY}','${SEASON}','${LOT}','completed');
    insert into public.batch_transformation_inputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${MIXED_MUTABLE}','${MIXED_TICKET}');
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${MIXED_MUTABLE}','${MIXED_TICKET}');
    insert into public.batch_processing_reversals(company_id,season_id,transformation_id,idempotency_key)
    values('${COMPANY}','${SEASON}','${MIXED_REVERSED}','mixed-reversed');
  `);
  const mixedReversedBefore = await scalar(db, `
    select jsonb_agg(d order by d.kind,d.id)::text from (
      select 'input' kind,id,company_id,transformation_id,source_ticket_id
      from public.batch_transformation_inputs where transformation_id='${MIXED_REVERSED}'
      union all
      select 'output' kind,id,company_id,transformation_id,source_ticket_id
      from public.batch_transformation_outputs where transformation_id='${MIXED_REVERSED}'
    ) d
  `);
  await scalar(db, `select public.void_ticket_with_storno_v2('${MIXED_TICKET}','${ACTOR}','mixed cleanup')`);
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_transformation_inputs where transformation_id='${MIXED_MUTABLE}'`)), 0);
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_transformation_outputs where transformation_id='${MIXED_MUTABLE}'`)), 0);
  assert.equal(Number(await scalar(db, `select count(*) from public.test_recompute_calls where transformation_id='${MIXED_MUTABLE}'`)), 1);
  assert.equal(await scalar(db, `
    select jsonb_agg(d order by d.kind,d.id)::text from (
      select 'input' kind,id,company_id,transformation_id,source_ticket_id
      from public.batch_transformation_inputs where transformation_id='${MIXED_REVERSED}'
      union all
      select 'output' kind,id,company_id,transformation_id,source_ticket_id
      from public.batch_transformation_outputs where transformation_id='${MIXED_REVERSED}'
    ) d
  `), mixedReversedBefore);
  console.log("PASS 05 mixed mutable cleanup preserves receipt-backed immutable documents");

  await seedTransformation(db, CROSS_SEASON_TICKET, CROSS_SEASON_TRANSFORMATION, {
    transformationSeason: OTHER_SEASON,
    transformationLot: LOT,
  });
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${CROSS_SEASON_TICKET}','${ACTOR}','cross season')`),
    /TZ315_REVERSED_INPUT_VOID_COMPANY_SEASON_MISMATCH/,
  );
  assert.equal(await scalar(db, `select status from public.tickets where id='${CROSS_SEASON_TICKET}'`), "finalized");
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_transformation_inputs where transformation_id='${CROSS_SEASON_TRANSFORMATION}'`)), 1);
  console.log("PASS 06 cross-season linkage is blocked atomically");

  await seedTransformation(db, CROSS_COMPANY_TICKET, CROSS_COMPANY_TRANSFORMATION, {
    documentCompany: OTHER_COMPANY,
    transformationCompany: OTHER_COMPANY,
    transformationSeason: OTHER_SEASON,
    transformationLot: OTHER_LOT,
  });
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${CROSS_COMPANY_TICKET}','${ACTOR}','cross company')`),
    /TZ315_REVERSED_INPUT_VOID_COMPANY_SEASON_MISMATCH/,
  );
  assert.equal(await scalar(db, `select status from public.tickets where id='${CROSS_COMPANY_TICKET}'`), "finalized");
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_transformation_outputs where transformation_id='${CROSS_COMPANY_TRANSFORMATION}'`)), 1);
  console.log("PASS 07 cross-company linkage is blocked atomically");

  await seedTransformation(db, DRIFT_TICKET, DRIFT_TRANSFORMATION_A);
  await db.exec(`
    insert into public.batch_transformations(id,company_id,season_id,harvest_lot_id,status)
    values('${DRIFT_TRANSFORMATION_B}','${COMPANY}','${SEASON}','${LOT}','completed');
  `);
  const originalLockDefinition = String(await scalar(db, `
    select pg_get_functiondef('private.lock_ticket_processing_boundary_v2(uuid,boolean)'::regprocedure)
  `));
  await db.exec(`
    create or replace function private.lock_ticket_processing_boundary_v2(
      p_ticket_id uuid,
      p_require_voided boolean default false
    ) returns uuid[] language plpgsql security definer set search_path = '' as $$
    begin
      raise exception 'LOCK_HELPER_SHOULD_NOT_RUN' using errcode='55000';
    end $$;
  `);
  await scalar(db, `select set_config('request.jwt.claim.sub','${OTHER_ACTOR}',false)`);
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${DRIFT_TICKET}','${OTHER_ACTOR}','foreign actor')`),
    /WEIGHBRIDGE_VOID_COMPANY_MISMATCH/,
  );
  assert.equal(await scalar(db, `select status from public.tickets where id='${DRIFT_TICKET}'`), "finalized");
  await scalar(db, `select set_config('request.jwt.claim.sub','${ACTOR}',false)`);
  await db.exec(originalLockDefinition);
  console.log("PASS 08 foreign same-season actor is rejected before lock helper or business writes");

  const driftInjection = `
  insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
  values('${COMPANY}','${DRIFT_TRANSFORMATION_B}',p_ticket_id);
  `;
  const injectedLockDefinition = originalLockDefinition.replace(
    "-- TZ315_TEST_STABLE_SET_RECHECK_ANCHOR",
    `-- TZ315_TEST_STABLE_SET_RECHECK_ANCHOR${driftInjection}`,
  );
  assert.notEqual(injectedLockDefinition, originalLockDefinition);
  await db.exec(injectedLockDefinition);
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${DRIFT_TICKET}','${ACTOR}','set drift')`),
    /TZ315_REVERSED_INPUT_VOID_LINK_SET_CHANGED_RETRY/,
  );
  assert.equal(await scalar(db, `select status from public.tickets where id='${DRIFT_TICKET}'`), "finalized");
  assert.equal(Number(await scalar(db, `
    select count(*) from public.batch_transformation_outputs
    where source_ticket_id='${DRIFT_TICKET}' and transformation_id='${DRIFT_TRANSFORMATION_B}'
  `)), 0);
  await db.exec(originalLockDefinition);
  console.log("PASS 09 deterministic concurrent-set interleaving returns retry and rolls back atomically");

  await db.exec(`
    insert into public.tickets(
      id,company_id,season_id,harvest_lot_id,is_finalized,is_voided,status
    ) values('${EMPTY_TICKET}','${COMPANY}','${SEASON}',null,true,false,'finalized');
    insert into public.batch_transformations(id,company_id,season_id,harvest_lot_id,status)
    values('${EMPTY_DRIFT_TRANSFORMATION}','${COMPANY}','${SEASON}','${LOT}','completed');
  `);
  const emptyDriftInjection = `
  insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
  values('${COMPANY}','${EMPTY_DRIFT_TRANSFORMATION}',p_ticket_id);
  `;
  const emptyInjectedDefinition = originalLockDefinition.replace(
    "-- TZ315_TEST_STABLE_SET_RECHECK_ANCHOR",
    `-- TZ315_TEST_STABLE_SET_RECHECK_ANCHOR${emptyDriftInjection}`,
  );
  await db.exec(emptyInjectedDefinition);
  await assert.rejects(
    () => db.query(`select public.void_ticket_with_storno_v2('${EMPTY_TICKET}','${ACTOR}','empty set drift')`),
    /TZ315_REVERSED_INPUT_VOID_LINK_SET_CHANGED_RETRY/,
  );
  assert.equal(await scalar(db, `select status from public.tickets where id='${EMPTY_TICKET}'`), "finalized");
  assert.equal(Number(await scalar(db, `
    select count(*) from public.batch_transformation_outputs where source_ticket_id='${EMPTY_TICKET}'
  `)), 0);
  await db.exec(originalLockDefinition);
  console.log("PASS 10 empty/non-harvest set still locks, rechecks and rejects concurrent linkage");

  const beforeReplay = await documentFingerprint(db, LEGACY_TICKET);
  await scalar(db, `select public.void_ticket_with_storno_v2('${LEGACY_TICKET}','${ACTOR}','idempotent replay')`);
  assert.equal(await documentFingerprint(db, LEGACY_TICKET), beforeReplay);
  assert.equal(await scalar(db, `select status from public.tickets where id='${LEGACY_TICKET}'`), "voided");
  console.log("PASS 11 canonical replay remains idempotent after wrapper/core split");

  assert.doesNotMatch(correctiveMigration, /delete\s+from\s+public\.batch_processing_reversals/i);
  assert.doesNotMatch(correctiveMigration, /update\s+public\.batch_processing_reversals/i);
  assert.doesNotMatch(correctiveMigration, /insert\s+into\s+public\.batch_processing_reversals/i);
  assert.match(correctiveMigration, /coalesce\(v_ticket\.season_id, v_lot\.season_id\)/);
  assert.match(correctiveMigration, /v_transformation_ids_after is distinct from v_transformation_ids_before/);
  console.log("PASS 12 migration is DDL-only, repeat-safe and has no receipt/business-data writes");

  await db.close();
  console.log("TZ315 REVERSED INPUT VOID LOCK ORDER 12/12 PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
