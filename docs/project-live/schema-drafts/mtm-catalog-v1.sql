-- UNAPPLIED SQL DRAFT. MTM catalog V1; no stock movement, seed, or business-data update.
-- Supabase CLI was absent when prepared. Promote through the project's reviewed
-- migration process only after a separate approval and real-schema verification.
-- Uses existing companies, profiles, products and the three existing model catalogs.
begin;
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
commit;
