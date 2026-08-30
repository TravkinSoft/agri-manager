-- TZ315 canonical processing reversal and physical-batch reconciliation V1.
--
-- Additive/repeat-safe contract:
--   * no business row is deleted;
--   * the closed transformation and all input/output/loss documents remain;
--   * every canonical ledger effect gets exactly one append-only compensating row;
--   * physical batches are reconciled from the canonical ledger afterwards;
--   * any downstream use blocks reversal instead of being guessed or cascaded;
--   * a server-only immutable receipt is the sole idempotency authority.

create table if not exists public.batch_processing_reversals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  transformation_id uuid not null references public.batch_transformations(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  audit_run_code text,
  snapshot jsonb not null,
  reversed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint batch_processing_reversals_reason_v1_check
    check (nullif(btrim(reason), '') is not null and length(reason) <= 2000),
  constraint batch_processing_reversals_idempotency_key_v1_check
    check (nullif(btrim(idempotency_key), '') is not null and length(idempotency_key) <= 200),
  constraint batch_processing_reversals_fingerprint_v1_check
    check (request_fingerprint ~ '^[0-9a-f]{32}$'),
  constraint batch_processing_reversals_audit_run_v1_check
    check (audit_run_code is null or (nullif(btrim(audit_run_code), '') is not null and length(audit_run_code) <= 200)),
  constraint batch_processing_reversals_transformation_v1_unique unique (transformation_id),
  constraint batch_processing_reversals_idempotency_v1_unique unique (company_id, idempotency_key)
);

create index if not exists idx_batch_processing_reversals_timeline_v1
  on public.batch_processing_reversals(company_id, season_id, reversed_at desc);

create index if not exists idx_batch_processing_reversals_actor_fk_v1
  on public.batch_processing_reversals(actor_user_id);

alter table public.batch_processing_reversals enable row level security;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'batch_processing_reversals'
      and policyname = 'batch_processing_reversals_read_v1'
  ) then
    create policy batch_processing_reversals_read_v1
      on public.batch_processing_reversals
      for select
      to authenticated
      using (
        company_id = public.get_user_company_id()
        and exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and coalesce(p.status, 'active') = 'active'
        )
      );
  end if;
end
$migration$;

create or replace function private.enforce_processing_reversal_documents_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_transformation_id uuid;
  v_new_transformation_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_transformation_id := old.transformation_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_transformation_id := new.transformation_id;
  end if;
  if exists (
    select 1
    from public.batch_processing_reversals r
    where r.transformation_id = v_old_transformation_id
       or r.transformation_id = v_new_transformation_id
  ) then
    raise exception 'PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

revoke all on function private.enforce_processing_reversal_documents_v1()
  from public, anon, authenticated;

do $migration$
declare
  v_target regclass;
  v_trigger_name text;
begin
  foreach v_target in array array[
    'public.batch_transformation_inputs'::regclass,
    'public.batch_transformation_outputs'::regclass,
    'public.batch_transformation_losses'::regclass
  ] loop
    v_trigger_name := 'trg_' || pg_catalog.replace(v_target::text, '.', '_') || '_reversal_guard_v1';
    if not exists (
      select 1
      from pg_catalog.pg_trigger
      where tgrelid = v_target
        and tgname = v_trigger_name
        and not tgisinternal
    ) then
      execute pg_catalog.format(
        'create trigger %I before insert or update or delete on %s for each row execute function private.enforce_processing_reversal_documents_v1()',
        v_trigger_name,
        v_target
      );
    end if;
  end loop;
end
$migration$;

revoke all on table public.batch_processing_reversals from public, anon, authenticated;
grant select on table public.batch_processing_reversals to authenticated, service_role;

create or replace function private.reject_processing_reversal_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'PROCESSING_REVERSAL_RECEIPT_IMMUTABLE' using errcode = '55000';
end
$function$;

revoke all on function private.reject_processing_reversal_mutation_v1()
  from public, anon, authenticated;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.batch_processing_reversals'::regclass
      and tgname = 'trg_batch_processing_reversals_immutable_v1'
      and not tgisinternal
  ) then
    create trigger trg_batch_processing_reversals_immutable_v1
      before update or delete on public.batch_processing_reversals
      for each row execute function private.reject_processing_reversal_mutation_v1();
  end if;
end
$migration$;

create or replace function private.enforce_processing_reversal_state_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.batch_processing_reversals r
    where r.transformation_id = old.id
  ) then
    raise exception 'PROCESSING_REVERSED_STATE_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end
$function$;

revoke all on function private.enforce_processing_reversal_state_v1()
  from public, anon, authenticated;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.batch_transformations'::regclass
      and tgname = 'trg_batch_transformations_reversal_state_v1'
      and not tgisinternal
  ) then
    create trigger trg_batch_transformations_reversal_state_v1
      before update on public.batch_transformations
      for each row execute function private.enforce_processing_reversal_state_v1();
  end if;
end
$migration$;

