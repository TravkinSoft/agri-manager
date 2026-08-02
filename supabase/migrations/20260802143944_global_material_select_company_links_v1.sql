create table if not exists public.company_product_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  global_product_id uuid not null references public.products(id) on delete restrict,
  source text not null check (source in ('operation', 'warehouse_receipt', 'manual_catalog_add')),
  sources text[] not null default '{}'::text[],
  first_used_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_product_links_company_global_key unique (company_id, global_product_id),
  constraint company_product_links_time_order_check check (last_used_at >= first_used_at)
);

comment on table public.company_product_links is
  'Idempotent company usage links to canonical global products. Does not duplicate public.products rows.';

create index if not exists idx_company_product_links_company_last_used_v1
  on public.company_product_links(company_id, last_used_at desc);

create index if not exists idx_company_product_links_global_product_v1
  on public.company_product_links(global_product_id);

alter table public.company_product_links enable row level security;

drop policy if exists "Company members can read company product links" on public.company_product_links;
create policy "Company members can read company product links"
  on public.company_product_links
  for select
  to authenticated
  using (
    company_id = (select public.get_user_company_id())
    or (select private.is_active_global_admin())
  );

revoke all on table public.company_product_links from public, anon;
revoke insert, update, delete on table public.company_product_links from authenticated;
grant select on table public.company_product_links to authenticated;

create or replace function private.upsert_company_product_link_v1(
  p_company_id uuid,
  p_product_id uuid,
  p_source text,
  p_used_at timestamptz default now(),
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_global_product_id uuid;
  v_link_id uuid;
  v_used_at timestamptz := coalesce(p_used_at, now());
begin
  if p_source not in ('operation', 'warehouse_receipt', 'manual_catalog_add') then
    raise exception 'Unsupported company product link source' using errcode = '23514';
  end if;

  select case
      when product.company_id is null then product.id
      when product.company_id = p_company_id then product.master_product_id
      else null
    end
    into v_global_product_id
  from public.products product
  where product.id = p_product_id
    and coalesce(product.archived, false) = false
    and coalesce(product.is_active, true) = true;

  if v_global_product_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.products global_product
    where global_product.id = v_global_product_id
      and global_product.company_id is null
      and coalesce(global_product.archived, false) = false
      and coalesce(global_product.is_active, true) = true
  ) then
    raise exception 'Canonical global product is unavailable' using errcode = '23503';
  end if;

  insert into public.company_product_links (
    company_id,
    global_product_id,
    source,
    sources,
    first_used_at,
    last_used_at,
    created_by,
    created_at,
    updated_at
  ) values (
    p_company_id,
    v_global_product_id,
    p_source,
    array[p_source],
    v_used_at,
    v_used_at,
    p_created_by,
    now(),
    now()
  )
  on conflict (company_id, global_product_id) do update
  set source = excluded.source,
      sources = (
        select array_agg(distinct source_name order by source_name)
        from unnest(public.company_product_links.sources || excluded.sources) as source_name
      ),
      first_used_at = least(public.company_product_links.first_used_at, excluded.first_used_at),
      last_used_at = greatest(public.company_product_links.last_used_at, excluded.last_used_at),
      created_by = coalesce(public.company_product_links.created_by, excluded.created_by),
      updated_at = now()
  returning id into v_link_id;

  return v_link_id;
end;
$$;

revoke all on function private.upsert_company_product_link_v1(uuid, uuid, text, timestamptz, uuid)
  from public, anon, authenticated;

create or replace function public.link_company_global_product_v1(
  p_company_id uuid,
  p_global_product_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_link_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.id is null
     or v_actor.role not in ('global_admin', 'company_admin')
     or (v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id) then
    raise exception 'Access denied';
  end if;

  v_link_id := private.upsert_company_product_link_v1(
    p_company_id,
    p_global_product_id,
    'manual_catalog_add',
    now(),
    auth.uid()
  );

  if v_link_id is null then
    raise exception 'Global product is unavailable';
  end if;
  return v_link_id;
end;
$$;

revoke all on function public.link_company_global_product_v1(uuid, uuid)
  from public, anon;
grant execute on function public.link_company_global_product_v1(uuid, uuid)
  to authenticated;

create or replace function private.link_operation_material_product_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.upsert_company_product_link_v1(
    new.company_id,
    new.product_id,
    'operation',
    coalesce(new.created_at, now()),
    coalesce(new.created_by_user_id, auth.uid())
  );
  return new;
end;
$$;

revoke all on function private.link_operation_material_product_v1()
  from public, anon, authenticated;

drop trigger if exists operation_materials_company_product_link_v1 on public.operation_materials;
create trigger operation_materials_company_product_link_v1
after insert or update of product_id on public.operation_materials
for each row
when (new.product_id is not null)
execute function private.link_operation_material_product_v1();

create or replace function private.link_warehouse_receipt_product_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.upsert_company_product_link_v1(
    new.company_id,
    new.product_id,
    'warehouse_receipt',
    coalesce(new.occurred_at, new.created_at, now()),
    coalesce(new.created_by, auth.uid())
  );
  return new;
end;
$$;

revoke all on function private.link_warehouse_receipt_product_v1()
  from public, anon, authenticated;

drop trigger if exists stock_ledger_company_product_link_v1 on public.stock_ledger_entries;
create trigger stock_ledger_company_product_link_v1
after insert on public.stock_ledger_entries
for each row
when (
  new.product_id is not null
  and new.direction = 'in'
  and coalesce(new.is_storno, false) = false
  and new.reason_type in ('warehouse_receipt', 'supplier_receipt_in')
)
execute function private.link_warehouse_receipt_product_v1();

create or replace function public.create_warehouse_receipt_atomic_v4(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_supplier_company_counterparty_id uuid,
  p_supplier_global_counterparty_id uuid,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_result jsonb;
  v_line jsonb;
  v_product public.products%rowtype;
  v_global_product_id uuid;
  v_actions jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid() and status = 'active';

  if not found or v_actor.role not in ('global_admin', 'company_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Warehousekeeper role is required';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to receipt company';
  end if;

  v_result := public.create_warehouse_receipt_atomic_v3(
    p_company_id,
    p_warehouse_id,
    p_supplier_company_counterparty_id,
    p_supplier_global_counterparty_id,
    p_document_no,
    p_notes,
    p_lines,
    p_idempotency_key
  );

  for v_line in
    select distinct on (value ->> 'product_id') value
    from jsonb_array_elements(p_lines)
    where coalesce(value ->> 'product_id', '') <> ''
  loop
    select * into v_product
    from public.products
    where id = (v_line ->> 'product_id')::uuid
      and (company_id is null or company_id = p_company_id)
      and coalesce(archived, false) = false
      and coalesce(is_active, true) = true;

    if not found then
      continue;
    end if;

    v_global_product_id := case
      when v_product.company_id is null then v_product.id
      else v_product.master_product_id
    end;

    if v_global_product_id is null then
      continue;
    end if;

    perform private.upsert_company_product_link_v1(
      p_company_id,
      v_product.id,
      'warehouse_receipt',
      now(),
      v_actor.id
    );

    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'global_product_id', v_global_product_id,
      'action', 'linked'
    ));
  end loop;

  update public.tickets
  set audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'company_product_links', v_actions
      ),
      updated_at = now()
  where id = p_idempotency_key and company_id = p_company_id;

  return v_result || jsonb_build_object('company_product_links', v_actions);
end;
$$;

revoke all on function public.create_warehouse_receipt_atomic_v4(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) from public, anon;

grant execute on function public.create_warehouse_receipt_atomic_v4(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) to authenticated;
