-- TZ-242: one crop-structure allocation with an ordered seed composition.
-- This migration is intentionally additive except for widening product_id on
-- seed planning rows; physical warehouse postings still require a real product.

alter table public.crop_structure
  drop constraint if exists crop_structure_land_use_type_check;

alter table public.crop_structure
  add constraint crop_structure_land_use_type_check
  check (land_use_type in ('crop', 'crop_mix', 'fallow'));

alter table public.crop_structure
  drop constraint if exists crop_structure_land_use_identity_check;

alter table public.crop_structure
  add constraint crop_structure_land_use_identity_check
  check (
    (land_use_type = 'crop' and crop_id is not null)
    or (
      land_use_type in ('crop_mix', 'fallow')
      and crop_id is null
      and variety_id is null
      and reproduction_id is null
    )
  );

create table if not exists public.crop_structure_mix_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  crop_structure_id uuid not null references public.crop_structure(id) on delete cascade,
  crop_id uuid not null references public.crops(id) on delete restrict,
  variety_id uuid not null references public.varieties(id) on delete restrict,
  reproduction_id uuid not null references public.seed_reproductions(id) on delete restrict,
  seed_rate_kg_ha numeric(14,4) not null check (seed_rate_kg_ha > 0),
  sort_order smallint not null check (sort_order between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crop_structure_mix_components_identity_key
    unique (crop_structure_id, crop_id, variety_id, reproduction_id),
  constraint crop_structure_mix_components_sort_key
    unique (crop_structure_id, sort_order)
);

create index if not exists idx_crop_structure_mix_components_company_structure
  on public.crop_structure_mix_components(company_id, crop_structure_id, sort_order);
create index if not exists idx_crop_structure_mix_components_crop
  on public.crop_structure_mix_components(crop_id, variety_id, reproduction_id);

create or replace function public.validate_crop_structure_mix_component_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_structure public.crop_structure%rowtype;
  v_variety_crop_id uuid;
begin
  select cs.* into v_structure
  from public.crop_structure cs
  where cs.id = new.crop_structure_id
  for share;

  if not found or v_structure.company_id is distinct from new.company_id then
    raise exception 'Crop mix component must belong to the same company as its structure row'
      using errcode = '23503';
  end if;
  if v_structure.land_use_type <> 'crop_mix' then
    raise exception 'Crop mix components require land_use_type crop_mix'
      using errcode = '23514';
  end if;

  select v.crop_id into v_variety_crop_id
  from public.varieties v
  where v.id = new.variety_id
    and coalesce(v.archived, false) = false
    and coalesce(v.is_active, true) = true
    and (v.company_id is null or v.company_id = new.company_id);
  if not found or v_variety_crop_id <> new.crop_id then
    raise exception 'Crop mix variety does not belong to its crop'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.crops c
    where c.id = new.crop_id
      and coalesce(c.archived, false) = false
      and coalesce(c.is_active, true) = true
      and (c.company_id is null or c.company_id = new.company_id)
  ) then
    raise exception 'Crop mix crop is not available to the company'
      using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.seed_reproductions sr
    where sr.id = new.reproduction_id
      and coalesce(sr.archived, false) = false
      and coalesce(sr.is_active, true) = true
      and (sr.company_id is null or sr.company_id = new.company_id)
  ) then
    raise exception 'Crop mix reproduction is not available to the company'
      using errcode = '23503';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_crop_structure_mix_component_v1() from public, anon, authenticated;

drop trigger if exists validate_crop_structure_mix_component_v1 on public.crop_structure_mix_components;
create trigger validate_crop_structure_mix_component_v1
before insert or update on public.crop_structure_mix_components
for each row execute function public.validate_crop_structure_mix_component_v1();

alter table public.crop_structure_mix_components enable row level security;

drop policy if exists crop_structure_mix_components_select on public.crop_structure_mix_components;
create policy crop_structure_mix_components_select
on public.crop_structure_mix_components for select to authenticated
using (
  company_id = public.get_user_company_id()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'global_admin' and p.status = 'active'
  )
);

