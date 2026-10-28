set local lock_timeout='5s';
set local statement_timeout='30s';
-- UNAPPLIED MTM prerequisite. Expand only the existing products.type CHECK.
-- No product rows are inserted, renamed, reclassified or backfilled.
-- product_type remains the existing agrochemical classification (NULL for MTM).

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- PostgreSQL normalizes both expressions, avoiding version-specific formatting
-- assumptions while still rejecting any different current restriction.
create temporary table mtm_product_type_preflight(type text not null) on commit drop;
alter table mtm_product_type_preflight add constraint mtm_expected_old_type_check
  check (type in ('produce','seed','fertilizer','pesticide'));

-- Lock before comparing the definition so a concurrent migration cannot change
-- the checked constraint between preflight and replacement. Timeout is bounded.
lock table public.products in access exclusive mode;
do $$
declare actual_definition text; expected_definition text;
begin
  if not exists(select 1 from pg_catalog.pg_attribute
    where attrelid='public.products'::regclass and attname='type'
      and atttypid='text'::regtype and attnotnull and not attisdropped) then
    raise exception 'MTM_PRODUCTS_TYPE_COLUMN_MISMATCH' using errcode='55000';
  end if;
  select pg_catalog.pg_get_constraintdef(oid) into actual_definition
  from pg_catalog.pg_constraint
  where conrelid='public.products'::regclass and conname='products_type_check' and contype='c';
  select pg_catalog.pg_get_constraintdef(oid) into expected_definition
  from pg_catalog.pg_constraint
  where conrelid='pg_temp.mtm_product_type_preflight'::regclass
    and conname='mtm_expected_old_type_check';
  if actual_definition is null or actual_definition is distinct from expected_definition then
    raise exception 'MTM_PRODUCTS_TYPE_CHECK_MISMATCH' using errcode='55000';
  end if;
end $$;

alter table public.products
  drop constraint products_type_check,
  add constraint products_type_check
    check (type in ('produce','seed','fertilizer','pesticide','material','fuel'));

-- UNAPPLIED SQL DRAFT. MTM catalog V1; no stock movement, seed, or business-data update.
-- Supabase CLI was absent when prepared. Promote through the project's reviewed
-- migration process only after a separate approval and real-schema verification.
-- Uses existing companies, profiles, products and the three existing model catalogs.

-- Keep the shared private schema and its existing ACL unchanged.
create schema mtm_private;
revoke all on schema mtm_private from public, anon, authenticated;

create table public.mtm_catalog (
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  category text not null check (category in ('part','lubricant','ppe','tire','consumable')),
  part_number text,
  barcode text,
  internal_code text,
  specifications text not null,
  accounting_unit_note text not null,
  applicability jsonb not null default '[]'::jsonb check (jsonb_typeof(applicability) = 'array'),
  revision integer not null check (revision > 0),
  updated_at timestamptz not null,
  updated_by uuid not null references public.profiles(id),
  primary key(company_id, product_id),
  unique(company_id, barcode)
);
create index mtm_catalog_product_idx on public.mtm_catalog(product_id);
create index mtm_catalog_actor_idx on public.mtm_catalog(updated_by);
create table public.mtm_catalog_history (
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  revision integer not null,
  actor_id uuid not null references public.profiles(id),
  changed_at timestamptz not null,
  previous_value jsonb,
  new_value jsonb not null,
  primary key(company_id, product_id, revision)
);
create index mtm_catalog_history_product_idx on public.mtm_catalog_history(product_id);
create index mtm_catalog_history_actor_idx on public.mtm_catalog_history(actor_id);
alter table public.mtm_catalog enable row level security;
alter table public.mtm_catalog_history enable row level security;
revoke all on public.mtm_catalog, public.mtm_catalog_history from public, anon, authenticated;

