-- TZ-238: package-aware warehouse preparation, stable human identifiers and QA markers.

alter table public.inventory_batches
  add column if not exists package_size numeric(14,4),
  add column if not exists package_unit text;

alter table public.inventory_batches
  drop constraint if exists inventory_batches_package_size_check;
alter table public.inventory_batches
  add constraint inventory_batches_package_size_check
  check (package_size is null or package_size > 0);

alter table public.warehouse_issue_request_items
  add column if not exists issue_mode text,
  add column if not exists package_source text,
  add column if not exists package_reason text;

alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_issue_mode_check;
alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_issue_mode_check
  check (issue_mode is null or issue_mode in ('whole_package', 'measured', 'mixed'));

create table if not exists public.warehouse_issue_request_item_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null references public.warehouse_issue_requests(id) on delete cascade,
  request_item_id uuid not null references public.warehouse_issue_request_items(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  batch_id uuid references public.inventory_batches(id) on delete set null,
  batch_id_text text,
  batch_class text not null,
  batch_label text not null,
  issue_mode text not null,
  package_source text not null,
  package_size numeric(14,4),
  package_count integer,
  package_unit text,
  manual_package_reason text,
  prepared_quantity numeric(14,4) not null,
  issued_quantity numeric(14,4) not null default 0,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_issue_allocations_mode_check
    check (issue_mode in ('whole_package', 'measured')),
  constraint warehouse_issue_allocations_source_check
    check (package_source in ('batch', 'product', 'manual', 'measured')),
  constraint warehouse_issue_allocations_quantity_check
    check (
      prepared_quantity > 0
      and issued_quantity >= 0
      and issued_quantity <= prepared_quantity
    ),
  constraint warehouse_issue_allocations_package_check
    check (
      (
        issue_mode = 'measured'
        and package_source = 'measured'
        and package_size is null
        and package_count is null
      )
      or (
        issue_mode = 'whole_package'
        and package_size > 0
        and package_count > 0
        and package_unit is not null
        and (
          package_source <> 'manual'
          or nullif(btrim(manual_package_reason), '') is not null
        )
      )
    )
);

create unique index if not exists warehouse_issue_allocations_identity_uidx
  on public.warehouse_issue_request_item_allocations (
    request_item_id,
    batch_class,
    coalesce(batch_id_text, '__unassigned__')
  );
create index if not exists warehouse_issue_allocations_request_idx
  on public.warehouse_issue_request_item_allocations(company_id, request_id);
create index if not exists warehouse_issue_allocations_stock_idx
  on public.warehouse_issue_request_item_allocations(
    company_id, warehouse_id, request_item_id, batch_class, batch_id_text
  );

drop trigger if exists warehouse_issue_allocations_updated_at
  on public.warehouse_issue_request_item_allocations;
create trigger warehouse_issue_allocations_updated_at
before update on public.warehouse_issue_request_item_allocations
for each row execute function public.set_updated_at_timestamp();

alter table public.warehouse_issue_request_item_allocations enable row level security;
drop policy if exists warehouse_issue_allocations_select on public.warehouse_issue_request_item_allocations;
create policy warehouse_issue_allocations_select
  on public.warehouse_issue_request_item_allocations
  for select
  to authenticated
  using (company_id = public.get_user_company_id());

revoke all on table public.warehouse_issue_request_item_allocations from public, anon, authenticated;
grant select on table public.warehouse_issue_request_item_allocations to authenticated;

alter table public.stock_ledger_entries
  add column if not exists warehouse_issue_allocation_id uuid
  references public.warehouse_issue_request_item_allocations(id) on delete set null;
create index if not exists stock_ledger_entries_warehouse_issue_allocation_idx
  on public.stock_ledger_entries(warehouse_issue_allocation_id)
  where warehouse_issue_allocation_id is not null;

alter table public.fields
  add column if not exists field_code text,
  add column if not exists is_test_data boolean not null default false,
  add column if not exists test_run_code text;

alter table public.operations
  add column if not exists operation_number text,
  add column if not exists is_test_data boolean not null default false,
  add column if not exists test_run_code text;

with ranked as (
  select
    id,
    row_number() over (
      partition by company_id
      order by created_at, id
    ) as seq
  from public.fields
  where field_code is null
)
update public.fields f
set field_code = 'FLD-' || lpad(r.seq::text, 3, '0')
from ranked r
where f.id = r.id;

