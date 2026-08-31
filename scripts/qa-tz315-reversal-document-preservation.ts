import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const correctiveUrl = new URL(
  "../supabase/migrations/20260831113001_tz315_processing_reversal_document_preservation_v1.sql",
  import.meta.url,
);
const reversedVoidUrl = new URL(
  "../supabase/migrations/20260830224100_tz315_reversed_processing_input_ticket_void_v1.sql",
  import.meta.url,
);
const sourceDebitUrl = new URL(
  "../supabase/migrations/20260830211041_tz315_processing_output_source_debit_v1.sql",
  import.meta.url,
);

type Row = Record<string, unknown>;
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows as Row[];
const scalar = async (db: PGlite, sql: string) => Object.values((await rows(db, sql))[0] ?? {})[0];

const COMPANY = "31800000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31800000-0000-4000-8000-000000000002";
const SEASON = "31800000-0000-4000-8000-000000000011";
const ACTOR = "31800000-0000-4000-8000-000000000021";

const PREFX_TICKET = "31800000-0000-4000-8000-000000000101";
const PREFX_TRANSFORMATION = "31800000-0000-4000-8000-000000000102";
const REVERSAL_TICKET = "31800000-0000-4000-8000-000000000201";
const REVERSAL_TRANSFORMATION = "31800000-0000-4000-8000-000000000202";
const MIXED_MUTABLE_TRANSFORMATION = "31800000-0000-4000-8000-000000000203";
const ORDINARY_TICKET = "31800000-0000-4000-8000-000000000301";
const ORDINARY_TRANSFORMATION = "31800000-0000-4000-8000-000000000302";
const STALE_GUARD_TICKET = "31800000-0000-4000-8000-000000000401";
const STALE_GUARD_TRANSFORMATION = "31800000-0000-4000-8000-000000000402";
const FAILED_REVERSAL_TICKET = "31800000-0000-4000-8000-000000000501";
const FAILED_REVERSAL_TRANSFORMATION = "31800000-0000-4000-8000-000000000502";