-- Never accept role/company/actor from JSON or user-editable JWT metadata.
-- Fail closed on legacy aliases until those profiles use canonical roles.
create function mtm_private.mtm_actor_v1(p_company_id uuid, p_write boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare a public.profiles%rowtype; selected_company uuid;
begin
  if auth.uid() is null or p_company_id is null then
    raise exception 'MTM_FORBIDDEN' using errcode = '42501';
  end if;
  select * into a from public.profiles p
    -- Canonical profiles link by id. Some historical environments additionally
    -- have user_id; JSON lookup preserves that fallback without requiring a column.
    where p.id = auth.uid() or to_jsonb(p)->>'user_id' = auth.uid()::text
    order by (p.id = auth.uid()) desc, p.id limit 1;
  if not found or a.status is distinct from 'active'
    or coalesce(a.role,'') not in ('global_admin','company_admin','warehouse','warehouse_operator','mechanic_operator','fleet_manager','agronomist','director','accountant')
    or (a.role <> 'global_admin' and a.company_id is distinct from p_company_id)
    or (p_write and a.role not in ('global_admin','company_admin')) then
    raise exception 'MTM_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'MTM_FORBIDDEN' using errcode = '42501';
  end if;
  if a.role='global_admin' then
    -- Match server-session's explicitly selected company. A direct RPC must not
    -- use the underlying administrator JWT to bypass the displayed context.
    select c.company_id into selected_company from public.global_admin_company_contexts c
      where c.user_id in (a.id,auth.uid()) and c.company_id is not null
      order by (c.user_id=a.id) desc limit 1;
    if selected_company is distinct from p_company_id then
      raise exception 'MTM_FORBIDDEN' using errcode = '42501';
    end if;
    if exists(select 1 from public.global_admin_impersonation_contexts i
      where i.admin_user_id in (a.id,auth.uid())
        and (i.impersonated_profile_id is not null or i.impersonated_company_id is not null)) then
      raise exception 'MTM_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  return a.id;
end $$;
revoke all on function mtm_private.mtm_actor_v1(uuid,boolean) from public, anon, authenticated;

create function mtm_private.mtm_can_read_v1(p_company_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  perform mtm_private.mtm_actor_v1(p_company_id, false);
  return true;
exception when insufficient_privilege then return false;
end $$;
revoke all on function mtm_private.mtm_can_read_v1(uuid) from public, anon, authenticated;
grant usage on schema mtm_private to authenticated;
grant execute on function mtm_private.mtm_can_read_v1(uuid) to authenticated;
create policy mtm_catalog_read on public.mtm_catalog for select to authenticated
  using (mtm_private.mtm_can_read_v1(company_id));
create policy mtm_catalog_history_read on public.mtm_catalog_history for select to authenticated
  using (mtm_private.mtm_can_read_v1(company_id));
grant select on public.mtm_catalog, public.mtm_catalog_history to authenticated;

-- Internal formatting function. Existing catalogs remain authoritative.
create function mtm_private.mtm_item_json_v1(p_item public.mtm_catalog)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p_item) || jsonb_build_object(
    'product', jsonb_build_object('id',p.id,'name',p.name,'type',p.type,'base_uom',p.base_uom,'pack_uom',p.pack_uom,'units_per_pack',p.units_per_pack),
    'applicability', coalesce((select jsonb_agg(e.value || jsonb_build_object('model_name',
      case e.value->>'model_kind'
        when 'machine' then coalesce((select m.full_name from public.agricultural_machine_models m where m.id=(e.value->>'model_id')::uuid),'Модель недоступна')
        when 'equipment' then coalesce((select coalesce(nullif(m.full_name,''),m.name) from public.equipment_models m where m.id=(e.value->>'model_id')::uuid),'Модель недоступна')
        when 'transport' then coalesce((select m.full_name from public.transport_models m where m.id=(e.value->>'model_id')::uuid),'Модель недоступна')
      end) order by e.ordinality) from jsonb_array_elements(p_item.applicability) with ordinality e(value,ordinality)), '[]'::jsonb))
  from public.products p where p.id=p_item.product_id;
$$;
revoke all on function mtm_private.mtm_item_json_v1(public.mtm_catalog) from public, anon, authenticated;

create function mtm_private.mtm_catalog_save_v1(p_company_id uuid,p_product_id uuid,p_expected_revision integer,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; old_row public.mtm_catalog%rowtype; new_row public.mtm_catalog%rowtype;
  product public.products%rowtype; entry jsonb; normalized_entries jsonb := '[]'::jsonb;
  model_id uuid; model_ok boolean; duplicate_keys text[] := '{}'; entry_key text;
  v_part text; v_barcode text; v_internal text; v_specs text; v_unit text; v_source text; v_restrictions text;
begin
  actor := mtm_private.mtm_actor_v1(p_company_id,true);
  if p_product_id is null or p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 2147483647
    or jsonb_typeof(p_metadata) is distinct from 'object'
    or (p_metadata - array['category','part_number','barcode','internal_code','specifications','accounting_unit_note','applicability']) <> '{}'::jsonb
    or jsonb_typeof(p_metadata->'category') is distinct from 'string'
    or p_metadata->>'category' not in ('part','lubricant','ppe','tire','consumable')
    or jsonb_typeof(p_metadata->'specifications') is distinct from 'string'
    or jsonb_typeof(p_metadata->'accounting_unit_note') is distinct from 'string'
    or jsonb_typeof(p_metadata->'applicability') is distinct from 'array' then
    raise exception 'MTM_INVALID_METADATA';
  end if;
  if jsonb_array_length(p_metadata->'applicability') > 100 then raise exception 'MTM_INVALID_APPLICABILITY'; end if;
  foreach entry_key in array array['part_number','barcode','internal_code'] loop
    if not p_metadata ? entry_key or jsonb_typeof(p_metadata->entry_key) not in ('string','null') then
      raise exception 'MTM_INVALID_IDENTIFIER';
    end if;
  end loop;
  v_part := nullif(btrim(p_metadata->>'part_number'),'');
  v_barcode := nullif(btrim(p_metadata->>'barcode'),'');
  v_internal := nullif(btrim(p_metadata->>'internal_code'),'');
  v_specs := btrim(p_metadata->>'specifications');
  v_unit := btrim(p_metadata->>'accounting_unit_note');
  if length(v_part)>200 or length(v_barcode)>128 or length(v_internal)>200 or v_barcode ~ '[[:cntrl:]]'
    or length(v_specs) not between 1 and 4000 or length(v_unit) not between 1 and 500 then
    raise exception 'MTM_INVALID_METADATA';
  end if;
  -- Serializes create and edit, including the missing-row/expected_revision=0 case.
  perform pg_advisory_xact_lock(hashtextextended('mtm-catalog:'||p_company_id::text||':'||p_product_id::text,0));
  select * into product from public.products p where p.id=p_product_id for share;
  if not found or product.archived is distinct from false or product.is_active is distinct from true
    or coalesce(product.type,'') not in ('material','fuel')
    or (product.company_id is not null and product.company_id <> p_company_id)
    or coalesce(product.base_uom,'') not in ('kg','l','pcs') then
    raise exception 'MTM_PRODUCT_UNAVAILABLE';
  end if;
  for entry in select value from jsonb_array_elements(p_metadata->'applicability') loop
    if jsonb_typeof(entry) <> 'object'
      or (entry - array['model_kind','model_id','node','status','source','restrictions']) <> '{}'::jsonb
      or jsonb_typeof(entry->'model_kind') is distinct from 'string'
      or entry->>'model_kind' not in ('machine','equipment','transport')
      or jsonb_typeof(entry->'model_id') is distinct from 'string'
      or (entry->>'model_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'node') is distinct from 'string'
      or length(btrim(entry->>'node')) not between 1 and 200
      or jsonb_typeof(entry->'status') is distinct from 'string'
      or entry->>'status' not in ('pending','confirmed','rejected')
      or not entry ? 'source' or jsonb_typeof(entry->'source') not in ('string','null')
      or not entry ? 'restrictions' or jsonb_typeof(entry->'restrictions') not in ('string','null') then
      raise exception 'MTM_INVALID_APPLICABILITY';
    end if;
    v_source := nullif(btrim(entry->>'source'),'');
    v_restrictions := nullif(btrim(entry->>'restrictions'),'');
    if length(v_source)>1000 or length(v_restrictions)>1000 or (entry->>'status'='confirmed' and v_source is null) then
      raise exception 'MTM_INVALID_SOURCE';
    end if;
    model_id := (entry->>'model_id')::uuid;
    model_ok := false;
    if entry->>'model_kind'='machine' then
      perform 1 from public.agricultural_machine_models m where m.id=model_id and m.is_active and not m.archived for share;
      model_ok := found;
    elsif entry->>'model_kind'='equipment' then
      perform 1 from public.equipment_models m where m.id=model_id and m.is_active and not m.archived for share;
      model_ok := found;
    elsif entry->>'model_kind'='transport' then
      perform 1 from public.transport_models m where m.id=model_id and m.is_active and not m.archived for share;
      model_ok := found;
    end if;
    if not model_ok then raise exception 'MTM_MODEL_UNAVAILABLE'; end if;
    entry_key := jsonb_build_array(entry->>'model_kind',model_id,btrim(entry->>'node'),v_restrictions)::text;
    if entry_key=any(duplicate_keys) then raise exception 'MTM_INVALID_DUPLICATE_APPLICABILITY'; end if;
    duplicate_keys := array_append(duplicate_keys,entry_key);
    normalized_entries := normalized_entries || jsonb_build_array(jsonb_build_object(
      'model_kind',entry->>'model_kind','model_id',model_id,'node',btrim(entry->>'node'),
      'status',entry->>'status','source',v_source,'restrictions',v_restrictions));
  end loop;
  select * into old_row from public.mtm_catalog where company_id=p_company_id and product_id=p_product_id for update;
  if coalesce(old_row.revision,0) <> p_expected_revision then raise exception 'MTM_REVISION_CONFLICT'; end if;
  begin
    insert into public.mtm_catalog(company_id,product_id,category,part_number,barcode,internal_code,specifications,accounting_unit_note,applicability,revision,updated_at,updated_by)
      values(p_company_id,p_product_id,p_metadata->>'category',v_part,v_barcode,v_internal,v_specs,v_unit,normalized_entries,p_expected_revision+1,clock_timestamp(),actor)
      on conflict(company_id,product_id) do update set
        category=excluded.category,part_number=excluded.part_number,barcode=excluded.barcode,internal_code=excluded.internal_code,
        specifications=excluded.specifications,accounting_unit_note=excluded.accounting_unit_note,applicability=excluded.applicability,
        revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning * into new_row;
  exception when unique_violation then raise exception 'MTM_BARCODE_CONFLICT'; end;
  insert into public.mtm_catalog_history(company_id,product_id,revision,actor_id,changed_at,previous_value,new_value)
    values(p_company_id,p_product_id,new_row.revision,actor,new_row.updated_at,
      case when old_row.revision is null then null else to_jsonb(old_row) end,to_jsonb(new_row));
  return mtm_private.mtm_item_json_v1(new_row);
end $$;
revoke all on function mtm_private.mtm_catalog_save_v1(uuid,uuid,integer,jsonb) from public, anon, authenticated;

create function mtm_private.mtm_catalog_list_v1(p_company_id uuid,p_offset integer,p_limit integer,p_search text,p_barcode text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform mtm_private.mtm_actor_v1(p_company_id,false);
  if p_offset is null or p_offset not between 0 and 1000000 or p_limit is null or p_limit not between 1 and 100
    or p_search is null or p_barcode is null or length(p_search)>200 or length(p_barcode)>128
    or (p_search||p_barcode) ~ '[[:cntrl:]]' then raise exception 'MTM_INVALID_PAGE'; end if;
  with eligible as (
    select c.* from public.mtm_catalog c join public.products p on p.id=c.product_id
    where c.company_id=p_company_id and (p.company_id is null or p.company_id=p_company_id)
      and p.type in ('material','fuel') and not p.archived and p.is_active
      and (p_barcode='' or c.barcode=p_barcode)
      and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',p.name,c.part_number,c.internal_code)))>0)
  ), page as (select * from eligible order by product_id limit p_limit offset p_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(mtm_private.mtm_item_json_v1(p::public.mtm_catalog) order by p.product_id) from page p),'[]'::jsonb),
    'total',(select count(*) from eligible),'offset',p_offset,'limit',p_limit) into result;
  return result;
end $$;
revoke all on function mtm_private.mtm_catalog_list_v1(uuid,integer,integer,text,text) from public, anon, authenticated;

create function mtm_private.mtm_catalog_options_v1(p_company_id uuid,p_kind text,p_offset integer,p_limit integer,p_search text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform mtm_private.mtm_actor_v1(p_company_id,false);
  if p_offset is null or p_offset not between 0 and 1000000 or p_limit is null or p_limit not between 1 and 100
    or p_search is null or length(p_search)>200 or p_search ~ '[[:cntrl:]]'
    or p_kind is null or p_kind not in ('products','machine','equipment','transport') then raise exception 'MTM_INVALID_PAGE'; end if;
  if p_kind='products' then
    with eligible as (
      select p.id,p.name,p.type,p.base_uom,p.pack_uom,p.units_per_pack from public.products p
      where (p.company_id is null or p.company_id=p_company_id) and not p.archived and p.is_active
        and p.type in ('material','fuel') and p.base_uom in ('kg','l','pcs')
        and not exists(select 1 from public.mtm_catalog c where c.company_id=p_company_id and c.product_id=p.id)
        and (p_search='' or position(lower(p_search) in lower(p.name))>0)
    ), page as (select * from eligible order by name,id limit p_limit offset p_offset)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from page p),'[]'::jsonb),
      'total',(select count(*) from eligible),'offset',p_offset,'limit',p_limit) into result;
  else
    with models as (
      select m.id,m.full_name as name,'machine'::text as model_kind from public.agricultural_machine_models m where p_kind='machine' and m.is_active and not m.archived
      union all
      select m.id,coalesce(nullif(m.full_name,''),m.name),'equipment' from public.equipment_models m where p_kind='equipment' and m.is_active and not m.archived
      union all
      select m.id,m.full_name,'transport' from public.transport_models m where p_kind='transport' and m.is_active and not m.archived
    ), eligible as (select * from models where p_search='' or position(lower(p_search) in lower(name))>0),
    page as (select * from eligible order by name,id limit p_limit offset p_offset)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from page p),'[]'::jsonb),
      'total',(select count(*) from eligible),'offset',p_offset,'limit',p_limit) into result;
  end if;
  return result;
