-- TZ-234: QA-only remediation for core data integrity, workflow and UX contracts.
-- Production is intentionally guarded out until a separate owner-approved release task.

do $qa_guard$
begin
  if to_regclass('public.assistant_glbd_snapshot_meta') is null
     or not exists (
       select 1
       from public.assistant_glbd_snapshot_meta
       where branch_ref = 'gsglkmudcwkdetqtocae'
     ) then
    raise exception 'STOP: TZ-234 migration is allowed only on QA branch gsglkmudcwkdetqtocae';
  end if;
end;
$qa_guard$;

alter table public.crop_structure
  add column if not exists identity_review_required boolean not null default false,
  add column if not exists identity_review_reason text;

update public.crop_structure
set identity_review_required = true,
    identity_review_reason = case
      when crop_id is null then 'crop_missing'
      when variety_id is null and reproduction_id is null then 'variety_and_reproduction_missing'
      when variety_id is null then 'variety_missing'
      when reproduction_id is null then 'reproduction_missing'
      else identity_review_reason
    end,
    updated_at = now()
where archived = false
  and (crop_id is null or variety_id is null or reproduction_id is null)
  and (
    identity_review_required is distinct from true
    or identity_review_reason is null
  );

create table if not exists public.user_notification_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  email_enabled boolean not null default true,
  operation_updates_enabled boolean not null default true,
  warehouse_updates_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, company_id)
);

alter table public.user_notification_preferences enable row level security;

drop policy if exists user_notification_preferences_select_own on public.user_notification_preferences;
create policy user_notification_preferences_select_own
on public.user_notification_preferences
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
);

drop policy if exists user_notification_preferences_insert_own on public.user_notification_preferences;
create policy user_notification_preferences_insert_own
on public.user_notification_preferences
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
);

drop policy if exists user_notification_preferences_update_own on public.user_notification_preferences;
create policy user_notification_preferences_update_own
on public.user_notification_preferences
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
);

drop policy if exists user_notification_preferences_delete_own on public.user_notification_preferences;
create policy user_notification_preferences_delete_own
on public.user_notification_preferences
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
);

revoke all on table public.user_notification_preferences from public, anon;
grant select, insert, update, delete on table public.user_notification_preferences to authenticated;

alter table public.warehouse_issue_requests
  drop constraint if exists warehouse_issue_requests_status_check;
alter table public.warehouse_issue_requests
  add constraint warehouse_issue_requests_status_check check (
    status in (
      'new',
      'active',
      'preparing',
      'ready',
      'partially_issued',
      'issued_by_warehouse',
      'issued',
      'received_confirmed',
      'closed',
      'cancelled'
    )
  );