do $migration$
begin
  if exists (
    select 1
    from public.stock_ledger_entries
    where storno_of_entry_id is not null
    group by storno_of_entry_id
    having count(*) > 1
  ) then
    raise exception 'TZ315_STORNO_TARGET_DUPLICATES_EXIST' using errcode = '23505';
  end if;
end
$migration$;

create unique index if not exists uq_stock_ledger_storno_target_v1
  on public.stock_ledger_entries(storno_of_entry_id)
  where storno_of_entry_id is not null;

create index if not exists idx_stock_ledger_processing_reversal_v1
  on public.stock_ledger_entries(company_id, processing_id, is_storno, occurred_at, id)
  where processing_id is not null;

create or replace function private.processing_reversal_blockers_v1(
  p_transformation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with transformation as (
    select t.id, t.company_id
    from public.batch_transformations t
    where t.id = p_transformation_id
  ),
  output_tickets as (
    select distinct o.source_ticket_id as ticket_id
    from public.batch_transformation_outputs o
    join transformation t on t.id = o.transformation_id and t.company_id = o.company_id
    where o.source_ticket_id is not null
  ),
  output_batches as (
    select distinct o.output_batch_id as batch_id
    from public.batch_transformation_outputs o
    join transformation t on t.id = o.transformation_id and t.company_id = o.company_id
    where o.output_batch_id is not null
    union
    select distinct b.id
    from public.inventory_batches b
    join transformation t on t.id = b.source_transformation_id and t.company_id = b.company_id
    union
    select distinct sle.inventory_batch_id
    from public.stock_ledger_entries sle
    join transformation t on sle.company_id = t.company_id and sle.processing_id = t.id
    where sle.ticket_id is null
      and not coalesce(sle.is_storno, false)
      and sle.direction = 'in'::public.ledger_direction
      and sle.inventory_batch_id is not null
  ),
  live_base_ledger as (
    select sle.*
    from public.stock_ledger_entries sle
    where not coalesce(sle.is_storno, false)
      and not exists (
        select 1
        from public.stock_ledger_entries reversal
        where reversal.storno_of_entry_id = sle.id
      )
  ),
  downstream_processing as (
    select count(*)::integer as count
    from public.batch_transformation_inputs i
    join transformation t on i.company_id = t.company_id
    left join public.batch_processing_reversals r on r.transformation_id = i.transformation_id
    where i.transformation_id <> t.id
      and i.batch_id in (select batch_id from output_batches)
      and r.id is null
  ),
  downstream_output_ledger as (
    select count(*)::integer as count
    from live_base_ledger sle
    join transformation t on sle.company_id = t.company_id
    where coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, ''))
            in (select batch_id::text from output_batches)
      and not coalesce((
        (sle.processing_id = t.id and sle.ticket_id is null)
        or sle.ticket_id in (select ticket_id from output_tickets)
      ), false)
  ),
  downstream_tickets as (
    select count(distinct tk.id)::integer as count
    from public.ticket_lines tl
    join public.tickets tk on tk.id = tl.ticket_id
    join transformation t on tk.company_id = t.company_id
    where not coalesce(tk.is_voided, false)
      and tk.id not in (select ticket_id from output_tickets)
      and (
        tl.destination_batch_id in (select batch_id from output_batches)
        or nullif(tl.batch_id, '') in (select batch_id::text from output_batches)
        or tk.batch_id in (select batch_id from output_batches)
      )
  ),
  downstream_children as (
    select count(*)::integer as count
    from public.inventory_batches child
    join transformation t on child.company_id = t.company_id
    where child.parent_batch_id in (select batch_id from output_batches)
      and child.id not in (select batch_id from output_batches)
      and (
        abs(coalesce(child.current_quantity, child.current_weight_kg, child.mass_kg, 0)) > 0.001
        or exists (
          select 1
          from live_base_ledger sle
          where sle.company_id = child.company_id
            and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = child.id::text
        )
      )
  ),
  downstream_issue_allocations as (
    select count(*)::integer as count
    from public.warehouse_issue_request_item_allocations a
    join transformation t on a.company_id = t.company_id
    where a.batch_id in (select batch_id from output_batches)
      and (abs(coalesce(a.prepared_quantity, 0)) > 0.0001 or abs(coalesce(a.issued_quantity, 0)) > 0.0001)
  ),
  downstream_inventory_transactions as (
    select count(*)::integer as count
    from public.inventory_transactions it
    join transformation t on it.company_id = t.company_id
    where it.inventory_batch_id in (select batch_id from output_batches)
      and coalesce(it.status, '') not in ('cancelled', 'voided')
  ),
  unmapped_processing_ticket_ledger as (
    select count(*)::integer as count
    from live_base_ledger sle
    join transformation t on sle.company_id = t.company_id
    where sle.processing_id = t.id
      and sle.ticket_id is not null
      and sle.ticket_id not in (select ticket_id from output_tickets)
  ),
  preexisting_storno_rows as (
    select count(*)::integer as count
    from public.stock_ledger_entries base
    join transformation t on base.company_id = t.company_id
    where not coalesce(base.is_storno, false)
      and (
        (base.processing_id = t.id and base.ticket_id is null)
        or base.ticket_id in (select ticket_id from output_tickets)
      )
      and exists (
        select 1
        from public.stock_ledger_entries reversal
        where reversal.storno_of_entry_id = base.id
      )
  ),
  output_ticket_state_conflicts as (
    select count(*)::integer as count
    from public.tickets tk
    join transformation t on tk.company_id = t.company_id
    where tk.id in (select ticket_id from output_tickets)
      and (
        coalesce(tk.is_voided, false)
        or not coalesce(tk.is_finalized, false)
        or tk.status::text <> 'finalized'
      )
  ),
  counts as (
    select
      (select count from downstream_processing) as downstream_processing_inputs,
      (select count from downstream_output_ledger) as downstream_output_ledger,
      (select count from downstream_tickets) as downstream_tickets,
      (select count from downstream_children) as downstream_child_batches,
      (select count from downstream_issue_allocations) as downstream_issue_allocations,
      (select count from downstream_inventory_transactions) as downstream_inventory_transactions,
      (select count from unmapped_processing_ticket_ledger) as unmapped_processing_ticket_ledger,
      (select count from preexisting_storno_rows) as preexisting_storno_rows,
      (select count from output_ticket_state_conflicts) as output_ticket_state_conflicts
  )
  select jsonb_build_object(
    'blocked', (
      downstream_processing_inputs
      + downstream_output_ledger
      + downstream_tickets
      + downstream_child_batches
      + downstream_issue_allocations
      + downstream_inventory_transactions
      + unmapped_processing_ticket_ledger
      + preexisting_storno_rows
      + output_ticket_state_conflicts
    ) > 0,
    'downstream_processing_inputs', downstream_processing_inputs,
    'downstream_output_ledger', downstream_output_ledger,
    'downstream_tickets', downstream_tickets,
    'downstream_child_batches', downstream_child_batches,
    'downstream_issue_allocations', downstream_issue_allocations,
    'downstream_inventory_transactions', downstream_inventory_transactions,
    'unmapped_processing_ticket_ledger', unmapped_processing_ticket_ledger,
    'preexisting_storno_rows', preexisting_storno_rows,
    'output_ticket_state_conflicts', output_ticket_state_conflicts
  )
  from counts;