end $$;
revoke all on function mtm_private.mtm_catalog_options_v1(uuid,text,integer,integer,text) from public, anon, authenticated;

-- Only these bounded contracts are exposed to PostgREST; all identity and payload
-- checks live in the private implementation too, so calling RPC directly is safe.
create function public.mtm_catalog_save_v1(p_company_id uuid,p_product_id uuid,p_expected_revision integer,p_metadata jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select mtm_private.mtm_catalog_save_v1(p_company_id,p_product_id,p_expected_revision,p_metadata);
$$;
create function public.mtm_catalog_list_v1(p_company_id uuid,p_offset integer,p_limit integer,p_search text,p_barcode text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select mtm_private.mtm_catalog_list_v1(p_company_id,p_offset,p_limit,p_search,p_barcode);
$$;
create function public.mtm_catalog_options_v1(p_company_id uuid,p_kind text,p_offset integer,p_limit integer,p_search text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select mtm_private.mtm_catalog_options_v1(p_company_id,p_kind,p_offset,p_limit,p_search);
$$;
revoke all on function public.mtm_catalog_save_v1(uuid,uuid,integer,jsonb), public.mtm_catalog_list_v1(uuid,integer,integer,text,text), public.mtm_catalog_options_v1(uuid,text,integer,integer,text) from public, anon, authenticated;
grant execute on function mtm_private.mtm_catalog_save_v1(uuid,uuid,integer,jsonb), mtm_private.mtm_catalog_list_v1(uuid,integer,integer,text,text), mtm_private.mtm_catalog_options_v1(uuid,text,integer,integer,text) to authenticated;
grant execute on function public.mtm_catalog_save_v1(uuid,uuid,integer,jsonb), public.mtm_catalog_list_v1(uuid,integer,integer,text,text), public.mtm_catalog_options_v1(uuid,text,integer,integer,text) to authenticated;
comment on table public.mtm_catalog is 'Company MTM metadata over existing products. No separate stock. Writes only through checked atomic RPC.';
comment on table public.mtm_catalog_history is 'Append-only MTM metadata snapshots. A metadata save is not a receipt, issue or installation.';

-- UNAPPLIED LOCAL DRAFT. Depends on mtm-catalog-v1 and the existing canonical
-- warehouse schema. No backfill, balances, business data or migration history.
-- Real-schema preflight and explicit QA permission remain a separate gate.

do $$ begin
  if to_regprocedure('public.post_inventory_transaction_to_ledger(uuid)') is null
    or to_regprocedure('public.warehouse_reserved_quantity_v1(uuid,uuid,uuid,text)') is null
    or to_regprocedure('private.acquire_nonprocessing_company_gate_v1(uuid)') is null
    or to_regclass('public.warehouse_issue_request_item_allocations') is null
    or to_regclass('public.v_stock_balance_canonical') is null then
    raise exception 'MTM_STOCK_SCHEMA_NOT_READY';
  end if;
end $$;

create table public.mtm_stock_operations (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  kind text not null check (kind in ('receipt','issue','return')),
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0 and quantity <= 999999999),
  uom text not null check (uom in ('kg','l','pcs')),
  purpose text not null check (length(btrim(purpose)) between 1 and 1000),
  recipient_id uuid references public.company_people(id),
  asset_kind text check (asset_kind in ('machine','equipment','transport')),
  asset_id uuid,
  task_id uuid references public.operations(id),
  original_issue_id uuid references public.mtm_stock_operations(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null,
  inventory_transaction_id uuid not null unique references public.inventory_transactions(id),
  ledger_entry_id uuid not null unique references public.stock_ledger_entries(id),
  request_payload jsonb not null,
  unique(company_id,id),
  foreign key(company_id,product_id) references public.mtm_catalog(company_id,product_id),
  check ((kind='return') = (original_issue_id is not null)),
  check ((asset_kind is null) = (asset_id is null)),
  check (uom <> 'pcs' or quantity=trunc(quantity))
);
create index mtm_stock_operations_list_idx on public.mtm_stock_operations(company_id,warehouse_id,created_at desc,id);
create index mtm_stock_operations_return_idx on public.mtm_stock_operations(original_issue_id) where original_issue_id is not null;

create table public.mtm_stock_minimums (
  company_id uuid not null references public.companies(id),
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity >= 0 and quantity <= 999999999),
  revision integer not null check (revision > 0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null,
  primary key(company_id,warehouse_id,product_id),
  foreign key(company_id,product_id) references public.mtm_catalog(company_id,product_id)
);
create table public.mtm_stock_minimum_history (
  company_id uuid not null,
  warehouse_id uuid not null,
  product_id uuid not null,
  revision integer not null,
  previous_quantity numeric(14,3),
  quantity numeric(14,3) not null,
  actor_id uuid not null references public.profiles(id),
  changed_at timestamptz not null,
  primary key(company_id,warehouse_id,product_id,revision),
  foreign key(company_id,warehouse_id,product_id) references public.mtm_stock_minimums(company_id,warehouse_id,product_id)
);
alter table public.mtm_stock_operations enable row level security;
alter table public.mtm_stock_minimums enable row level security;
alter table public.mtm_stock_minimum_history enable row level security;
revoke all on public.mtm_stock_operations, public.mtm_stock_minimums, public.mtm_stock_minimum_history from public,anon,authenticated;
create policy mtm_stock_operations_read on public.mtm_stock_operations for select to authenticated using(mtm_private.mtm_can_read_v1(company_id));
create policy mtm_stock_minimums_read on public.mtm_stock_minimums for select to authenticated using(mtm_private.mtm_can_read_v1(company_id));
create policy mtm_stock_minimum_history_read on public.mtm_stock_minimum_history for select to authenticated using(mtm_private.mtm_can_read_v1(company_id));
grant select on public.mtm_stock_operations,public.mtm_stock_minimums,public.mtm_stock_minimum_history to authenticated;

create function mtm_private.mtm_stock_actor_v1(p_company_id uuid,p_write boolean default false)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid; actor_role text;
begin
  actor := mtm_private.mtm_actor_v1(p_company_id,false);
  select role into actor_role from public.profiles where id=actor;
  if p_write and actor_role not in ('global_admin','warehouse','warehouse_operator') then
    raise exception 'MTM_FORBIDDEN' using errcode='42501';
  end if;
  return actor;
end $$;
revoke all on function mtm_private.mtm_stock_actor_v1(uuid,boolean) from public,anon,authenticated;

create function mtm_private.mtm_stock_quantity_v1(p_text text,p_allow_zero boolean default false)
returns numeric language plpgsql immutable set search_path='' as $$
declare qty numeric;
begin
  if p_text is null or p_text !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$' then
    raise exception 'MTM_INVALID_QUANTITY' using errcode='22023';
  end if;
  qty := p_text::numeric;
  if qty>999999999 or qty<0 or (not p_allow_zero and qty=0) then
    raise exception 'MTM_INVALID_QUANTITY' using errcode='22023';
  end if;
  return qty;
end $$;
revoke all on function mtm_private.mtm_stock_quantity_v1(text,boolean) from public,anon,authenticated;

-- New, deliberately narrow MTM compatibility rule over existing warehouse types.
-- It is not a claim that an old agrochemical ACL already supports spare parts.
create function mtm_private.mtm_warehouse_compatible_v1(p_warehouse public.warehouses,p_product public.products)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(to_jsonb(p_warehouse)->>'place_type','WAREHOUSE')='WAREHOUSE'
    and (p_warehouse.warehouse_type='universal'
      or (p_warehouse.warehouse_type='fuel' and p_product.type='fuel'));
$$;
revoke all on function mtm_private.mtm_warehouse_compatible_v1(public.warehouses,public.products) from public,anon,authenticated;

create function mtm_private.mtm_stock_identity_v1(p_company_id uuid,p_warehouse_id uuid,p_product_id uuid,p_allow_archived_product boolean default false)
returns public.products language plpgsql security definer set search_path='' as $$
declare product public.products%rowtype; warehouse public.warehouses%rowtype;
begin
  select * into product from public.products p where p.id=p_product_id for share;
  if not found or coalesce(product.type,'') not in ('material','fuel')
    or coalesce(nullif(to_jsonb(product)->>'product_type',''),product.type) not in ('material','fuel')
    or (product.company_id is not null and product.company_id <> p_company_id)
    or coalesce(product.base_uom,'') not in ('kg','l','pcs')
    or (not p_allow_archived_product and (product.archived is distinct from false or product.is_active is distinct from true))
    or not exists(select 1 from public.mtm_catalog c where c.company_id=p_company_id and c.product_id=p_product_id) then
    raise exception 'MTM_PRODUCT_UNAVAILABLE' using errcode='23514';
  end if;
  if not p_allow_archived_product and public.warehouse_canonical_product_id_v1(p_company_id,p_product_id) is distinct from p_product_id then
    raise exception 'MTM_STOCK_IDENTITY_CONFLICT' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('warehouse-company:'||p_company_id::text,0));
  select * into warehouse from public.warehouses w where w.id=p_warehouse_id and w.company_id=p_company_id for share;
  if not found or coalesce(warehouse.archived,false) or coalesce(warehouse.is_archived,false)
    or not mtm_private.mtm_warehouse_compatible_v1(warehouse,product) then
    raise exception 'MTM_WAREHOUSE_UNAVAILABLE' using errcode='23514';
  end if;
  return product;
end $$;
revoke all on function mtm_private.mtm_stock_identity_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated;

-- Keep the existing helper as a lower bound, but account for outstanding partial
-- issues from the newer allocation workflow too. Per-item maximum avoids
-- counting the same reservation twice through item and allocation representations.
create function mtm_private.mtm_reserved_quantity_v1(p_company_id uuid,p_warehouse_id uuid,p_product_id uuid,p_uom text)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare legacy_reserved numeric; current_reserved numeric;
begin
  legacy_reserved:=public.warehouse_reserved_quantity_v1(p_company_id,p_warehouse_id,p_product_id,p_uom);
  with matching as (
    select i.* from public.warehouse_issue_request_items i join public.warehouse_issue_requests r on r.id=i.request_id and r.company_id=i.company_id
    where r.company_id=p_company_id and r.source_warehouse_id=p_warehouse_id
      and coalesce(r.status,'') not in ('cancelled','canceled','closed','completed','return_received')
      and coalesce(r.warehouse_request_status,'') not in ('cancelled','canceled','closed','completed','return_received')
      and public.warehouse_canonical_product_id_v1(p_company_id,coalesce(i.actual_product_id,i.product_id))=p_product_id
      and public.canonical_stock_uom(coalesce(i.prepared_unit,i.issued_unit,i.unit))=p_uom
  ), allocations as (
    select i.id,sum(greatest(a.prepared_quantity-a.issued_quantity,0)) qty from matching i
      join public.warehouse_issue_request_item_allocations a on a.request_item_id=i.id and a.request_id=i.request_id and a.company_id=p_company_id and a.warehouse_id=p_warehouse_id
      where a.batch_class='material' group by i.id
  ) select coalesce(sum(greatest(greatest(coalesce(i.prepared_quantity,0)-coalesce(i.issued_quantity,0),0),coalesce(a.qty,0))),0)
      into current_reserved from matching i left join allocations a on a.id=i.id;
  if coalesce(legacy_reserved,0)::text in ('NaN','Infinity','-Infinity') or coalesce(current_reserved,0)::text in ('NaN','Infinity','-Infinity') then
    raise exception 'MTM_STOCK_IDENTITY_CONFLICT' using errcode='23514';
  end if;
  return greatest(coalesce(legacy_reserved,0),coalesce(current_reserved,0));
end $$;
revoke all on function mtm_private.mtm_reserved_quantity_v1(uuid,uuid,uuid,text) from public,anon,authenticated;

-- Match v_stock_balance_identity's existing text identity exactly. The UUID
-- trace is evidence, not permission to invent a different grouping. Conflicting
-- or shadowed identifiers require the existing lineage repair gate.
create function mtm_private.mtm_ledger_batch_key_v1(p_row public.stock_ledger_entries)
returns text language plpgsql immutable set search_path='' as $$
declare canonical_key text; text_key text; old_key text;
begin
  text_key:=nullif(btrim(p_row.batch_id_text),'');
  old_key:=nullif(btrim(p_row.batch_id),'');
  canonical_key:=nullif(btrim(coalesce(p_row.batch_id_text,p_row.batch_id,'')),'');
  if (text_key is not null and old_key is not null and text_key<>old_key)
    or (canonical_key is null and old_key is not null)
    or (p_row.inventory_batch_id is not null and canonical_key is distinct from p_row.inventory_batch_id::text) then
    raise exception 'MTM_STOCK_IDENTITY_CONFLICT' using errcode='23514';
  end if;
  return coalesce(canonical_key,'__unassigned__');
end $$;
revoke all on function mtm_private.mtm_ledger_batch_key_v1(public.stock_ledger_entries) from public,anon,authenticated;

-- One physical stock guard for ALL writers of registered MTM products. Checking
-- only inside the new RPC would race with old writers using different locks.
-- Reservation ownership stays in the business writer; this guard checks physical
-- material balance only, allowing existing issue writers to consume their reserve.
create function mtm_private.mtm_guard_ledger_balance_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare qty numeric; batch_key text;
begin
  if not exists(select 1 from public.mtm_catalog c join public.products p on p.id=c.product_id
    where c.company_id=new.company_id and c.product_id=new.product_id and p.type in ('material','fuel')) then
    return new;
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'MTM_UNSUPPORTED_ISOLATION' using errcode='40001';
  end if;
  if new.uom not in ('kg','l','pcs') or new.batch_class is distinct from 'material'
    or new.unit_contract_version is distinct from 2 then
    raise exception 'MTM_STOCK_IDENTITY_CONFLICT' using errcode='23514';
  end if;
  batch_key:=mtm_private.mtm_ledger_batch_key_v1(new);
  -- One physical-write mutex for every registered MTM ledger writer. Do not
  -- introduce the allocation lock into legacy writer paths; the new RPC takes
  -- that lock separately to coordinate its reservation check with preparation.
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':'||new.warehouse_id::text||':inventory',0));
  -- Recheck after the lock: an older trigger's earlier check alone can race an
  -- inventory start. Its own adjustment remains allowed by the existing rule.
  if new.reason_type<>'warehouse_inventory_adjustment' and exists(select 1 from public.warehouse_inventory_documents d where d.company_id=new.company_id and d.warehouse_id=new.warehouse_id and d.status in ('in_progress','awaiting_approval','rejected')) then
    raise exception 'MTM_INVENTORY_BLOCKED' using errcode='55000';
  end if;
  select coalesce(sum(s.delta_qty_signed),0) into qty from public.stock_ledger_entries s
    where s.company_id=new.company_id and s.warehouse_id=new.warehouse_id and s.product_id=new.product_id
      and s.uom=new.uom and s.batch_class='material' and s.unit_contract_version=2
      and mtm_private.mtm_ledger_batch_key_v1(s)=batch_key;
  if new.delta_qty_signed is null or new.quantity::text in ('NaN','Infinity','-Infinity')
    or new.delta_qty_signed::text in ('NaN','Infinity','-Infinity') or qty::text in ('NaN','Infinity','-Infinity')
    or new.delta_qty_signed <> (case when new.direction='in' then new.quantity else -new.quantity end)
    or (new.uom='pcs' and new.quantity<>trunc(new.quantity)) then
    raise exception 'MTM_INVALID_LEDGER_QUANTITY' using errcode='23514';
  end if;
  if qty+new.delta_qty_signed<0 then raise exception 'MTM_INSUFFICIENT_STOCK' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function mtm_private.mtm_guard_ledger_balance_v1() from public,anon,authenticated;