create or replace function public.sync_warehouse_request_closed_status_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.warehouse_request_status = 'closed' then
    new.status := 'closed';
    new.return_closed_at := coalesce(new.return_closed_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.sync_warehouse_request_closed_status_v1() from public, anon, authenticated;

drop trigger if exists sync_warehouse_request_closed_status_v1 on public.warehouse_issue_requests;
create trigger sync_warehouse_request_closed_status_v1
before insert or update of warehouse_request_status
on public.warehouse_issue_requests
for each row
execute function public.sync_warehouse_request_closed_status_v1();

update public.warehouse_issue_requests
set status = 'closed',
    return_closed_at = coalesce(return_closed_at, now()),
    updated_at = now()
where warehouse_request_status = 'closed'
  and status <> 'closed';

create or replace function public.enrich_field_history_material_facts_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact jsonb;
  v_enriched jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_product_name text;
  v_request_id uuid;
  v_request_number text;
  v_unit text;
  v_completion_date timestamptz;
begin
  if new.operation_id is null
     or jsonb_typeof(coalesce(new.material_facts, '[]'::jsonb)) <> 'array' then
    return new;
  end if;

  select coalesce(o.completed_at, o.date::timestamptz)
  into v_completion_date
  from public.operations o
  where o.id = new.operation_id
    and o.company_id = new.company_id;

  for v_fact in
    select value
    from jsonb_array_elements(coalesce(new.material_facts, '[]'::jsonb))
  loop
    v_product_id := nullif(v_fact ->> 'product_id', '')::uuid;
    v_product_name := null;
    v_request_id := null;
    v_request_number := null;
    v_unit := null;

    if v_product_id is not null then
      select coalesce(nullif(btrim(p.trade_name), ''), nullif(btrim(p.name), ''), 'Материал')
      into v_product_name
      from public.products p
      where p.id = v_product_id;

      select r.id,
             r.request_number,
             coalesce(nullif(btrim(i.issued_unit), ''), nullif(btrim(i.prepared_unit), ''), i.unit),
             coalesce(r.return_closed_at, v_completion_date)
      into v_request_id, v_request_number, v_unit, v_completion_date
      from public.warehouse_issue_requests r
      join public.warehouse_issue_request_items i on i.request_id = r.id
      where r.company_id = new.company_id
        and r.operation_id = new.operation_id
        and coalesce(i.actual_product_id, i.product_id) = v_product_id
        and i.reconciliation_status = 'reconciled'
      order by r.return_closed_at desc nulls last, r.created_at desc
      limit 1;
    end if;

    v_enriched := v_enriched || jsonb_build_array(
      v_fact || jsonb_build_object(
        'product_name', coalesce(nullif(v_fact ->> 'product_name', ''), v_product_name),
        'unit', coalesce(nullif(v_fact ->> 'unit', ''), v_unit),
        'request_id', coalesce(nullif(v_fact ->> 'request_id', '')::uuid, v_request_id),
        'request_number', coalesce(nullif(v_fact ->> 'request_number', ''), v_request_number),
        'completion_date', coalesce(nullif(v_fact ->> 'completion_date', '')::timestamptz, v_completion_date)
      )
    );
  end loop;

  new.material_facts := v_enriched;
  return new;
end;
$$;

revoke all on function public.enrich_field_history_material_facts_v1() from public, anon, authenticated;

drop trigger if exists enrich_field_history_material_facts_v1 on public.field_history_entries;
create trigger enrich_field_history_material_facts_v1
before insert or update of material_facts, operation_id
on public.field_history_entries
for each row
execute function public.enrich_field_history_material_facts_v1();

update public.field_history_entries
set material_facts = material_facts,
    updated_at = now()
where operation_id is not null
  and jsonb_array_length(material_facts) > 0;

create or replace function public.update_material_request_stage_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_action text,
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
  v_response jsonb;
  v_prepared numeric;
  v_product_id uuid;
  v_unit text;
  v_on_hand numeric;
  v_reserved numeric;
  v_available numeric;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  if p_action <> 'ready' then
    raise exception 'Warehouse can only mark a request ready'
      using errcode = '22023';
  end if;
  if p_source_warehouse_id is null then
    raise exception 'Source warehouse is required before materials can be marked ready'
      using errcode = '23514';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'request_stage', p_idempotency_key, p_request_fingerprint
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
    where w.id = p_source_warehouse_id and w.company_id = p_company_id
  ) then
    raise exception 'Source warehouse does not belong to the target company'
      using errcode = '23503';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Prepared quantities are required before materials can be marked ready'
      using errcode = '22023';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ) <> (
    select count(distinct value ->> 'item_id')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ) then
    raise exception 'Prepared item ids must be unique'
      using errcode = '23514';
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
    raise exception 'Prepared quantity is required for every request item'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(keys.lock_key)
  from (
    select distinct hashtextextended(
      concat_ws(
        ':',
        p_company_id::text,
        p_source_warehouse_id::text,
        coalesce(i.actual_product_id, i.product_id)::text,
        lower(btrim(coalesce(i.prepared_unit, i.unit, '')))
      ),
      0
    ) as lock_key
    from public.warehouse_issue_request_items i
    join jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      on x ->> 'item_id' = i.id::text
    where i.request_id = p_request_id
      and i.company_id = p_company_id
    order by lock_key
  ) keys;

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

    v_prepared := coalesce((v_input ->> 'prepared_quantity')::numeric, 0);
    if v_prepared < 0 then
      raise exception 'Prepared quantity must be zero or positive'
        using errcode = '23514';
    end if;

    v_product_id := coalesce(v_item.actual_product_id, v_item.product_id);
    v_unit := case lower(btrim(coalesce(v_item.prepared_unit, v_item.unit, '')))
      when 'kg' then 'kg' when 'кг' then 'kg'
      when 'l' then 'l' when 'л' then 'l' when 'liter' then 'l' when 'litre' then 'l'
      when 't' then 't' when 'т' then 't'
      when 'pcs' then 'pcs' when 'шт' then 'pcs' when 'шт.' then 'pcs'
      else lower(btrim(coalesce(v_item.prepared_unit, v_item.unit, '')))
    end;

    select coalesce(sum(b.quantity), 0)
    into v_on_hand
    from public.v_stock_balance_identity b
    where b.company_id = p_company_id
      and b.warehouse_id = p_source_warehouse_id
      and b.product_id = v_product_id
      and (
        case lower(btrim(coalesce(b.uom, '')))
          when 'kg' then 'kg' when 'кг' then 'kg'
          when 'l' then 'l' when 'л' then 'l' when 'liter' then 'l' when 'litre' then 'l'
          when 't' then 't' when 'т' then 't'
          when 'pcs' then 'pcs' when 'шт' then 'pcs' when 'шт.' then 'pcs'
          else lower(btrim(coalesce(b.uom, '')))
        end
      ) = v_unit;

    select coalesce(sum(greatest(coalesce(i.prepared_quantity, 0) - coalesce(i.issued_quantity, 0), 0)), 0)
    into v_reserved
    from public.warehouse_issue_requests r
    join public.warehouse_issue_request_items i on i.request_id = r.id
    where r.company_id = p_company_id
      and i.company_id = p_company_id
      and r.id <> p_request_id
      and r.source_warehouse_id = p_source_warehouse_id
      and coalesce(i.actual_product_id, i.product_id) = v_product_id
      and coalesce(
        r.warehouse_request_status,
        case r.status
          when 'new' then 'pending'
          when 'active' then 'pending'
          when 'preparing' then 'collecting'
          when 'ready' then 'ready_for_pickup'
          else r.status
        end
      ) in ('pending', 'collecting', 'ready_for_pickup')
      and (
        case lower(btrim(coalesce(i.prepared_unit, i.unit, '')))
          when 'kg' then 'kg' when 'кг' then 'kg'
          when 'l' then 'l' when 'л' then 'l' when 'liter' then 'l' when 'litre' then 'l'
          when 't' then 't' when 'т' then 't'
          when 'pcs' then 'pcs' when 'шт' then 'pcs' when 'шт.' then 'pcs'
          else lower(btrim(coalesce(i.prepared_unit, i.unit, '')))
        end
      ) = v_unit;

    v_available := v_on_hand - v_reserved;
    if v_prepared > v_available + 0.000001 then
      raise exception 'Insufficient available stock after reservations: on hand %, reserved %, available %, requested % %',
        round(v_on_hand, 4),
        round(v_reserved, 4),
        round(v_available, 4),
        round(v_prepared, 4),
        v_unit
        using errcode = '23514';
    end if;

    update public.warehouse_issue_request_items
    set prepared_quantity = round(v_prepared, 4),
        prepared_unit = unit,
        package_size = null,
        package_count = null,
        package_unit = null,
        reconciliation_status = 'prepared'
    where id = v_item.id;
  end loop;

  if not exists (
    select 1
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id
      and i.company_id = p_company_id
      and coalesce(i.prepared_quantity, 0) > 0.000001
  ) then
    raise exception 'At least one prepared quantity must be greater than zero'
      using errcode = '23514';
  end if;

  update public.warehouse_issue_requests
  set status = 'ready',
      warehouse_request_status = 'ready_for_pickup',
      source_warehouse_id = p_source_warehouse_id,
      prepared_at = coalesce(prepared_at, now()),
      ready_at = now(),
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id,
    p_actor_profile_id,
    'warehouse_issue_request',
    p_request_id::text,
    'request_ready_atomic',
    jsonb_build_object(
      'status', v_request.status,
      'source_warehouse_id', p_source_warehouse_id,
      'item_count', jsonb_array_length(coalesce(p_items, '[]'::jsonb)),
      'reservation_checked', true
    )
  );

  v_response := jsonb_build_object(
    'request', to_jsonb(v_request),
    'workflow_status', 'ready'
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'request_stage',
    p_request_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.update_material_request_stage_atomic_v1(
  uuid, uuid, uuid, text, uuid, jsonb, text, text
) from public, anon;
grant execute on function public.update_material_request_stage_atomic_v1(
  uuid, uuid, uuid, text, uuid, jsonb, text, text
) to authenticated;