with ranked as (
  select
    id,
    extract(year from date)::integer as operation_year,
    row_number() over (
      partition by company_id, extract(year from date)
      order by created_at, id
    ) as seq
  from public.operations
  where operation_number is null
)
update public.operations o
set operation_number =
  'OP-' || r.operation_year::text || '-' || lpad(r.seq::text, 6, '0')
from ranked r
where o.id = r.id;

create unique index if not exists fields_company_field_code_uidx
  on public.fields(company_id, field_code)
  where field_code is not null;
create unique index if not exists operations_company_operation_number_uidx
  on public.operations(company_id, operation_number)
  where operation_number is not null;

create or replace function public.assign_field_code_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if nullif(btrim(new.field_code), '') is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(new.company_id::text || ':field_code', 0)
  );
  select coalesce(max(substring(field_code from '([0-9]+)$')::integer), 0) + 1
  into v_next
  from public.fields
  where company_id = new.company_id
    and field_code ~ '^FLD-[0-9]+$';
  new.field_code := 'FLD-' || lpad(v_next::text, 3, '0');
  return new;
end;
$$;

revoke all on function public.assign_field_code_v1() from public, anon, authenticated;
drop trigger if exists assign_field_code_v1 on public.fields;
create trigger assign_field_code_v1
before insert on public.fields
for each row execute function public.assign_field_code_v1();

create or replace function public.assign_operation_number_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer;
  v_next integer;
begin
  if nullif(btrim(new.operation_number), '') is not null then
    return new;
  end if;
  v_year := extract(year from new.date)::integer;
  perform pg_advisory_xact_lock(
    hashtextextended(new.company_id::text || ':operation_number:' || v_year::text, 0)
  );
  select coalesce(max(substring(operation_number from '([0-9]+)$')::integer), 0) + 1
  into v_next
  from public.operations
  where company_id = new.company_id
    and operation_number like 'OP-' || v_year::text || '-%';
  new.operation_number :=
    'OP-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
  return new;
end;
$$;

revoke all on function public.assign_operation_number_v1() from public, anon, authenticated;
drop trigger if exists assign_operation_number_v1 on public.operations;
create trigger assign_operation_number_v1
before insert on public.operations
for each row execute function public.assign_operation_number_v1();

update public.fields
set
  is_test_data = true,
  test_run_code = upper(
    regexp_replace(
      (regexp_match(name, '(?i)(E2E[-_ ]*TZ[0-9]+)'))[1],
      '[_ ]+',
      '-',
      'g'
    )
  )
where name ~* 'E2E[-_ ]*TZ[0-9]+';

update public.operations
set
  is_test_data = true,
  test_run_code = upper(
    regexp_replace(
      (regexp_match(coalesce(notes, '') || ' ' || coalesce(operation_type, ''), '(?i)(E2E[-_ ]*TZ[0-9]+)'))[1],
      '[_ ]+',
      '-',
      'g'
    )
  )
where coalesce(notes, '') || ' ' || coalesce(operation_type, '')
  ~* 'E2E[-_ ]*TZ[0-9]+';