create trigger zz_mtm_guard_ledger_balance_v1 before insert on public.stock_ledger_entries
  for each row execute function mtm_private.mtm_guard_ledger_balance_v1();

create function mtm_private.mtm_operation_json_v1(p_row public.mtm_stock_operations)
returns jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(p_row)-'request_payload')||jsonb_build_object(
    'quantity',p_row.quantity::text,
    'product_name',(select name from public.products where id=p_row.product_id),
    'warehouse_name',(select name from public.warehouses where id=p_row.warehouse_id),
    'created_by_name',coalesce((select nullif(to_jsonb(p)->>'full_name','') from public.profiles p where p.id=p_row.created_by),'Пользователь'),
    'recipient_name',case when p_row.recipient_id is null then null else coalesce((select full_name from public.company_people where id=p_row.recipient_id and company_id=p_row.company_id),'Сотрудник недоступен') end,
    'asset_name',case p_row.asset_kind
      when 'machine' then coalesce((select name from public.reference_machines where id=p_row.asset_id and company_id=p_row.company_id),'Техника недоступна')
      when 'equipment' then coalesce((select name from public.reference_equipment where id=p_row.asset_id and company_id=p_row.company_id),'Агрегат недоступен')
      when 'transport' then coalesce((select name from public.reference_vehicles where id=p_row.asset_id and company_id=p_row.company_id),'Транспорт недоступен') end,
    'task_name',case when p_row.task_id is null then null else coalesce((select coalesce(nullif(to_jsonb(o)->>'title',''),nullif(to_jsonb(o)->>'name',''),nullif(o.operation_type,''),'Задача') from public.operations o where o.id=p_row.task_id and o.company_id=p_row.company_id),'Задача недоступна') end,
    'remaining_returnable',case when p_row.kind='issue' then
      (p_row.quantity-coalesce((select sum(r.quantity) from public.mtm_stock_operations r
        where r.original_issue_id=p_row.id and r.company_id=p_row.company_id),0))::text else '0' end);