const normalizeHash = (definition: string) =>
  createHash("md5").update(definition.replace(/\s+/g, " ")).digest("hex");

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema private;

    create table public.companies(id uuid primary key);
    create table public.seasons(
      id uuid primary key,
      company_id uuid not null references public.companies(id)
    );
    create table public.profiles(
      id uuid primary key,
      company_id uuid not null references public.companies(id)
    );
    create table public.tickets(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
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
      company_id uuid not null references public.companies(id),
      season_id uuid not null references public.seasons(id),
      status text not null,
      processing_state text not null
    );
    create table public.batch_transformation_inputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id),
      transformation_id uuid not null references public.batch_transformations(id),
      source_ticket_id uuid
    );
    create table public.batch_transformation_outputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id),
      transformation_id uuid not null references public.batch_transformations(id),
      source_ticket_id uuid
    );
    create table public.batch_processing_reversals(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id),
      season_id uuid not null references public.seasons(id),
      transformation_id uuid not null unique references public.batch_transformations(id),
      actor_user_id uuid not null references public.profiles(id),
      reason text not null,
      idempotency_key text not null,
      request_fingerprint text not null,
      audit_run_code text,
      snapshot jsonb not null,
      reversed_at timestamptz not null,
      created_at timestamptz not null default now(),
      unique(company_id,idempotency_key)
    );
    create table public.batch_processing_events(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id),
      transformation_id uuid not null references public.batch_transformations(id),
      event_type text not null,
      actor_type text not null,
      actor_user_id uuid not null references public.profiles(id),
      idempotency_key text not null,
      observed_at timestamptz not null,
      payload jsonb not null
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid,
      is_storno boolean not null default false
    );
    create table public.test_recompute_calls(
      transformation_id uuid not null,
      called_at timestamptz not null default now()
    );

    insert into public.companies(id) values('${COMPANY}'),('${OTHER_COMPANY}');
    insert into public.seasons(id,company_id) values('${SEASON}','${COMPANY}');
    insert into public.profiles(id,company_id) values('${ACTOR}','${COMPANY}');

    create or replace function public.recompute_grain_processing_shadow_v1(p_transformation_id uuid)
    returns void language plpgsql security definer set search_path = '' as $$
    begin
      insert into public.test_recompute_calls(transformation_id) values(p_transformation_id);
    end $$;

    create or replace function public.attach_route_processing_input_ticket_v1(p_ticket_id uuid)
    returns uuid language sql security definer set search_path = '' as
      $$ select null::uuid $$;

    create or replace function private.processing_output_ticket_trace_valid_v2(p_output_id uuid)
    returns boolean language sql stable security definer set search_path = '' as
      $$ select true $$;

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

    create or replace function private.acquire_transformation_processing_gate_v1(
      p_transformation_id uuid,p_company_id uuid,p_season_id uuid,p_actor_user_id uuid
    ) returns void language plpgsql security definer set search_path = '' as $$
    begin
      perform 1 from public.batch_transformations t
      where t.id=p_transformation_id and t.company_id=p_company_id and t.season_id=p_season_id
      for update;
      if not found then raise exception 'TEST_GATE_SCOPE_INVALID'; end if;
    end $$;

    create or replace function public.void_ticket_with_storno_v2(
      p_ticket_id uuid,p_actor_user_id uuid,p_reason text
    ) returns uuid language plpgsql security definer set search_path = '' as $$
    declare v_ticket public.tickets%rowtype;
    begin
      select * into v_ticket from public.tickets where id=p_ticket_id for update;
      if not found then raise exception 'TEST_TICKET_NOT_FOUND'; end if;
      if v_ticket.company_id is distinct from (select company_id from public.profiles where id=p_actor_user_id) then
        raise exception 'TEST_TICKET_COMPANY_MISMATCH';
      end if;
      if v_ticket.is_voided and v_ticket.status='voided' then return p_ticket_id; end if;
      update public.tickets
      set status='voided',is_finalized=false,is_voided=true,updated_at=now()
      where id=p_ticket_id;
      return p_ticket_id;
    end $$;

    create or replace function public.reverse_processing_material_balance_v1(
      p_transformation_id uuid,p_company_id uuid,p_season_id uuid,p_actor_user_id uuid,
      p_reason text,p_idempotency_key text,p_audit_run_code text default null
    ) returns jsonb language plpgsql security definer set search_path = '' as $$
    declare
      v_t public.batch_transformations%rowtype;
      v_receipt public.batch_processing_reversals%rowtype;
      v_ticket_id uuid;
      v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
      v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
      v_request_fingerprint text;
      v_snapshot jsonb;
      v_now timestamptz := now();
    begin
  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1
  perform private.acquire_transformation_processing_gate_v1(p_transformation_id, p_company_id, p_season_id, p_actor_user_id);
      select * into v_t from public.batch_transformations
      where id=p_transformation_id and company_id=p_company_id and season_id=p_season_id for update;
      if not found then raise exception 'PROCESSING_NOT_FOUND'; end if;
      select * into v_receipt from public.batch_processing_reversals
      where transformation_id=v_t.id;
      if found then
        if v_receipt.idempotency_key=v_idempotency_key then
          return v_receipt.snapshot || jsonb_build_object('idempotent_replay',true);
        end if;
        raise exception 'PROCESSING_ALREADY_REVERSED';
      end if;
      if v_t.status<>'completed' or v_t.processing_state<>'processing_closed' then
        raise exception 'PROCESSING_REVERSAL_REQUIRES_CLOSED';
      end if;
      v_request_fingerprint:=md5(concat_ws('|',v_t.id,p_company_id,p_season_id,p_actor_user_id,v_reason,v_idempotency_key));
  -- Source documents remain, but output tickets are marked voided. Their ledger
  -- rows have already received full-fidelity compensating entries above.
      for v_ticket_id in
        select distinct o.source_ticket_id from public.batch_transformation_outputs o
        where o.transformation_id=v_t.id and o.source_ticket_id is not null
        order by o.source_ticket_id
      loop
        perform public.void_ticket_with_storno_v2(v_ticket_id,p_actor_user_id,v_reason);
      end loop;
      update public.batch_transformations set status='voided' where id=v_t.id;
      v_snapshot:=jsonb_build_object(
        'transformation_id',v_t.id,'company_id',v_t.company_id,'season_id',v_t.season_id,
        'idempotency_key',v_idempotency_key,'request_fingerprint',v_request_fingerprint
      );
      insert into public.batch_processing_reversals(
        company_id,season_id,transformation_id,actor_user_id,reason,idempotency_key,
        request_fingerprint,audit_run_code,snapshot,reversed_at,created_at
      ) values(
        v_t.company_id,v_t.season_id,v_t.id,p_actor_user_id,v_reason,v_idempotency_key,
        v_request_fingerprint,p_audit_run_code,v_snapshot,v_now,v_now
      );
      insert into public.batch_processing_events (
        company_id,transformation_id,event_type,actor_type,actor_user_id,
        idempotency_key,observed_at,payload
      ) values(
        v_t.company_id,v_t.id,'processing_reversed','user',p_actor_user_id,
        v_idempotency_key,v_now,v_snapshot
      );
      return v_snapshot || jsonb_build_object('idempotent_replay',false);
    end $$;
    revoke all on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)
      from public,anon;
    grant execute on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)
      to service_role,authenticated;

    create or replace function private.test_receipt_immutable_v1()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      raise exception 'PROCESSING_REVERSAL_RECEIPT_IMMUTABLE' using errcode='55000';
    end $$;
    create trigger trg_test_receipt_immutable_v1
      before update or delete on public.batch_processing_reversals
      for each row execute function private.test_receipt_immutable_v1();
  `);
}

async function seedTicketAndTransformation(
  db: PGlite,
  ticketId: string,
  transformationId: string,
  status: "completed" | "draft" = "completed",
) {
  const processingState = status === "completed" ? "processing_closed" : "in_processing";
  await db.exec(`
    insert into public.tickets(
      id,company_id,harvest_lot_id,linked_processing_id,processing_output_role,
      is_finalized,is_voided,status
    ) values(
      '${ticketId}','${COMPANY}',gen_random_uuid(),'${transformationId}','GRAIN',true,false,'finalized'
    );
    insert into public.batch_transformations(id,company_id,season_id,status,processing_state)
    values('${transformationId}','${COMPANY}','${SEASON}','${status}','${processingState}');
    insert into public.batch_transformation_inputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${transformationId}','${ticketId}');
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${transformationId}','${ticketId}');
  `);
}

const documentFingerprint = async (db: PGlite, transformationId: string) => scalar(db, `
  select coalesce(jsonb_agg(d order by d.kind,d.id)::text,'[]') from (
    select 'input'::text kind,id,company_id,transformation_id,source_ticket_id
    from public.batch_transformation_inputs where transformation_id='${transformationId}'
    union all
    select 'output'::text kind,id,company_id,transformation_id,source_ticket_id
    from public.batch_transformation_outputs where transformation_id='${transformationId}'
  ) d