drop policy if exists crop_structure_mix_components_insert on public.crop_structure_mix_components;
create policy crop_structure_mix_components_insert
on public.crop_structure_mix_components for insert to authenticated
with check (
  company_id = public.get_user_company_id()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

drop policy if exists crop_structure_mix_components_update on public.crop_structure_mix_components;
create policy crop_structure_mix_components_update
on public.crop_structure_mix_components for update to authenticated
using (company_id = public.get_user_company_id())
with check (
  company_id = public.get_user_company_id()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

drop policy if exists crop_structure_mix_components_delete on public.crop_structure_mix_components;
create policy crop_structure_mix_components_delete
on public.crop_structure_mix_components for delete to authenticated
using (
  company_id = public.get_user_company_id()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

revoke all on table public.crop_structure_mix_components from public, anon, authenticated;
grant select, insert, update, delete on table public.crop_structure_mix_components to authenticated;

alter table public.operation_materials
  add column if not exists crop_id uuid references public.crops(id) on delete restrict,
  add column if not exists variety_id uuid references public.varieties(id) on delete restrict,
  add column if not exists reproduction_id uuid references public.seed_reproductions(id) on delete restrict,
  add column if not exists source_mix_component_id uuid references public.crop_structure_mix_components(id) on delete restrict;

alter table public.operation_materials alter column product_id drop not null;
alter table public.operation_materials
  drop constraint if exists operation_materials_product_or_seed_identity_check;
alter table public.operation_materials
  add constraint operation_materials_product_or_seed_identity_check
  check (
    product_id is not null
    or (
      material_type = 'seed'
      and crop_id is not null
      and variety_id is not null
      and reproduction_id is not null
      and source_mix_component_id is not null
    )
  );

create unique index if not exists uq_operation_materials_mix_component_v1
  on public.operation_materials(operation_id, source_mix_component_id)
  where source_mix_component_id is not null;

alter table public.warehouse_issue_request_items
  add column if not exists crop_id uuid references public.crops(id) on delete restrict,
  add column if not exists variety_id uuid references public.varieties(id) on delete restrict,
  add column if not exists reproduction_id uuid references public.seed_reproductions(id) on delete restrict,
  add column if not exists material_kind text,
  add column if not exists source_mix_component_id uuid references public.crop_structure_mix_components(id) on delete restrict;

alter table public.warehouse_issue_request_items alter column product_id drop not null;
alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_product_or_seed_identity_check;
alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_product_or_seed_identity_check
  check (
    product_id is not null
    or (
      material_kind = 'seed'
      and crop_id is not null
      and variety_id is not null
      and reproduction_id is not null
      and source_mix_component_id is not null
    )
  );

create unique index if not exists uq_warehouse_request_items_mix_component_v1
  on public.warehouse_issue_request_items(request_id, source_mix_component_id)
  where source_mix_component_id is not null;

create or replace function public.validate_crop_mix_request_item_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_component public.crop_structure_mix_components%rowtype;
begin
  if new.source_mix_component_id is null then
    return new;
  end if;

  select mc.* into v_component
  from public.crop_structure_mix_components mc
  where mc.id = new.source_mix_component_id
  for share;

  if not found
     or v_component.company_id is distinct from new.company_id
     or v_component.crop_id is distinct from new.crop_id
     or v_component.variety_id is distinct from new.variety_id
     or v_component.reproduction_id is distinct from new.reproduction_id then
    raise exception 'Warehouse request item must match its crop mix component identity'
      using errcode = '23514';
  end if;

  if new.product_id is not null and not exists (
    select 1
    from public.products p
    where p.id = new.product_id
      and (p.company_id = new.company_id or p.company_id is null)
      and coalesce(p.archived, false) = false
      and coalesce(p.is_active, true) = true
      and (p.type = 'seed' or p.is_seed_material)
      and p.crop_id = new.crop_id
      and p.variety_id = new.variety_id
      and p.seed_reproduction_id = new.reproduction_id
  ) then
    raise exception 'Warehouse product must exactly match crop, variety and reproduction'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_crop_mix_request_item_identity_v1() from public, anon, authenticated;

drop trigger if exists validate_crop_mix_request_item_identity_v1 on public.warehouse_issue_request_items;
create trigger validate_crop_mix_request_item_identity_v1
before insert or update of product_id, crop_id, variety_id, reproduction_id, source_mix_component_id
on public.warehouse_issue_request_items
for each row execute function public.validate_crop_mix_request_item_identity_v1();

alter table public.products
  add column if not exists is_derived_inventory boolean not null default false,
  add column if not exists derived_identity_key text;

create unique index if not exists uq_products_company_derived_identity_v1
  on public.products(company_id, derived_identity_key)
  where is_derived_inventory and company_id is not null and derived_identity_key is not null;

alter table public.inventory_batches
  add column if not exists composition_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists composition_hash text,
  add column if not exists display_name text,
  add column if not exists is_mixed_harvest boolean not null default false,
  add column if not exists planting_operation_id uuid references public.operations(id) on delete set null;

alter table public.ticket_lines
  add column if not exists composition_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists composition_hash text,
  add column if not exists is_mixed_harvest boolean not null default false;

create or replace function public.save_crop_structure_field_v5(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_actor_auth_user_id uuid,
  p_field_id uuid,
  p_season_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field public.fields%rowtype;
  v_row jsonb;
  v_component jsonb;
  v_existing public.crop_structure%rowtype;
  v_row_id uuid;
  v_land_use_type text;
  v_area numeric;
  v_total_area numeric;
  v_component_count integer;
  v_current_component_count integer;
  v_structure_changed boolean;
  v_components_changed boolean;
  v_result jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'rows must be an array with at most 100 items' using errcode = '22023';
  end if;

  select f.* into v_field
  from public.fields f
  where f.id = p_field_id and f.company_id = p_company_id and coalesce(f.archived, false) = false
  for update;
  if not found then
    raise exception 'Field is not available' using errcode = '23503';
  end if;

  perform 1 from public.seasons s
  where s.id = p_season_id and s.company_id = p_company_id and coalesce(s.archived, false) = false
  for share;
  if not found then
    raise exception 'Closed season is read-only' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) a
    where nullif(a ->> 'id', '') is not null
    group by a ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'Duplicate crop structure row id is not allowed' using errcode = '23505';
  end if;

  select coalesce(sum((r ->> 'area')::numeric), 0) into v_total_area
  from jsonb_array_elements(p_rows) r;
  if v_total_area > v_field.area + 0.0001 then
    raise exception 'Total crop structure area exceeds field area' using errcode = '23514';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_land_use_type := lower(coalesce(nullif(v_row ->> 'land_use_type', ''), 'crop'));
    v_area := nullif(v_row ->> 'area', '')::numeric;
    if v_land_use_type not in ('crop', 'crop_mix', 'fallow') then
      raise exception 'Unsupported land_use_type' using errcode = '22023';
    end if;
    if v_area is null or v_area <= 0 then
      raise exception 'Crop structure area must be positive' using errcode = '23514';
    end if;

    if v_land_use_type = 'crop' then
      if nullif(v_row ->> 'crop_id', '') is null
         or nullif(v_row ->> 'variety_id', '') is null
         or nullif(v_row ->> 'reproduction_id', '') is null then
        raise exception 'Crop row requires crop, variety and reproduction' using errcode = '23514';
      end if;
      if not exists (
        select 1 from public.varieties v
        where v.id = (v_row ->> 'variety_id')::uuid
          and v.crop_id = (v_row ->> 'crop_id')::uuid
          and coalesce(v.archived, false) = false
          and coalesce(v.is_active, true) = true
          and (v.company_id is null or v.company_id = p_company_id)
      ) then
        raise exception 'Selected variety does not belong to the crop' using errcode = '23514';
      end if;
    elsif nullif(v_row ->> 'crop_id', '') is not null
       or nullif(v_row ->> 'variety_id', '') is not null
       or nullif(v_row ->> 'reproduction_id', '') is not null then
      raise exception 'Crop mix and fallow roots cannot contain crop identity' using errcode = '23514';
    end if;

    v_component_count := jsonb_array_length(coalesce(v_row -> 'mix_components', '[]'::jsonb));
    if v_land_use_type = 'crop_mix' and (v_component_count < 2 or v_component_count > 10) then
      raise exception 'Crop mix requires between 2 and 10 components' using errcode = '23514';
    end if;
    if v_land_use_type <> 'crop_mix' and v_component_count <> 0 then
      raise exception 'Only crop_mix rows may contain mix components' using errcode = '23514';
    end if;

    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      where nullif(c ->> 'crop_id', '') is null
         or nullif(c ->> 'variety_id', '') is null
         or nullif(c ->> 'reproduction_id', '') is null
         or coalesce(nullif(c ->> 'seed_rate_kg_ha', '')::numeric, 0) <= 0
    ) then
      raise exception 'Every crop mix component requires crop, variety, reproduction and positive rate'
        using errcode = '23514';
    end if;
    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      left join public.varieties v on v.id = (c ->> 'variety_id')::uuid
      where v.id is null
         or v.crop_id <> (c ->> 'crop_id')::uuid
         or coalesce(v.archived, false)
         or not coalesce(v.is_active, true)
         or (v.company_id is not null and v.company_id <> p_company_id)
    ) then
      raise exception 'Crop mix variety does not belong to its crop' using errcode = '23514';
    end if;
    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      group by c ->> 'crop_id', c ->> 'variety_id', c ->> 'reproduction_id'
      having count(*) > 1
    ) then
      raise exception 'Exact duplicate crop mix component is not allowed' using errcode = '23505';
    end if;

    v_row_id := coalesce(nullif(v_row ->> 'id', '')::uuid, gen_random_uuid());
    select cs.* into v_existing
    from public.crop_structure cs
    where cs.id = v_row_id
    for update;

    if found and (
      v_existing.company_id is distinct from p_company_id
      or v_existing.field_id <> p_field_id
      or v_existing.season_id <> p_season_id
    ) then
      raise exception 'Crop structure row belongs to another scope' using errcode = '42501';
    end if;

    v_structure_changed := found and (
      v_existing.land_use_type is distinct from v_land_use_type
      or v_existing.crop_id is distinct from nullif(v_row ->> 'crop_id', '')::uuid
      or v_existing.variety_id is distinct from nullif(v_row ->> 'variety_id', '')::uuid
      or v_existing.reproduction_id is distinct from nullif(v_row ->> 'reproduction_id', '')::uuid
      or v_existing.area is distinct from v_area
    );
    select count(*) into v_current_component_count
    from public.crop_structure_mix_components mc
    where mc.crop_structure_id = v_row_id;
    v_components_changed := v_current_component_count <> v_component_count;
    if not v_components_changed and v_land_use_type = 'crop_mix' then
      v_components_changed := exists (
        select 1
        from jsonb_array_elements(v_row -> 'mix_components') with ordinality c(value, ordinality)
        where not exists (
          select 1 from public.crop_structure_mix_components mc
          where mc.crop_structure_id = v_row_id
            and mc.crop_id = (c.value ->> 'crop_id')::uuid
            and mc.variety_id = (c.value ->> 'variety_id')::uuid
            and mc.reproduction_id = (c.value ->> 'reproduction_id')::uuid
            and mc.seed_rate_kg_ha = (c.value ->> 'seed_rate_kg_ha')::numeric
            and mc.sort_order = c.ordinality
        )
      );
    end if;

    if found and (v_structure_changed or v_components_changed) and exists (
      select 1 from public.operations o
      where o.company_id = p_company_id and o.crop_structure_id = v_row_id and coalesce(o.archived, false) = false
    ) then
      raise exception 'Crop mix composition is locked after operation creation' using errcode = '23514';
    end if;

    insert into public.crop_structure (
      id, company_id, user_id, field_id, season_id, land_use_type,
      crop_id, variety_id, reproduction_id, notes, area, status, archived,
      irrigation_type, row_spacing_m, seed_spacing_cm, updated_at
    ) values (
      v_row_id, p_company_id, p_actor_auth_user_id, p_field_id, p_season_id, v_land_use_type,
      nullif(v_row ->> 'crop_id', '')::uuid,
      nullif(v_row ->> 'variety_id', '')::uuid,
      nullif(v_row ->> 'reproduction_id', '')::uuid,
      nullif(v_row ->> 'notes', ''), v_area, 'planned', false,
      coalesce(nullif(v_row ->> 'irrigation_type', ''), 'unknown'),
      nullif(v_row ->> 'row_spacing_m', '')::numeric,
      nullif(v_row ->> 'seed_spacing_cm', '')::numeric,
      now()
    )
    on conflict (id) do update set
      land_use_type = excluded.land_use_type,
      crop_id = excluded.crop_id,
      variety_id = excluded.variety_id,
      reproduction_id = excluded.reproduction_id,
      notes = excluded.notes,
      area = excluded.area,
      irrigation_type = excluded.irrigation_type,
      row_spacing_m = excluded.row_spacing_m,
      seed_spacing_cm = excluded.seed_spacing_cm,
      updated_at = now();

    if v_components_changed then
      delete from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_row_id and mc.company_id = p_company_id;
      if v_land_use_type = 'crop_mix' then
        for v_component in
          select value || jsonb_build_object('sort_order', ordinality)
          from jsonb_array_elements(v_row -> 'mix_components') with ordinality
        loop
          insert into public.crop_structure_mix_components (
            company_id, crop_structure_id, crop_id, variety_id, reproduction_id,
            seed_rate_kg_ha, sort_order
          ) values (
            p_company_id, v_row_id,
            (v_component ->> 'crop_id')::uuid,
            (v_component ->> 'variety_id')::uuid,
            (v_component ->> 'reproduction_id')::uuid,
            (v_component ->> 'seed_rate_kg_ha')::numeric,
            (v_component ->> 'sort_order')::smallint
          );
        end loop;
      end if;
    end if;
  end loop;

  if exists (
    select 1 from public.crop_structure cs
    where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
      and coalesce(cs.archived, false) = false
      and not exists (
        select 1 from jsonb_array_elements(p_rows) r
        where nullif(r ->> 'id', '')::uuid = cs.id
      )
      and (
        exists (select 1 from public.operations o where o.crop_structure_id = cs.id and coalesce(o.archived, false) = false)
        or exists (select 1 from public.field_material_consumptions fmc where fmc.crop_structure_row_id = cs.id)
      )
  ) then
    raise exception 'Crop structure row with operations or materials cannot be deleted' using errcode = '23514';
  end if;

  delete from public.crop_structure cs
  where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
    and coalesce(cs.archived, false) = false
    and not exists (
      select 1 from jsonb_array_elements(p_rows) r
      where nullif(r ->> 'id', '')::uuid = cs.id
    );

  select coalesce(jsonb_agg(row_payload order by row_payload ->> 'id'), '[]'::jsonb)
    into v_result
  from (
    select to_jsonb(cs) || jsonb_build_object(
      'mix_components', coalesce((
        select jsonb_agg(to_jsonb(mc) order by mc.sort_order)
        from public.crop_structure_mix_components mc
        where mc.crop_structure_id = cs.id
      ), '[]'::jsonb)
    ) as row_payload
    from public.crop_structure cs
    where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
      and coalesce(cs.archived, false) = false
  ) rows;

  return jsonb_build_object('companyId', p_company_id, 'fieldId', p_field_id, 'seasonId', p_season_id, 'rows', v_result);