$$;
revoke all on function mtm_private.mtm_operation_json_v1(public.mtm_stock_operations) from public,anon,authenticated;

create function mtm_private.mtm_post_operation_v1(p_company_id uuid,p_idempotency_key uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid; product public.products%rowtype; original public.mtm_stock_operations%rowtype;
  result public.mtm_stock_operations%rowtype; k text; field text; warehouse_id uuid; product_id uuid;
  recipient_id uuid; asset_id uuid; task_id uuid; original_id uuid; asset_kind text;
  quantity numeric; uom text; purpose text; balance numeric; reserved numeric; returned numeric;
  tx uuid:=gen_random_uuid(); ledger uuid; posted integer; at_time timestamptz:=clock_timestamp();
begin
  actor := mtm_private.mtm_stock_actor_v1(p_company_id,true);
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'MTM_UNSUPPORTED_ISOLATION' using errcode='40001';
  end if;
  if p_idempotency_key is null or jsonb_typeof(p_payload) is distinct from 'object'
    or (p_payload-array['kind','warehouse_id','product_id','quantity','uom','purpose','recipient_id','asset_kind','asset_id','task_id','original_issue_id'])<>'{}'::jsonb
    or jsonb_typeof(p_payload->'kind') is distinct from 'string'
    or p_payload->>'kind' not in ('receipt','issue','return')
    or jsonb_typeof(p_payload->'quantity') is distinct from 'string'
    or jsonb_typeof(p_payload->'uom') is distinct from 'string'
    or jsonb_typeof(p_payload->'purpose') is distinct from 'string' then
    raise exception 'MTM_INVALID_OPERATION' using errcode='22023';
  end if;
  foreach field in array array['warehouse_id','product_id','recipient_id','asset_id','task_id','original_issue_id'] loop
    if not p_payload?field or jsonb_typeof(p_payload->field) not in ('string','null')
      or (jsonb_typeof(p_payload->field)='string' and p_payload->>field !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
      raise exception 'MTM_INVALID_OPERATION' using errcode='22023';
    end if;
  end loop;
  if not p_payload?'asset_kind' or jsonb_typeof(p_payload->'asset_kind') not in ('string','null') then
    raise exception 'MTM_INVALID_OPERATION' using errcode='22023';
  end if;
  k:=p_payload->>'kind'; warehouse_id:=(p_payload->>'warehouse_id')::uuid; product_id:=(p_payload->>'product_id')::uuid;
  recipient_id:=(p_payload->>'recipient_id')::uuid; asset_id:=(p_payload->>'asset_id')::uuid;
  task_id:=(p_payload->>'task_id')::uuid; original_id:=(p_payload->>'original_issue_id')::uuid;
  asset_kind:=p_payload->>'asset_kind'; quantity:=mtm_private.mtm_stock_quantity_v1(p_payload->>'quantity');
  uom:=p_payload->>'uom'; purpose:=btrim(p_payload->>'purpose');
  if warehouse_id is null or product_id is null or uom not in ('kg','l','pcs')
    or length(purpose) not between 1 and 1000 or (uom='pcs' and quantity<>trunc(quantity))
    or ((asset_kind is null)<>(asset_id is null)) or (asset_kind is not null and asset_kind not in ('machine','equipment','transport'))
    or ((k='return')<>(original_id is not null))
    or (k in ('receipt','return') and (recipient_id is not null or asset_id is not null or task_id is not null)) then
    raise exception 'MTM_INVALID_OPERATION' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mtm-request:'||p_company_id::text||':'||p_idempotency_key::text,0));
  select * into result from public.mtm_stock_operations o where o.id=p_idempotency_key;
  if found then
    if result.company_id<>p_company_id or result.created_by<>actor or result.request_payload<>p_payload then
      raise exception 'MTM_IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    return mtm_private.mtm_operation_json_v1(result);
  end if;
  perform private.acquire_nonprocessing_company_gate_v1(p_company_id);
  product:=mtm_private.mtm_stock_identity_v1(p_company_id,warehouse_id,product_id,k='return');
  if uom<>product.base_uom then raise exception 'MTM_UNIT_MISMATCH' using errcode='23514'; end if;
  -- V1 posts only unassigned material stock. The current allocation path takes
  -- this lock before inserting a ledger row; match that order before inventory.
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',p_company_id::text,warehouse_id::text,product_id::text,uom,'material','__unassigned__'),0));
  -- Also coordinate with the older non-package preparation writer.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||warehouse_id::text||':'||product_id::text||':'||uom,0));
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||warehouse_id::text||':inventory',0));
  if exists(select 1 from public.warehouse_inventory_documents d where d.company_id=p_company_id and d.warehouse_id=warehouse_id
    and d.status in ('in_progress','awaiting_approval','rejected')) then
    raise exception 'MTM_INVENTORY_BLOCKED' using errcode='55000';
  end if;
  if k='issue' then
    if exists(select 1 from public.stock_ledger_entries s where s.company_id=p_company_id and s.warehouse_id=warehouse_id
      and s.product_id=product_id and (s.uom is distinct from uom or s.batch_class is distinct from 'material' or s.unit_contract_version is distinct from 2
        or s.inventory_batch_id is not null or nullif(btrim(s.batch_id_text),'') is not null or nullif(btrim(s.batch_id),'') is not null))
      or exists(select 1 from public.warehouse_issue_request_item_allocations a join public.warehouse_issue_request_items i on i.id=a.request_item_id and i.company_id=a.company_id
        where a.company_id=p_company_id and a.warehouse_id=warehouse_id and coalesce(i.actual_product_id,i.product_id)=product_id
          and (a.batch_id is not null or nullif(btrim(a.batch_id_text),'') is not null)) then
      raise exception 'MTM_STOCK_IDENTITY_CONFLICT' using errcode='23514';
    end if;
    select coalesce(sum(s.quantity),0) into balance from public.v_stock_balance_canonical s
      where s.company_id=p_company_id and s.warehouse_id=warehouse_id and s.product_id=product_id and s.uom=uom and s.batch_class='material';
    reserved:=mtm_private.mtm_reserved_quantity_v1(p_company_id,warehouse_id,product_id,uom);
    if balance-coalesce(reserved,0)<quantity then raise exception 'MTM_INSUFFICIENT_STOCK' using errcode='23514'; end if;
    if recipient_id is not null then
      perform 1 from public.company_people p where p.id=recipient_id and p.company_id=p_company_id and p.status='active' and p.deleted_at is null for share;
      if not found then raise exception 'MTM_RECIPIENT_UNAVAILABLE' using errcode='23514'; end if;
    end if;
    if asset_kind='machine' then
      perform 1 from public.reference_machines a where a.id=asset_id and a.company_id=p_company_id and not coalesce(a.archived,false) and coalesce((to_jsonb(a)->>'is_active')::boolean,true) for share;
      if not found then raise exception 'MTM_ASSET_UNAVAILABLE' using errcode='23514'; end if;
    elsif asset_kind='equipment' then
      perform 1 from public.reference_equipment a where a.id=asset_id and a.company_id=p_company_id and not coalesce(a.archived,false) and coalesce((to_jsonb(a)->>'is_active')::boolean,true) for share;
      if not found then raise exception 'MTM_ASSET_UNAVAILABLE' using errcode='23514'; end if;
    elsif asset_kind='transport' then
      perform 1 from public.reference_vehicles a where a.id=asset_id and a.company_id=p_company_id and not coalesce(a.archived,false) and a.is_active for share;
      if not found then raise exception 'MTM_ASSET_UNAVAILABLE' using errcode='23514'; end if;
    end if;
    if task_id is not null then
      perform 1 from public.operations o where o.id=task_id and o.company_id=p_company_id and not coalesce(o.archived,false) and coalesce(to_jsonb(o)->>'status','') not in ('cancelled','canceled') for share;
      if not found then raise exception 'MTM_TASK_UNAVAILABLE' using errcode='23514'; end if;
    end if;
  elsif k='return' then
    select * into original from public.mtm_stock_operations o where o.id=original_id and o.company_id=p_company_id and o.kind='issue' for update;
    if not found or original.product_id<>product_id or original.warehouse_id<>warehouse_id or original.uom<>uom then
      raise exception 'MTM_RETURN_SOURCE_INVALID' using errcode='23514';
    end if;
    select coalesce(sum(o.quantity),0) into returned from public.mtm_stock_operations o where o.original_issue_id=original_id and o.company_id=p_company_id;
    if quantity>original.quantity-returned then raise exception 'MTM_RETURN_EXCEEDED' using errcode='23514'; end if;
    recipient_id:=original.recipient_id; asset_kind:=original.asset_kind; asset_id:=original.asset_id; task_id:=original.task_id;
  end if;
  insert into public.inventory_transactions(id,company_id,warehouse_id,product_id,quantity,transaction_type,date,notes,user_id,
    movement_type,status,source_warehouse_id,destination_warehouse_id,operation_datetime,responsible_user_id,confirmed_at,
    quantity_input,input_uom,base_quantity_kg,base_quantity,base_uom,mass_kg,batch_class,unit_source,unit_contract_version)
  values(tx,p_company_id,warehouse_id,product_id,quantity,case when k='issue' then 'out' else 'in' end,(at_time at time zone 'Asia/Qyzylorda')::date,purpose,auth.uid(),
    case when k='issue' then 'issue' else 'receipt' end,'confirmed',case when k='issue' then warehouse_id end,case when k<>'issue' then warehouse_id end,at_time,actor,at_time,
    quantity,uom,case when uom='kg' then quantity end,quantity,uom,case when uom='kg' then quantity end,'material','mtm_operation:'||p_idempotency_key::text,2);
  posted:=public.post_inventory_transaction_to_ledger(tx);
  if posted<>1 then raise exception 'MTM_LEDGER_POST_FAILED' using errcode='55000'; end if;
  select s.id into ledger from public.stock_ledger_entries s where s.reason_ref_id=tx and s.company_id=p_company_id
    and s.warehouse_id=warehouse_id and s.product_id=product_id and s.uom=uom and s.batch_class='material'
    and s.delta_qty_signed=case when k='issue' then -quantity else quantity end;
  if ledger is null then raise exception 'MTM_LEDGER_POST_FAILED' using errcode='55000'; end if;
  insert into public.mtm_stock_operations(id,company_id,kind,warehouse_id,product_id,quantity,uom,purpose,recipient_id,asset_kind,asset_id,task_id,original_issue_id,
    created_by,created_at,inventory_transaction_id,ledger_entry_id,request_payload)
  values(p_idempotency_key,p_company_id,k,warehouse_id,product_id,quantity,uom,purpose,recipient_id,asset_kind,asset_id,task_id,original_id,actor,at_time,tx,ledger,p_payload)
  returning * into result;
  return mtm_private.mtm_operation_json_v1(result);