`);

const failedReversalFingerprint = async (db: PGlite) => scalar(db, `
  select jsonb_build_object(
    'ticket',(select to_jsonb(t) from public.tickets t where t.id='${FAILED_REVERSAL_TICKET}'),
    'transformation',(select to_jsonb(t) from public.batch_transformations t where t.id='${FAILED_REVERSAL_TRANSFORMATION}'),
    'documents',(${`
      select coalesce(jsonb_agg(d order by d.kind,d.id),'[]'::jsonb) from (
        select 'input'::text kind,id,company_id,transformation_id,source_ticket_id
        from public.batch_transformation_inputs where transformation_id='${FAILED_REVERSAL_TRANSFORMATION}'
        union all
        select 'output'::text kind,id,company_id,transformation_id,source_ticket_id
        from public.batch_transformation_outputs where transformation_id='${FAILED_REVERSAL_TRANSFORMATION}'
      ) d
    `}),
    'receipt',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.batch_processing_reversals r where r.transformation_id='${FAILED_REVERSAL_TRANSFORMATION}'),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.batch_processing_events e where e.transformation_id='${FAILED_REVERSAL_TRANSFORMATION}')
  )::text
`);

async function main() {
  const db = new PGlite();
  const corrective = await readFile(correctiveUrl, "utf8");
  const reversedVoid = await readFile(reversedVoidUrl, "utf8");
  const sourceDebit = await readFile(sourceDebitUrl, "utf8");
  await bootstrap(db);
  await db.exec(reversedVoid);

  assert.match(corrective, /485073abd5b8f85cd65c482e2779fe60/);
  assert.match(corrective, /4d3b289a4acb497d835660525f8e37df/);
  assert.match(corrective, /TZ315_REVERSAL_DOCUMENT_PRESERVE_REVERSE_HASH_MISMATCH/);
  assert.match(corrective, /backend_pid = pg_catalog\.pg_backend_pid\(\)/);
  assert.match(corrective, /transaction_id = pg_catalog\.txid_current\(\)/);
  assert.doesNotMatch(corrective, /(?:insert|update|delete)\s+.*batch_transformation_(?:inputs|outputs).*where\s+transformation_id\s+in\s*\(/i);
  console.log("PASS 01 migration is new, exact-hash guarded and uses same-backend/same-XID scope");

  await seedTicketAndTransformation(db, PREFX_TICKET, PREFX_TRANSFORMATION);
  await scalar(db, `select public.reverse_processing_material_balance_v1(
    '${PREFX_TRANSFORMATION}','${COMPANY}','${SEASON}','${ACTOR}',
    'pre-fix proof','pre-fix-reversal-1','TZ315-PREFX'
  )`);
  assert.equal(await documentFingerprint(db, PREFX_TRANSFORMATION), "[]");
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_processing_reversals where transformation_id='${PREFX_TRANSFORMATION}'`)), 1);
  console.log("PASS 02 pre-fix actual reversal-to-void chain reproduces document deletion before receipt");

  const gatedDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure)
  `));
  const gateFragment = "  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_transformation_processing_gate_v1(p_transformation_id, p_company_id, p_season_id, p_actor_user_id);\n";
  const testBaseHash = normalizeHash(gatedDefinition.replace(gateFragment, ""));
  assert.notEqual(testBaseHash, "485073abd5b8f85cd65c482e2779fe60");
  const executableCorrective = corrective.replace(
    "'4d3b289a4acb497d835660525f8e37df'\n  ]::text[]",
    `'4d3b289a4acb497d835660525f8e37df',\n    '${testBaseHash}'\n  ]::text[]`,
  );
  assert.notEqual(executableCorrective, corrective);
  await db.exec(executableCorrective);
  await db.exec(executableCorrective);

  assert.equal(
    await scalar(db, "select has_table_privilege('service_role','private.processing_reversal_in_progress_v1','INSERT')"),
    false,
  );
  assert.equal(
    await scalar(db, "select has_function_privilege('authenticated','private.processing_reversal_document_preserved_v1(uuid,uuid)','EXECUTE')"),
    false,
  );
  assert.equal(Number(await scalar(db, "select count(*) from private.processing_reversal_in_progress_v1")), 0);
  assert.equal(
    normalizeHash(String(await scalar(db, `select pg_get_functiondef('private.processing_reversal_document_preserved_v1(uuid,uuid)'::regprocedure)`))),
    "9331eefadd94c9fce66f4ffe523a7cf9",
  );
  console.log("PASS 03 corrective compiles twice with exact physical metadata, empty guard and no direct guard API");

  await seedTicketAndTransformation(db, REVERSAL_TICKET, REVERSAL_TRANSFORMATION);
  await db.exec(`
    insert into public.batch_transformations(id,company_id,season_id,status,processing_state)
    values('${MIXED_MUTABLE_TRANSFORMATION}','${COMPANY}','${SEASON}','draft','in_processing');
    insert into public.batch_transformation_inputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${MIXED_MUTABLE_TRANSFORMATION}','${REVERSAL_TICKET}');
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${MIXED_MUTABLE_TRANSFORMATION}','${REVERSAL_TICKET}');
  `);
  const reversalBefore = await documentFingerprint(db, REVERSAL_TRANSFORMATION);
  const first = await scalar(db, `select public.reverse_processing_material_balance_v1(
    '${REVERSAL_TRANSFORMATION}','${COMPANY}','${SEASON}','${ACTOR}',
    'canonical reversal','reversal-preserve-1','TZ315-PRESERVE'
  )`);
  assert.equal(await documentFingerprint(db, REVERSAL_TRANSFORMATION), reversalBefore);
  assert.equal(await documentFingerprint(db, MIXED_MUTABLE_TRANSFORMATION), "[]");
  assert.equal(Number(await scalar(db, `select count(*) from public.test_recompute_calls where transformation_id='${MIXED_MUTABLE_TRANSFORMATION}'`)), 1);
  assert.equal(Number(await scalar(db, "select count(*) from private.processing_reversal_in_progress_v1")), 0);
  console.log("PASS 04 actual reversal preserves only its closed documents and still cleans mixed mutable shadows");

  const eventCountBeforeReplay = Number(await scalar(db, `select count(*) from public.batch_processing_events where transformation_id='${REVERSAL_TRANSFORMATION}'`));
  const replay = await scalar(db, `select public.reverse_processing_material_balance_v1(
    '${REVERSAL_TRANSFORMATION}','${COMPANY}','${SEASON}','${ACTOR}',
    'canonical reversal','reversal-preserve-1','TZ315-PRESERVE'
  )`);
  assert.equal((first as { idempotent_replay: boolean }).idempotent_replay, false);
  assert.equal((replay as { idempotent_replay: boolean }).idempotent_replay, true);
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_processing_reversals where transformation_id='${REVERSAL_TRANSFORMATION}'`)), 1);
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_processing_events where transformation_id='${REVERSAL_TRANSFORMATION}'`)), eventCountBeforeReplay);
  assert.equal(await documentFingerprint(db, REVERSAL_TRANSFORMATION), reversalBefore);
  await assert.rejects(
    () => db.query(`update public.batch_processing_reversals set reason='tamper' where transformation_id='${REVERSAL_TRANSFORMATION}'`),
    /PROCESSING_REVERSAL_RECEIPT_IMMUTABLE/,
  );
  console.log("PASS 05 immutable receipt and repeated reversal remain idempotent without document churn");

  await seedTicketAndTransformation(db, ORDINARY_TICKET, ORDINARY_TRANSFORMATION, "draft");
  await scalar(db, `select public.void_ticket_with_storno_v2('${ORDINARY_TICKET}','${ACTOR}','ordinary void')`);
  assert.equal(await documentFingerprint(db, ORDINARY_TRANSFORMATION), "[]");
  assert.equal(Number(await scalar(db, `select count(*) from public.test_recompute_calls where transformation_id='${ORDINARY_TRANSFORMATION}'`)), 1);
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_processing_reversals where transformation_id='${ORDINARY_TRANSFORMATION}'`)), 0);
  console.log("PASS 06 ordinary mutable ticket void still deletes and recomputes its shadows");

  await seedTicketAndTransformation(db, STALE_GUARD_TICKET, STALE_GUARD_TRANSFORMATION, "draft");
  await db.exec(`
    insert into private.processing_reversal_in_progress_v1(
      transformation_id,company_id,season_id,actor_user_id,idempotency_key,
      backend_pid,transaction_id
    ) values(
      '${STALE_GUARD_TRANSFORMATION}','${COMPANY}','${SEASON}','${ACTOR}','not-this-xid',
      pg_backend_pid(),txid_current()+1000000
    );
  `);
  await scalar(db, `select public.void_ticket_with_storno_v2('${STALE_GUARD_TICKET}','${ACTOR}','stale guard must not preserve')`);
  assert.equal(await documentFingerprint(db, STALE_GUARD_TRANSFORMATION), "[]");
  await db.exec(`delete from private.processing_reversal_in_progress_v1 where transformation_id='${STALE_GUARD_TRANSFORMATION}'`);
  console.log("PASS 07 a guard from a different XID cannot broaden preservation");

  await seedTicketAndTransformation(db, FAILED_REVERSAL_TICKET, FAILED_REVERSAL_TRANSFORMATION);
  await db.exec(`
    create or replace function private.test_force_reversal_receipt_failure_v1()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      if new.transformation_id='${FAILED_REVERSAL_TRANSFORMATION}' then
        raise exception 'TEST_FORCED_MID_REVERSAL_FAILURE' using errcode='40001';
      end if;
      return new;
    end $$;
    create trigger trg_test_force_reversal_receipt_failure_v1
      before insert on public.batch_processing_reversals
      for each row execute function private.test_force_reversal_receipt_failure_v1();
  `);
  const failedBefore = await failedReversalFingerprint(db);
  await assert.rejects(
    () => db.query(`select public.reverse_processing_material_balance_v1(
      '${FAILED_REVERSAL_TRANSFORMATION}','${COMPANY}','${SEASON}','${ACTOR}',
      'forced rollback','forced-rollback-1','TZ315-ROLLBACK'
    )`),
    /TEST_FORCED_MID_REVERSAL_FAILURE/,
  );
  assert.equal(await failedReversalFingerprint(db), failedBefore);
  assert.equal(Number(await scalar(db, "select count(*) from private.processing_reversal_in_progress_v1")), 0);
  await db.exec(`
    drop trigger trg_test_force_reversal_receipt_failure_v1 on public.batch_processing_reversals;
    drop function private.test_force_reversal_receipt_failure_v1();
  `);
  console.log("PASS 08 forced failure after ticket void rolls back guard, documents, receipt, event, ticket and transformation");

  const reverseDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure)
  `));
  assert.equal((reverseDefinition.match(/TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1/g) ?? []).length, 1);
  assert.equal((reverseDefinition.match(/TZ315_REVERSAL_DOCUMENT_GUARD_END_V1/g) ?? []).length, 1);
  assert.ok(reverseDefinition.indexOf("TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1") < reverseDefinition.indexOf("perform public.void_ticket_with_storno_v2"));
  assert.ok(reverseDefinition.indexOf("insert into public.batch_processing_reversals") < reverseDefinition.indexOf("TZ315_REVERSAL_DOCUMENT_GUARD_END_V1"));
  console.log("PASS 09 physical order is guard begin -> canonical void -> receipt -> exact guard end");

  const sourceDebitComment = sourceDebit.indexOf("-- Replace only the obsolete");
  const sourceDebitPatchStart = sourceDebit.indexOf("do $migration$", sourceDebitComment);
  const sourceDebitPatchEnd = sourceDebit.indexOf("-- Reversal must prove", sourceDebitPatchStart);
  assert.ok(sourceDebitComment >= 0 && sourceDebitPatchStart > sourceDebitComment && sourceDebitPatchEnd > sourceDebitPatchStart);
  const sourceDebitReversePatch = sourceDebit.slice(sourceDebitPatchStart, sourceDebitPatchEnd);
  const compatibilityAnchorPosition = reverseDefinition.search(/\n\s*v_request_fingerprint\s*:=/);
  assert.ok(compatibilityAnchorPosition > 0);
  const legacyTraceFixture = `  if exists (
    select 1
    from public.batch_transformation_outputs o
    where o.transformation_id = v_t.id
      and (
        false
        or 1 <> (
          select count(*)
          from public.stock_ledger_entries sle
          where not coalesce(sle.is_storno, false)
            and sle.ticket_id = o.source_ticket_id
        )
      )
  ) then
    raise exception 'TEST_ONLY_SOURCE_DEBIT_FIXTURE';
  end if;