end;
$$;

revoke all on function public.save_crop_structure_field_v5(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_crop_structure_field_v5(uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.create_crop_mix_operation_plan_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation jsonb,
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
  v_existing public.operations%rowtype;
  v_structure public.crop_structure%rowtype;
  v_operation public.operations%rowtype;
  v_line public.operation_lines%rowtype;
  v_request public.warehouse_issue_requests%rowtype;
  v_component public.crop_structure_mix_components%rowtype;
  v_product_id uuid;
  v_material_rows jsonb;
  v_request_rows jsonb;
  v_response jsonb;
  v_component_count integer;
  v_config jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );
  if nullif(p_idempotency_key, '') is null or nullif(p_request_fingerprint, '') is null then
    raise exception 'Idempotency key and fingerprint are required' using errcode = '23514';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'create', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_existing from public.operations
  where company_id = p_company_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if coalesce(v_existing.request_fingerprint, '') <> p_request_fingerprint then
      raise exception 'Idempotency-Key was already used with a different payload' using errcode = '23505';
    end if;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
      into v_material_rows from public.operation_materials m where m.operation_id = v_existing.id;
    select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]'::jsonb)
      into v_request_rows
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = v_existing.id;
    return jsonb_build_object(
      'operation', to_jsonb(v_existing), 'operation_materials', v_material_rows,
      'request_items', v_request_rows, 'idempotent_replay', true
    );
  end if;

  select cs.* into v_structure
  from public.crop_structure cs
  where cs.id = nullif(p_operation ->> 'crop_structure_id', '')::uuid
    and cs.company_id = p_company_id
    and cs.field_id = nullif(p_operation ->> 'field_id', '')::uuid
    and cs.land_use_type = 'crop_mix'
    and coalesce(cs.archived, false) = false
  for share;
  if not found then
    raise exception 'Active crop_mix structure row was not found' using errcode = '23503';
  end if;
  perform 1 from public.seasons s
  where s.id = v_structure.season_id and s.company_id = p_company_id and coalesce(s.archived, false) = false
  for share;
  if not found then raise exception 'Operation season is closed' using errcode = '23514'; end if;

  select count(*) into v_component_count
  from public.crop_structure_mix_components mc
  where mc.crop_structure_id = v_structure.id and mc.company_id = p_company_id;
  if v_component_count < 2 or v_component_count > 10 then
    raise exception 'Crop mix requires between 2 and 10 components' using errcode = '23514';
  end if;
  if coalesce(nullif(p_operation ->> 'planned_area_ha', '')::numeric, v_structure.area) > v_structure.area + 0.0001 then
    raise exception 'Planned area exceeds crop mix area' using errcode = '23514';
  end if;
  if nullif(p_operation ->> 'responsible_user_id', '') is null then
    raise exception 'Responsible specialist is required' using errcode = '23514';
  end if;

  v_config := coalesce(p_operation -> 'operation_config', '{}'::jsonb) || jsonb_build_object(
    'crop_mix', true,
    'land_use_type', 'crop_mix',
    'composition_snapshot', (
      select jsonb_agg(jsonb_build_object(
        'component_id', mc.id,
        'crop_id', mc.crop_id,
        'variety_id', mc.variety_id,
        'reproduction_id', mc.reproduction_id,
        'seed_rate_kg_ha', mc.seed_rate_kg_ha,
        'planned_quantity_kg', v_structure.area * mc.seed_rate_kg_ha,
        'sort_order', mc.sort_order
      ) order by mc.sort_order)
      from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_structure.id
    )
  );

  insert into public.operations (
    company_id, field_id, crop_structure_id, operation_type, date, notes,
    user_id, status, work_status, responsible_user_id,
    operation_category_slug, operation_type_slug, machine_id, equipment_id, transport_id,
    operation_target, operation_config, idempotency_key, request_fingerprint,
    operation_status, specialist_task_status, planned_area_ha, completed_area_ha,
    remaining_area_ha, progress_percent
  ) values (
    p_company_id, v_structure.field_id, v_structure.id,
    'Посев зерносмеси',
    (p_operation ->> 'date')::date,
    nullif(p_operation ->> 'notes', ''), auth.uid(), 'planned', 'active',
    (p_operation ->> 'responsible_user_id')::uuid,
    coalesce(nullif(p_operation ->> 'operation_category_slug', ''), 'planting'),
    coalesce(nullif(p_operation ->> 'operation_type_slug', ''), 'planting'),
    nullif(p_operation ->> 'machine_id', '')::uuid,
    nullif(p_operation ->> 'equipment_id', '')::uuid,
    nullif(p_operation ->> 'transport_id', '')::uuid,
    nullif(p_operation ->> 'operation_target', ''), v_config,
    p_idempotency_key, p_request_fingerprint,
    'planned', 'waiting_materials', v_structure.area, 0, v_structure.area, 0
  ) returning * into v_operation;

  insert into public.operation_lines (
    company_id, operation_id, field_id, crop_id, variety_id, reproduction_id,
    planned_area_ha, actual_area_ha, notes, created_by_user_id, updated_by_user_id
  ) values (
    p_company_id, v_operation.id, v_structure.field_id, null, null, null,
    v_structure.area, null, 'Crop mix root: area counted once', auth.uid(), auth.uid()
  ) returning * into v_line;

  insert into public.warehouse_issue_requests (
    company_id, operation_id, field_id, operation_line_id,
    recipient_user_id, assigned_specialist_id, planned_datetime,
    comment, status, warehouse_request_status
  ) values (
    p_company_id, v_operation.id, v_structure.field_id, v_line.id,
    v_operation.responsible_user_id, v_operation.responsible_user_id,
    v_operation.date::timestamp + time '08:00',
    'Посев зерносмеси: одна заявка, отдельная строка на компонент',
    'new', 'pending'
  ) returning * into v_request;

  for v_component in
    select * from public.crop_structure_mix_components mc
    where mc.crop_structure_id = v_structure.id and mc.company_id = p_company_id
    order by mc.sort_order
  loop
    v_product_id := null;
    select p.id into v_product_id
    from public.products p
    where (p.company_id = p_company_id or p.company_id is null)
      and coalesce(p.archived, false) = false and coalesce(p.is_active, true) = true
      and (p.type = 'seed' or p.is_seed_material)
      and p.crop_id = v_component.crop_id
      and p.variety_id = v_component.variety_id
      and p.seed_reproduction_id = v_component.reproduction_id
    order by (p.company_id = p_company_id) desc, p.created_at, p.id
    limit 1;

    insert into public.operation_materials (
      company_id, operation_id, operation_line_id, product_id,
      material_type, unit, planned_rate, planned_quantity, issued_quantity,
      notes, created_by_user_id, updated_by_user_id,
      crop_id, variety_id, reproduction_id, source_mix_component_id
    ) values (
      p_company_id, v_operation.id, v_line.id, v_product_id,
      'seed', 'kg', v_component.seed_rate_kg_ha,
      v_structure.area * v_component.seed_rate_kg_ha, 0,
      case when v_product_id is null then 'seed_stock_deficit:product_not_received' else 'crop_mix_component' end,
      auth.uid(), auth.uid(),
      v_component.crop_id, v_component.variety_id, v_component.reproduction_id, v_component.id
    );

    insert into public.warehouse_issue_request_items (
      request_id, company_id, product_id, product_category,
      required_quantity, planned_quantity, issued_quantity, unit, planned_rate_per_ha,
      prepared_quantity, expected_consumed_quantity, expected_return_quantity,
      return_received_quantity, loss_quantity, shortage_quantity,
      reconciliation_status, substitution_status, planned_product_id, actual_product_id,
      prepared_unit, issued_unit, received_unit, package_unit,
      crop_id, variety_id, reproduction_id, material_kind, source_mix_component_id
    ) values (
      v_request.id, p_company_id, v_product_id, 'seed',
      v_structure.area * v_component.seed_rate_kg_ha,
      v_structure.area * v_component.seed_rate_kg_ha, 0, 'kg', v_component.seed_rate_kg_ha,
      0, 0, 0, 0, 0, v_structure.area * v_component.seed_rate_kg_ha,
      case when v_product_id is null then 'blocked' else 'pending' end,
      'none', v_product_id, v_product_id,
      'kg', 'kg', 'kg', 'kg',
      v_component.crop_id, v_component.variety_id, v_component.reproduction_id,
      'seed', v_component.id
    );
  end loop;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'operation', v_operation.id::text,
    'crop_mix_created_atomic',
    jsonb_build_object('component_count', v_component_count, 'request_id', v_request.id, 'area_ha', v_structure.area)
  );

  select coalesce(jsonb_agg(to_jsonb(m) order by mc.sort_order), '[]'::jsonb)
    into v_material_rows
  from public.operation_materials m
  join public.crop_structure_mix_components mc on mc.id = m.source_mix_component_id
  where m.operation_id = v_operation.id;
  select coalesce(jsonb_agg(to_jsonb(i) order by mc.sort_order), '[]'::jsonb)
    into v_request_rows
  from public.warehouse_issue_request_items i
  join public.crop_structure_mix_components mc on mc.id = i.source_mix_component_id
  where i.request_id = v_request.id;

  v_response := jsonb_build_object(
    'operation', to_jsonb(v_operation),
    'operation_line', to_jsonb(v_line),
    'operation_materials', v_material_rows,
    'material_request', jsonb_build_object(
      'created', true, 'request_id', v_request.id, 'request_number', v_request.request_number,
      'request_status', v_request.status, 'item_count', v_component_count
    ),
    'request_items', v_request_rows
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'create', v_operation.id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.create_crop_mix_operation_plan_atomic_v1(uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.create_crop_mix_operation_plan_atomic_v1(uuid, uuid, jsonb, text, text) to authenticated;

create or replace function public.transition_operation_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_transition text,
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
  v_operation public.operations%rowtype;
  v_response jsonb;
  v_is_crop_mix boolean := false;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier']::text[]
  );
  if p_transition not in ('accept', 'start') then
    raise exception 'Unsupported operation transition' using errcode = '22023';
  end if;
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'activate', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Operation was not found' using errcode = 'P0002'; end if;
  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) = 'completed' then
    raise exception 'Operation is already completed' using errcode = '23514';
  end if;
  if v_operation.responsible_user_id is not null
     and v_operation.responsible_user_id <> p_actor_profile_id
     and public.assert_operation_mutation_actor_v1(
       p_company_id, p_actor_profile_id,
       array['global_admin', 'company_admin', 'agronomist']::text[]
     ) is null then
    raise exception 'Operation is assigned to another specialist' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.crop_structure cs
    where cs.id = v_operation.crop_structure_id
      and cs.company_id = p_company_id and cs.land_use_type = 'crop_mix'
  ) into v_is_crop_mix;

  if p_transition = 'accept' then
    update public.operations
    set status = 'accepted', operation_status = 'accepted', specialist_task_status = 'accepted',
        accepted_at = coalesce(accepted_at, now()), updated_at = now()
    where id = p_operation_id returning * into v_operation;
    update public.warehouse_issue_requests
    set status = case when status = 'new' then 'active' else status end,
        warehouse_request_status = coalesce(warehouse_request_status, 'pending'), updated_at = now()
    where operation_id = p_operation_id and company_id = p_company_id
      and status not in ('cancelled', 'issued', 'issued_by_warehouse');
  else
    if v_is_crop_mix
       and coalesce(v_operation.operation_category_slug, '') = 'planting'
       and exists (
      select 1
      from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_operation.crop_structure_id
        and mc.company_id = p_company_id
        and not exists (
          select 1
          from public.warehouse_issue_requests r
          join public.warehouse_issue_request_items i
            on i.request_id = r.id and i.company_id = r.company_id
          where r.operation_id = p_operation_id
            and r.company_id = p_company_id
            and i.source_mix_component_id = mc.id
            and i.product_id is not null
            and coalesce(i.issued_quantity, 0) + 0.0001 >= i.required_quantity
            and coalesce(i.reconciliation_status, '') <> 'blocked'
        )
    ) then
      raise exception 'Все компоненты зерносмеси должны быть полностью выданы до начала посева'
        using errcode = '23514';
    end if;
    if not v_is_crop_mix and exists (
      select 1 from public.warehouse_issue_requests r
      where r.operation_id = p_operation_id and r.company_id = p_company_id
        and coalesce(r.status, '') not in ('issued', 'issued_by_warehouse', 'partially_issued')
    ) then
      raise exception 'Materials must be issued before operation start' using errcode = '23514';
    end if;
    update public.operations
    set status = 'in_progress', work_status = 'in_progress', operation_status = 'in_progress',
        specialist_task_status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
    where id = p_operation_id returning * into v_operation;
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (p_company_id, p_actor_profile_id, 'operation', p_operation_id::text,
          p_transition || '_atomic', to_jsonb(v_operation));
  v_response := jsonb_build_object('operation', to_jsonb(v_operation), 'transition', p_transition);
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'activate', p_operation_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text) to authenticated;