end $$;
revoke all on function mtm_private.mtm_post_operation_v1(uuid,uuid,jsonb) from public,anon,authenticated;

create function mtm_private.mtm_set_minimum_v1(p_company_id uuid,p_warehouse_id uuid,p_product_id uuid,p_quantity text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; product public.products%rowtype; qty numeric; old_row public.mtm_stock_minimums%rowtype; next_revision integer; at_time timestamptz:=clock_timestamp();
begin
  actor:=mtm_private.mtm_stock_actor_v1(p_company_id,true);
  qty:=mtm_private.mtm_stock_quantity_v1(p_quantity,true);
  if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 then raise exception 'MTM_INVALID_REVISION' using errcode='22023'; end if;
  product:=mtm_private.mtm_stock_identity_v1(p_company_id,p_warehouse_id,p_product_id,false);
  if product.base_uom='pcs' and qty<>trunc(qty) then raise exception 'MTM_INVALID_QUANTITY' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mtm-minimum:'||p_company_id::text||':'||p_warehouse_id::text||':'||p_product_id::text,0));
  select * into old_row from public.mtm_stock_minimums m where m.company_id=p_company_id and m.warehouse_id=p_warehouse_id and m.product_id=p_product_id for update;
  if coalesce(old_row.revision,0)<>p_expected_revision then raise exception 'MTM_REVISION_CONFLICT' using errcode='40001'; end if;
  next_revision:=p_expected_revision+1;
  insert into public.mtm_stock_minimums(company_id,warehouse_id,product_id,quantity,revision,updated_by,updated_at)
    values(p_company_id,p_warehouse_id,p_product_id,qty,next_revision,actor,at_time)
    on conflict(company_id,warehouse_id,product_id) do update set quantity=excluded.quantity,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.mtm_stock_minimum_history values(p_company_id,p_warehouse_id,p_product_id,next_revision,old_row.quantity,qty,actor,at_time);
  return jsonb_build_object('minimum_quantity',qty::text,'minimum_revision',next_revision);
end $$;
revoke all on function mtm_private.mtm_set_minimum_v1(uuid,uuid,uuid,text,integer) from public,anon,authenticated;

create function mtm_private.mtm_stock_list_v1(p_company_id uuid,p_warehouse_id uuid,p_search text,p_below_minimum boolean,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; rows jsonb; total integer; can_write boolean;
begin
  actor:=mtm_private.mtm_stock_actor_v1(p_company_id,false);
  select role in ('global_admin','warehouse','warehouse_operator') into can_write from public.profiles where id=actor;
  if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_search,''))>200 then raise exception 'MTM_INVALID_PAGE' using errcode='22023'; end if;
  if p_warehouse_id is not null and not exists(select 1 from public.warehouses where id=p_warehouse_id and company_id=p_company_id) then raise exception 'MTM_WAREHOUSE_UNAVAILABLE' using errcode='23514'; end if;
  with identities as (
    select c.company_id,w.id warehouse_id,w.name warehouse_name,p.id product_id,p.name product_name,p.base_uom uom,
      (p.archived is distinct from false or p.is_active is distinct from true) product_archived,coalesce(w.archived,false) or coalesce(w.is_archived,false) warehouse_archived,
      coalesce((select sum(s.quantity) from public.v_stock_balance_canonical s where s.company_id=c.company_id and s.warehouse_id=w.id and s.product_id=p.id and s.uom=p.base_uom and s.batch_class='material'),0) balance,
      mtm_private.mtm_reserved_quantity_v1(c.company_id,w.id,p.id,p.base_uom) reserved,
      coalesce(m.quantity,0) minimum_quantity,coalesce(m.revision,0) minimum_revision,
      (coalesce(nullif(to_jsonb(p)->>'product_type',''),p.type) not in ('material','fuel') or public.warehouse_canonical_product_id_v1(c.company_id,p.id) is distinct from p.id or exists(select 1 from public.stock_ledger_entries s where s.company_id=c.company_id and s.warehouse_id=w.id and s.product_id=p.id and (s.uom is distinct from p.base_uom or s.batch_class is distinct from 'material' or s.unit_contract_version is distinct from 2 or s.inventory_batch_id is not null or nullif(btrim(s.batch_id_text),'') is not null or nullif(btrim(s.batch_id),'') is not null))
        or exists(select 1 from public.warehouse_issue_request_item_allocations a join public.warehouse_issue_request_items i on i.id=a.request_item_id and i.company_id=a.company_id where a.company_id=c.company_id and a.warehouse_id=w.id and coalesce(i.actual_product_id,i.product_id)=p.id and (a.batch_id is not null or nullif(btrim(a.batch_id_text),'') is not null))) stock_blocked
    from public.mtm_catalog c join public.products p on p.id=c.product_id
    join public.warehouses w on w.company_id=c.company_id
    left join public.mtm_stock_minimums m on m.company_id=c.company_id and m.warehouse_id=w.id and m.product_id=p.id
    where c.company_id=p_company_id and (p_warehouse_id is null or w.id=p_warehouse_id)
      and p.type in ('material','fuel') and p.base_uom in ('kg','l','pcs')
      and (p.company_id is null or p.company_id=p_company_id) and mtm_private.mtm_warehouse_compatible_v1(w,p)
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(p.name||' '||coalesce(c.part_number,'')||' '||coalesce(c.barcode,'')||' '||coalesce(c.internal_code,'')))>0)
  ), all_rows as (select *,balance-coalesce(reserved,0) available,balance-coalesce(reserved,0)<minimum_quantity below_minimum from identities),
  filtered as (select * from all_rows where not coalesce(p_below_minimum,false) or below_minimum),
  page as (select * from filtered order by warehouse_name,warehouse_id,product_name,product_id offset p_offset limit p_limit)
  select (select count(*)::integer from filtered),coalesce(jsonb_agg(to_jsonb(page)||jsonb_build_object('balance',balance::text,'reserved',coalesce(reserved,0)::text,'available',available::text,'minimum_quantity',minimum_quantity::text) order by warehouse_name,warehouse_id,product_name,product_id),'[]'::jsonb) into total,rows from page;
  return jsonb_build_object('items',rows,'total',total,'offset',p_offset,'limit',p_limit,'can_write',can_write);
