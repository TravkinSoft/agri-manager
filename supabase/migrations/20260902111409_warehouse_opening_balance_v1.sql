-- Canonical warehouse opening balance for harvested/processed physical stock.
-- One immutable, atomic document per company and season. No ticket history is fabricated.

create table if not exists public.warehouse_opening_balance_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete restrict,
  document_no text not null,
  snapshot_at timestamptz not null,
  status text not null default 'posted' check (status = 'posted'),
  notes text,
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint warehouse_opening_balance_company_season_v1 unique (company_id, season_id),
  constraint warehouse_opening_balance_idempotency_v1 unique (company_id, idempotency_key),
  constraint warehouse_opening_balance_document_no_v1 unique (company_id, document_no),
  constraint warehouse_opening_balance_document_no_nonempty_v1 check (nullif(btrim(document_no), '') is not null),
  constraint warehouse_opening_balance_idempotency_nonempty_v1 check (nullif(btrim(idempotency_key), '') is not null),
  constraint warehouse_opening_balance_fingerprint_nonempty_v1 check (nullif(btrim(request_fingerprint), '') is not null)
);

create table if not exists public.warehouse_opening_balance_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.warehouse_opening_balance_documents(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete restrict,
  line_no integer not null check (line_no > 0),
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  inventory_batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  harvest_lot_id uuid not null references public.harvest_lots(id) on delete restrict,
  ledger_entry_id uuid not null references public.stock_ledger_entries(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  crop_id uuid not null references public.crops(id) on delete restrict,
  variety_id uuid references public.varieties(id) on delete restrict,
  reproduction_id uuid references public.seed_reproductions(id) on delete restrict,
  batch_code text not null,
  batch_name text,
  quantity_kg numeric(18,3) not null check (quantity_kg > 0),
  physical_state text not null check (physical_state in (
    'SOURCE', 'AFTER_CLEANING', 'AFTER_DRYING', 'COMMODITY_GRAIN',
    'SCREENINGS', 'TRIER_WASTE', 'OTHER'
  )),
  origin_mode text not null check (origin_mode in ('explicit', 'auto', 'unknown')),
  source_count integer not null check (source_count >= 0),
  source_quantities_known boolean not null default false,
  parent_batch_id uuid references public.inventory_batches(id) on delete restrict,
  moisture_percent numeric(8,3) check (moisture_percent is null or moisture_percent between 0 and 100),
  dockage_percent numeric(8,3) check (dockage_percent is null or dockage_percent between 0 and 100),
  notes text,
  created_at timestamptz not null default now(),
  constraint warehouse_opening_balance_line_no_v1 unique (document_id, line_no),
  constraint warehouse_opening_balance_line_batch_v1 unique (company_id, inventory_batch_id),
  constraint warehouse_opening_balance_line_ledger_v1 unique (company_id, ledger_entry_id),
  constraint warehouse_opening_balance_line_lot_v1 unique (company_id, harvest_lot_id),
  constraint warehouse_opening_balance_line_batch_code_nonempty_v1 check (nullif(btrim(batch_code), '') is not null),
  constraint warehouse_opening_balance_line_origin_count_v1 check (
    (origin_mode = 'unknown' and source_count = 0)
    or (origin_mode in ('explicit', 'auto') and source_count > 0)
  )
);

create table if not exists public.warehouse_opening_balance_line_sources (
  id uuid primary key default gen_random_uuid(),
  opening_balance_line_id uuid not null references public.warehouse_opening_balance_lines(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete restrict,
  crop_structure_id uuid not null references public.crop_structure(id) on delete restrict,
  field_id uuid not null references public.fields(id) on delete restrict,
  quantity_kg numeric(18,3) check (quantity_kg is null or quantity_kg > 0),
  created_at timestamptz not null default now(),
  constraint warehouse_opening_balance_source_unique_v1 unique (opening_balance_line_id, crop_structure_id)
);

create index if not exists warehouse_opening_balance_documents_company_snapshot_v1
  on public.warehouse_opening_balance_documents(company_id, snapshot_at desc, id);
create index if not exists warehouse_opening_balance_lines_company_warehouse_v1
  on public.warehouse_opening_balance_lines(company_id, warehouse_id, created_at, id);
create index if not exists warehouse_opening_balance_sources_crop_structure_v1
  on public.warehouse_opening_balance_line_sources(company_id, season_id, crop_structure_id);

alter table public.warehouse_opening_balance_documents enable row level security;
alter table public.warehouse_opening_balance_lines enable row level security;
alter table public.warehouse_opening_balance_line_sources enable row level security;

drop policy if exists warehouse_opening_balance_documents_read_v1 on public.warehouse_opening_balance_documents;
create policy warehouse_opening_balance_documents_read_v1
on public.warehouse_opening_balance_documents for select to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists warehouse_opening_balance_lines_read_v1 on public.warehouse_opening_balance_lines;
create policy warehouse_opening_balance_lines_read_v1
on public.warehouse_opening_balance_lines for select to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists warehouse_opening_balance_sources_read_v1 on public.warehouse_opening_balance_line_sources;
create policy warehouse_opening_balance_sources_read_v1
on public.warehouse_opening_balance_line_sources for select to authenticated
using (company_id = public.get_user_company_id());

revoke all privileges on table public.warehouse_opening_balance_documents from public, anon, authenticated, service_role;
revoke all privileges on table public.warehouse_opening_balance_lines from public, anon, authenticated, service_role;
revoke all privileges on table public.warehouse_opening_balance_line_sources from public, anon, authenticated, service_role;
grant select on table public.warehouse_opening_balance_documents to authenticated, service_role;
grant select on table public.warehouse_opening_balance_lines to authenticated, service_role;
grant select on table public.warehouse_opening_balance_line_sources to authenticated, service_role;

create or replace function public.prevent_warehouse_opening_balance_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Posted warehouse opening balance is immutable' using errcode = '42501';
end;
$$;

drop trigger if exists warehouse_opening_balance_documents_immutable_v1 on public.warehouse_opening_balance_documents;
create trigger warehouse_opening_balance_documents_immutable_v1
before update or delete or truncate on public.warehouse_opening_balance_documents
for each statement execute function public.prevent_warehouse_opening_balance_mutation_v1();

drop trigger if exists warehouse_opening_balance_lines_immutable_v1 on public.warehouse_opening_balance_lines;
create trigger warehouse_opening_balance_lines_immutable_v1
before update or delete or truncate on public.warehouse_opening_balance_lines
for each statement execute function public.prevent_warehouse_opening_balance_mutation_v1();

drop trigger if exists warehouse_opening_balance_sources_immutable_v1 on public.warehouse_opening_balance_line_sources;
create trigger warehouse_opening_balance_sources_immutable_v1
before update or delete or truncate on public.warehouse_opening_balance_line_sources
for each statement execute function public.prevent_warehouse_opening_balance_mutation_v1();

create or replace function public.create_warehouse_opening_balance_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_season_id uuid,
  p_document_id uuid,
  p_document_no text,
  p_snapshot_at timestamptz,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.warehouse_opening_balance_documents%rowtype;
  v_document_id uuid := coalesce(p_document_id, gen_random_uuid());
  v_line jsonb;
  v_sources jsonb;
  v_source jsonb;
  v_line_id uuid;
  v_batch_id uuid;
  v_lot_id uuid;
  v_ledger_id uuid;
  v_warehouse_id uuid;
  v_crop_id uuid;
  v_variety_id uuid;
  v_reproduction_id uuid;
  v_parent_batch_id uuid;
  v_hint_field_id uuid;
  v_single_field_id uuid;
  v_single_crop_structure_id uuid;
  v_product_id uuid;
  v_quantity numeric(18,3);
  v_source_quantity numeric(18,3);
  v_source_sum numeric(18,3);
  v_moisture numeric(8,3);
  v_dockage numeric(8,3);
  v_batch_code text;
  v_batch_name text;
  v_origin_mode text;
  v_physical_state text;
  v_batch_status text;
  v_batch_class text;
  v_state_label text;
  v_crop_name text;
  v_variety_name text;
  v_reproduction_name text;
  v_display_name text;
  v_identity_key text;
  v_line_no integer := 0;
  v_source_count integer;
  v_source_with_quantity_count integer;
  v_sources_snapshot jsonb;
  v_response_lines jsonb := '[]'::jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin']::text[]
  );

  if nullif(btrim(p_idempotency_key), '') is null
     or nullif(btrim(p_request_fingerprint), '') is null then
    raise exception 'Idempotency key and request fingerprint are required' using errcode = '22023';
  end if;
  if nullif(btrim(p_document_no), '') is null then
    raise exception 'Opening balance document number is required' using errcode = '22023';
  end if;
  if p_snapshot_at is null or p_snapshot_at > now() + interval '5 minutes' then
    raise exception 'Opening balance snapshot time is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Opening balance requires at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Opening balance cannot contain more than 500 lines' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':warehouse-opening-balance:' || p_season_id::text, 0));

  select * into v_existing
  from public.warehouse_opening_balance_documents d
  where d.company_id = p_company_id
    and d.idempotency_key = btrim(p_idempotency_key)
  for share;
  if found then
    if v_existing.request_fingerprint <> btrim(p_request_fingerprint) then
      raise exception 'Idempotency-Key was already used with a different opening balance payload' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true,
      'document_id', v_existing.id,
      'document_no', v_existing.document_no,
      'season_id', v_existing.season_id,
      'snapshot_at', v_existing.snapshot_at,
      'line_count', (select count(*) from public.warehouse_opening_balance_lines l where l.document_id = v_existing.id),
      'idempotent_replay', true
    );
  end if;

  if exists (
    select 1 from public.warehouse_opening_balance_documents d
    where d.company_id = p_company_id and d.season_id = p_season_id
  ) then
    raise exception 'Opening balance is already posted for this company and season' using errcode = '23505';
  end if;

  if not exists (
    select 1 from public.seasons s
    where s.id = p_season_id and s.company_id = p_company_id and not coalesce(s.archived, false)
  ) then
    raise exception 'Opening balance season is unavailable for this company' using errcode = '23503';
  end if;

  insert into public.warehouse_opening_balance_documents (
    id, company_id, season_id, document_no, snapshot_at, notes,
    idempotency_key, request_fingerprint, created_by_profile_id, created_by_auth_user_id
  ) values (
    v_document_id, p_company_id, p_season_id, btrim(p_document_no), p_snapshot_at,
    nullif(btrim(coalesce(p_notes, '')), ''), btrim(p_idempotency_key), btrim(p_request_fingerprint),
    p_actor_profile_id, auth.uid()
  );

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    v_line_id := gen_random_uuid();
    v_batch_id := gen_random_uuid();
    v_lot_id := gen_random_uuid();
    v_ledger_id := gen_random_uuid();
    v_warehouse_id := nullif(v_line ->> 'warehouse_id', '')::uuid;
    v_crop_id := nullif(v_line ->> 'crop_id', '')::uuid;
    v_variety_id := nullif(v_line ->> 'variety_id', '')::uuid;
    v_reproduction_id := nullif(v_line ->> 'reproduction_id', '')::uuid;
    v_parent_batch_id := nullif(v_line ->> 'parent_batch_id', '')::uuid;
    v_hint_field_id := nullif(v_line ->> 'field_id', '')::uuid;
    v_quantity := nullif(v_line ->> 'quantity_kg', '')::numeric;
    v_moisture := nullif(v_line ->> 'moisture_percent', '')::numeric;
    v_dockage := nullif(v_line ->> 'dockage_percent', '')::numeric;
    v_batch_code := nullif(btrim(v_line ->> 'batch_code'), '');
    v_batch_name := nullif(btrim(v_line ->> 'batch_name'), '');
    v_origin_mode := lower(coalesce(nullif(btrim(v_line ->> 'origin_mode'), ''), 'explicit'));
    v_physical_state := upper(coalesce(nullif(btrim(v_line ->> 'physical_state'), ''), 'SOURCE'));
    v_sources := coalesce(v_line -> 'sources', '[]'::jsonb);

    if v_warehouse_id is null or v_crop_id is null or v_batch_code is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'Opening balance line % requires warehouse, crop, batch code and positive quantity', v_line_no using errcode = '22023';
    end if;
    if v_origin_mode not in ('explicit', 'auto', 'unknown') then
      raise exception 'Opening balance line % has unsupported origin mode', v_line_no using errcode = '22023';
    end if;
    if v_physical_state not in ('SOURCE','AFTER_CLEANING','AFTER_DRYING','COMMODITY_GRAIN','SCREENINGS','TRIER_WASTE','OTHER') then
      raise exception 'Opening balance line % has unsupported physical state', v_line_no using errcode = '22023';
    end if;
    if v_moisture is not null and (v_moisture < 0 or v_moisture > 100) then
      raise exception 'Opening balance line % moisture must be from 0 to 100', v_line_no using errcode = '23514';
    end if;
    if v_dockage is not null and (v_dockage < 0 or v_dockage > 100) then
      raise exception 'Opening balance line % dockage must be from 0 to 100', v_line_no using errcode = '23514';
    end if;
    if jsonb_typeof(v_sources) <> 'array' then
      raise exception 'Opening balance line % sources must be an array', v_line_no using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.warehouses w
      where w.id = v_warehouse_id and w.company_id = p_company_id
        and not coalesce(w.archived, false) and not coalesce(w.is_archived, false)
    ) then
      raise exception 'Opening balance line % warehouse is unavailable', v_line_no using errcode = '23503';
    end if;

    select coalesce(c.name_ru, c.name) into v_crop_name
    from public.crops c
    where c.id = v_crop_id and not coalesce(c.archived, false) and coalesce(c.is_active, true);
    if v_crop_name is null then
      raise exception 'Opening balance line % crop is unavailable', v_line_no using errcode = '23503';
    end if;

    v_variety_name := null;
    if v_variety_id is not null then
      select coalesce(v.name_ru, v.name) into v_variety_name
      from public.varieties v
      where v.id = v_variety_id and v.crop_id = v_crop_id
        and not coalesce(v.archived, false) and coalesce(v.is_active, true);
      if v_variety_name is null then
        raise exception 'Opening balance line % variety does not belong to the crop', v_line_no using errcode = '23514';
      end if;
    end if;

    v_reproduction_name := null;
    if v_reproduction_id is not null then
      select coalesce(sr.name_ru, sr.name, sr.code) into v_reproduction_name
      from public.seed_reproductions sr
      where sr.id = v_reproduction_id
        and not coalesce(sr.archived, false) and coalesce(sr.is_active, true);
      if v_reproduction_name is null then
        raise exception 'Opening balance line % reproduction is unavailable', v_line_no using errcode = '23503';
      end if;
    end if;

    if v_origin_mode = 'unknown' then
      if jsonb_array_length(v_sources) <> 0 or v_hint_field_id is not null then
        raise exception 'Opening balance line % unknown origin cannot contain field or crop-structure sources', v_line_no using errcode = '23514';
      end if;
    elsif v_origin_mode = 'auto' then
      if jsonb_array_length(v_sources) <> 0 then
        raise exception 'Opening balance line % auto origin cannot contain explicit sources', v_line_no using errcode = '23514';
      end if;
      select count(*)
        into v_source_count
      from public.crop_structure cs
      join public.fields f on f.id = cs.field_id
      where cs.company_id = p_company_id and cs.season_id = p_season_id
        and not coalesce(cs.archived, false) and not coalesce(f.archived, false)
        and coalesce(cs.land_use_type, 'crop') <> 'fallow'
        and not coalesce(cs.identity_review_required, false)
        and cs.crop_id is not distinct from v_crop_id
        and cs.variety_id is not distinct from v_variety_id
        and cs.reproduction_id is not distinct from v_reproduction_id
        and (v_hint_field_id is null or cs.field_id = v_hint_field_id);
      if v_source_count <> 1 then
        raise exception 'Opening balance line % source is ambiguous or absent; select exact crop_structure rows', v_line_no using errcode = '23514';
      end if;
      select cs.id, cs.field_id
        into v_single_crop_structure_id, v_single_field_id
      from public.crop_structure cs
      join public.fields f on f.id = cs.field_id
      where cs.company_id = p_company_id and cs.season_id = p_season_id
        and not coalesce(cs.archived, false) and not coalesce(f.archived, false)
        and coalesce(cs.land_use_type, 'crop') <> 'fallow'
        and not coalesce(cs.identity_review_required, false)
        and cs.crop_id is not distinct from v_crop_id
        and cs.variety_id is not distinct from v_variety_id
        and cs.reproduction_id is not distinct from v_reproduction_id
        and (v_hint_field_id is null or cs.field_id = v_hint_field_id)
      limit 1;
      v_sources := jsonb_build_array(jsonb_build_object('crop_structure_id', v_single_crop_structure_id, 'quantity_kg', null));
    else
      if jsonb_array_length(v_sources) = 0 then
        raise exception 'Opening balance line % requires at least one exact crop_structure source', v_line_no using errcode = '23514';
      end if;
    end if;

    v_source_count := jsonb_array_length(v_sources);
    v_source_sum := 0;
    v_source_with_quantity_count := 0;
    v_single_crop_structure_id := null;
    v_single_field_id := null;
    v_sources_snapshot := '[]'::jsonb;

    for v_source in select value from jsonb_array_elements(v_sources)
    loop
      select cs.id, cs.field_id
        into v_single_crop_structure_id, v_single_field_id
      from public.crop_structure cs
      join public.fields f on f.id = cs.field_id
      where cs.id = nullif(v_source ->> 'crop_structure_id', '')::uuid
        and cs.company_id = p_company_id and cs.season_id = p_season_id
        and f.company_id = p_company_id
        and not coalesce(cs.archived, false) and not coalesce(f.archived, false)
        and coalesce(cs.land_use_type, 'crop') <> 'fallow'
        and not coalesce(cs.identity_review_required, false)
        and cs.crop_id is not distinct from v_crop_id
        and cs.variety_id is not distinct from v_variety_id
        and cs.reproduction_id is not distinct from v_reproduction_id;
      if v_single_crop_structure_id is null then
        raise exception 'Opening balance line % source conflicts with company, season or crop identity', v_line_no using errcode = '23514';
      end if;

      v_source_quantity := nullif(v_source ->> 'quantity_kg', '')::numeric;
      if v_source_quantity is not null then
        if v_source_quantity <= 0 then
          raise exception 'Opening balance line % source quantity must be positive', v_line_no using errcode = '23514';
        end if;
        v_source_with_quantity_count := v_source_with_quantity_count + 1;
        v_source_sum := v_source_sum + v_source_quantity;
      end if;
      v_sources_snapshot := v_sources_snapshot || jsonb_build_array(jsonb_build_object(
        'crop_structure_id', v_single_crop_structure_id,
        'field_id', v_single_field_id,
        'quantity_kg', v_source_quantity
      ));
    end loop;

    if v_source_with_quantity_count not in (0, v_source_count) then
      raise exception 'Opening balance line % source quantities must be all known or all unknown', v_line_no using errcode = '23514';
    end if;
    if v_source_with_quantity_count = v_source_count and abs(v_source_sum - v_quantity) > 0.001 then
      raise exception 'Opening balance line % source quantities must equal line quantity', v_line_no using errcode = '23514';
    end if;

    if v_parent_batch_id is not null and not exists (
      select 1 from public.inventory_batches b
      where b.id = v_parent_batch_id and b.company_id = p_company_id
        and b.season_id = p_season_id
        and b.crop_id is not distinct from v_crop_id
        and b.variety_id is not distinct from v_variety_id
        and b.reproduction_id is not distinct from v_reproduction_id
    ) then
      raise exception 'Opening balance line % parent batch is unavailable or has a conflicting identity', v_line_no using errcode = '23514';
    end if;

    v_state_label := case v_physical_state
      when 'SOURCE' then 'с поля'
      when 'AFTER_CLEANING' then 'после очистки'
      when 'AFTER_DRYING' then 'после сушки'
      when 'COMMODITY_GRAIN' then 'товарное зерно'
      when 'SCREENINGS' then 'зерновая примесь'
      when 'TRIER_WASTE' then 'триерный отход'
      else 'другое состояние'
    end;
    v_batch_status := case v_physical_state
      when 'SOURCE' then 'raw'
      when 'AFTER_CLEANING' then 'conditioned'
      when 'AFTER_DRYING' then 'conditioned'
      when 'COMMODITY_GRAIN' then 'commodity'
      when 'SCREENINGS' then 'forage'
      when 'TRIER_WASTE' then 'waste'
      else 'commodity'
    end;
    v_batch_class := case v_physical_state
      when 'SCREENINGS' then 'feed'
      when 'TRIER_WASTE' then 'waste'
      else 'commodity'
    end;
    v_display_name := concat_ws(' · ', v_crop_name, v_variety_name, v_reproduction_name, v_state_label);
    v_identity_key := concat_ws(':', 'opening-balance-harvest-v1', v_crop_id,
      coalesce(v_variety_id::text, 'none'), coalesce(v_reproduction_id::text, 'none'), v_physical_state);

    insert into public.products (
      name, name_ru, type, product_type, product_form, user_id, company_id, unit, base_uom,
      accounting_mode, is_seed_material, is_active, archived, crop_id, variety_id,
      seed_reproduction_id, physical_state, is_derived_inventory, derived_identity_key, description
    ) values (
      v_display_name, v_display_name, 'produce', null, lower(v_physical_state),
      auth.uid(), p_company_id, 'kg', 'kg', 'bulk_mass', false, true, false,
      v_crop_id, v_variety_id, v_reproduction_id, 'solid', true, v_identity_key,
      'Каноническая identity начального складского остатка.'
    )
    on conflict (company_id, derived_identity_key)
      where is_derived_inventory and company_id is not null and derived_identity_key is not null
    do nothing;

    select p.id into v_product_id
    from public.products p
    where p.company_id = p_company_id
      and p.is_derived_inventory
      and p.derived_identity_key = v_identity_key
      and not coalesce(p.archived, false)
      and coalesce(p.is_active, true)
      and p.type = 'produce'
      and p.crop_id is not distinct from v_crop_id
      and p.variety_id is not distinct from v_variety_id
      and p.seed_reproduction_id is not distinct from v_reproduction_id;
    if v_product_id is null then
      raise exception 'Opening balance product identity conflicts with an existing catalog row' using errcode = '23514';
    end if;

    insert into public.inventory_batches (
      id, company_id, season_id, product_id, crop_id, variety_id, reproduction_id,
      source_field_id, crop_structure_id, batch_code, status, batch_class,
      parent_batch_id, origin_type, origin_ref_id, initial_weight_kg, current_weight_kg,
      moisture_percent, dockage_percent, treatment_status, initial_quantity, current_quantity,
      uom, mass_kg, unit_source, unit_contract_version, warehouse_id, received_at,
      source_type, composition_snapshot, composition_hash, display_name, is_mixed_harvest, physical_state
    ) values (
      v_batch_id, p_company_id, p_season_id, v_product_id, v_crop_id, v_variety_id, v_reproduction_id,
      case when v_source_count = 1 then v_single_field_id else null end,
      case when v_source_count = 1 then v_single_crop_structure_id else null end,
      v_batch_code, v_batch_status, v_batch_class, v_parent_batch_id,
      'opening_balance', v_line_id, v_quantity, v_quantity, v_moisture, v_dockage,
      'not_applicable', v_quantity, v_quantity, 'kg', v_quantity,
      'warehouse_opening_balance_v1', 2, v_warehouse_id, p_snapshot_at,
      case when v_origin_mode = 'unknown' then 'opening_balance_unknown_origin' else 'opening_balance' end,
      v_sources_snapshot, md5(v_sources_snapshot::text), coalesce(v_batch_name, v_display_name),
      v_source_count > 1, v_physical_state
    );

    insert into public.harvest_lots (
      id, company_id, lot_code, season_id, source_field_id, crop_id, variety_id,
      reproduction_id, composition_hash, identity_kind, identity_key,
      review_state, review_reasons, resolution_locked, status
    ) values (
      v_lot_id, p_company_id, v_batch_code, p_season_id,
      case when v_source_count = 1 then v_single_field_id else null end,
      v_crop_id, v_variety_id, v_reproduction_id, md5(v_sources_snapshot::text),
      'crop', 'opening-balance:' || v_line_id::text,
      case when v_origin_mode = 'unknown' then 'requires_review' else 'confirmed' end,
      case when v_origin_mode = 'unknown' then array['opening_balance_origin_unknown']::text[] else array[]::text[] end,
      v_origin_mode <> 'unknown', 'active'
    );

    insert into public.harvest_lot_batches (
      company_id, harvest_lot_id, inventory_batch_id, source_ticket_id,
      crop_structure_id, assigned_by, assignment_reason
    ) values (
      p_company_id, v_lot_id, v_batch_id, null,
      case when v_source_count = 1 then v_single_crop_structure_id else null end,
      p_actor_profile_id, 'warehouse_opening_balance_v1'
    );

    insert into public.stock_ledger_entries (
      id, company_id, ticket_id, processing_id, product_id, crop_id, variety_id, reproduction_id,
      batch_id, batch_id_text, batch_class, inventory_batch_id, warehouse_id,
      direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id,
      occurred_at, created_by, notes, mass_kg, unit_source, unit_contract_version
    ) values (
      v_ledger_id, p_company_id, null, null, v_product_id, v_crop_id, v_variety_id, v_reproduction_id,
      v_batch_id::text, v_batch_id::text, v_batch_class, v_batch_id, v_warehouse_id,
      'in', v_quantity, 'kg', v_quantity, 'warehouse_opening_balance', v_line_id,
      p_snapshot_at, p_actor_profile_id,
      coalesce(nullif(btrim(v_line ->> 'notes'), ''), 'Начальный остаток ' || v_batch_code),
      v_quantity, 'warehouse_opening_balance_v1', 2
    );

    insert into public.warehouse_opening_balance_lines (
      id, document_id, company_id, season_id, line_no, warehouse_id,
      inventory_batch_id, harvest_lot_id, ledger_entry_id, product_id, crop_id,
      variety_id, reproduction_id, batch_code, batch_name, quantity_kg,
      physical_state, origin_mode, source_count, source_quantities_known,
      parent_batch_id, moisture_percent, dockage_percent, notes
    ) values (
      v_line_id, v_document_id, p_company_id, p_season_id, v_line_no, v_warehouse_id,
      v_batch_id, v_lot_id, v_ledger_id, v_product_id, v_crop_id,
      v_variety_id, v_reproduction_id, v_batch_code, v_batch_name, v_quantity,
      v_physical_state, v_origin_mode, v_source_count,
      v_source_count > 0 and v_source_with_quantity_count = v_source_count,
      v_parent_batch_id, v_moisture, v_dockage, nullif(btrim(v_line ->> 'notes'), '')
    );

    for v_source in select value from jsonb_array_elements(v_sources_snapshot)
    loop
      insert into public.warehouse_opening_balance_line_sources (
        opening_balance_line_id, company_id, season_id, crop_structure_id, field_id, quantity_kg
      ) values (
        v_line_id, p_company_id, p_season_id,
        (v_source ->> 'crop_structure_id')::uuid,
        (v_source ->> 'field_id')::uuid,
        nullif(v_source ->> 'quantity_kg', '')::numeric
      );
    end loop;

    if not exists (
      select 1
      from public.inventory_batches b
      join public.stock_ledger_entries sle on sle.inventory_batch_id = b.id
      join public.harvest_lot_batches hlb on hlb.inventory_batch_id = b.id
      where b.id = v_batch_id and b.company_id = p_company_id
        and b.source_ticket_id is null and sle.ticket_id is null
        and sle.id = v_ledger_id and sle.reason_type = 'warehouse_opening_balance'
        and abs(sle.delta_qty_signed - v_quantity) <= 0.001
        and abs(b.current_quantity - v_quantity) <= 0.001
        and hlb.harvest_lot_id = v_lot_id
    ) then
      raise exception 'Opening balance line % accounting postcondition failed', v_line_no using errcode = '23514';
    end if;

    v_response_lines := v_response_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_line_no,
      'line_id', v_line_id,
      'batch_id', v_batch_id,
      'harvest_lot_id', v_lot_id,
      'ledger_entry_id', v_ledger_id,
      'batch_code', v_batch_code,
      'quantity_kg', v_quantity,
      'source_count', v_source_count,
      'source_quantities_known', v_source_count > 0 and v_source_with_quantity_count = v_source_count
    ));
  end loop;

  if v_line_no <> jsonb_array_length(p_lines)
     or (select count(*) from public.warehouse_opening_balance_lines l where l.document_id = v_document_id) <> v_line_no then
    raise exception 'Opening balance document postcondition failed' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'ok', true,
    'document_id', v_document_id,
    'document_no', btrim(p_document_no),
    'season_id', p_season_id,
    'snapshot_at', p_snapshot_at,
    'line_count', v_line_no,
    'lines', v_response_lines,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_warehouse_opening_balance_atomic_v1(
  uuid, uuid, uuid, uuid, text, timestamptz, text, jsonb, text, text
) from public, anon, service_role;
grant execute on function public.create_warehouse_opening_balance_atomic_v1(
  uuid, uuid, uuid, uuid, text, timestamptz, text, jsonb, text, text
) to authenticated;