create or replace function public.ensure_crop_mix_inventory_product_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_crop_structure_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_structure public.crop_structure%rowtype;
  v_component_count integer;
  v_identity_key text;
  v_display_name text;
  v_snapshot jsonb;
  v_product public.products%rowtype;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'weighbridge_operator', 'weighman']::text[]
  );

  select p.* into v_actor from public.profiles p
  where p.id = p_actor_profile_id
    and p.status = 'active';
  if not found or (
    v_actor.role <> 'global_admin'
    and (v_actor.company_id is distinct from p_company_id
      or v_actor.role not in ('company_admin', 'agronomist', 'weighbridge_operator', 'weighman'))
  ) then
    raise exception 'Actor cannot create crop mix inventory identity' using errcode = '42501';
  end if;

  select cs.* into v_structure from public.crop_structure cs
  where cs.id = p_crop_structure_id and cs.company_id = p_company_id
    and cs.land_use_type = 'crop_mix' and coalesce(cs.archived, false) = false
  for share;
  if not found then raise exception 'Crop mix structure was not found' using errcode = '23503'; end if;

  select count(*),
         md5(string_agg(mc.crop_id::text || ':' || mc.variety_id::text || ':' || mc.reproduction_id::text || ':' || mc.seed_rate_kg_ha::text, '|' order by mc.sort_order)),
         'Зерносмесь: ' || string_agg(coalesce(c.name_ru, c.name), ' + ' order by mc.sort_order),
         jsonb_agg(jsonb_build_object(
           'component_id', mc.id, 'crop_id', mc.crop_id, 'crop_name', coalesce(c.name_ru, c.name),
           'variety_id', mc.variety_id, 'variety_name', coalesce(v.name_ru, v.name),
           'reproduction_id', mc.reproduction_id,
           'reproduction_name', coalesce(sr.name_ru, sr.name, sr.code),
           'seed_rate_kg_ha', mc.seed_rate_kg_ha, 'sort_order', mc.sort_order
         ) order by mc.sort_order)
    into v_component_count, v_identity_key, v_display_name, v_snapshot
  from public.crop_structure_mix_components mc
  join public.crops c on c.id = mc.crop_id
  join public.varieties v on v.id = mc.variety_id
  join public.seed_reproductions sr on sr.id = mc.reproduction_id
  where mc.crop_structure_id = v_structure.id and mc.company_id = p_company_id;
  if v_component_count < 2 then raise exception 'Crop mix composition is incomplete' using errcode = '23514'; end if;

  insert into public.products (
    name, name_ru, type, user_id, company_id, unit, base_uom,
    accounting_mode, is_seed_material, is_active, archived,
    is_derived_inventory, derived_identity_key, description
  ) values (
    v_display_name, v_display_name, 'produce', p_actor_profile_id, p_company_id,
    'kg', 'kg', 'bulk_mass', false, true, false,
    true, v_identity_key, 'Складская идентичность смешанного урожая; состав хранится в партии.'
  )
  on conflict (company_id, derived_identity_key)
    where is_derived_inventory and company_id is not null and derived_identity_key is not null
  do update set name = excluded.name, name_ru = excluded.name_ru, is_active = true, archived = false, updated_at = now()
  returning * into v_product;

  return jsonb_build_object(
    'product_id', v_product.id, 'display_name', v_display_name,
    'composition_hash', v_identity_key, 'composition_snapshot', v_snapshot
  );