end $$;
revoke all on function mtm_private.mtm_stock_list_v1(uuid,uuid,text,boolean,integer,integer) from public,anon,authenticated;

create function mtm_private.mtm_operations_list_v1(p_company_id uuid,p_warehouse_id uuid,p_product_id uuid,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; total integer;
begin
  perform mtm_private.mtm_stock_actor_v1(p_company_id,false);
  if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 then raise exception 'MTM_INVALID_PAGE' using errcode='22023'; end if;
  with filtered as (select o.* from public.mtm_stock_operations o where o.company_id=p_company_id and (p_warehouse_id is null or o.warehouse_id=p_warehouse_id) and (p_product_id is null or o.product_id=p_product_id)),
  page as (select * from filtered order by created_at desc,id desc offset p_offset limit p_limit)
  select (select count(*)::integer from filtered),coalesce(jsonb_agg(mtm_private.mtm_operation_json_v1(page) order by created_at desc,id desc),'[]'::jsonb) into total,rows from page;
  return jsonb_build_object('items',rows,'total',total,'offset',p_offset,'limit',p_limit);
end $$;
revoke all on function mtm_private.mtm_operations_list_v1(uuid,uuid,uuid,integer,integer) from public,anon,authenticated;

create function mtm_private.mtm_stock_options_v1(p_company_id uuid,p_kind text,p_search text,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; total integer;
begin
  perform mtm_private.mtm_stock_actor_v1(p_company_id,false);
  if p_kind is null or p_kind not in ('warehouse','employee','machine','equipment','transport','task') or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_search,''))>200 then raise exception 'MTM_INVALID_PAGE' using errcode='22023'; end if;
  with all_options as (
    select w.id,w.name label,jsonb_build_object('warehouse_type',w.warehouse_type) metadata from public.warehouses w where p_kind='warehouse' and w.company_id=p_company_id and not coalesce(w.archived,false) and not coalesce(w.is_archived,false) and coalesce(to_jsonb(w)->>'place_type','WAREHOUSE')='WAREHOUSE' and w.warehouse_type in ('universal','fuel')
    union all select p.id,p.full_name,'{}'::jsonb from public.company_people p where p_kind='employee' and p.company_id=p_company_id and p.status='active' and p.deleted_at is null
    union all select m.id,m.name,'{}'::jsonb from public.reference_machines m where p_kind='machine' and m.company_id=p_company_id and not coalesce(m.archived,false) and coalesce((to_jsonb(m)->>'is_active')::boolean,true)
    union all select e.id,e.name,'{}'::jsonb from public.reference_equipment e where p_kind='equipment' and e.company_id=p_company_id and not coalesce(e.archived,false) and coalesce((to_jsonb(e)->>'is_active')::boolean,true)
    union all select v.id,v.name,'{}'::jsonb from public.reference_vehicles v where p_kind='transport' and v.company_id=p_company_id and not coalesce(v.archived,false) and v.is_active
    union all select o.id,coalesce(nullif(to_jsonb(o)->>'title',''),nullif(to_jsonb(o)->>'name',''),nullif(to_jsonb(o)->>'operation_type',''),o.id::text),'{}'::jsonb from public.operations o where p_kind='task' and o.company_id=p_company_id and not coalesce(o.archived,false) and coalesce(to_jsonb(o)->>'status','') not in ('cancelled','canceled')
  ), filtered as (select * from all_options where coalesce(p_search,'')='' or position(lower(p_search) in lower(label))>0),
  page as (select * from filtered order by label,id offset p_offset limit p_limit)
  select (select count(*)::integer from filtered),coalesce(jsonb_agg(jsonb_build_object('id',id,'name',label)||metadata order by label,id),'[]'::jsonb) into total,rows from page;
  return jsonb_build_object('items',rows,'total',total,'offset',p_offset,'limit',p_limit);
