-- TZ315 P0: whole-cycle reversal calls canonical ticket storno before it can
-- write the immutable reversal receipt.  The ticket shadow trigger therefore
-- needs a transaction-local, transformation-exact preservation proof for that
-- short interval.  This migration does not restore or mutate historical rows.

begin;

do $migration$
declare
  v_reverse_definition text;
  v_reverse_base_definition text;
  v_reconcile_definition text;
  v_trigger_definition text;
  v_gate_fragment constant text := E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_transformation_processing_gate_v1(p_transformation_id, p_company_id, p_season_id, p_actor_user_id);\n';
  v_guard_begin_pos integer;
  v_guard_end_pos integer;
  v_anchor_pos integer;
  v_reverse_hash text;
  v_reconcile_hash text;
  v_trigger_hash text;
begin
  if to_regprocedure('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)') is null
     or to_regprocedure('public.void_ticket_with_storno_v2(uuid,uuid,text)') is null
     or to_regprocedure('private.reconcile_voided_ticket_processing_shadow_v1(uuid)') is null
     or to_regprocedure('public.tg_sync_grain_movement_shadow_v1()') is null
     or to_regprocedure('public.sync_grain_movement_shadow_v1(uuid)') is null
     or to_regprocedure('public.recompute_grain_processing_shadow_v1(uuid)') is null
  then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_PREREQUISITE_MISSING'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  ) into v_reverse_definition;
  select pg_catalog.pg_get_functiondef(
    'private.reconcile_voided_ticket_processing_shadow_v1(uuid)'::regprocedure
  ) into v_reconcile_definition;
  select pg_catalog.pg_get_functiondef(
    'public.tg_sync_grain_movement_shadow_v1()'::regprocedure
  ) into v_trigger_definition;

  -- The universal gate must run first.  Applying it afterwards would reject
  -- the intentionally changed reversal body and could silently omit locking.
  if pg_catalog.strpos(v_reverse_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') = 0 then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_REQUIRES_UNIVERSAL_GATE_V1'
      using errcode = '55000';
  end if;

  -- Normalize a repeat application back to the exact pre-gate canonical body,
  -- then require one of the two reviewed hashes (before/after source-debit).
  v_reverse_base_definition := v_reverse_definition;
  v_guard_end_pos := pg_catalog.strpos(
    v_reverse_base_definition,
    '  -- TZ315_REVERSAL_DOCUMENT_GUARD_END_V1'
  );
  if v_guard_end_pos > 0 then
    v_anchor_pos := pg_catalog.strpos(
      v_reverse_base_definition,
      '  insert into public.batch_processing_events ('
    );
    if v_anchor_pos <= v_guard_end_pos then
      raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_END_MARKER_MISMATCH'
        using errcode = '55000';
    end if;
    v_reverse_base_definition := pg_catalog.overlay(
      v_reverse_base_definition,
      '',
      v_guard_end_pos,
      v_anchor_pos - v_guard_end_pos
    );
  end if;

  v_guard_begin_pos := pg_catalog.strpos(
    v_reverse_base_definition,
    '  -- TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1'
  );
  if v_guard_begin_pos > 0 then
    v_anchor_pos := pg_catalog.strpos(
      v_reverse_base_definition,
      '  -- Source documents remain, but output tickets are marked voided. Their ledger'
    );
    if v_anchor_pos <= v_guard_begin_pos then
      raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_BEGIN_MARKER_MISMATCH'
        using errcode = '55000';
    end if;
    v_reverse_base_definition := pg_catalog.overlay(
      v_reverse_base_definition,
      '',
      v_guard_begin_pos,
      v_anchor_pos - v_guard_begin_pos
    );
  end if;

  if pg_catalog.strpos(v_reverse_base_definition, v_gate_fragment) = 0
     or (
       pg_catalog.length(v_reverse_base_definition)
       - pg_catalog.length(pg_catalog.replace(v_reverse_base_definition, v_gate_fragment, ''))
     ) <> pg_catalog.length(v_gate_fragment)
  then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GATE_FRAGMENT_MISMATCH'
      using errcode = '55000';
  end if;
  v_reverse_base_definition := pg_catalog.replace(
    v_reverse_base_definition,
    v_gate_fragment,
    ''
  );
  v_reverse_hash := pg_catalog.md5(
    pg_catalog.regexp_replace(v_reverse_base_definition, '\s+', ' ', 'g')
  );
  if not (v_reverse_hash = any(array[
    '485073abd5b8f85cd65c482e2779fe60',
    '4d3b289a4acb497d835660525f8e37df'
  ]::text[])) then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_REVERSE_HASH_MISMATCH|%',
      v_reverse_hash using errcode = '55000';
  end if;

  if pg_catalog.strpos(v_reverse_definition, 'perform public.void_ticket_with_storno_v2') = 0
     or pg_catalog.strpos(v_reverse_definition, 'insert into public.batch_processing_reversals') = 0
     or pg_catalog.strpos(v_reverse_definition, 'perform public.void_ticket_with_storno_v2')
        >= pg_catalog.strpos(v_reverse_definition, 'insert into public.batch_processing_reversals')
  then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_SEQUENCE_MISMATCH'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(v_reconcile_definition, 'delete from public.batch_transformation_inputs') = 0
     or pg_catalog.strpos(v_reconcile_definition, 'delete from public.batch_transformation_outputs') = 0
     or pg_catalog.strpos(v_reconcile_definition, 'batch_processing_reversals') = 0
  then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_RECONCILE_BODY_MISMATCH'
      using errcode = '55000';
  end if;

  v_reconcile_hash := pg_catalog.md5(
    pg_catalog.regexp_replace(v_reconcile_definition, '\s+', ' ', 'g')
  );
  if (
    pg_catalog.strpos(v_reconcile_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_RECONCILE_V1') = 0
    and v_reconcile_hash <> 'aa20fab3f0325204e7b9b3b667f621ff'
  ) or (
    pg_catalog.strpos(v_reconcile_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_RECONCILE_V1') > 0
    and v_reconcile_hash <> '6836f70f0a85491b9b0a0d4b26e47a75'
  ) then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_RECONCILE_HASH_MISMATCH'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(v_trigger_definition, 'perform private.reconcile_voided_ticket_processing_shadow_v1(new.id);') = 0
     or pg_catalog.strpos(v_trigger_definition, 'perform public.sync_grain_movement_shadow_v1(new.id);') = 0
     or pg_catalog.strpos(v_trigger_definition, 'perform public.attach_route_processing_input_ticket_v1(new.id);') = 0
  then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_TRIGGER_BODY_MISMATCH'
      using errcode = '55000';
  end if;

  v_trigger_hash := pg_catalog.md5(
    pg_catalog.regexp_replace(v_trigger_definition, '\s+', ' ', 'g')
  );
  if (
    pg_catalog.strpos(v_trigger_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_TRIGGER_V1') = 0
    and v_trigger_hash <> '013809def26106fd8476c37f9920eabc'
  ) or (
    pg_catalog.strpos(v_trigger_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_TRIGGER_V1') > 0
    and v_trigger_hash <> '134911c20ba76aa083722c14788da811'
  ) then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_TRIGGER_HASH_MISMATCH'
      using errcode = '55000';
  end if;
end
$migration$;

create table if not exists private.processing_reversal_in_progress_v1 (
  transformation_id uuid primary key
    references public.batch_transformations(id),
  company_id uuid not null
    references public.companies(id),
  season_id uuid not null
    references public.seasons(id),
  actor_user_id uuid not null
    references public.profiles(id),
  idempotency_key text not null,
  backend_pid integer not null,
  transaction_id bigint not null,
  started_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint processing_reversal_in_progress_key_v1_check
    check (pg_catalog.length(pg_catalog.btrim(idempotency_key)) between 1 and 200),
  constraint processing_reversal_in_progress_backend_v1_check
    check (backend_pid > 0),
  constraint processing_reversal_in_progress_transaction_v1_check
    check (transaction_id > 0)
);

revoke all privileges
  on table private.processing_reversal_in_progress_v1
  from public, anon, authenticated, service_role;

comment on table private.processing_reversal_in_progress_v1 is
  'Transaction-local TZ315 reversal guard. Successful and failed RPC calls leave this table empty.';

-- Block reversal and ticket DML while the three function bodies are replaced.
-- The lock is held only for this migration transaction and changes no rows.
set local lock_timeout = '5s';
lock table
  public.batch_transformations,
  public.tickets,
  public.batch_transformation_inputs,
  public.batch_transformation_outputs,
  public.batch_processing_reversals,
  private.processing_reversal_in_progress_v1
in share row exclusive mode;

create or replace function private.processing_reversal_document_preserved_v1(
  p_transformation_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.batch_transformations t
    where t.id = p_transformation_id
      and t.company_id = p_company_id
      and (
        exists (
          select 1
          from public.batch_processing_reversals r
          where r.transformation_id = t.id
            and r.company_id = t.company_id
            and r.season_id = t.season_id
        )
        or exists (
          select 1
          from private.processing_reversal_in_progress_v1 g
          where g.transformation_id = t.id
            and g.company_id = t.company_id
            and g.season_id = t.season_id
            and g.backend_pid = pg_catalog.pg_backend_pid()
            and g.transaction_id = pg_catalog.txid_current()
        )
      )
  );
$function$;

revoke all on function private.processing_reversal_document_preserved_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.reconcile_voided_ticket_processing_shadow_v1(
  p_ticket_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_transformation_id uuid;
begin
  -- TZ315_REVERSAL_DOCUMENT_GUARD_RECONCILE_V1
  -- Use one fixed lock order.  The private guard is checked only for the same
  -- backend and transaction that owns the exact transformation reversal.
  lock table
    public.batch_transformation_inputs,
    public.batch_transformation_outputs
  in share row exclusive mode;
  lock table public.batch_processing_reversals in share row exclusive mode;
  lock table private.processing_reversal_in_progress_v1 in share row exclusive mode;

  select *
  into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for share;

  if not found then
    raise exception 'TZ315_TICKET_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_ticket.is_finalized
     and not v_ticket.is_voided
     and v_ticket.status = 'finalized'
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_REQUIRES_VOIDED_TICKET'
      using errcode = '23514';
  end if;

  -- Any document, receipt, or same-transaction guard outside the ticket's
  -- company/season is corruption.  Fail closed instead of deleting evidence.
  if exists (
    select 1
    from public.batch_transformation_inputs i
    left join public.batch_transformations t on t.id = i.transformation_id
    left join public.batch_processing_reversals r on r.transformation_id = i.transformation_id
    left join private.processing_reversal_in_progress_v1 g
      on g.transformation_id = i.transformation_id
     and g.backend_pid = pg_catalog.pg_backend_pid()
     and g.transaction_id = pg_catalog.txid_current()
    where i.source_ticket_id = p_ticket_id
      and (
        i.company_id is distinct from v_ticket.company_id
        or t.id is null
        or t.company_id is distinct from v_ticket.company_id
        or (r.id is not null and (
          r.company_id is distinct from v_ticket.company_id
          or r.season_id is distinct from t.season_id
        ))
        or (g.transformation_id is not null and (
          g.company_id is distinct from v_ticket.company_id
          or g.season_id is distinct from t.season_id
        ))
      )
    union all
    select 1
    from public.batch_transformation_outputs o
    left join public.batch_transformations t on t.id = o.transformation_id
    left join public.batch_processing_reversals r on r.transformation_id = o.transformation_id
    left join private.processing_reversal_in_progress_v1 g
      on g.transformation_id = o.transformation_id
     and g.backend_pid = pg_catalog.pg_backend_pid()
     and g.transaction_id = pg_catalog.txid_current()
    where o.source_ticket_id = p_ticket_id
      and (
        o.company_id is distinct from v_ticket.company_id
        or t.id is null
        or t.company_id is distinct from v_ticket.company_id
        or (r.id is not null and (
          r.company_id is distinct from v_ticket.company_id
          or r.season_id is distinct from t.season_id
        ))
        or (g.transformation_id is not null and (
          g.company_id is distinct from v_ticket.company_id
          or g.season_id is distinct from t.season_id
        ))
      )
  ) then
    raise exception 'TZ315_REVERSED_INPUT_VOID_COMPANY_SEASON_MISMATCH'
      using errcode = '23514';
  end if;

  for v_transformation_id in
    select q.transformation_id
    from (
      select i.transformation_id
      from public.batch_transformation_inputs i
      where i.source_ticket_id = p_ticket_id
        and i.company_id = v_ticket.company_id
      union
      select o.transformation_id
      from public.batch_transformation_outputs o
      where o.source_ticket_id = p_ticket_id
        and o.company_id = v_ticket.company_id
    ) q
    where not private.processing_reversal_document_preserved_v1(
      q.transformation_id,
      v_ticket.company_id
    )
    order by q.transformation_id
  loop
    delete from public.batch_transformation_inputs i
    where i.source_ticket_id = p_ticket_id
      and i.company_id = v_ticket.company_id
      and i.transformation_id = v_transformation_id
      and not private.processing_reversal_document_preserved_v1(
        i.transformation_id,
        v_ticket.company_id
      );

    delete from public.batch_transformation_outputs o
    where o.source_ticket_id = p_ticket_id
      and o.company_id = v_ticket.company_id
      and o.transformation_id = v_transformation_id
      and not private.processing_reversal_document_preserved_v1(
        o.transformation_id,
        v_ticket.company_id
      );

    perform public.recompute_grain_processing_shadow_v1(v_transformation_id);
  end loop;
end
$function$;

revoke all on function private.reconcile_voided_ticket_processing_shadow_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.tg_sync_grain_movement_shadow_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_input_transformation_id uuid;
begin
  if new.source_kind = 'processing_wip'
     and new.linked_processing_id is not null
     and new.processing_output_role in ('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER')
     and new.is_finalized
     and not new.is_voided
     and new.status = 'finalized'
  then
    perform public.attach_route_processing_input_ticket_v1(new.id);
    return new;
  end if;

  if new.harvest_lot_id is not null
     and (
       old.is_finalized is distinct from new.is_finalized
       or old.status is distinct from new.status
       or old.is_voided is distinct from new.is_voided
     )
  then
    if new.is_finalized and not new.is_voided and new.status = 'finalized' then
      v_input_transformation_id := public.attach_route_processing_input_ticket_v1(new.id);
      if v_input_transformation_id is not null then
        return new;
      end if;
    end if;

    -- TZ315_REVERSAL_DOCUMENT_GUARD_TRIGGER_V1
    if (not new.is_finalized or new.is_voided or new.status <> 'finalized')
       and exists (
         select 1
         from public.batch_transformation_inputs i
         where i.source_ticket_id = new.id
           and private.processing_reversal_document_preserved_v1(
             i.transformation_id,
             new.company_id
           )
         union all
         select 1
         from public.batch_transformation_outputs o
         where o.source_ticket_id = new.id
           and private.processing_reversal_document_preserved_v1(
             o.transformation_id,
             new.company_id
           )
       )
    then
      perform private.reconcile_voided_ticket_processing_shadow_v1(new.id);
      return new;
    end if;

    perform public.sync_grain_movement_shadow_v1(new.id);
  end if;
  return new;
end
$function$;

revoke all on function public.tg_sync_grain_movement_shadow_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.tg_sync_grain_movement_shadow_v1()
  to service_role;

-- Inject only two bounded statements into the already gated reversal RPC.
-- CREATE OR REPLACE preserves owner, ACL, volatility and SECURITY DEFINER
-- metadata from the existing canonical body.
do $migration$
declare
  v_definition text;
  v_begin_anchor constant text := E'  -- Source documents remain, but output tickets are marked voided. Their ledger\n  -- rows have already received full-fidelity compensating entries above.';
  v_end_anchor constant text := E'  insert into public.batch_processing_events (';
  v_begin_patch constant text := E'  -- TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1\n  insert into private.processing_reversal_in_progress_v1 (\n    transformation_id, company_id, season_id, actor_user_id, idempotency_key,\n    backend_pid, transaction_id, started_at\n  ) values (\n    v_t.id, v_t.company_id, v_t.season_id, p_actor_user_id, v_idempotency_key,\n    pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), pg_catalog.clock_timestamp()\n  );\n\n';
  v_end_patch constant text := E'  -- TZ315_REVERSAL_DOCUMENT_GUARD_END_V1\n  delete from private.processing_reversal_in_progress_v1 g\n  where g.transformation_id = v_t.id\n    and g.company_id = v_t.company_id\n    and g.season_id = v_t.season_id\n    and g.actor_user_id = p_actor_user_id\n    and g.idempotency_key = v_idempotency_key\n    and g.backend_pid = pg_catalog.pg_backend_pid()\n    and g.transaction_id = pg_catalog.txid_current();\n  if not found then\n    raise exception ''PROCESSING_REVERSAL_GUARD_LOST'' using errcode = ''40001'';\n  end if;\n\n';
  v_begin_count integer;
  v_end_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1') > 0
     or pg_catalog.strpos(v_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_END_V1') > 0
  then
    if pg_catalog.strpos(v_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1') = 0
       or pg_catalog.strpos(v_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_END_V1') = 0
    then
      raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_PARTIAL_PATCH'
        using errcode = '55000';
    end if;
    return;
  end if;

  v_begin_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_begin_anchor, ''))
  ) / pg_catalog.length(v_begin_anchor);
  v_end_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_end_anchor, ''))
  ) / pg_catalog.length(v_end_anchor);

  if v_begin_count <> 1 or v_end_count <> 1 then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_ANCHOR_MISMATCH|begin=%|end=%',
      v_begin_count, v_end_count using errcode = '55000';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_begin_anchor,
    v_begin_patch || v_begin_anchor
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_end_anchor,
    v_end_patch || v_end_anchor
  );
  execute v_definition;
end
$migration$;

comment on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)
  is 'Canonical TZ315 processing reversal with universal accounting gate and same-XID document-preservation guard.';

do $migration$
declare
  v_guard_table_oid oid;
  v_guard_relation pg_catalog.pg_class%rowtype;
  v_actual_columns jsonb;
  v_expected_columns jsonb;
  v_constraint pg_catalog.pg_constraint%rowtype;
  v_expected record;
  v_column_attnum smallint;
  v_target_attnum smallint;
  v_proc pg_catalog.pg_proc%rowtype;
  v_actual_execute_roles text[];
  v_reverse_definition text;
  v_helper_definition text;
  v_reconcile_definition text;
  v_trigger_definition text;
  v_helper_hash text;
  v_reconcile_hash text;
  v_trigger_hash text;
begin
  v_guard_table_oid := pg_catalog.to_regclass(
    'private.processing_reversal_in_progress_v1'
  );
  if v_guard_table_oid is null then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_TABLE_MISSING'
      using errcode = '55000';
  end if;

  select c.* into strict v_guard_relation
  from pg_catalog.pg_class c
  where c.oid = v_guard_table_oid;
  if v_guard_relation.relkind <> 'r'
     or pg_catalog.pg_get_userbyid(v_guard_relation.relowner) <> 'postgres'
     or v_guard_relation.relrowsecurity
     or v_guard_relation.relforcerowsecurity
  then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_RELATION_MISMATCH'
      using errcode = '55000';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'not_null', a.attnotnull,
        'default', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
      ) order by a.attnum
    ),
    '[]'::jsonb
  ) into v_actual_columns
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef ad
    on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where a.attrelid = v_guard_table_oid
    and a.attnum > 0
    and not a.attisdropped;

  v_expected_columns := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('name','transformation_id','type','uuid','not_null',true,'default',null),
    pg_catalog.jsonb_build_object('name','company_id','type','uuid','not_null',true,'default',null),
    pg_catalog.jsonb_build_object('name','season_id','type','uuid','not_null',true,'default',null),
    pg_catalog.jsonb_build_object('name','actor_user_id','type','uuid','not_null',true,'default',null),
    pg_catalog.jsonb_build_object('name','idempotency_key','type','text','not_null',true,'default',null),
    pg_catalog.jsonb_build_object('name','backend_pid','type','integer','not_null',true,'default',null),
    pg_catalog.jsonb_build_object('name','transaction_id','type','bigint','not_null',true,'default',null),
    pg_catalog.jsonb_build_object('name','started_at','type','timestamp with time zone','not_null',true,'default','statement_timestamp()')
  );
  if v_actual_columns is distinct from v_expected_columns then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_COLUMNS_MISMATCH|%',
      v_actual_columns using errcode = '55000';
  end if;

  -- One PK, four exact-scope FKs and three named checks.  PostgreSQL versions
  -- that expose NOT NULL constraints in pg_constraint are intentionally
  -- ignored here because attnotnull was checked above.
  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint c
    where c.conrelid = v_guard_table_oid
      and c.contype in ('p','f','c')
  ) <> 8 then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_CONSTRAINT_COUNT_MISMATCH'
      using errcode = '55000';
  end if;

  select c.* into v_constraint
  from pg_catalog.pg_constraint c
  where c.conrelid = v_guard_table_oid
    and c.conname = 'processing_reversal_in_progress_v1_pkey';
  if not found
     or v_constraint.contype <> 'p'
     or v_constraint.conkey is distinct from array[1]::smallint[]
     or not v_constraint.convalidated
     or v_constraint.condeferrable
     or v_constraint.condeferred
  then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_PK_MISMATCH'
      using errcode = '55000';
  end if;

  for v_expected in
    select * from (values
      ('processing_reversal_in_progress_v1_transformation_id_fkey','transformation_id','public.batch_transformations'),
      ('processing_reversal_in_progress_v1_company_id_fkey','company_id','public.companies'),
      ('processing_reversal_in_progress_v1_season_id_fkey','season_id','public.seasons'),
      ('processing_reversal_in_progress_v1_actor_user_id_fkey','actor_user_id','public.profiles')
    ) as expected(constraint_name, column_name, target_relation)
  loop
    select a.attnum into strict v_column_attnum
    from pg_catalog.pg_attribute a
    where a.attrelid = v_guard_table_oid
      and a.attname = v_expected.column_name
      and not a.attisdropped;
    select a.attnum into strict v_target_attnum
    from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass(v_expected.target_relation)
      and a.attname = 'id'
      and not a.attisdropped;
    select c.* into v_constraint
    from pg_catalog.pg_constraint c
    where c.conrelid = v_guard_table_oid
      and c.conname = v_expected.constraint_name;
    if not found
       or v_constraint.contype <> 'f'
       or v_constraint.conkey is distinct from array[v_column_attnum]::smallint[]
       or v_constraint.confrelid is distinct from pg_catalog.to_regclass(v_expected.target_relation)
       or v_constraint.confkey is distinct from array[v_target_attnum]::smallint[]
       or v_constraint.confupdtype <> 'a'
       or v_constraint.confdeltype <> 'a'
       or v_constraint.confmatchtype <> 's'
       or not v_constraint.convalidated
       or v_constraint.condeferrable
       or v_constraint.condeferred
    then
      raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_FK_MISMATCH|%',
        v_expected.constraint_name using errcode = '55000';
    end if;
  end loop;

  for v_expected in
    select * from (values
      ('processing_reversal_in_progress_key_v1_check','idempotency_key','((length(btrim(idempotency_key)) >= 1) AND (length(btrim(idempotency_key)) <= 200))'),
      ('processing_reversal_in_progress_backend_v1_check','backend_pid','(backend_pid > 0)'),
      ('processing_reversal_in_progress_transaction_v1_check','transaction_id','(transaction_id > 0)')
    ) as expected(constraint_name, column_name, expression_text)
  loop
    select a.attnum into strict v_column_attnum
    from pg_catalog.pg_attribute a
    where a.attrelid = v_guard_table_oid
      and a.attname = v_expected.column_name
      and not a.attisdropped;
    select c.* into v_constraint
    from pg_catalog.pg_constraint c
    where c.conrelid = v_guard_table_oid
      and c.conname = v_expected.constraint_name;
    if not found
       or v_constraint.contype <> 'c'
       or v_constraint.conkey is distinct from array[v_column_attnum]::smallint[]
       or not v_constraint.convalidated
       or pg_catalog.pg_get_expr(v_constraint.conbin, v_constraint.conrelid)
          is distinct from v_expected.expression_text
    then
      raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_CHECK_MISMATCH|%',
        v_expected.constraint_name using errcode = '55000';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        v_guard_relation.relacl,
        pg_catalog.acldefault('r', v_guard_relation.relowner)
      )
    ) acl
    where acl.grantee <> v_guard_relation.relowner
  ) then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_NONOWNER_ACL'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  ) into v_reverse_definition;
  select pg_catalog.pg_get_functiondef(
    'private.processing_reversal_document_preserved_v1(uuid,uuid)'::regprocedure
  ) into v_helper_definition;
  select pg_catalog.pg_get_functiondef(
    'private.reconcile_voided_ticket_processing_shadow_v1(uuid)'::regprocedure
  ) into v_reconcile_definition;
  select pg_catalog.pg_get_functiondef(
    'public.tg_sync_grain_movement_shadow_v1()'::regprocedure
  ) into v_trigger_definition;
  v_helper_hash := pg_catalog.md5(
    pg_catalog.regexp_replace(v_helper_definition, '\s+', ' ', 'g')
  );
  v_reconcile_hash := pg_catalog.md5(
    pg_catalog.regexp_replace(v_reconcile_definition, '\s+', ' ', 'g')
  );
  v_trigger_hash := pg_catalog.md5(
    pg_catalog.regexp_replace(v_trigger_definition, '\s+', ' ', 'g')
  );

  if pg_catalog.strpos(v_reverse_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') = 0
     or pg_catalog.strpos(v_reverse_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1') = 0
     or pg_catalog.strpos(v_reverse_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_END_V1') = 0
     or pg_catalog.length(v_reverse_definition)
          - pg_catalog.length(pg_catalog.replace(v_reverse_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1', ''))
          <> pg_catalog.length('TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1')
     or pg_catalog.length(v_reverse_definition)
          - pg_catalog.length(pg_catalog.replace(v_reverse_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_END_V1', ''))
          <> pg_catalog.length('TZ315_REVERSAL_DOCUMENT_GUARD_END_V1')
     or pg_catalog.strpos(v_reverse_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_BEGIN_V1')
          >= pg_catalog.strpos(v_reverse_definition, 'perform public.void_ticket_with_storno_v2')
     or pg_catalog.strpos(v_reverse_definition, 'insert into public.batch_processing_reversals')
          >= pg_catalog.strpos(v_reverse_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_END_V1')
     or pg_catalog.strpos(v_reconcile_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_RECONCILE_V1') = 0
     or pg_catalog.strpos(v_trigger_definition, 'TZ315_REVERSAL_DOCUMENT_GUARD_TRIGGER_V1') = 0
     or v_helper_hash <> '9331eefadd94c9fce66f4ffe523a7cf9'
     or v_reconcile_hash <> '6836f70f0a85491b9b0a0d4b26e47a75'
     or v_trigger_hash <> '134911c20ba76aa083722c14788da811'
  then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;

  if exists (select 1 from private.processing_reversal_in_progress_v1) then
    raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_GUARD_NOT_EMPTY'
      using errcode = '55000';
  end if;

  -- Exact owner/security/search_path/EXECUTE matrix.  This also proves that
  -- CREATE OR REPLACE retained the canonical public RPC grants while the two
  -- private helpers remain non-callable by API roles.
  for v_expected in
    select * from (values
      ('private.processing_reversal_document_preserved_v1(uuid,uuid)',false,'search_path=""','boolean','s',array['postgres']::text[]),
      ('private.reconcile_voided_ticket_processing_shadow_v1(uuid)',true,'search_path=""','void','v',array['postgres']::text[]),
      ('public.tg_sync_grain_movement_shadow_v1()',true,'search_path=public, pg_temp','trigger','v',array['postgres','service_role']::text[]),
      ('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)',true,'search_path=""','jsonb','v',array['authenticated','postgres','service_role']::text[])
    ) as expected(signature, security_definer, config_text, return_type, volatility, execute_roles)
  loop
    select p.* into strict v_proc
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(v_expected.signature);

    select coalesce(
      pg_catalog.array_agg(q.role_name order by q.role_name),
      array[]::text[]
    ) into v_actual_execute_roles
    from (
      select distinct case
        when acl.grantee = 0 then 'PUBLIC'
        else pg_catalog.pg_get_userbyid(acl.grantee)
      end as role_name
      from pg_catalog.aclexplode(
        coalesce(
          v_proc.proacl,
          pg_catalog.acldefault('f', v_proc.proowner)
        )
      ) acl
      where acl.privilege_type = 'EXECUTE'
        and acl.grantor = v_proc.proowner
    ) q;

    if pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       or v_proc.prokind <> 'f'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.proconfig is distinct from array[v_expected.config_text]::text[]
       or pg_catalog.format_type(v_proc.prorettype, null) <> v_expected.return_type
       or v_proc.provolatile <> v_expected.volatility
       or v_actual_execute_roles is distinct from v_expected.execute_roles
       or exists (
         select 1
         from pg_catalog.aclexplode(
           coalesce(
             v_proc.proacl,
             pg_catalog.acldefault('f', v_proc.proowner)
           )
         ) acl
         where acl.privilege_type = 'EXECUTE'
           and acl.grantor <> v_proc.proowner
       )
    then
      raise exception 'TZ315_REVERSAL_DOCUMENT_PRESERVE_FUNCTION_METADATA_MISMATCH|%|acl=%',
        v_expected.signature, v_actual_execute_roles using errcode = '55000';
    end if;
  end loop;
end
$migration$;

notify pgrst, 'reload schema';

commit;