end;
$$;

revoke all on function public.ensure_crop_mix_inventory_product_v1(uuid, uuid, uuid) from public, anon;
grant execute on function public.ensure_crop_mix_inventory_product_v1(uuid, uuid, uuid) to authenticated;

create or replace function public.populate_crop_mix_harvest_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_structure public.crop_structure%rowtype;
  v_snapshot jsonb;
  v_hash text;
  v_name text;
  v_planting_operation_id uuid;
begin
  if new.origin_type <> 'harvest' or new.source_ticket_id is null then return new; end if;
  select cs.* into v_structure
  from public.tickets t
  join public.crop_structure cs on cs.id = t.crop_structure_allocation_id and cs.company_id = t.company_id
  where t.id = new.source_ticket_id and t.company_id = new.company_id;
  if not found or v_structure.land_use_type <> 'crop_mix' then return new; end if;

  select jsonb_agg(jsonb_build_object(
           'component_id', mc.id, 'crop_id', mc.crop_id, 'crop_name', coalesce(c.name_ru, c.name),
           'variety_id', mc.variety_id, 'variety_name', coalesce(v.name_ru, v.name),
           'reproduction_id', mc.reproduction_id,
           'reproduction_name', coalesce(sr.name_ru, sr.name, sr.code),
           'seed_rate_kg_ha', mc.seed_rate_kg_ha, 'sort_order', mc.sort_order
         ) order by mc.sort_order),
         md5(string_agg(mc.crop_id::text || ':' || mc.variety_id::text || ':' || mc.reproduction_id::text || ':' || mc.seed_rate_kg_ha::text, '|' order by mc.sort_order)),
         'Зерносмесь: ' || string_agg(coalesce(c.name_ru, c.name), ' + ' order by mc.sort_order)
    into v_snapshot, v_hash, v_name
  from public.crop_structure_mix_components mc
  join public.crops c on c.id = mc.crop_id
  join public.varieties v on v.id = mc.variety_id
  join public.seed_reproductions sr on sr.id = mc.reproduction_id
  where mc.crop_structure_id = v_structure.id;

  select o.id into v_planting_operation_id
  from public.operations o
  where o.company_id = new.company_id and o.crop_structure_id = v_structure.id
    and (o.operation_category_slug = 'planting' or o.operation_type_slug = 'planting')
    and coalesce(o.archived, false) = false
  order by o.created_at desc, o.id desc limit 1;

  new.crop_id := null;
  new.variety_id := null;
  new.reproduction_id := null;
  new.composition_snapshot := coalesce(v_snapshot, '[]'::jsonb);
  new.composition_hash := v_hash;
  new.display_name := v_name;
  new.is_mixed_harvest := true;
  new.planting_operation_id := v_planting_operation_id;
  return new;