end $$;
revoke all on function mtm_private.mtm_stock_options_v1(uuid,text,text,integer,integer) from public,anon,authenticated;

create function public.mtm_post_operation_v1(p_company_id uuid,p_idempotency_key uuid,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select mtm_private.mtm_post_operation_v1(p_company_id,p_idempotency_key,p_payload) $$;
create function public.mtm_set_minimum_v1(p_company_id uuid,p_warehouse_id uuid,p_product_id uuid,p_quantity text,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$ select mtm_private.mtm_set_minimum_v1(p_company_id,p_warehouse_id,p_product_id,p_quantity,p_expected_revision) $$;
create function public.mtm_stock_list_v1(p_company_id uuid,p_warehouse_id uuid,p_search text,p_below_minimum boolean,p_offset integer,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select mtm_private.mtm_stock_list_v1(p_company_id,p_warehouse_id,p_search,p_below_minimum,p_offset,p_limit) $$;
create function public.mtm_operations_list_v1(p_company_id uuid,p_warehouse_id uuid,p_product_id uuid,p_offset integer,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select mtm_private.mtm_operations_list_v1(p_company_id,p_warehouse_id,p_product_id,p_offset,p_limit) $$;
create function public.mtm_stock_options_v1(p_company_id uuid,p_kind text,p_search text,p_offset integer,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select mtm_private.mtm_stock_options_v1(p_company_id,p_kind,p_search,p_offset,p_limit) $$;

revoke all on function public.mtm_post_operation_v1(uuid,uuid,jsonb),public.mtm_set_minimum_v1(uuid,uuid,uuid,text,integer),public.mtm_stock_list_v1(uuid,uuid,text,boolean,integer,integer),public.mtm_operations_list_v1(uuid,uuid,uuid,integer,integer),public.mtm_stock_options_v1(uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.mtm_post_operation_v1(uuid,uuid,jsonb),public.mtm_set_minimum_v1(uuid,uuid,uuid,text,integer),public.mtm_stock_list_v1(uuid,uuid,text,boolean,integer,integer),public.mtm_operations_list_v1(uuid,uuid,uuid,integer,integer),public.mtm_stock_options_v1(uuid,text,text,integer,integer) to authenticated;
grant execute on function mtm_private.mtm_post_operation_v1(uuid,uuid,jsonb),mtm_private.mtm_set_minimum_v1(uuid,uuid,uuid,text,integer),mtm_private.mtm_stock_list_v1(uuid,uuid,text,boolean,integer,integer),mtm_private.mtm_operations_list_v1(uuid,uuid,uuid,integer,integer),mtm_private.mtm_stock_options_v1(uuid,text,text,integer,integer) to authenticated;
