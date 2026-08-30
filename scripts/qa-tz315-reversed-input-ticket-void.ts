import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830224100_tz315_reversed_processing_input_ticket_void_v1.sql",
  import.meta.url,
);

type Row = Record<string, unknown>;
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows as Row[];
const scalar = async (db: PGlite, sql: string) => Object.values((await rows(db, sql))[0] ?? {})[0];

const COMPANY = "31700000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31700000-0000-4000-8000-000000000002";
const SEASON = "31700000-0000-4000-8000-000000000011";
const OTHER_SEASON = "31700000-0000-4000-8000-000000000012";
const REVERSED_TICKET = "31700000-0000-4000-8000-000000000101";
const REVERSED_TRANSFORMATION = "31700000-0000-4000-8000-000000000102";
const MIXED_TICKET = "31700000-0000-4000-8000-000000000201";
const MIXED_REVERSED_TRANSFORMATION = "31700000-0000-4000-8000-000000000202";
const MIXED_MUTABLE_TRANSFORMATION = "31700000-0000-4000-8000-000000000203";
const FOREIGN_TICKET = "31700000-0000-4000-8000-000000000301";
const FOREIGN_TRANSFORMATION = "31700000-0000-4000-8000-000000000302";
const CORRUPT_TICKET = "31700000-0000-4000-8000-000000000401";
const CORRUPT_TRANSFORMATION = "31700000-0000-4000-8000-000000000402";

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema private;

    create table public.tickets(
      id uuid primary key,
      company_id uuid not null,
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
      created_at timestamptz not null default now(),
      unique(company_id, idempotency_key)
    );
    create table public.test_recompute_calls(
      transformation_id uuid not null,
      called_at timestamptz not null default now()
    );

    create or replace function private.enforce_processing_reversal_documents_v1()
    returns trigger language plpgsql security definer set search_path = '' as $$
    declare v_old uuid; v_new uuid;
    begin
      if tg_op <> 'INSERT' then v_old := old.transformation_id; end if;
      if tg_op <> 'DELETE' then v_new := new.transformation_id; end if;
      if exists(
        select 1 from public.batch_processing_reversals r
        where r.transformation_id=v_old or r.transformation_id=v_new
      ) then
        raise exception 'PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE' using errcode='55000';
      end if;
      if tg_op='DELETE' then return old; end if;
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

    -- Reproduce the physical pre-corrective synchronizer: voiding a ticket
    -- unconditionally deletes its processing documents.
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

    -- Exact WIP-handoff behaviour required immediately before the corrective.
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

    create or replace function public.test_reverse_processing_v1(
      p_transformation_id uuid,
      p_company_id uuid,
      p_season_id uuid,
      p_idempotency_key text
    ) returns uuid language plpgsql security definer set search_path = '' as $$
    declare v_t public.batch_transformations%rowtype; v_receipt_id uuid;
    begin
      select * into v_t from public.batch_transformations where id=p_transformation_id for update;
      if not found then raise exception 'TEST_REVERSAL_NOT_FOUND'; end if;
      if v_t.company_id is distinct from p_company_id or v_t.season_id is distinct from p_season_id then
        raise exception 'TEST_REVERSAL_COMPANY_SEASON_MISMATCH';
      end if;
      select id into v_receipt_id from public.batch_processing_reversals
      where transformation_id=p_transformation_id;
      if found then return v_receipt_id; end if;
      insert into public.batch_processing_reversals(
        company_id,season_id,transformation_id,idempotency_key
      ) values(p_company_id,p_season_id,p_transformation_id,p_idempotency_key)
      returning id into v_receipt_id;
      update public.batch_transformations set status='reversed' where id=p_transformation_id;
      return v_receipt_id;
    end $$;

    create or replace function public.test_void_ticket_v1(p_ticket_id uuid, p_company_id uuid)
    returns uuid language plpgsql security definer set search_path = '' as $$
    declare v_ticket public.tickets%rowtype;
    begin
      select * into v_ticket from public.tickets where id=p_ticket_id for update;
      if not found then raise exception 'TEST_TICKET_NOT_FOUND'; end if;
      if v_ticket.company_id is distinct from p_company_id then
        raise exception 'TEST_TICKET_COMPANY_MISMATCH';
      end if;
      if v_ticket.is_voided and v_ticket.status='voided' then return v_ticket.id; end if;
      update public.tickets
      set status='voided',is_finalized=false,is_voided=true,updated_at=now()
      where id=p_ticket_id;
      return p_ticket_id;
    end $$;
  `);
}

async function seedTicketAndTransformation(
  db: PGlite,
  ticketId: string,
  transformationId: string,
  companyId: string,
  seasonId: string,
) {
  await db.exec(`
    insert into public.tickets(id,company_id,harvest_lot_id,is_finalized,is_voided,status)
    values('${ticketId}','${companyId}',gen_random_uuid(),true,false,'finalized');
    insert into public.batch_transformations(id,company_id,season_id,status)
    values('${transformationId}','${companyId}','${seasonId}','completed');
    insert into public.batch_transformation_inputs(company_id,transformation_id,source_ticket_id)
    values('${companyId}','${transformationId}','${ticketId}');
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${companyId}','${transformationId}','${ticketId}');
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
  const migration = await readFile(migrationUrl, "utf8");
  await bootstrap(db);

  assert.match(migration, /REQUIRES_WIP_HANDOFF_V1/);
  assert.match(migration, /not exists \([\s\S]*batch_processing_reversals/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.batch_processing_reversals/i);
  console.log("PASS 01 corrective is ordered after WIP and never deletes reversal receipts");

  await seedTicketAndTransformation(db, REVERSED_TICKET, REVERSED_TRANSFORMATION, COMPANY, SEASON);
  const receipt = await scalar(db, `select public.test_reverse_processing_v1(
    '${REVERSED_TRANSFORMATION}','${COMPANY}','${SEASON}','reversed-input-1'
  )`);
  const replayReceipt = await scalar(db, `select public.test_reverse_processing_v1(
    '${REVERSED_TRANSFORMATION}','${COMPANY}','${SEASON}','reversed-input-1'
  )`);
  assert.equal(replayReceipt, receipt);
  const beforeDocuments = await documentFingerprint(db, REVERSED_TICKET);

  await assert.rejects(
    () => db.query(`select public.test_void_ticket_v1('${REVERSED_TICKET}','${COMPANY}')`),
    /PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE/,
  );
  assert.equal(await scalar(db, `select status from public.tickets where id='${REVERSED_TICKET}'`), "finalized");
  assert.equal(await documentFingerprint(db, REVERSED_TICKET), beforeDocuments);
  console.log("PASS 02 regression reproduced: pre-fix reversal blocks canonical input-ticket void");

  await db.exec(migration);
  await db.exec(migration);
  assert.equal(
    await scalar(db, "select has_function_privilege('authenticated','private.reconcile_voided_ticket_processing_shadow_v1(uuid)','EXECUTE')"),
    false,
  );
  assert.equal(
    await scalar(db, "select has_function_privilege('service_role','private.reconcile_voided_ticket_processing_shadow_v1(uuid)','EXECUTE')"),
    false,
  );
  assert.equal(
    await scalar(db, "select has_function_privilege('service_role','public.tg_sync_grain_movement_shadow_v1()','EXECUTE')"),
    true,
  );
  console.log("PASS 03 corrective compiles twice and helper remains trigger-internal");

  await scalar(db, `select public.test_void_ticket_v1('${REVERSED_TICKET}','${COMPANY}')`);
  assert.equal(await scalar(db, `select status from public.tickets where id='${REVERSED_TICKET}'`), "voided");
  assert.equal(await documentFingerprint(db, REVERSED_TICKET), beforeDocuments);
  assert.equal(
    Number(await scalar(db, `select count(*) from public.test_recompute_calls where transformation_id='${REVERSED_TRANSFORMATION}'`)),
    0,
  );
  await assert.rejects(
    () => db.query(`delete from public.batch_transformation_inputs where transformation_id='${REVERSED_TRANSFORMATION}'`),
    /PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE/,
  );
  console.log("PASS 04 reversed input/output documents survive ticket void unchanged and remain immutable");

  const replayBefore = (await rows(db, `
    select updated_at,
      (select count(*) from public.batch_transformation_inputs where source_ticket_id='${REVERSED_TICKET}') input_count,
      (select count(*) from public.batch_transformation_outputs where source_ticket_id='${REVERSED_TICKET}') output_count,
      (select count(*) from public.test_recompute_calls) recompute_count
    from public.tickets where id='${REVERSED_TICKET}'
  `))[0];
  await scalar(db, `select public.test_void_ticket_v1('${REVERSED_TICKET}','${COMPANY}')`);
  const replayAfter = (await rows(db, `
    select updated_at,
      (select count(*) from public.batch_transformation_inputs where source_ticket_id='${REVERSED_TICKET}') input_count,
      (select count(*) from public.batch_transformation_outputs where source_ticket_id='${REVERSED_TICKET}') output_count,
      (select count(*) from public.test_recompute_calls) recompute_count
    from public.tickets where id='${REVERSED_TICKET}'
  `))[0];
  assert.deepEqual(replayAfter, replayBefore);
  console.log("PASS 05 repeated ticket void is idempotent and does not churn audit documents");

  await seedTicketAndTransformation(db, MIXED_TICKET, MIXED_REVERSED_TRANSFORMATION, COMPANY, SEASON);
  await db.exec(`
    insert into public.batch_transformations(id,company_id,season_id,status)
    values('${MIXED_MUTABLE_TRANSFORMATION}','${COMPANY}','${SEASON}','draft');
    insert into public.batch_transformation_inputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${MIXED_MUTABLE_TRANSFORMATION}','${MIXED_TICKET}');
    insert into public.batch_transformation_outputs(company_id,transformation_id,source_ticket_id)
    values('${COMPANY}','${MIXED_MUTABLE_TRANSFORMATION}','${MIXED_TICKET}');
  `);
  await scalar(db, `select public.test_reverse_processing_v1(
    '${MIXED_REVERSED_TRANSFORMATION}','${COMPANY}','${SEASON}','mixed-reversed-1'
  )`);
  const mixedReversedBefore = await scalar(db, `
    select jsonb_agg(d order by d.kind,d.id)::text from (
      select 'input' kind,id,company_id,transformation_id,source_ticket_id
      from public.batch_transformation_inputs where transformation_id='${MIXED_REVERSED_TRANSFORMATION}'
      union all
      select 'output' kind,id,company_id,transformation_id,source_ticket_id
      from public.batch_transformation_outputs where transformation_id='${MIXED_REVERSED_TRANSFORMATION}'
    ) d
  `);
  await scalar(db, `select public.test_void_ticket_v1('${MIXED_TICKET}','${COMPANY}')`);
  assert.equal(
    Number(await scalar(db, `select count(*) from public.batch_transformation_inputs where transformation_id='${MIXED_MUTABLE_TRANSFORMATION}'`)),
    0,
  );
  assert.equal(
    Number(await scalar(db, `select count(*) from public.batch_transformation_outputs where transformation_id='${MIXED_MUTABLE_TRANSFORMATION}'`)),
    0,
  );
  assert.equal(
    Number(await scalar(db, `select count(*) from public.test_recompute_calls where transformation_id='${MIXED_MUTABLE_TRANSFORMATION}'`)),
    1,
  );
  const mixedReversedAfter = await scalar(db, `
    select jsonb_agg(d order by d.kind,d.id)::text from (
      select 'input' kind,id,company_id,transformation_id,source_ticket_id
      from public.batch_transformation_inputs where transformation_id='${MIXED_REVERSED_TRANSFORMATION}'
      union all
      select 'output' kind,id,company_id,transformation_id,source_ticket_id
      from public.batch_transformation_outputs where transformation_id='${MIXED_REVERSED_TRANSFORMATION}'
    ) d
  `);
  assert.equal(mixedReversedAfter, mixedReversedBefore);
  console.log("PASS 06 mixed ticket cleans/recomputes only mutable shadows and preserves reversed lineage");

  await seedTicketAndTransformation(db, FOREIGN_TICKET, FOREIGN_TRANSFORMATION, OTHER_COMPANY, OTHER_SEASON);
  const companyDocumentsBefore = await documentFingerprint(db, REVERSED_TICKET);
  await scalar(db, `select public.test_reverse_processing_v1(
    '${FOREIGN_TRANSFORMATION}','${OTHER_COMPANY}','${OTHER_SEASON}','foreign-reversed-1'
  )`);
  await scalar(db, `select public.test_void_ticket_v1('${FOREIGN_TICKET}','${OTHER_COMPANY}')`);
  assert.equal(await scalar(db, `select status from public.tickets where id='${FOREIGN_TICKET}'`), "voided");
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_transformation_inputs where transformation_id='${FOREIGN_TRANSFORMATION}'`)), 1);
  assert.equal(await documentFingerprint(db, REVERSED_TICKET), companyDocumentsBefore);
  await assert.rejects(
    () => db.query(`select public.test_void_ticket_v1('${FOREIGN_TICKET}','${COMPANY}')`),
    /TEST_TICKET_COMPANY_MISMATCH/,
  );
  console.log("PASS 07 independent company ticket is handled in its own boundary only");

  await db.exec(`
    insert into public.tickets(id,company_id,harvest_lot_id,is_finalized,is_voided,status)
    values('${CORRUPT_TICKET}','${COMPANY}',gen_random_uuid(),true,false,'finalized');
    insert into public.batch_transformations(id,company_id,season_id,status)
    values('${CORRUPT_TRANSFORMATION}','${OTHER_COMPANY}','${OTHER_SEASON}','completed');
    insert into public.batch_transformation_inputs(company_id,transformation_id,source_ticket_id)
    values('${OTHER_COMPANY}','${CORRUPT_TRANSFORMATION}','${CORRUPT_TICKET}');
  `);
  await scalar(db, `select public.test_reverse_processing_v1(
    '${CORRUPT_TRANSFORMATION}','${OTHER_COMPANY}','${OTHER_SEASON}','corrupt-link-reversed-1'
  )`);
  await assert.rejects(
    () => db.query(`select public.test_void_ticket_v1('${CORRUPT_TICKET}','${COMPANY}')`),
    /TZ315_REVERSED_INPUT_VOID_COMPANY_SEASON_MISMATCH/,
  );
  assert.equal(await scalar(db, `select status from public.tickets where id='${CORRUPT_TICKET}'`), "finalized");
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_transformation_inputs where transformation_id='${CORRUPT_TRANSFORMATION}'`)), 1);
  console.log("PASS 08 corrupt cross-company lineage fails atomically without deleting evidence");

  await db.close();
  console.log("TZ315 REVERSED INPUT TICKET VOID 8/8 PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