end;
$$;

revoke all on function public.populate_crop_mix_harvest_snapshot_v1() from public, anon, authenticated;
drop trigger if exists populate_crop_mix_harvest_snapshot_v1 on public.inventory_batches;
create trigger populate_crop_mix_harvest_snapshot_v1
before insert or update of source_ticket_id, origin_type
on public.inventory_batches for each row
execute function public.populate_crop_mix_harvest_snapshot_v1();

create or replace function public.record_finalized_harvest_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_structure public.crop_structure%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_history_name text;
  v_season_year integer;
begin
  if new.op_type <> 'harvest_incoming'
     or not new.is_finalized
     or new.status::text <> 'finalized'
     or (old.is_finalized and old.status::text = 'finalized') then return new; end if;

  select cs.* into v_structure from public.crop_structure cs
  where cs.id = new.crop_structure_allocation_id and cs.company_id = new.company_id
    and cs.field_id = new.field_id and cs.season_id = new.season_id
    and coalesce(cs.archived, false) = false;
  if not found then raise exception 'Finalized harvest ticket requires crop structure identity'; end if;
  if v_structure.land_use_type = 'crop' and (
    v_structure.crop_id is null or v_structure.variety_id is null or v_structure.reproduction_id is null
  ) then raise exception 'Finalized harvest ticket requires complete crop structure identity'; end if;
  if v_structure.land_use_type not in ('crop', 'crop_mix') then
    raise exception 'Harvest is not allowed for this land use type';
  end if;

  select ib.* into v_batch from public.inventory_batches ib
  where ib.company_id = new.company_id and ib.source_ticket_id = new.id and ib.origin_type = 'harvest'
  order by ib.created_at, ib.id limit 1;
  if not found then raise exception 'Finalized harvest ticket requires a harvest batch'; end if;
  if v_structure.land_use_type = 'crop_mix' and (
    not v_batch.is_mixed_harvest or jsonb_array_length(v_batch.composition_snapshot) < 2
  ) then raise exception 'Mixed harvest batch requires composition snapshot'; end if;
  if not exists (
    select 1 from public.stock_ledger_entries sle
    where sle.company_id = new.company_id and sle.ticket_id = new.id
      and sle.direction::text = 'in' and sle.batch_id = v_batch.id::text
      and coalesce(sle.is_storno, false) = false
  ) then raise exception 'Finalized harvest ticket requires one linked ledger IN posting'; end if;

  if v_structure.land_use_type = 'crop_mix' then
    v_history_name := coalesce(v_batch.display_name, 'Зерносмесь');
  else
    select coalesce(c.name_ru, c.name) into v_history_name from public.crops c where c.id = v_structure.crop_id;
  end if;
  select s.year into v_season_year from public.seasons s
  where s.id = new.season_id and s.company_id = new.company_id;

  insert into public.field_history_entries (
    company_id, field_id, season_id, season_year, crop_id,
    history_value, token, original_raw_value, source, notes,
    operation_id, crop_structure_id, harvest_ticket_id, harvest_batch_id, material_facts
  ) values (
    new.company_id, new.field_id, new.season_id, v_season_year, v_structure.crop_id,
    coalesce(v_history_name, 'Урожай'), 'weighbridge:' || new.id::text,
    coalesce(new.notes, ''), 'weighbridge_harvest',
    'Урожай принят по талону ' || new.ticket_no,
    new.linked_operation_id, v_structure.id, new.id, v_batch.id,
    case when v_batch.is_mixed_harvest then v_batch.composition_snapshot else '[]'::jsonb end
  ) on conflict (harvest_ticket_id)
    where source = 'weighbridge_harvest' and harvest_ticket_id is not null
  do nothing;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    new.company_id, new.closed_by, 'weighbridge_ticket', new.id, 'harvest_finalized',
    jsonb_build_object(
      'ticket_id', new.id, 'batch_id', v_batch.id, 'crop_structure_id', v_structure.id,
      'operation_id', new.linked_operation_id, 'warehouse_id', new.warehouse_to_id,
      'net_weight_kg', new.net_weight_kg, 'is_mixed_harvest', v_batch.is_mixed_harvest,
      'composition_hash', v_batch.composition_hash
    )
  );
  return new;
end;
$$;

revoke all on function public.record_finalized_harvest_trace_v1() from public, anon, authenticated;

comment on table public.crop_structure_mix_components is
  'TZ-242 ordered components of one crop_mix allocation; area remains on crop_structure.';
comment on column public.warehouse_issue_request_items.product_id is
  'Physical product when resolved; crop_mix seed planning may remain identity-only until matching stock exists.';
comment on column public.inventory_batches.composition_snapshot is
  'Immutable agronomic identity snapshot for mixed harvest batches.';