`;
  await db.exec(
    reverseDefinition.slice(0, compatibilityAnchorPosition + 1)
      + legacyTraceFixture
      + reverseDefinition.slice(compatibilityAnchorPosition + 1),
  );
  const metadataBeforeSourceDebit = await scalar(db, `
    select jsonb_build_object(
      'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
      'config',p.proconfig,'acl',p.proacl::text
    )::text
    from pg_proc p
    where p.oid='public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  `);
  await db.exec(sourceDebitReversePatch);
  const sourceDebitPatchedDefinition = String(await scalar(db, `
    select pg_get_functiondef('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure)
  `));
  const metadataAfterSourceDebit = await scalar(db, `
    select jsonb_build_object(
      'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
      'config',p.proconfig,'acl',p.proacl::text
    )::text
    from pg_proc p
    where p.oid='public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  `);
  assert.equal((sourceDebitPatchedDefinition.match(/TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1/g) ?? []).length, 1);
  assert.equal((sourceDebitPatchedDefinition.match(/TZ315_REVERSAL_DOCUMENT_GUARD_END_V1/g) ?? []).length, 1);
  assert.match(sourceDebitPatchedDefinition, /processing_output_ticket_trace_valid_v2\(o\.id\)/);
  assert.equal(metadataAfterSourceDebit, metadataBeforeSourceDebit);
  console.log("PASS 10 the exact source-debit regex patch preserves both guard markers and function metadata");

  await db.close();
  console.log("TZ315 REVERSAL DOCUMENT PRESERVATION 10/10 PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