$function$;

revoke all on function private.processing_reversal_blockers_v1(uuid)
  from public, anon, authenticated;

create or replace function public.reverse_processing_material_balance_v1(
  p_transformation_id uuid,
  p_company_id uuid,
  p_season_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_audit_run_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_t public.batch_transformations%rowtype;
  v_receipt public.batch_processing_reversals%rowtype;
  v_entry public.stock_ledger_entries%rowtype;
  v_ticket_id uuid;
  v_batch_id uuid;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_audit_run_code text := nullif(btrim(coalesce(p_audit_run_code, '')), '');
  v_request_fingerprint text;
  v_blockers jsonb;
  v_before_net_effect_kg numeric(18,6) := 0;
  v_before_absolute_effect_kg numeric(18,6) := 0;
  v_after_effect_kg numeric(18,6) := 0;
  v_base_count integer := 0;
  v_storno_created integer := 0;
  v_tickets_voided integer := 0;
  v_batches_reconciled integer := 0;
  v_outstanding integer := 0;
  v_invalid_pairs integer := 0;
  v_invalid_batches integer := 0;
  v_batch_balances_before jsonb := '[]'::jsonb;
  v_batch_balances_after jsonb := '[]'::jsonb;
  v_snapshot jsonb;
  v_receipt_id uuid := gen_random_uuid();
begin
  if p_transformation_id is null or p_company_id is null or p_season_id is null or p_actor_user_id is null then
    raise exception 'PROCESSING_REVERSAL_CONTEXT_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is null or auth.uid() is distinct from p_actor_user_id then
    raise exception 'PROCESSING_FORBIDDEN' using errcode = '42501';
  end if;
  if public.get_user_company_id() is distinct from p_company_id then
    raise exception 'PROCESSING_FORBIDDEN' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'PROCESSING_REVERSAL_REASON_REQUIRED' using errcode = '22023';
  end if;
  if length(v_reason) > 2000 then
    raise exception 'PROCESSING_REVERSAL_REASON_TOO_LONG' using errcode = '22023';
  end if;
  if v_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  if length(v_idempotency_key) > 200 or (v_audit_run_code is not null and length(v_audit_run_code) > 200) then
    raise exception 'PROCESSING_REVERSAL_KEY_TOO_LONG' using errcode = '22023';
  end if;

  v_request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws(
    E'\x1f',
    p_transformation_id::text,
    p_company_id::text,
    p_season_id::text,
    p_actor_user_id::text,
    v_reason,
    v_idempotency_key,
    coalesce(v_audit_run_code, '')
  ));

  select * into v_t
  from public.batch_transformations
  where id = p_transformation_id
    and company_id = p_company_id
    and season_id = p_season_id;
  if not found then
    raise exception 'PROCESSING_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.tz297_assert_processing_actor_v1(
    v_t.company_id,
    p_actor_user_id,
    array['global_admin','company_admin']
  );

  perform pg_catalog.pg_advisory_xact_lock(public.tz297_processing_context_lock_key_v1(
    v_t.company_id,
    v_t.season_id,
    v_t.node_warehouse_id,
    v_t.processing_node_id,
    v_t.transformation_type,
    v_t.harvest_lot_id,
    coalesce(v_t.source_physical_state, 'SOURCE')
  ));

  select * into v_t
  from public.batch_transformations
  where id = p_transformation_id
    and company_id = p_company_id
    and season_id = p_season_id
  for update;
  if not found then
    raise exception 'PROCESSING_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_receipt
  from public.batch_processing_reversals
  where transformation_id = v_t.id;
  if found then
    if v_receipt.idempotency_key = v_idempotency_key
       and v_receipt.request_fingerprint = v_request_fingerprint
    then
      return v_receipt.snapshot || jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'reversal_receipt_id', v_receipt.id,
        'status', 'voided',
        'processing_state', 'processing_closed'
      );
    end if;
    if v_receipt.idempotency_key = v_idempotency_key then
      raise exception 'PROCESSING_REVERSAL_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    raise exception 'PROCESSING_ALREADY_REVERSED' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.batch_processing_reversals r
    where r.company_id = v_t.company_id
      and r.idempotency_key = v_idempotency_key
      and r.transformation_id <> v_t.id
  ) then
    raise exception 'PROCESSING_REVERSAL_IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;

  if v_t.status <> 'completed'
     or v_t.processing_state <> 'processing_closed'
     or v_t.closed_at is null
  then
    raise exception 'PROCESSING_REVERSAL_REQUIRES_CLOSED' using errcode = '23514';
  end if;

  -- Reversal is rare, but it must be race-proof. These locks are acquired in
  -- one fixed order before any downstream scan and block concurrent RowExclusive
  -- DML until this short transaction either commits or rolls back.
  lock table
    public.batch_transformation_inputs,
    public.batch_transformation_outputs,
    public.batch_transformation_losses,
    public.stock_ledger_entries,
    public.ticket_lines,
    public.inventory_transactions,
    public.warehouse_issue_request_item_allocations
  in share row exclusive mode;

  if not exists (
    select 1
    from public.seasons s
    where s.id = v_t.season_id
      and s.company_id = v_t.company_id
  ) then
    raise exception 'PROCESSING_REVERSAL_SEASON_INVALID' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.batch_transformation_inputs i
    where i.transformation_id = v_t.id and i.company_id is distinct from v_t.company_id
    union all
    select 1
    from public.batch_transformation_outputs o
    where o.transformation_id = v_t.id and o.company_id is distinct from v_t.company_id
    union all
    select 1
    from public.batch_transformation_losses l
    where l.transformation_id = v_t.id and l.company_id is distinct from v_t.company_id
    union all
    select 1
    from public.stock_ledger_entries sle
    where sle.processing_id = v_t.id and sle.company_id is distinct from v_t.company_id
  ) then
    raise exception 'PROCESSING_REVERSAL_COMPANY_MISMATCH' using errcode = '23514';
  end if;

  if (
    (v_t.node_warehouse_id is not null and not exists (
      select 1 from public.warehouses w
      where w.id = v_t.node_warehouse_id and w.company_id = v_t.company_id
    ))
    or (v_t.processing_node_id is not null and not exists (
      select 1 from public.processing_nodes pn
      where pn.id = v_t.processing_node_id and pn.company_id = v_t.company_id
    ))
    or exists (
      select 1
      from public.batch_transformation_inputs i
      left join public.inventory_batches b on b.id = i.batch_id
      where i.transformation_id = v_t.id
        and (
          (i.batch_id is not null and (
            b.id is null
            or b.company_id is distinct from v_t.company_id
            or b.season_id is distinct from v_t.season_id
          ))
          or (i.warehouse_from_id is not null and not exists (
            select 1 from public.warehouses w
            where w.id = i.warehouse_from_id and w.company_id = v_t.company_id
          ))
          or (i.node_warehouse_id is not null and not exists (
            select 1 from public.warehouses w
            where w.id = i.node_warehouse_id and w.company_id = v_t.company_id
          ))
        )
    )
    or exists (
      select 1
      from public.batch_transformation_outputs o
      left join public.inventory_batches b on b.id = o.output_batch_id
      left join public.tickets tk on tk.id = o.source_ticket_id
      where o.transformation_id = v_t.id
        and (
          (o.output_batch_id is not null and (
            b.id is null
            or b.company_id is distinct from v_t.company_id
            or b.season_id is distinct from v_t.season_id
          ))
          or (o.source_ticket_id is not null and (
            tk.id is null
            or tk.company_id is distinct from v_t.company_id
            or tk.season_id is distinct from v_t.season_id
            or tk.linked_processing_id is distinct from v_t.id
          ))
          or (o.warehouse_to_id is not null and not exists (
            select 1 from public.warehouses w
            where w.id = o.warehouse_to_id and w.company_id = v_t.company_id
          ))
        )
    )
    or exists (
      select 1
      from public.stock_ledger_entries sle
      left join public.inventory_batches b on b.id = sle.inventory_batch_id
      where not coalesce(sle.is_storno, false)
        and (
          (sle.processing_id = v_t.id and sle.ticket_id is null)
          or sle.ticket_id in (
            select o.source_ticket_id
            from public.batch_transformation_outputs o
            where o.transformation_id = v_t.id and o.source_ticket_id is not null
          )
        )
        and (
          not exists (
            select 1 from public.warehouses w
            where w.id = sle.warehouse_id and w.company_id = v_t.company_id
          )
          or (sle.inventory_batch_id is not null and (
            b.id is null
            or b.company_id is distinct from v_t.company_id
            or b.season_id is distinct from v_t.season_id
          ))
        )
    )
  ) then
    raise exception 'PROCESSING_REVERSAL_REFERENCE_MISMATCH' using errcode = '23514';
  end if;

  -- Every physical output must be traceable to one finalized output ticket and
  -- exactly one canonical IN entry. Missing or extra ledger rows are blocked;
  -- reversal never invents a batch/ticket link.
  if exists (
    select 1
    from public.batch_transformation_outputs o
    left join public.tickets tk on tk.id = o.source_ticket_id
    where o.transformation_id = v_t.id
      and o.output_type in ('main_product','byproduct','stock_waste')
      and coalesce(o.output_weight_kg, 0) > 0
      and (
        o.source_ticket_id is null
        or o.output_batch_id is null
        or o.warehouse_to_id is null
        or tk.company_id is distinct from v_t.company_id
        or tk.season_id is distinct from v_t.season_id
        or tk.linked_processing_id is distinct from v_t.id
        or not coalesce(tk.is_finalized, false)
        or coalesce(tk.is_voided, false)
        or tk.status::text <> 'finalized'
        or 1 <> (
          select count(*)
          from public.stock_ledger_entries sle
          where not coalesce(sle.is_storno, false)
            and sle.ticket_id = o.source_ticket_id
            and sle.processing_id = v_t.id
            and sle.inventory_batch_id = o.output_batch_id
            and sle.warehouse_id = o.warehouse_to_id
            and sle.direction = 'in'::public.ledger_direction
            and abs(sle.delta_qty_signed - o.output_weight_kg) <= 0.001
            and abs(sle.quantity - o.output_weight_kg) <= 0.001
        )
        or 1 <> (
          select count(*)
          from public.stock_ledger_entries sle
          where not coalesce(sle.is_storno, false)
            and sle.ticket_id = o.source_ticket_id
        )
      )
  ) or abs(
    coalesce((
      select sum(l.qty_kg)
      from public.batch_transformation_losses l
      where l.transformation_id = v_t.id
        and l.loss_type <> 'moisture_loss'
    ), 0)
    - coalesce((
      select sum(-sle.delta_qty_signed)
      from public.stock_ledger_entries sle
      where sle.processing_id = v_t.id
        and sle.ticket_id is null
        and not coalesce(sle.is_storno, false)
        and sle.reason_type = 'processing_loss'
        and sle.direction = 'out'::public.ledger_direction
    ), 0)
  ) > 0.001 then
    raise exception 'PROCESSING_LEDGER_TRACE_INCOMPLETE' using errcode = '23514';
  end if;

  -- Canonical lock order: output source tickets, then every involved physical
  -- batch in UUID order, then the processing documents and ledger rows.
  perform 1
  from public.tickets tk
  where tk.id in (
    select o.source_ticket_id
    from public.batch_transformation_outputs o
    where o.transformation_id = v_t.id and o.source_ticket_id is not null
  )
  order by tk.id
  for update;

  perform 1
  from public.inventory_batches b
  where b.id in (
    select i.batch_id
    from public.batch_transformation_inputs i
    where i.transformation_id = v_t.id and i.batch_id is not null
    union
    select o.output_batch_id
    from public.batch_transformation_outputs o
    where o.transformation_id = v_t.id and o.output_batch_id is not null
    union
    select child.id
    from public.inventory_batches child
    where child.source_transformation_id = v_t.id
    union
    select sle.inventory_batch_id
    from public.stock_ledger_entries sle
    where not coalesce(sle.is_storno, false)
      and sle.inventory_batch_id is not null
      and (
        (sle.processing_id = v_t.id and sle.ticket_id is null)
        or sle.ticket_id in (
          select o.source_ticket_id
          from public.batch_transformation_outputs o
          where o.transformation_id = v_t.id and o.source_ticket_id is not null
        )
      )
  )
  order by b.id
  for update;

  perform 1
  from public.batch_transformation_inputs i
  where i.transformation_id = v_t.id
  order by i.id
  for update;

  perform 1
  from public.batch_transformation_outputs o
  where o.transformation_id = v_t.id
  order by o.id
  for update;

  perform 1
  from public.batch_transformation_losses l
  where l.transformation_id = v_t.id
  order by l.id
  for update;

  perform 1
  from public.stock_ledger_entries sle
  where not coalesce(sle.is_storno, false)
    and (
      (sle.processing_id = v_t.id and sle.ticket_id is null)
      or sle.ticket_id in (
        select o.source_ticket_id
        from public.batch_transformation_outputs o
        where o.transformation_id = v_t.id and o.source_ticket_id is not null
      )
    )
  order by sle.id
  for update;

  v_blockers := private.processing_reversal_blockers_v1(v_t.id);
  if coalesce((v_blockers ->> 'blocked')::boolean, false) then
    raise exception 'PROCESSING_REVERSAL_DOWNSTREAM_DEPENDENCY|%', v_blockers::text using errcode = '23514';
  end if;

  select count(*),
         round(coalesce(sum(sle.delta_qty_signed), 0), 6),
         round(coalesce(sum(abs(sle.delta_qty_signed)), 0), 6)
  into v_base_count, v_before_net_effect_kg, v_before_absolute_effect_kg
  from public.stock_ledger_entries sle
  where not coalesce(sle.is_storno, false)
    and (
      (sle.processing_id = v_t.id and sle.ticket_id is null)
      or sle.ticket_id in (
        select o.source_ticket_id
        from public.batch_transformation_outputs o
        where o.transformation_id = v_t.id and o.source_ticket_id is not null
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'batch_id', b.id,
    'warehouse_id', b.warehouse_id,
    'current_quantity', b.current_quantity,
    'current_weight_kg', b.current_weight_kg,
    'mass_kg', b.mass_kg,
    'ledger_balance_kg', round(coalesce((
      select sum(sle.delta_qty_signed)
      from public.stock_ledger_entries sle
      where sle.company_id = b.company_id
        and sle.warehouse_id = b.warehouse_id
        and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = b.id::text
    ), 0), 6)
  ) order by b.id), '[]'::jsonb)
  into v_batch_balances_before
  from public.inventory_batches b
  where b.id in (
    select i.batch_id from public.batch_transformation_inputs i
      where i.transformation_id = v_t.id and i.batch_id is not null
    union
    select o.output_batch_id from public.batch_transformation_outputs o
      where o.transformation_id = v_t.id and o.output_batch_id is not null
    union
    select child.id from public.inventory_batches child
      where child.source_transformation_id = v_t.id
    union
    select sle.inventory_batch_id
    from public.stock_ledger_entries sle
    where not coalesce(sle.is_storno, false)
      and sle.inventory_batch_id is not null
      and (
        (sle.processing_id = v_t.id and sle.ticket_id is null)
        or sle.ticket_id in (
          select o.source_ticket_id from public.batch_transformation_outputs o
          where o.transformation_id = v_t.id and o.source_ticket_id is not null
        )
      )
  );

  for v_entry in
    select sle.*
    from public.stock_ledger_entries sle
    where not coalesce(sle.is_storno, false)
      and (
        (sle.processing_id = v_t.id and sle.ticket_id is null)
        or sle.ticket_id in (
          select o.source_ticket_id
          from public.batch_transformation_outputs o
          where o.transformation_id = v_t.id and o.source_ticket_id is not null
        )
      )
    order by sle.id
  loop
    insert into public.stock_ledger_entries (
      company_id, ticket_id, processing_id, product_id, warehouse_id,
      direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id,
      batch_id, occurred_at, created_by, is_storno, storno_of_entry_id, notes,
      variety_id, reproduction_id, batch_id_text, batch_class, operation_line_id,
      mass_kg, density_kg_per_l, density_unit, density_source,
      density_verification_status, density_verified_at, unit_source,
      unit_contract_version, warehouse_issue_allocation_id, crop_id, inventory_batch_id
    ) values (
      v_entry.company_id, v_entry.ticket_id, v_entry.processing_id,
      v_entry.product_id, v_entry.warehouse_id,
      case
        when v_entry.direction = 'in'::public.ledger_direction then 'out'::public.ledger_direction
        else 'in'::public.ledger_direction
      end,
      v_entry.quantity, v_entry.uom, -v_entry.delta_qty_signed,
      'storno_processing_reversal', v_t.id, v_entry.batch_id, v_now,
      p_actor_user_id, true, v_entry.id,
      concat_ws(E'\n', v_entry.notes, 'TZ315 processing reversal: ' || v_reason),
      v_entry.variety_id, v_entry.reproduction_id, v_entry.batch_id_text,
      v_entry.batch_class, v_entry.operation_line_id, v_entry.mass_kg,
      v_entry.density_kg_per_l, v_entry.density_unit, v_entry.density_source,
      v_entry.density_verification_status, v_entry.density_verified_at,
      v_entry.unit_source, v_entry.unit_contract_version,
      v_entry.warehouse_issue_allocation_id, v_entry.crop_id, v_entry.inventory_batch_id
    )
    on conflict (storno_of_entry_id) where storno_of_entry_id is not null do nothing;
    if found then
      v_storno_created := v_storno_created + 1;
    end if;
  end loop;

  -- Source documents remain, but output tickets are marked voided. Their ledger
  -- rows have already received full-fidelity compensating entries above.
  for v_ticket_id in
    select distinct o.source_ticket_id
    from public.batch_transformation_outputs o
    where o.transformation_id = v_t.id
      and o.source_ticket_id is not null
    order by o.source_ticket_id
  loop
    perform public.void_ticket_with_storno_v2(v_ticket_id, p_actor_user_id, v_reason);
    v_tickets_voided := v_tickets_voided + 1;
  end loop;

  for v_batch_id in
    select distinct batch_id
    from (
      select i.batch_id
      from public.batch_transformation_inputs i
      where i.transformation_id = v_t.id and i.batch_id is not null
      union
      select o.output_batch_id
      from public.batch_transformation_outputs o
      where o.transformation_id = v_t.id and o.output_batch_id is not null
      union
      select b.id
      from public.inventory_batches b
      where b.source_transformation_id = v_t.id
      union
      select sle.inventory_batch_id
      from public.stock_ledger_entries sle
      where not coalesce(sle.is_storno, false)
        and sle.inventory_batch_id is not null
        and (
          (sle.processing_id = v_t.id and sle.ticket_id is null)
          or sle.ticket_id in (
            select o.source_ticket_id
            from public.batch_transformation_outputs o
            where o.transformation_id = v_t.id and o.source_ticket_id is not null
          )
        )
    ) batches
    where batch_id is not null
    order by batch_id
  loop
    perform private.reconcile_warehouse_local_batch_balance_v1(v_batch_id);
    v_batches_reconciled := v_batches_reconciled + 1;
  end loop;

  select round(coalesce(sum(base.delta_qty_signed + coalesce(reversal.delta_qty_signed, 0)), 0), 6),
         count(*) filter (where reversal.id is null),
         count(*) filter (
           where reversal.id is null
              or reversal.company_id is distinct from base.company_id
              or reversal.ticket_id is distinct from base.ticket_id
              or reversal.processing_id is distinct from base.processing_id
              or reversal.product_id is distinct from base.product_id
              or reversal.crop_id is distinct from base.crop_id
              or reversal.variety_id is distinct from base.variety_id
              or reversal.reproduction_id is distinct from base.reproduction_id
              or reversal.warehouse_id is distinct from base.warehouse_id
              or reversal.inventory_batch_id is distinct from base.inventory_batch_id
              or reversal.batch_id is distinct from base.batch_id
              or reversal.batch_id_text is distinct from base.batch_id_text
              or reversal.batch_class is distinct from base.batch_class
              or reversal.operation_line_id is distinct from base.operation_line_id
              or reversal.quantity is distinct from base.quantity
              or reversal.uom is distinct from base.uom
              or reversal.mass_kg is distinct from base.mass_kg
              or reversal.density_kg_per_l is distinct from base.density_kg_per_l
              or reversal.density_unit is distinct from base.density_unit
              or reversal.density_source is distinct from base.density_source
              or reversal.density_verification_status is distinct from base.density_verification_status
              or reversal.density_verified_at is distinct from base.density_verified_at
              or reversal.unit_source is distinct from base.unit_source
              or reversal.unit_contract_version is distinct from base.unit_contract_version
              or reversal.warehouse_issue_allocation_id is distinct from base.warehouse_issue_allocation_id
              or reversal.delta_qty_signed is distinct from -base.delta_qty_signed
              or reversal.direction is distinct from (
                case
                  when base.direction = 'in'::public.ledger_direction then 'out'::public.ledger_direction
                  else 'in'::public.ledger_direction
                end
              )
              or not coalesce(reversal.is_storno, false)
         )
  into v_after_effect_kg, v_outstanding, v_invalid_pairs
  from public.stock_ledger_entries base
  left join public.stock_ledger_entries reversal on reversal.storno_of_entry_id = base.id
  where not coalesce(base.is_storno, false)
    and (
      (base.processing_id = v_t.id and base.ticket_id is null)
      or base.ticket_id in (
        select o.source_ticket_id
        from public.batch_transformation_outputs o
        where o.transformation_id = v_t.id and o.source_ticket_id is not null
      )
    );

  select count(*)
  into v_invalid_batches
  from public.inventory_batches b
  cross join lateral (
    select round(coalesce(sum(sle.delta_qty_signed), 0), 6) as ledger_balance_kg
    from public.stock_ledger_entries sle
    where sle.company_id = b.company_id
      and sle.warehouse_id = b.warehouse_id
      and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = b.id::text
  ) canonical
  where b.id in (
    select i.batch_id from public.batch_transformation_inputs i
      where i.transformation_id = v_t.id and i.batch_id is not null
    union
    select o.output_batch_id from public.batch_transformation_outputs o
      where o.transformation_id = v_t.id and o.output_batch_id is not null
    union
    select child.id from public.inventory_batches child
      where child.source_transformation_id = v_t.id
    union
    select sle.inventory_batch_id
    from public.stock_ledger_entries sle
    where not coalesce(sle.is_storno, false)
      and sle.inventory_batch_id is not null
      and (
        (sle.processing_id = v_t.id and sle.ticket_id is null)
        or sle.ticket_id in (
          select o.source_ticket_id from public.batch_transformation_outputs o
          where o.transformation_id = v_t.id and o.source_ticket_id is not null
        )
      )
  )
    and (
      canonical.ledger_balance_kg < -0.001
      or abs(coalesce(b.current_quantity, 0) - greatest(canonical.ledger_balance_kg, 0)) > 0.001
      or abs(coalesce(b.current_weight_kg, 0) - greatest(canonical.ledger_balance_kg, 0)) > 0.001
      or abs(coalesce(b.mass_kg, 0) - greatest(canonical.ledger_balance_kg, 0)) > 0.001
    );

  if v_storno_created <> v_base_count
     or abs(v_after_effect_kg) > 0.001
     or v_outstanding <> 0
     or v_invalid_pairs <> 0
     or v_invalid_batches <> 0
     or exists (
       select 1
       from public.tickets tk
       where tk.id in (
         select o.source_ticket_id
         from public.batch_transformation_outputs o
         where o.transformation_id = v_t.id and o.source_ticket_id is not null
       )
         and (not coalesce(tk.is_voided, false) or tk.status::text <> 'voided')
     )
  then
    raise exception 'PROCESSING_REVERSAL_POSTCONDITION_FAILED|%|%|%|%|%|%',
      v_storno_created, v_base_count, v_after_effect_kg, v_outstanding, v_invalid_pairs, v_invalid_batches
      using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'batch_id', b.id,
    'warehouse_id', b.warehouse_id,
    'current_quantity', b.current_quantity,
    'current_weight_kg', b.current_weight_kg,
    'mass_kg', b.mass_kg,
    'ledger_balance_kg', round(coalesce((
      select sum(sle.delta_qty_signed)
      from public.stock_ledger_entries sle
      where sle.company_id = b.company_id
        and sle.warehouse_id = b.warehouse_id
        and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = b.id::text
    ), 0), 6)
  ) order by b.id), '[]'::jsonb)
  into v_batch_balances_after
  from public.inventory_batches b
  where b.id in (
    select i.batch_id from public.batch_transformation_inputs i
      where i.transformation_id = v_t.id and i.batch_id is not null
    union
    select o.output_batch_id from public.batch_transformation_outputs o
      where o.transformation_id = v_t.id and o.output_batch_id is not null
    union
    select child.id from public.inventory_batches child
      where child.source_transformation_id = v_t.id
    union
    select sle.inventory_batch_id
    from public.stock_ledger_entries sle
    where not coalesce(sle.is_storno, false)
      and sle.inventory_batch_id is not null
      and (
        (sle.processing_id = v_t.id and sle.ticket_id is null)
        or sle.ticket_id in (
          select o.source_ticket_id from public.batch_transformation_outputs o
          where o.transformation_id = v_t.id and o.source_ticket_id is not null
        )
      )
  );

  update public.batch_transformations
  set status = 'voided',
      updated_at = v_now
  where id = v_t.id;

  v_snapshot := jsonb_build_object(
    'contract_version', 'tz315_processing_reversal_v1',
    'reversal_receipt_id', v_receipt_id,
    'transformation_id', v_t.id,
    'company_id', v_t.company_id,
    'season_id', v_t.season_id,
    'reason', v_reason,
    'idempotency_key', v_idempotency_key,
    'request_fingerprint', v_request_fingerprint,
    'audit_run_code', v_audit_run_code,
    'reversed_at', v_now,
    'reversed_by', p_actor_user_id,
    'base_ledger_rows', v_base_count,
    'storno_created', v_storno_created,
    'tickets_voided', v_tickets_voided,
    'batches_reconciled', v_batches_reconciled,
    'before_processing_net_effect_kg', v_before_net_effect_kg,
    'before_processing_absolute_effect_kg', v_before_absolute_effect_kg,
    'after_processing_effect_kg', v_after_effect_kg,
    'outstanding_unreversed_rows', v_outstanding,
    'invalid_inverse_pairs', v_invalid_pairs,
    'invalid_batch_balances', v_invalid_batches,
    'batch_balances_before', v_batch_balances_before,
    'batch_balances_after', v_batch_balances_after,
    'downstream_check', v_blockers,
    'status', 'voided',
    'processing_state', 'processing_closed'
  );

  begin
    insert into public.batch_processing_reversals (
      id, company_id, season_id, transformation_id, actor_user_id,
      reason, idempotency_key, request_fingerprint, audit_run_code,
      snapshot, reversed_at, created_at
    ) values (
      v_receipt_id, v_t.company_id, v_t.season_id, v_t.id, p_actor_user_id,
      v_reason, v_idempotency_key, v_request_fingerprint, v_audit_run_code,
      v_snapshot, v_now, v_now
    );
  exception
    when unique_violation then
      raise exception 'PROCESSING_REVERSAL_IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end;

  insert into public.batch_processing_events (
    company_id, transformation_id, event_type, actor_type, actor_user_id,
    idempotency_key, observed_at, payload
  ) values (
    v_t.company_id, v_t.id, 'processing_reversed', 'user', p_actor_user_id,
    v_idempotency_key, v_now, v_snapshot
  );

  return v_snapshot || jsonb_build_object(
    'ok', true,
    'idempotent_replay', false
  );
end
$function$;

revoke all on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)
  to authenticated, service_role;