create or replace function public.normalize_material_issue_uom_v1(p_unit text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(btrim(coalesce(p_unit, '')))
    when 'кг' then 'kg'
    when 'г' then 'g'
    when 'л' then 'l'
    when 'liter' then 'l'
    when 'litre' then 'l'
    when 'мл' then 'ml'
    when 'т' then 't'
    when 'шт' then 'pcs'
    when 'шт.' then 'pcs'
    when 'pc' then 'pcs'
    else lower(btrim(coalesce(p_unit, '')))
  end;
$$;

revoke all on function public.normalize_material_issue_uom_v1(text)
  from public, anon, authenticated;

create or replace function public.prepare_package_aware_material_request_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_source_warehouse_id uuid,
  p_items jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_request public.warehouse_issue_requests%rowtype;
  v_item public.warehouse_issue_request_items%rowtype;
  v_input jsonb;
  v_allocation jsonb;
  v_product_id uuid;
  v_unit text;
  v_prepared numeric;
  v_allocation_quantity numeric;
  v_on_hand numeric;
  v_reserved numeric;
  v_available numeric;
  v_batch_id_text text;
  v_batch_id uuid;
  v_batch_class text;
  v_issue_mode text;
  v_package_source text;
  v_package_size numeric;
  v_package_count numeric;
  v_package_unit text;
  v_manual_reason text;
  v_batch_package_size numeric;
  v_batch_package_unit text;
  v_product_package_size numeric;
  v_product_package_unit text;
  v_allocation_count integer;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  if p_source_warehouse_id is null then
    raise exception 'Source warehouse is required' using errcode = '23514';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id,
    'request_stage_package_v1',
    p_idempotency_key,
    p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Material request was not found' using errcode = 'P0002';
  end if;
  if v_request.status not in ('new', 'active', 'preparing', 'ready') then
    raise exception 'Material request cannot be prepared in its current stage'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_source_warehouse_id
      and w.company_id = p_company_id
      and not coalesce(w.archived, false)
      and not coalesce(w.is_archived, false)
  ) then
    raise exception 'Source warehouse does not belong to the target company'
      using errcode = '23503';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Prepared allocations are required' using errcode = '22023';
  end if;

  perform 1
  from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;

  if exists (
    select 1
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id
      and i.company_id = p_company_id
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
        where x ->> 'item_id' = i.id::text
      )
  ) then
    raise exception 'Allocation is required for every request item'
      using errcode = '23514';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) <> (
    select count(distinct value ->> 'item_id')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ) then
    raise exception 'Each request item must be submitted once'
      using errcode = '23505';
  end if;

  delete from public.warehouse_issue_request_item_allocations
  where request_id = p_request_id and company_id = p_company_id;

  for v_input in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_input ->> 'item_id')::uuid
      and request_id = p_request_id
      and company_id = p_company_id
    for update;
    if not found then
      raise exception 'Prepared item does not belong to the request'
        using errcode = '23503';
    end if;

    v_product_id := coalesce(v_item.actual_product_id, v_item.product_id);
    v_unit := public.normalize_material_issue_uom_v1(
      coalesce(v_item.prepared_unit, v_item.unit)
    );
    v_prepared := 0;
    v_allocation_count := jsonb_array_length(coalesce(v_input -> 'allocations', '[]'::jsonb));
    if v_allocation_count = 0 then
      raise exception 'At least one explicit stock allocation is required'
        using errcode = '22023';
    end if;
    if v_allocation_count <> (
      select count(distinct concat_ws(
        ':',
        nullif(value ->> 'batch_class', ''),
        coalesce(nullif(value ->> 'batch_id_text', ''), '__unassigned__')
      ))
      from jsonb_array_elements(coalesce(v_input -> 'allocations', '[]'::jsonb))
    ) then
      raise exception 'The same stock batch cannot be selected twice'
        using errcode = '23505';
    end if;

    select coalesce(sum(b.quantity), 0)
    into v_on_hand
    from public.v_stock_balance_identity b
    where b.company_id = p_company_id
      and b.warehouse_id = p_source_warehouse_id
      and b.product_id = v_product_id
      and public.normalize_material_issue_uom_v1(b.uom) = v_unit;

    select coalesce(sum(greatest(coalesce(i.prepared_quantity, 0) - coalesce(i.issued_quantity, 0), 0)), 0)
    into v_reserved
    from public.warehouse_issue_requests r
    join public.warehouse_issue_request_items i on i.request_id = r.id
    where r.company_id = p_company_id
      and i.company_id = p_company_id
      and r.id <> p_request_id
      and r.source_warehouse_id = p_source_warehouse_id
      and coalesce(i.actual_product_id, i.product_id) = v_product_id
      and coalesce(r.warehouse_request_status, '') in (
        'pending', 'collecting', 'ready_for_pickup'
      )
      and public.normalize_material_issue_uom_v1(
        coalesce(i.prepared_unit, i.unit)
      ) = v_unit;
    v_available := v_on_hand - v_reserved;

    for v_allocation in
      select value
      from jsonb_array_elements(coalesce(v_input -> 'allocations', '[]'::jsonb))
    loop
      v_allocation_quantity := coalesce((v_allocation ->> 'quantity')::numeric, 0);
      v_batch_id_text := nullif(v_allocation ->> 'batch_id_text', '');
      v_batch_id := nullif(v_allocation ->> 'batch_id', '')::uuid;
      v_batch_class := nullif(btrim(v_allocation ->> 'batch_class'), '');
      v_issue_mode := v_allocation ->> 'issue_mode';
      v_manual_reason := nullif(btrim(v_allocation ->> 'manual_package_reason'), '');
      if v_allocation_quantity <= 0 then
        raise exception 'Allocation quantity must be positive' using errcode = '23514';
      end if;
      if v_issue_mode not in ('whole_package', 'measured') then
        raise exception 'Unknown material issue mode' using errcode = '23514';
      end if;
      if v_batch_class is null then
        raise exception 'Stock batch class is required' using errcode = '23514';
      end if;
      if v_batch_id is not null
         and v_batch_id_text is distinct from v_batch_id::text then
        raise exception 'Batch identity does not match the selected inventory batch'
          using errcode = '23514';
      end if;

      perform pg_advisory_xact_lock(hashtextextended(
        concat_ws(
          ':',
          p_company_id::text,
          p_source_warehouse_id::text,
          v_product_id::text,
          v_unit,
          v_batch_class,
          coalesce(v_batch_id_text, '__unassigned__')
        ),
        0
      ));

      select coalesce(sum(b.quantity), 0)
      into v_on_hand
      from public.v_stock_balance_identity b
      where b.company_id = p_company_id
        and b.warehouse_id = p_source_warehouse_id
        and b.product_id = v_product_id
        and public.normalize_material_issue_uom_v1(b.uom) = v_unit
        and b.batch_class = v_batch_class
        and b.batch_id is not distinct from v_batch_id_text;

      select coalesce(sum(greatest(a.prepared_quantity - a.issued_quantity, 0)), 0)
      into v_reserved
      from public.warehouse_issue_request_item_allocations a
      join public.warehouse_issue_requests r on r.id = a.request_id
      join public.warehouse_issue_request_items i on i.id = a.request_item_id
      where a.company_id = p_company_id
        and a.request_id <> p_request_id
        and a.warehouse_id = p_source_warehouse_id
        and coalesce(i.actual_product_id, i.product_id) = v_product_id
        and public.normalize_material_issue_uom_v1(
          coalesce(i.prepared_unit, i.unit)
        ) = v_unit
        and a.batch_class = v_batch_class
        and a.batch_id_text is not distinct from v_batch_id_text
        and coalesce(r.warehouse_request_status, '') in (
          'pending', 'collecting', 'ready_for_pickup'
        );
      if v_allocation_quantity > v_on_hand - v_reserved + 0.000001 then
        raise exception 'Insufficient stock in selected batch. Available %, required %',
          round(v_on_hand - v_reserved, 4),
          round(v_allocation_quantity, 4)
          using errcode = '23514';
      end if;

      v_package_source := 'measured';
      v_package_size := null;
      v_package_count := null;
      v_package_unit := null;
      if v_issue_mode = 'whole_package' then
        v_batch_package_size := null;
        v_batch_package_unit := null;
        if v_batch_id is not null then
          select b.package_size, b.package_unit
          into v_batch_package_size, v_batch_package_unit
          from public.inventory_batches b
          where b.id = v_batch_id
            and b.company_id = p_company_id
            and b.product_id = v_product_id;
        end if;
        select p.package_size, p.package_unit
        into v_product_package_size, v_product_package_unit
        from public.products p
        where p.id = v_product_id;

        if v_batch_package_size is not null then
          v_package_source := 'batch';
          v_package_size := v_batch_package_size;
          v_package_unit := v_batch_package_unit;
        elsif v_product_package_size is not null then
          v_package_source := 'product';
          v_package_size := v_product_package_size;
          v_package_unit := v_product_package_unit;
        else
          v_package_source := 'manual';
          v_package_size := nullif(v_allocation ->> 'package_size', '')::numeric;
          v_package_unit := nullif(v_allocation ->> 'package_unit', '');
          if v_manual_reason is null then
            raise exception 'Manual package size requires an explanation'
              using errcode = '23514';
          end if;
        end if;
        v_package_count := nullif(v_allocation ->> 'package_count', '')::numeric;
        if v_package_size is null or v_package_size <= 0 then
          raise exception 'Package size must be positive' using errcode = '23514';
        end if;
        if v_package_count is null
           or v_package_count <= 0
           or v_package_count <> trunc(v_package_count) then
          raise exception 'Package count must be a positive integer'
            using errcode = '23514';
        end if;
        if public.normalize_material_issue_uom_v1(v_package_unit) <> v_unit then
          raise exception 'Package unit does not match request unit'
            using errcode = '23514';
        end if;
        if abs(v_allocation_quantity - v_package_size * v_package_count) > 0.0001 then
          raise exception 'Prepared quantity must equal package size multiplied by package count'
            using errcode = '23514';
        end if;
      end if;

      insert into public.warehouse_issue_request_item_allocations (
        company_id,
        request_id,
        request_item_id,
        warehouse_id,
        batch_id,
        batch_id_text,
        batch_class,
        batch_label,
        issue_mode,
        package_source,
        package_size,
        package_count,
        package_unit,
        manual_package_reason,
        prepared_quantity,
        created_by_profile_id
      ) values (
        p_company_id,
        p_request_id,
        v_item.id,
        p_source_warehouse_id,
        v_batch_id,
        v_batch_id_text,
        v_batch_class,
        coalesce(nullif(btrim(v_allocation ->> 'batch_label'), ''), 'Партия не указана'),
        v_issue_mode,
        v_package_source,
        v_package_size,
        v_package_count::integer,
        v_package_unit,
        v_manual_reason,
        round(v_allocation_quantity, 4),
        p_actor_profile_id
      );
      v_prepared := v_prepared + v_allocation_quantity;
    end loop;

    if v_prepared > v_available + 0.000001 then
      raise exception 'Insufficient available stock after reservations: available %, required %',
        round(v_available, 4),
        round(v_prepared, 4)
        using errcode = '23514';
    end if;
    if v_prepared + 0.000001
       < coalesce(v_item.planned_quantity, v_item.required_quantity, 0) then
      raise exception 'Prepared quantity cannot be lower than the operation plan'
        using errcode = '23514';
    end if;

    update public.warehouse_issue_request_items i
    set
      prepared_quantity = round(v_prepared, 4),
      prepared_unit = i.unit,
      expected_consumed_quantity = coalesce(i.planned_quantity, i.required_quantity, 0),
      expected_return_quantity = greatest(
        round(v_prepared, 4) - coalesce(i.planned_quantity, i.required_quantity, 0),
        0
      ),
      package_size = case when v_allocation_count = 1 then (
        select a.package_size
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      package_count = case when v_allocation_count = 1 then (
        select a.package_count
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      package_unit = case when v_allocation_count = 1 then (
        select a.package_unit
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      issue_mode = case
        when (
          select count(distinct a.issue_mode)
          from public.warehouse_issue_request_item_allocations a
          where a.request_item_id = i.id
        ) > 1 then 'mixed'
        else (
          select min(a.issue_mode)
          from public.warehouse_issue_request_item_allocations a
          where a.request_item_id = i.id
        )
      end,
      package_source = case when v_allocation_count = 1 then (
        select a.package_source
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      package_reason = case when v_allocation_count = 1 then (
        select a.manual_package_reason
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      batch_id = case when v_allocation_count = 1 then (
        select a.batch_id
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      shortage_quantity = greatest(
        coalesce(i.planned_quantity, i.required_quantity, 0) - round(v_prepared, 4),
        0
      ),
      reconciliation_status = 'prepared'
    where i.id = v_item.id;
  end loop;

  update public.warehouse_issue_requests
  set
    status = 'ready',
    warehouse_request_status = 'ready_for_pickup',
    source_warehouse_id = p_source_warehouse_id,
    prepared_at = coalesce(prepared_at, now()),
    ready_at = now(),
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, new_values
  ) values (
    p_company_id,
    p_actor_profile_id,
    'warehouse_issue_request',
    p_request_id::text,
    'request_ready_package_aware_v1',
    jsonb_build_object(
      'source_warehouse_id', p_source_warehouse_id,
      'allocation_count', (
        select count(*)
        from public.warehouse_issue_request_item_allocations
        where request_id = p_request_id
      ),
      'reservation_checked', true
    )
  );

  v_response := jsonb_build_object(
    'request', to_jsonb(v_request),
    'workflow_status', 'ready'
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'request_stage_package_v1',
    p_request_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.prepare_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon;
grant execute on function public.prepare_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to authenticated;

create or replace function public.issue_package_aware_material_request_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_source_warehouse_id uuid,
  p_items jsonb,
  p_ledger_rows jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_request public.warehouse_issue_requests%rowtype;
  v_item_input jsonb;
  v_item public.warehouse_issue_request_items%rowtype;
  v_allocation public.warehouse_issue_request_item_allocations%rowtype;
  v_ledger jsonb;
  v_stock record;
  v_issue_quantity numeric;
  v_ledger_quantity numeric;
  v_reserved numeric;
  v_next_issued numeric;
  v_total_prepared numeric;
  v_total_issued numeric;
  v_next_status text;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id,
    'issue_package_v1',
    p_idempotency_key,
    p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Material request was not found' using errcode = 'P0002';
  end if;
  if v_request.status in ('issued_by_warehouse', 'issued') then
    v_response := jsonb_build_object(
      'result', jsonb_build_object(
        'success', true,
        'already_issued', true,
        'request_id', p_request_id,
        'status', v_request.status
      ),
      'workflow_status', 'issued'
    );
    return public.operation_mutation_receipt_finish_v1(
      p_company_id,
      'issue_package_v1',
      p_request_id,
      p_idempotency_key,
      p_request_fingerprint,
      p_actor_profile_id,
      v_response
    );
  end if;
  if v_request.status not in ('received_confirmed', 'partially_issued') then
    raise exception 'Specialist must accept prepared materials before warehouse issue'
      using errcode = '23514';
  end if;
  if v_request.source_warehouse_id is distinct from p_source_warehouse_id then
    raise exception 'Selected warehouse does not match the prepared request warehouse'
      using errcode = '23514';
  end if;

  perform 1
  from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;
  perform 1
  from public.warehouse_issue_request_item_allocations a
  where a.request_id = p_request_id and a.company_id = p_company_id
  for update;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'At least one issue item is required' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) <> (
    select count(distinct value ->> 'item_id')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ) then
    raise exception 'Each issue item must be submitted once'
      using errcode = '23505';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    left join public.warehouse_issue_request_item_allocations a
      on a.id = nullif(row ->> 'allocation_id', '')::uuid
     and a.request_id = p_request_id
     and a.company_id = p_company_id
    left join public.warehouse_issue_request_items i
      on i.id = a.request_item_id
    where a.id is null
       or row ->> 'reason_ref_id' is distinct from a.request_item_id::text
       or row ->> 'warehouse_id' is distinct from a.warehouse_id::text
       or row ->> 'product_id' is distinct from coalesce(i.actual_product_id, i.product_id)::text
       or row ->> 'batch_class' is distinct from a.batch_class
       or public.normalize_material_issue_uom_v1(row ->> 'uom')
          is distinct from public.normalize_material_issue_uom_v1(
            coalesce(i.prepared_unit, i.unit)
          )
       or nullif(row ->> 'batch_id_text', '')
          is distinct from a.batch_id_text
  ) then
    raise exception 'Ledger payload contains an unknown or mismatched prepared allocation'
      using errcode = '23514';
  end if;

  for v_item_input in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_item_input ->> 'item_id')::uuid
      and request_id = p_request_id
      and company_id = p_company_id
    for update;
    if not found then
      raise exception 'Issue item does not belong to the request'
        using errcode = '23503';
    end if;
    v_issue_quantity := coalesce((v_item_input ->> 'issued_quantity')::numeric, 0);
    if v_issue_quantity <= 0 then
      raise exception 'Issue quantity must be positive' using errcode = '22023';
    end if;
    if coalesce(v_item.issued_quantity, 0) + v_issue_quantity
       > coalesce(v_item.prepared_quantity, 0) + 0.000001 then
      raise exception 'Issued quantity exceeds prepared remainder'
        using errcode = '23514';
    end if;
    select coalesce(sum(a.prepared_quantity - a.issued_quantity), 0)
    into v_ledger_quantity
    from public.warehouse_issue_request_item_allocations a
    where a.request_item_id = v_item.id;
    if abs(v_ledger_quantity - v_issue_quantity) > 0.0001 then
      raise exception 'Issue must use the prepared allocation remainder'
        using errcode = '23514';
    end if;
    select coalesce(sum(abs((row ->> 'delta_qty_signed')::numeric)), 0)
    into v_ledger_quantity
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    where row ->> 'reason_ref_id' = v_item.id::text;
    if abs(v_ledger_quantity - v_issue_quantity) > 0.0001 then
      raise exception 'Ledger payload does not match issued quantity'
        using errcode = '23514';
    end if;
  end loop;

  for v_allocation in
    select *
    from public.warehouse_issue_request_item_allocations
    where request_id = p_request_id
      and company_id = p_company_id
      and prepared_quantity > issued_quantity + 0.000001
    order by created_at, id
  loop
    select coalesce(sum(abs((row ->> 'delta_qty_signed')::numeric)), 0)
    into v_ledger_quantity
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    where row ->> 'allocation_id' = v_allocation.id::text;
    if abs(
      v_ledger_quantity
      - (v_allocation.prepared_quantity - v_allocation.issued_quantity)
    ) > 0.0001 then
      raise exception 'Ledger payload does not match prepared batch allocation'
        using errcode = '23514';
    end if;
  end loop;

  for v_stock in
    select
      (row ->> 'warehouse_id')::uuid as warehouse_id,
      (row ->> 'product_id')::uuid as product_id,
      row ->> 'uom' as uom,
      row ->> 'batch_class' as batch_class,
      nullif(row ->> 'batch_id_text', '') as batch_id_text,
      sum(abs((row ->> 'delta_qty_signed')::numeric)) as required_quantity
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    group by 1, 2, 3, 4, 5
    order by 1::text, 2::text, 3, 4, 5
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      concat_ws(
        ':',
        p_company_id::text,
        v_stock.warehouse_id::text,
        v_stock.product_id::text,
        v_stock.uom,
        v_stock.batch_class,
        coalesce(v_stock.batch_id_text, '__unassigned__')
      ),
      0
    ));
    select coalesce(sum(l.delta_qty_signed), 0)
    into v_ledger_quantity
    from public.stock_ledger_entries l
    where l.company_id = p_company_id
      and l.warehouse_id = v_stock.warehouse_id
      and l.product_id = v_stock.product_id
      and l.uom = v_stock.uom
      and l.batch_class = v_stock.batch_class
      and l.batch_id_text is not distinct from v_stock.batch_id_text;
    select coalesce(sum(greatest(a.prepared_quantity - a.issued_quantity, 0)), 0)
    into v_reserved
    from public.warehouse_issue_request_item_allocations a
    join public.warehouse_issue_requests r on r.id = a.request_id
    join public.warehouse_issue_request_items i on i.id = a.request_item_id
    where a.company_id = p_company_id
      and a.request_id <> p_request_id
      and a.warehouse_id = v_stock.warehouse_id
      and coalesce(i.actual_product_id, i.product_id) = v_stock.product_id
      and public.normalize_material_issue_uom_v1(
        coalesce(i.prepared_unit, i.unit)
      ) = public.normalize_material_issue_uom_v1(v_stock.uom)
      and a.batch_class = v_stock.batch_class
      and a.batch_id_text is not distinct from v_stock.batch_id_text
      and coalesce(r.warehouse_request_status, '') in (
        'pending', 'collecting', 'ready_for_pickup'
      );
    if v_ledger_quantity - v_reserved + 0.000001 < v_stock.required_quantity then
      raise exception 'Insufficient stock. Available %, required %',
        greatest(v_ledger_quantity - v_reserved, 0),
        v_stock.required_quantity
        using errcode = '23514';
    end if;
  end loop;

  for v_ledger in
    select value from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb))
  loop
    insert into public.stock_ledger_entries (
      company_id,
      product_id,
      warehouse_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      reason_type,
      reason_ref_id,
      occurred_at,
      created_by,
      notes,
      batch_id_text,
      batch_class,
      mass_kg,
      density_kg_per_l,
      density_unit,
      density_source,
      density_verification_status,
      density_verified_at,
      unit_source,
      unit_contract_version,
      operation_line_id,
      warehouse_issue_allocation_id
    ) values (
      p_company_id,
      (v_ledger ->> 'product_id')::uuid,
      (v_ledger ->> 'warehouse_id')::uuid,
      'out',
      abs((v_ledger ->> 'quantity')::numeric),
      v_ledger ->> 'uom',
      -abs((v_ledger ->> 'delta_qty_signed')::numeric),
      'warehouse_issue',
      (v_ledger ->> 'reason_ref_id')::uuid,
      coalesce(nullif(v_ledger ->> 'occurred_at', '')::timestamptz, now()),
      auth.uid(),
      nullif(v_ledger ->> 'notes', ''),
      nullif(v_ledger ->> 'batch_id_text', ''),
      v_ledger ->> 'batch_class',
      nullif(v_ledger ->> 'mass_kg', '')::numeric,
      nullif(v_ledger ->> 'density_kg_per_l', '')::numeric,
      nullif(v_ledger ->> 'density_unit', ''),
      nullif(v_ledger ->> 'density_source', ''),
      nullif(v_ledger ->> 'density_verification_status', ''),
      nullif(v_ledger ->> 'density_verified_at', '')::timestamptz,
      nullif(v_ledger ->> 'unit_source', ''),
      nullif(v_ledger ->> 'unit_contract_version', '')::smallint,
      coalesce(
        v_request.operation_line_id,
        nullif(v_ledger ->> 'operation_line_id', '')::uuid
      ),
      (v_ledger ->> 'allocation_id')::uuid
    );
    update public.warehouse_issue_request_item_allocations
    set
      issued_quantity = round(
        issued_quantity + abs((v_ledger ->> 'delta_qty_signed')::numeric),
        4
      ),
      updated_at = now()
    where id = (v_ledger ->> 'allocation_id')::uuid
      and request_id = p_request_id
      and company_id = p_company_id;
  end loop;

  for v_item_input in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_item_input ->> 'item_id')::uuid
    for update;
    v_issue_quantity := (v_item_input ->> 'issued_quantity')::numeric;
    v_next_issued := coalesce(v_item.issued_quantity, 0) + v_issue_quantity;
    update public.warehouse_issue_request_items
    set
      issued_quantity = round(v_next_issued, 4),
      issued_unit = unit,
      expected_consumed_quantity = coalesce(planned_quantity, required_quantity, 0),
      expected_return_quantity = greatest(
        v_next_issued - coalesce(planned_quantity, required_quantity, 0),
        0
      ),
      shortage_quantity = greatest(
        coalesce(planned_quantity, required_quantity, 0) - v_next_issued,
        0
      ),
      reconciliation_status = 'issued'
    where id = v_item.id;
  end loop;

  select coalesce(sum(prepared_quantity), 0), coalesce(sum(issued_quantity), 0)
  into v_total_prepared, v_total_issued
  from public.warehouse_issue_request_items
  where request_id = p_request_id and company_id = p_company_id;
  v_next_status := case
    when v_total_prepared > 0
      and v_total_issued >= v_total_prepared - 0.000001
      then 'issued_by_warehouse'
    else 'partially_issued'
  end;

  update public.warehouse_issue_requests
  set
    status = v_next_status,
    source_warehouse_id = p_source_warehouse_id,
    issued_at = now(),
    issued_by_user_id = p_actor_profile_id,
    warehouse_request_status = 'issued',
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  update public.operation_materials m
  set
    issued_quantity = q.issued_quantity,
    updated_by_user_id = auth.uid(),
    updated_at = now()
  from (
    select i.product_id, sum(coalesce(i.issued_quantity, 0)) as issued_quantity
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id and i.company_id = p_company_id
    group by i.product_id
  ) q
  where m.operation_id = v_request.operation_id
    and m.company_id = p_company_id
    and m.product_id = q.product_id;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, new_values
  ) values (
    p_company_id,
    p_actor_profile_id,
    'warehouse_issue_request',
    p_request_id::text,
    'issued_package_aware_v1',
    jsonb_build_object(
      'status', v_next_status,
      'total_prepared', v_total_prepared,
      'total_issued', v_total_issued,
      'ledger_rows', jsonb_array_length(coalesce(p_ledger_rows, '[]'::jsonb))
    )
  );

  v_response := jsonb_build_object(
    'result', jsonb_build_object(
      'success', true,
      'request_id', p_request_id,
      'status', v_next_status,
      'issued_at', v_request.issued_at,
      'total_prepared', v_total_prepared,
      'total_issued', v_total_issued
    ),
    'workflow_status',
    case when v_next_status = 'partially_issued' then 'partially_issued' else 'issued' end
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'issue_package_v1',
    p_request_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.issue_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.issue_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;
