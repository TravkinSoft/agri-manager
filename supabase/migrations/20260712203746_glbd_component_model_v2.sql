-- TZ No. 128 - PRODUCTION APPLY CANDIDATE / OWNER REVIEW ONLY
-- TARGET: Supabase project bhsemlvmkikpntabctml, PostgreSQL 17.6.
-- DO NOT APPLY without explicit TZ No. 129 owner approval, fresh backup and live preflight.
-- Legacy tables and app reads remain unchanged.
-- Source isolated test: TZ No. 127 PASS_ISOLATED_TEST.

begin;

-- BLOCK 0: production identity and count stop gates.
-- The operator must also confirm project ref bhsemlvmkikpntabctml outside SQL.
set local lock_timeout = '10s';
set local statement_timeout = '10min';
select pg_advisory_xact_lock(hashtext('glbd_component_model_v2_comp1'));

do $preflight$
declare
  v_count bigint;
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'PostgreSQL 15+ is required for security_invoker views';
  end if;

  if to_regclass('public.glbd_components') is not null
     or to_regclass('public.glbd_component_aliases') is not null
     or to_regclass('public.glbd_component_sources') is not null
     or to_regclass('public.glbd_product_components') is not null
     or to_regclass('public.glbd_active_ingredients_v2_compat') is not null then
    raise exception 'One or more V2 relations already exist';
  end if;

  if exists (
    select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public'
      and t.typname in ('glbd_component_type','glbd_form_type','glbd_review_status','glbd_source_type','glbd_role_in_product')
  ) then
    raise exception 'One or more V2 enum types already exist';
  end if;

  if to_regprocedure('public.ensure_updated_at_column()') is null then
    raise exception 'Required ensure_updated_at_column() helper is missing';
  end if;

  select count(*) into v_count from public.active_ingredients;
  if v_count <> 425 then raise exception 'active_ingredients drift: %', v_count; end if;

  select count(*) into v_count from public.active_ingredients where coalesce(is_active,true) and not coalesce(archived,false);
  if v_count <> 415 then raise exception 'active active_ingredients drift: %', v_count; end if;

  select count(*) into v_count from public.active_ingredients where coalesce(archived,false);
  if v_count <> 10 then raise exception 'archived active_ingredients drift: %', v_count; end if;

  select count(*) into v_count from public.products where company_id is null;
  if v_count <> 1225 then raise exception 'global products drift: %', v_count; end if;

  select count(*) into v_count from public.products where company_id is not null;
  if v_count <> 6 then raise exception 'company products drift: %', v_count; end if;

  select count(*) into v_count
  from public.product_active_ingredients pai join public.products p on p.id=pai.product_id
  where p.company_id is null;
  if v_count <> 1373 then raise exception 'global product links drift: %', v_count; end if;

  select count(*) into v_count
  from public.product_active_ingredients pai join public.products p on p.id=pai.product_id
  where p.company_id is not null;
  if v_count <> 0 then raise exception 'company product links found: %', v_count; end if;

  select count(*) into v_count
  from public.product_active_ingredients pai left join public.active_ingredients ai on ai.id=pai.active_ingredient_id
  where ai.id is null;
  if v_count <> 0 then raise exception 'legacy AI orphans found: %', v_count; end if;

  select count(*) into v_count
  from public.product_active_ingredients pai left join public.products p on p.id=pai.product_id
  where p.id is null;
  if v_count <> 0 then raise exception 'legacy product orphans found: %', v_count; end if;

  select count(*) into v_count from (
    select product_id,active_ingredient_id,count(*)
    from public.product_active_ingredients group by 1,2 having count(*)>1
  ) d;
  if v_count <> 0 then raise exception 'duplicate legacy product/AI pairs found: %', v_count; end if;
end;
$preflight$;

-- BLOCKS 1-3: additive schema, RLS/guards, 425 component backfill and 1373 global-link backfill.
create type public.glbd_component_type as enum (
  'active_ingredient', 'safener', 'synergist', 'biological_component',
  'formulation_component', 'unknown_component'
);

create type public.glbd_form_type as enum (
  'parent', 'acid', 'salt', 'ester', 'isomer', 'mixture', 'hydrate', 'other'
);

create type public.glbd_review_status as enum (
  'draft', 'needs_source', 'needs_owner_review', 'approved', 'rejected', 'archived'
);

create type public.glbd_source_type as enum (
  'official_label', 'official_registry', 'manufacturer_site', 'distributor_catalog',
  'internal_existing_data', 'owner_verified', 'needs_source'
);

create type public.glbd_role_in_product as enum (
  'active', 'safener', 'synergist', 'biological_agent', 'formulation_component'
);

create table public.glbd_components (
  id uuid primary key default gen_random_uuid(),
  legacy_active_ingredient_id uuid unique references public.active_ingredients(id) on delete restrict,
  component_type public.glbd_component_type not null,
  name_ru text not null,
  name_en text,
  canonical_name text not null,
  normalized_key text not null,
  parent_component_id uuid references public.glbd_components(id) on delete restrict,
  form_type public.glbd_form_type not null default 'parent',
  chemical_class text,
  biological_organism text,
  biological_species text,
  biological_strain text,
  biological_titer_value numeric,
  biological_titer_unit text,
  review_status public.glbd_review_status not null default 'draft',
  source_status public.glbd_source_type not null default 'needs_source',
  is_active boolean not null default true,
  archived_at timestamptz,
  archived_reason text,
  replaced_by_id uuid references public.glbd_components(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_components_parent_not_self check (parent_component_id is null or parent_component_id <> id),
  constraint glbd_components_replacement_not_self check (replaced_by_id is null or replaced_by_id <> id),
  constraint glbd_components_titer_nonnegative check (biological_titer_value is null or biological_titer_value >= 0),
  constraint glbd_components_titer_pair check ((biological_titer_value is null) = (biological_titer_unit is null)),
  constraint glbd_components_archive_fields check (
    (archived_at is null and archived_reason is null)
    or (archived_at is not null and archived_reason is not null and is_active = false)
  ),
  constraint glbd_components_archive_status check ((review_status = 'archived') = (archived_at is not null)),
  constraint glbd_components_names_not_blank check (btrim(name_ru) <> '' and btrim(canonical_name) <> '' and btrim(normalized_key) <> '')
);

create table public.glbd_component_sources (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.glbd_components(id) on delete cascade,
  source_type public.glbd_source_type not null,
  source_url text,
  source_title text not null,
  claim_scope text not null,
  confidence numeric(5,4) not null default 0,
  checked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  constraint glbd_component_sources_confidence check (confidence between 0 and 1),
  constraint glbd_component_sources_text_not_blank check (btrim(source_title) <> '' and btrim(claim_scope) <> ''),
  constraint glbd_component_sources_id_component_unique unique (id, component_id)
);

create table public.glbd_component_aliases (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.glbd_components(id) on delete cascade,
  alias_text text not null,
  normalized_text text not null,
  language text,
  alias_type text not null,
  confidence numeric(5,4) not null default 0,
  source_id uuid,
  created_at timestamptz not null default now(),
  constraint glbd_component_aliases_confidence check (confidence between 0 and 1),
  constraint glbd_component_aliases_text_not_blank check (btrim(alias_text) <> '' and btrim(normalized_text) <> ''),
  constraint glbd_component_aliases_language check (language is null or language in ('ru', 'en', 'la', 'und')),
  constraint glbd_component_aliases_type check (alias_type in ('canonical', 'translation', 'synonym', 'chemical_form', 'trade_variant', 'legacy', 'abbreviation', 'transliteration', 'other')),
  constraint glbd_component_aliases_source_component_fk
    foreign key (source_id, component_id)
    references public.glbd_component_sources(id, component_id)
    on delete restrict
);

create table public.glbd_product_components (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  component_id uuid not null references public.glbd_components(id) on delete restrict,
  legacy_product_active_ingredient_id uuid unique references public.product_active_ingredients(id) on delete restrict,
  role_in_product public.glbd_role_in_product not null,
  concentration_value numeric,
  concentration_unit text,
  concentration_text text,
  equivalent_basis text,
  is_primary_active boolean not null default false,
  source_id uuid,
  confidence numeric(5,4) not null default 0,
  review_status public.glbd_review_status not null default 'draft',
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_components_concentration_nonnegative check (concentration_value is null or concentration_value >= 0),
  constraint glbd_product_components_concentration_pair check ((concentration_value is null) = (concentration_unit is null)),
  constraint glbd_product_components_confidence check (confidence between 0 and 1),
  constraint glbd_product_components_sort_order check (sort_order > 0),
  constraint glbd_product_components_source_component_fk
    foreign key (source_id, component_id)
    references public.glbd_component_sources(id, component_id)
    on delete restrict
);

create unique index ux_glbd_components_normalized_active
  on public.glbd_components (lower(normalized_key))
  where archived_at is null and is_active = true;
create index ix_glbd_components_type_active
  on public.glbd_components (component_type)
  where archived_at is null and is_active = true;
create index ix_glbd_components_parent on public.glbd_components (parent_component_id) where parent_component_id is not null;
create unique index ux_glbd_component_aliases_normalized
  on public.glbd_component_aliases (component_id, lower(normalized_text), coalesce(language, 'und'));
create index ix_glbd_component_aliases_lookup on public.glbd_component_aliases (lower(normalized_text));
create index ix_glbd_component_sources_component on public.glbd_component_sources (component_id);
create index ix_glbd_product_components_product on public.glbd_product_components (product_id)
  where review_status not in ('archived', 'rejected');
create index ix_glbd_product_components_component on public.glbd_product_components (component_id)
  where review_status not in ('archived', 'rejected');
create unique index ux_glbd_product_components_active_role
  on public.glbd_product_components (product_id, component_id, role_in_product)
  where review_status not in ('archived', 'rejected');

create trigger trg_glbd_components_updated_at
before update on public.glbd_components
for each row execute function public.ensure_updated_at_column();

create trigger trg_glbd_product_components_updated_at
before update on public.glbd_product_components
for each row execute function public.ensure_updated_at_column();

create function public.glbd_guard_component_archive()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (new.archived_at is not null or new.review_status = 'archived')
     and (old.archived_at is null and old.review_status <> 'archived')
     and exists (
       select 1 from public.glbd_product_components pc
       where pc.component_id = new.id
         and pc.review_status not in ('archived', 'rejected')
     ) then
    raise exception 'Cannot archive component % while active product links exist', new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.glbd_guard_component_archive() from public, anon, authenticated;
grant execute on function public.glbd_guard_component_archive() to service_role;

create trigger trg_glbd_guard_component_archive
before update of archived_at, review_status on public.glbd_components
for each row execute function public.glbd_guard_component_archive();

create function public.glbd_validate_product_component()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  resolved_type public.glbd_component_type;
  resolved_active boolean;
  resolved_archived_at timestamptz;
begin
  if not exists (
    select 1 from public.products p
    where p.id = new.product_id and p.company_id is null
  ) then
    raise exception 'glbd_product_components accepts global products only: %', new.product_id;
  end if;

  select c.component_type, c.is_active, c.archived_at
    into resolved_type, resolved_active, resolved_archived_at
  from public.glbd_components c
  where c.id = new.component_id;

  if resolved_type is null or not resolved_active or resolved_archived_at is not null then
    raise exception 'Component % is missing, inactive, or archived', new.component_id;
  end if;

  if not (
    (resolved_type = 'active_ingredient' and new.role_in_product = 'active')
    or (resolved_type = 'safener' and new.role_in_product = 'safener')
    or (resolved_type = 'synergist' and new.role_in_product = 'synergist')
    or (resolved_type = 'biological_component' and new.role_in_product = 'biological_agent')
    or (resolved_type = 'formulation_component' and new.role_in_product = 'formulation_component')
    or (
      resolved_type = 'unknown_component'
      and new.role_in_product = 'active'
      and new.review_status in ('draft', 'needs_source', 'needs_owner_review')
    )
  ) then
    raise exception 'Role % is incompatible with component type %', new.role_in_product, resolved_type;
  end if;

  if resolved_type = 'unknown_component' and new.review_status in ('approved', 'archived') then
    raise exception 'Unknown components cannot be approved or archived through product links';
  end if;

  return new;
end;
$$;

revoke all on function public.glbd_validate_product_component() from public, anon, authenticated;
grant execute on function public.glbd_validate_product_component() to service_role;

create trigger trg_glbd_validate_product_component
before insert or update of product_id, component_id, role_in_product, review_status
on public.glbd_product_components
for each row execute function public.glbd_validate_product_component();

alter table public.glbd_components enable row level security;
alter table public.glbd_component_sources enable row level security;
alter table public.glbd_component_aliases enable row level security;
alter table public.glbd_product_components enable row level security;

revoke all on table public.glbd_components, public.glbd_component_sources,
  public.glbd_component_aliases, public.glbd_product_components from anon, authenticated;
grant usage on type public.glbd_component_type, public.glbd_form_type,
  public.glbd_review_status, public.glbd_source_type, public.glbd_role_in_product
  to anon, authenticated, service_role;
grant select on table public.glbd_components, public.glbd_component_aliases,
  public.glbd_product_components to anon, authenticated;
grant select (id, component_id, source_type, source_url, source_title, claim_scope, confidence, checked_at, created_at)
  on public.glbd_component_sources to anon, authenticated;
grant all on table public.glbd_components, public.glbd_component_sources,
  public.glbd_component_aliases, public.glbd_product_components to service_role;

create policy glbd_components_read_approved
on public.glbd_components for select to anon, authenticated
using (review_status = 'approved' and is_active = true and archived_at is null);

create policy glbd_component_sources_read_approved
on public.glbd_component_sources for select to anon, authenticated
using (
  source_type <> 'needs_source'
  and exists (
    select 1 from public.glbd_components c
    where c.id = glbd_component_sources.component_id
      and c.review_status = 'approved' and c.is_active = true and c.archived_at is null
  )
);

create policy glbd_component_aliases_read_approved
on public.glbd_component_aliases for select to anon, authenticated
using (
  exists (
    select 1 from public.glbd_components c
    where c.id = glbd_component_aliases.component_id
      and c.review_status = 'approved' and c.is_active = true and c.archived_at is null
  )
);

create policy glbd_product_components_read_approved
on public.glbd_product_components for select to anon, authenticated
using (
  review_status = 'approved'
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_components.product_id
      and p.company_id is null and coalesce(p.is_active, true) = true and coalesce(p.archived, false) = false
  )
  and exists (
    select 1 from public.glbd_components c
    where c.id = glbd_product_components.component_id
      and c.review_status = 'approved' and c.is_active = true and c.archived_at is null
  )
);

create view public.glbd_active_ingredients_v2_compat
with (security_invoker = true)
as
select
  coalesce(c.legacy_active_ingredient_id, c.id) as id,
  c.id as glbd_component_id,
  c.name_ru,
  c.name_en,
  c.normalized_key as slug,
  'pesticide_ai'::text as ingredient_type,
  c.is_active,
  (c.archived_at is not null) as archived,
  c.created_at,
  c.updated_at
from public.glbd_components c
where c.component_type = 'active_ingredient'
  and c.review_status = 'approved'
  and c.is_active = true
  and c.archived_at is null;

revoke all on public.glbd_active_ingredients_v2_compat from public;
grant select on public.glbd_active_ingredients_v2_compat to anon, authenticated, service_role;

-- SECTION B: 425 COMPONENT BACKFILL PREVIEW
-- PREVIEW DATA BLOCK: execute only after schema apply is separately approved.
-- The exact 425-row classification is embedded from the TZ-125 migration map.
-- Parent/form relationships are intentionally NOT applied in GLBD-COMP-1; they stay for GLBD-COMP-3.
with migration_map (
  legacy_id, proposed_component_type, proposed_form_type, proposed_parent_legacy_id, needs_source
) as (
values
  ('6256488c-67f7-43e2-8dcb-33ee3f4c33a2'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('02edd07d-0fd7-4a6a-bc02-936edc1340d0'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('0aa0e29c-1250-404f-bb61-f0243703aada'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('84245974-5611-4fc6-a4c4-d7b3dfdb998a'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('a71ee39b-e4d0-4d8a-bcec-4436513905f8'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('f2094f9f-3f7a-4112-a71b-7a5f7da7f964'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('6b40c9bd-bb8d-4526-a75d-fea5703c6a0e'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('e9da84ac-0a74-4fce-bc6c-042facbd7324'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('84497a18-c37a-4356-8b69-317c1a0f8623'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('aaf6484a-a808-4d50-92c5-27927fd8fe10'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('6c69e596-6d42-44ef-a30f-a34a0743d556'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('9d4a447d-3ff5-4d59-86f2-35e7c97c9682'::uuid, 'unknown_component'::public.glbd_component_type, 'salt'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('06fd072f-a327-4619-8373-6be4a021e79d'::uuid, 'unknown_component'::public.glbd_component_type, 'salt'::public.glbd_form_type, '3fb693c0-d838-4d74-8a7a-3865c67a60e4'::uuid, true),
  ('95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a45440e7-2d26-42cc-9caf-6adab291212c'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('010defb3-f9c1-4482-82d8-dac1731d6418'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('bc5011f7-0ddb-49f0-84e4-5ade1b4e482b'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('ffcec372-61ab-408b-820e-11edddf94c39'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('13775b43-a114-419d-aded-02e5625bbeba'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('dac1bf4f-d5be-43ce-8325-2871f83613b5'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('8c66cf37-103c-41ed-9bd1-df458abd6d41'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('e0dedc29-e4f4-4cb1-aedd-922c17686539'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('acf82e4b-4223-40b0-b1ed-896d8f09a27e'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('e073851a-c30e-4efe-a386-234c045b71bb'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('1bf09024-074d-410d-b9e0-409adec79a77'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('b8cd395d-ed76-4693-9eec-9e5b57345e3d'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('597adace-7873-4d5d-8f6a-6f2c1436f86f'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('e06af077-0cee-42fe-9c53-696dd8e10ac5'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('4fa4f6d8-bc97-4a01-92cc-3a53810b66c3'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('d4758897-5b6f-4fcf-99de-aeb36d86504d'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('3e45e6e3-89e7-480f-80ce-a72d39420ac0'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('bd72a5b7-5467-47ec-b19e-9dc7a2f9ed60'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('fc1d6c7c-a95e-4728-8205-0eebd85d85a5'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('565534b5-b9fd-4417-ae4f-15c8bc1b3c38'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('1c95731a-8f9d-4561-9a05-fc2092ae6bd0'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('af7bea8a-7472-4d62-a720-32dec1263cad'::uuid, 'biological_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('a563e05b-44d1-47c7-be6e-d9cd6162433e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('9bdc39d0-40c4-4e45-b87b-4aa1370907a2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('e29cc3b9-c9ce-45b9-9dd5-66018be450e8'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('9e5d460c-8369-4cfd-b058-0fb246bdfb03'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('717b5401-cc8e-4cc1-a212-e78db6091f92'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('a471f3ad-09ea-4b39-951a-d9e7a76a1e3f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('d5bc678f-00fe-4839-944f-b47a0fa0ce47'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('1a3db8d7-c2f3-4e4b-9964-ab64a526d9dc'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('60a28d27-b6ad-4dfe-84e8-ed919f17b761'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('486c6e6a-7de8-4563-afe3-86a91182fc74'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('2032f490-f80d-451d-b596-070c0beeb5a8'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('3ec7b235-f1e1-4e00-a463-5a39b855967d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('5655d235-7689-45c2-bbb7-e1ba6e4e89b7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('ea3d1cc8-4668-44b8-ae3f-91ebf329c627'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('c97cf501-3aed-4d11-8e24-a5cb8c973ffb'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('0f4d4e49-fc04-42eb-aa46-d24067c60c6f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('0efdc699-1a44-422d-a85b-a13716fa48b4'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('7372e5cf-2b22-4f40-a6cd-09d72ce3dc54'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('dc03d25c-a3b7-4e55-a86b-4352262c03e2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('bbbf0819-15d4-4245-a224-1405805424a4'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('332a7c84-a167-4e84-af93-fce405303ab2'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('92a9a690-ba6d-4566-885e-85bb53628704'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('216aa8dc-8d6d-44f9-a52f-846d382483e3'::uuid, 'active_ingredient'::public.glbd_component_type, 'salt'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('f1008de0-fed7-4fdb-98fa-451bb73987bf'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('cbd55690-ce5a-4925-b9c1-71e286d5e59e'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('ca7800d4-e389-4970-bab8-42e62b9aefac'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('ffbee108-df03-44b6-ab57-1868c904fc2d'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('f9251d74-05d9-4c56-a086-9ba82582841e'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('03182d84-46dd-4f47-8b4a-bafe81dbd00d'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('40363e72-4927-4c4f-a972-1739cc05072e'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, 'cb51eee1-2ed0-4981-8d88-2af3d6785909'::uuid, true),
  ('7f2b368f-b1b1-4c0f-ace4-9fa01dbe8b3a'::uuid, 'active_ingredient'::public.glbd_component_type, 'acid'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('a5c2970c-e83e-48d7-af49-abf566605a2c'::uuid, 'active_ingredient'::public.glbd_component_type, 'acid'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('33c62d39-47f5-4a64-ac55-75f0b0d79d4d'::uuid, 'active_ingredient'::public.glbd_component_type, 'acid'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('4e3dd17a-7bdf-4a04-b4d8-0ad26d032e2b'::uuid, 'active_ingredient'::public.glbd_component_type, 'mixture'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('f59d1e0c-ac16-4fab-aa3c-d943705111d4'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('7a96c4ff-a890-451e-8ea4-964ff62181da'::uuid, 'active_ingredient'::public.glbd_component_type, 'salt'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('103b38b7-7643-4717-8741-a89b40ebb956'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('66940e59-adff-481b-8f2d-5299843b292c'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('f04d9ca8-8068-4d65-ac11-b42218400d34'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('76f206f4-1d4a-47e6-929b-bce5e4a8f6ed'::uuid, 'active_ingredient'::public.glbd_component_type, 'salt'::public.glbd_form_type, '95121f0a-b149-4338-ba2e-981d4c09c8cc'::uuid, true),
  ('a24de196-b79d-4580-9181-19d00a2161b2'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, '42f30fc4-ee42-47be-833f-a0b4977c79d2'::uuid, true),
  ('310c78b4-6075-4b0e-8fcf-13ee3f22e891'::uuid, 'active_ingredient'::public.glbd_component_type, 'ester'::public.glbd_form_type, 'cb51eee1-2ed0-4981-8d88-2af3d6785909'::uuid, true),
  ('61854b1e-9b15-42eb-9006-48be400dba35'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1abe8c85-7c6d-4a08-ad18-15c360366743'::uuid, 'unknown_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('369a1f8d-74b8-4609-b75a-890a84f20d10'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1259948a-5feb-498c-a643-86bac3b7a94c'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('af92d7a0-2624-46be-8711-85757ffe4534'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('095dd74f-a026-4513-accb-8f149b3e378f'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f5de3d49-214c-499f-a2ba-07596b5fe8ce'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('adf759ac-01bf-4bbe-b50c-28cf2eea973e'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('116dcd5d-7b46-4a71-bd2e-be11cd6648bd'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7382df7d-4b87-4ddc-964c-9125c8bdbcbe'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0afa5060-de5b-4d05-91fb-9551433aec50'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('89c6ac02-28d9-4d4b-ac74-b5afc0797994'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4b66af7c-dd57-418c-8a76-b325d8294979'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f4c2835e-4a56-4fa5-b7e8-eeaf332b4a01'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5584ba5d-2e47-4a77-b2f6-17375f6875b7'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('845c7404-e5b9-473a-aa0a-482ec032d432'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9c75a546-a53f-460a-9827-a57033db1217'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('80758f1c-8e71-472b-8a9d-65a9b78ed332'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fa4b045b-8c1a-4f53-97a8-ccc9bfe32ea6'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f2ec745b-d4f2-4213-8616-808d87c89bfc'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0baeb059-8782-4b69-bd6c-c675341d095d'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2b1bbc4c-f64e-4548-b635-3c4f02db5a35'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fde952df-553f-4bca-b9d8-a74335ff33e8'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5fc74991-2c25-4e2f-b882-11340a393cbb'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1073a7c9-de8f-473a-805d-828311b4d9cb'::uuid, 'safener'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('98f8b7e5-9d30-4ed6-b4bd-ce14d6f68567'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('4664507a-80f0-4c79-80dd-03e1dc9d9ee0'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('b2c9e196-2930-4684-8cea-8f821e67fac1'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('875a5831-1111-442e-9adc-a3f2a201a8a3'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('d43be320-6eb2-4a62-bdc8-01d48db68891'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('c9dd66f1-b0c8-45fa-9379-4bc74d5a8268'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('f7944639-915a-4ebc-af25-61b44dea1aa9'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('630f9657-c25c-417f-a907-e57aad020696'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('aa7189bf-874f-4dda-b363-a8f256ef25a4'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('bd3e96f0-8db7-4aa5-8551-96c51e903b43'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('d241b4f8-7826-4ce5-8108-02b082af3b70'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('9a85d3d0-1723-4323-ae81-a62a94bfd927'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3c30aabf-38ce-43d9-8b6f-ac2f5f4561ed'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f877aa19-3db5-4846-aacc-51a248bb3d72'::uuid, 'formulation_component'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f69bb83c-c688-4315-8517-63ab2f29f836'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('42e35997-1fad-4c04-9bda-9752dc5b3ec7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('cd6fd05f-f4c4-4bff-b058-9a007e82f127'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, true),
  ('4fa29b23-2aff-4eda-94ee-ee9b7d910c16'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('52d2d6e1-d434-4ffb-b58b-590083d64dad'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('81117cc9-56ad-46d9-82b1-94d1cf38ebdf'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e626f8bc-d90d-436b-ab4d-6e7b1642132d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e9dea482-fae4-45b5-93eb-345417309526'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fc8173e7-b202-442e-bd12-4544778a529d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d61d183c-deac-4c6f-8a36-9b680f876d6e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('db784423-e452-4cdd-8409-0bedae64f85e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('82340142-d114-4f1c-a917-7a974e7db941'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c5d2a483-306d-4b77-b2a2-ce8e9739c5ef'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ef091ebd-ea1f-4719-8acc-bbbd4daa1043'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b7c4641c-caa6-4dff-981d-3b8cb4a559a2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d8a6561a-653f-457c-a7cf-a8bbf110a5df'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9a420c71-554a-4b5f-890c-2e235df5bbde'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0a88555b-bc83-4dfd-aea3-d2730abe188c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('604fbb48-1a20-412b-b87a-f72f174138fc'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('08d53d04-0fb9-4bf0-8ca3-382613611259'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('826d8e88-2681-433a-bbca-60044d4cd619'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c607784c-24e9-4ef2-84fa-3773a647a69b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('695e4280-705a-4dcb-903e-abb39ee4584b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a8709e08-d71a-4b34-a30c-b1ade4152cf7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2ada2ba9-5504-437b-bef8-47a38e453dde'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('81a0a3bb-4efc-40f1-a750-106f4feb7643'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ab9628a3-e03b-4b1a-8e37-4bd9c66c1b65'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3e3a233e-404e-4f4c-8102-c249cc233c82'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3e1bbb6d-13db-4acd-8a57-e4521d71484e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7f27a13a-c6e9-465c-bbc6-9a285a9fd329'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8bebace2-7826-4ead-9bf6-d1c1e4ff4c89'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('42531d9c-f934-40bf-a414-220552d9e16e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fa659bfa-5a35-418f-aae6-2c6fb47746b0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7a458621-f4eb-4b43-8256-266a1920992b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6dd2c84a-52dc-4579-b8dc-e85a2043efb5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('80170d45-a55f-479b-ac05-dd4c4d9f7ed5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3fb693c0-d838-4d74-8a7a-3865c67a60e4'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('42f30fc4-ee42-47be-833f-a0b4977c79d2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1b4dab77-2e95-4a71-97f9-17c53bf7d0fa'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3f9d6403-7208-4ba3-b5c9-4f8d423e6582'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('cb51eee1-2ed0-4981-8d88-2af3d6785909'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('41ed735f-79c0-4b1c-9a50-c540433e726c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e7a5cbb3-d2c9-4e20-a42e-205cf79e4059'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('eb9a6c8f-574a-408e-9c51-9dfb44efccf2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5f5b4e86-db02-42d5-887e-04d6dbb86ea5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fe532c6d-cdc7-4538-a666-9fa438119f35'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2ca7ebaf-e1c4-402e-af46-c7ae11d0df99'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1901b809-6b94-48c0-8fde-6099c3e206d3'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('bca23682-7e4b-46da-9a77-24b538379e16'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('45655a91-ee48-48e7-93d0-fe71656de27e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4fd6d64c-4f0f-4b4f-9de0-200b9c1d319a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('dfecf253-ea9f-4bb4-88fd-42f0b5050b43'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d6e1b996-ea67-40c9-8b1e-bc718798f23a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('653243fc-db99-49e9-bb01-eff59d5ad949'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('49b35432-abcb-45e6-b58f-66c1d2fe5695'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d6487c44-2d7a-4b20-aa6e-053db1543488'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('83ec87e5-6c9b-401e-8a31-fc42321a40e0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b3e72df1-1444-4692-b48d-53eb97e390cf'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('44870173-0046-448d-b6a8-3a9789570e42'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('45a7496b-0987-4a29-a45b-9aaf9380246b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c869c318-71b6-40bc-aa0c-ed5675547659'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('feec0d2f-fcdf-4103-9420-856e44c259f5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('105f9951-a742-4062-90fb-ce08a02233a1'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7b2e7b20-5779-4396-a685-ce19f1308601'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9652c08a-101a-4388-99fb-b947f117f116'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('bb99cee6-8b22-438a-9c24-992f1270f448'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c2486d26-3897-4cef-9e42-3f6779ae0c85'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5b642f5b-9d88-4fa3-8534-a9aedb6e288b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('42e027fa-06e9-4c45-8600-4e0df684b2dd'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('53037863-4a2c-4acc-a89a-9b60ed830260'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('51d739e9-0a28-4839-acdf-2fd8b019ea98'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('95d2ee04-8607-40e2-a651-73d1dfd8d7cd'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d1960313-4658-40c5-8bb2-85d1827cb02b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fba454af-3e88-4bbc-a576-406f853b5eea'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e8f6079e-7c33-42f8-8246-174dfe7f9f6b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8a8608ed-ae86-45c2-be5a-3b23508c29dc'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a138448f-4d15-42e5-a215-a046ef3d9a83'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e1fcd73b-fc90-4bae-acd6-0cf8eabc0ba8'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('78f6486c-85b2-4551-96e7-a7727006d40f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('218c8519-9e3e-4038-a4aa-53038c3d6132'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('19720684-4712-4244-b1f6-b0df73b7318d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('360cc6ab-fc6d-418d-a0a8-51ed92fc5ba4'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('eee71233-53d2-4b5d-842e-fef19739f607'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7746591d-41d7-4aa6-979c-87f419cb631d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f6b93a6e-9282-4329-a2a1-c7268753da1e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fdefa70e-3fe7-4198-ae1d-d64fc6ff22a6'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2f238ff6-dfc0-40c8-8da2-3ec34094041f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1637b248-8853-4182-9c41-f607551ff126'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('240bd9f7-501f-4d1a-a73e-33bfbfb8e011'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('11b82f5a-ed7f-49f4-9f6a-1e8d4e81b602'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('67fc7cc3-b24d-4efe-870a-ece43f07c21c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4dda849f-dde1-404a-8fef-6a2b2ada8f26'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2df9a874-bef2-432a-a1c8-2912ded58080'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('07edba8f-4373-47b6-9b6e-151175ae8d6c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d9795de4-da8e-48d0-9e1e-d2c2e556696d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c3a5e659-4a15-4068-84e0-5330b2fcb43f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a7d80cb4-973c-4562-b626-823cc2fece48'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5b0efe55-1c10-4706-96f3-52dc1a5c930c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('56fb3a08-1ad0-462c-825b-05ca72e072ac'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b9d0c1eb-4ef2-4848-830e-41e1b6caf2fc'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('80187547-c398-4b94-8a55-b3ae4379c6f2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('68fe627c-f3aa-4bed-8613-1681c105a7a3'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('34a159ab-753e-497f-9fff-53ff4055a516'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('368e4e83-93d6-4d28-9a4e-78015c804d68'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0c2c685d-98b2-42bf-8bac-49576f25c4ed'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('309defa1-2e76-4ab0-8312-a850a503ce07'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e3ea15e7-d2f1-4294-b1d3-f21587aa7fa0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7012474e-8a6f-4348-81fb-219fc6107d86'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('32a527d3-22eb-4c5c-b379-5187eb61d25b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e48e0722-311f-4785-9167-feac57ffb3ae'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0a7b0ebb-5339-47ba-bb03-1da75821d787'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6ccfadbc-be9a-4f90-8fca-b1502123bd71'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c4a62a5e-b0b4-47b5-8e83-31dbaf6fa3bc'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('bf6f2a6e-cf16-4a28-b8f1-93cc97c910a9'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('17e8a6f8-518f-4f77-8562-1de7a15445b0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('29340e1c-f9df-424c-983f-7e4ce04e9b68'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9157a7c1-e949-44f9-a219-32fc6c4f6cb0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1d737af1-a018-4cd5-a592-3b9a7df6bc08'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a6068ca5-7fc2-439a-bb6f-431e5222e79a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8bc957f1-7ec4-437f-9be2-d4a2fee0562f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c10f7757-1943-4b17-b448-75172f173ac9'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e0dcadee-cea1-4d14-84bf-c3428ea535eb'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4aed8291-8b39-452e-81a8-e58c88ab53ae'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('720dbd48-1673-42ed-bfeb-946ca9b7d9ae'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a5da9669-fea1-4d49-9d5d-ab8559fc8a1b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b94b17bc-f1cc-49d0-a554-8ab864333269'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f7f0d88f-8a36-4c51-8b07-2fc54d7367b7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('06788fed-c3fe-4364-93f4-c72d163efd7c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1c91c365-fb15-4544-8bf2-1e62228d41ee'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('420ae415-9f51-4b97-80d7-32fee3d6e8a9'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a986e287-476e-46fd-9abd-3b735b61ba63'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9d262fda-a35c-4f13-a208-e0820f8a598e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('94350bce-ecba-477e-9526-272845142fd8'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('28964f46-8772-474e-b433-52cdeab404f9'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d69fe101-dbb2-453e-a6b7-79c5e937edb1'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('bf2c9e18-931b-4535-839e-883e903221bb'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('780ae912-70eb-49e3-a5b0-9ba4de0d9b6b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('95a50265-7cbc-47ce-a90c-e789e53d50ef'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4b85982a-2a45-451d-9ff4-5c892de49f6d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('245ce6d8-f7ff-4f90-bfd0-c8dfaada04e0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d38db230-f4ef-4760-9598-752ed16dc2a0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4fa313a4-6089-43ad-a76f-63a18bd09815'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('74ab9b63-222d-41fa-8718-d180df3b1d54'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('838c04c2-48a5-4ea0-a905-f7511706ba37'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6fcb9b78-8b4a-4436-86d0-023ca1c1291c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('17b25a4b-3347-40b1-96d1-6d390c84d933'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('674b7c9d-6bc2-4006-a577-da9a09621101'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('69c599c3-57ee-4444-a18c-95308ae1c899'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1509a2e8-3e00-4aa2-b7a9-fd564089bfdb'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('97e4d388-d96f-45ec-821a-25478dc77244'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('75ffe3d2-0786-4550-9b17-e06cb670bdc5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6915c7ce-d203-4042-b89f-5650aaab7f03'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('dedf06ea-4169-49e5-a7d6-b8734121e955'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('830e30e0-16f2-4834-94d3-dbd2f51db455'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ccb00cdd-4629-4440-ab0e-3c5936fbf015'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('702371f9-1da1-427d-816f-f40ea30f8d48'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('562805a9-b8b2-46ef-aacd-6a0e69f97921'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7fe0db33-213f-432b-bc7d-16b15be0feed'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1b7188dc-5bfb-47b3-9570-42b61068370e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7b6d1aef-f573-44bf-bd43-5d8796e479d3'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8eba739b-f6dd-49a2-9e60-cacb9111ef2f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('befcb6b8-e644-4ec9-bbeb-3fce30950a6a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7c02040b-39bc-443f-a636-9c099dfccee6'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a030184d-3acb-4666-98b8-506ea7658f80'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c3bcdef4-c66d-497b-9cd1-e740c0e7eaae'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ac75d4db-f0e0-4e73-b2b5-c7f7a049f88a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('55668a3b-38bc-47a9-acb6-cd153dd6d981'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5ddee0c3-c345-435f-af63-d2d5f931061f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('de790576-b774-45a0-873d-a99090d67a05'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b4435a8e-d408-4c4f-ac8a-d79947925bc8'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('579fba08-83a0-47b9-a843-bb1602842a6a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('956e8fe5-a00b-42dc-a666-bd5a6cf576d2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f2415a56-091b-4ca2-bc29-ba7772465268'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('eca57978-bab9-4119-aa75-b41407c83d96'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5e0df997-8545-40e8-afd0-240ca4f4676e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3e2ce75c-1016-415f-99db-21b23f0fc323'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('012ec045-e798-4ddb-b758-f711bae5e8e5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('226ec1cb-3b18-4ae5-b486-09253e5ad007'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7116ef28-4c8e-4797-b520-f553d7173068'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7ce0afdb-c575-4ce7-a536-c0bc122abe5f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3035715b-b343-4bed-ba66-f11bf22aa15c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3131e331-0f41-4801-909e-68ab773a6780'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3672fc28-4cec-49cf-9c50-ec35a9fb844d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d8f2d42c-fc2a-4252-b1f1-fa4b8aa0cf04'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('cfe58d83-79d2-4b84-af64-3cf346ed4c9e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f9a25d44-887a-4538-9314-62dc14e9e7a1'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('293e497f-eea9-44f7-91d1-216f8f022a26'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7bd3422d-c7f0-4c61-ad00-90d2535e00db'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b47e47ad-b600-4698-9a4d-1a6228e1849d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0ad0cc4e-a36a-47ff-a99d-cb010e30aa7e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9e741a15-93ff-4069-af21-e749a1c315a2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('18c5fe3d-bde8-4952-9b4c-f4460a3506b0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1f785f9c-0803-4278-b456-57b49cc89d5d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('94cfcbf0-31e2-40d0-b502-f9b95f5ff4ad'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('151f6fe3-413e-4601-9867-1e47c42b6152'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('66cd36b3-3e9d-4af4-9620-60644fabc7c4'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ec89e952-4019-403d-b484-143627a9c10b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('34727236-8b7f-4bcb-b249-a8cd731ad43c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('21740454-3a94-4393-bd7f-5b7a287057f1'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('bae6c5d8-6453-4722-9027-82acba4e01c5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('65d34087-28e2-4411-ab2b-fec25bb619a9'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f3088ba3-309b-4899-8fd7-c71b4f1dfb6a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3d934e1f-14df-4e74-8dd1-77e397296e04'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2a5e9bb0-c332-4850-9ac4-8ea0e442daf9'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1002f904-83bc-4703-bc70-734f082f998c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c52591cb-bb51-40d3-afcb-940b2b0f683f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6600a799-9ef7-4171-83a3-1199b8cde77e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c12013ba-57cf-4b30-a538-fd8d0b16b097'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('db1683ad-cb09-4ec0-ae56-7252853a58fc'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('807a8a1a-353b-4a6b-9a1c-f1b6639c692a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5d38cb37-7158-42a4-abb1-c94ec06bcff7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('42d011f3-09e3-441b-a6e0-218fd2143e24'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b5582c9d-7d6f-4f2a-83b0-11f7bb0a10ef'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2f5e546c-9a56-49a0-8d2c-f8566c1bb510'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9f177525-a78f-4ac4-83df-e1d81efe1e9f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('66046257-0a1d-4963-a20b-46c029b41053'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('05fb9b13-1562-41d9-8f38-78c01a62bae7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8c1dec5a-f1e9-438e-a9f8-3ae2739087d0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0c96cf73-a09a-4770-b685-dbb3d5e87646'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('de0e4df2-cd04-4f8d-ac8c-b8cccd9bed02'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7b377f97-d60d-4e31-ae8c-1e5fd58b3505'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7743bc80-6434-4fc6-935a-1763ccf27bd6'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e79081c0-1a52-4e36-a9fc-67cdd315dff8'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d34976e6-9bcb-4d44-ab68-6f64896f9cd3'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('33eb8a70-a4c6-44ac-8f4f-fb27f12cead6'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6f6aa178-10d1-4c2e-ac99-a7ca32699f83'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d413a872-ffc7-4fb8-b3ce-ecb297998ea0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('de8e5309-59ab-47f6-bd27-de7dbdc8ecc9'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('7ad445ef-330c-408c-bda6-010777980b35'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0809e164-4830-4782-9984-406ef232e751'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('0ac99755-c1be-4f0a-8f08-268b1185990e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b1337a3c-c105-4b73-87bb-b557edadba33'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6b002b14-dc0f-4682-b088-e79661b54b5b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('658f6f3c-c489-41d4-a64d-364e9e311c36'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6de672dc-4a92-49a5-a580-b4483da66515'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8931aa30-cdcb-4f07-9417-82f98eb5d194'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5b63e5ac-4a18-45b4-abec-7d384c23fb12'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b34f79f4-444f-4612-a039-b6dd8ad2bdaa'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ab4d0742-3301-4e07-ab02-0ec923cd9482'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('baaf597c-8f78-41a2-9301-f99137f3f7d2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8aa909a0-02b7-489e-aec5-70e74fc2c9ee'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d4ec0be2-5be3-4048-9d06-cd17e8c34f96'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('747fa4b0-4447-4a2b-a552-f00bd9326035'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f4eff6a8-31ef-4805-8adc-6857c9fb9233'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2c723446-cf4d-4893-b220-87dd869a44ed'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a0e90c35-8679-47cc-b2e5-c27285c2de2e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('db5af131-426f-4059-9899-c59e61e6cad3'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('43ed83d6-e4cc-4a50-81bf-3952a043eb62'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ff53bb3f-f502-4208-bf6f-cc8399b6657e'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('50fdd455-c31b-4b6a-be7b-6c3ea2804059'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c1aabb66-987a-4e0a-a646-f4f9bca113eb'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c9d148d9-3322-40c9-b12c-a8a74f41e1be'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d38f3c88-6bb7-4558-a09e-dedea0c4e2e3'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('685ddcda-cda4-4587-a7a4-a96fa9c28509'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('795907b8-2cbe-4c1d-82c6-470fb4390e67'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('d06e95f1-e562-4a73-80f7-9da1e953dbc2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1de100f8-0289-403e-b3bd-5f8ddf1d892c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ee8ed056-6260-4fe5-badd-b6ae770db8e5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('dbf7cde0-347e-496e-ad85-a40b4a7727d7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c582356e-023f-482b-bfd9-856d599f39cd'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6ad0aac2-e828-482b-b117-8cf4fd8f95df'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('33be1c3e-5591-4e85-86bd-a432c1507afd'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3dc829b4-4872-4609-ac7d-933b188d3df0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4379cc67-c5bb-4664-85e3-3976fc7f5f2c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1036a54f-6fc8-4c65-8a27-603431f1b61f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c21cba26-e875-470d-b7a1-ff7d69ad5e46'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('dcbf2ae7-0730-4a37-9fbe-de3879dd57a7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9b3fc964-ae7d-437d-b2bb-3b7f255b83a2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f5688dff-ddce-4f08-b6f1-35f592081be4'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('80ecd425-d894-4487-825d-6c1ca0e1d5eb'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6769d756-12ac-4fdb-b1e4-356151353080'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('436b86a5-b4e4-4b68-98ed-044953dccb4f'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8deda4b2-6da1-4fa7-bc05-c0d444f729cc'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ff18ec7d-6c4e-4ee5-a0d7-8e3f076dc260'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fa668f6a-0cf1-4278-b1c3-1f8356c7dd99'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8a5f2586-350d-48b8-bd4a-190a1e119977'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('39397874-c90c-4b93-825a-af11d89ffa84'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3697926c-e245-46e7-b675-9c224b113ce3'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('77484447-41f5-48a5-ad86-654f0672eee6'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2aa55dcc-d6fb-4021-909d-d2147cb8ba0a'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('bf7967be-9def-47d4-92c3-f4af561da488'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('1a3228b8-c279-456a-bf42-0341f79f0f3c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e20de38c-d2d4-408d-a784-bb65c9b522bd'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('f2f9763b-c81d-4a4a-be50-996f87ca785b'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4929fb7c-a3e4-4b75-941d-de31350097f2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('2a721d84-f6f7-4bb9-ba1a-1529038f29ae'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('a823f377-249c-4610-b270-642a590ef73c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('6fc8acb0-dfd3-4e91-9f43-051e8e2594db'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('4abd40ca-9593-4fab-944d-1b6f67be1380'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('5e2c98a7-5d4c-4172-96be-43737c508ee7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('e4c3f015-5fd4-4609-82a9-3948d2d71d3d'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c8f1ae5a-54ff-4e98-b9d5-614bafb4a255'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('3c4d0cc8-4fb7-49fd-b81b-bfb4bb8fb466'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('afc5c37a-3cde-4cf2-a03b-e36bce84d3b2'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('c7dba39e-a2c9-4a06-be12-7cc3a87006d5'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9b1b5681-cf7f-4c58-b78b-386466a772d4'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('fad8f87c-c0c4-40d1-9813-62bcab8294b3'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9619d041-2f4c-49a6-b369-7fe527ec73d7'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('553f67ad-8efa-4e13-8cb1-772f41cb45e0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('de92c2b6-17ba-44dd-9252-0c174ae6c249'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('b8ab753b-5953-4ea2-90b9-e9e43910f5f9'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9464fe21-153a-4771-badd-4257c4a4bc42'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('9937f0fb-2ff4-4d8c-aa87-d4527e3f7059'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('8ee566f8-1f16-4431-a430-fc6e52511592'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('014c6af7-5c16-48ad-8752-ebdbf27b5fdd'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('ff51c64d-0103-4dae-a73a-17fb0a0e3587'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('daba2be5-e4f3-4f20-a99c-4c816041314c'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false),
  ('eab0e11c-f385-4c18-83e6-c90ad63568d0'::uuid, 'active_ingredient'::public.glbd_component_type, 'parent'::public.glbd_form_type, null::uuid, false)
)
insert into public.glbd_components (
  legacy_active_ingredient_id, component_type, name_ru, name_en, canonical_name,
  normalized_key, parent_component_id, form_type, review_status, source_status,
  is_active, created_at, updated_at
)
select
  ai.id,
  m.proposed_component_type,
  ai.name_ru,
  ai.name_en,
  coalesce(nullif(btrim(ai.name_en), ''), ai.name_ru),
  lower(btrim(ai.slug)),
  null,
  'parent'::public.glbd_form_type,
  'draft'::public.glbd_review_status,
  case when m.needs_source then 'needs_source' else 'internal_existing_data' end::public.glbd_source_type,
  (coalesce(ai.is_active, true) and not coalesce(ai.archived, false)),
  ai.created_at,
  ai.updated_at
from public.active_ingredients ai
join migration_map m on m.legacy_id = ai.id
on conflict (legacy_active_ingredient_id) do nothing;

-- Stop gate: this must return exactly 425 before commit in the future apply transaction.
select count(*) as mapped_component_rows
from public.glbd_components
where legacy_active_ingredient_id is not null;

-- SECTION C: 1373 GLOBAL PRODUCT-COMPONENT LINK BACKFILL PREVIEW
-- PREVIEW DATA BLOCK: preserve all 1373 global legacy links without relink/dedupe/archive.
-- Role defaults to active for ordinary/unknown components and is derived for typed V2 components.
-- The 18 unknown-component links remain draft-only and cannot be approved by the guard.
insert into public.glbd_product_components (
  product_id, component_id, legacy_product_active_ingredient_id, role_in_product,
  concentration_text, is_primary_active, confidence, review_status, sort_order,
  created_at, updated_at
)
select
  pai.product_id,
  c.id,
  pai.id,
  case c.component_type
    when 'safener' then 'safener'
    when 'synergist' then 'synergist'
    when 'biological_component' then 'biological_agent'
    when 'formulation_component' then 'formulation_component'
    else 'active'
  end::public.glbd_role_in_product,
  pai.concentration_text,
  (c.component_type = 'active_ingredient'),
  0.2500,
  'draft'::public.glbd_review_status,
  pai.sort_order,
  pai.created_at,
  pai.created_at
from public.product_active_ingredients pai
join public.products p on p.id = pai.product_id and p.company_id is null
join public.glbd_components c on c.legacy_active_ingredient_id = pai.active_ingredient_id
on conflict (legacy_product_active_ingredient_id) do nothing;

-- Stop gate: this must return exactly 1373 and company_product_links must be zero.
select count(*) as mapped_global_product_links
from public.glbd_product_components
where legacy_product_active_ingredient_id is not null;

select count(*) as company_product_links
from public.glbd_product_components gpc
join public.products p on p.id = gpc.product_id
where p.company_id is not null;

-- BLOCK 4: transaction-level parity assertions. Any mismatch aborts all DDL/backfill.
do $postflight$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.glbd_components;
  if v_count <> 425 then raise exception 'V2 component count mismatch: %', v_count; end if;

  select count(*) into v_count from public.glbd_product_components;
  if v_count <> 1373 then raise exception 'V2 product link count mismatch: %', v_count; end if;

  select count(*) into v_count
  from public.glbd_product_components g join public.products p on p.id=g.product_id
  where p.company_id is not null;
  if v_count <> 0 then raise exception 'V2 company product links found: %', v_count; end if;

  select count(*) into v_count
  from public.glbd_product_components g left join public.glbd_components c on c.id=g.component_id
  where c.id is null;
  if v_count <> 0 then raise exception 'V2 component FK orphans found: %', v_count; end if;

  select count(*) into v_count
  from public.glbd_product_components g left join public.products p on p.id=g.product_id
  where p.id is null;
  if v_count <> 0 then raise exception 'V2 product FK orphans found: %', v_count; end if;

  select count(*) into v_count from (
    select product_id,component_id,role_in_product,count(*)
    from public.glbd_product_components
    where review_status not in ('archived','rejected')
    group by 1,2,3 having count(*)>1
  ) d;
  if v_count <> 0 then raise exception 'V2 duplicate active links found: %', v_count; end if;

  select count(*) into v_count
  from public.active_ingredients ai join public.glbd_components c on c.legacy_active_ingredient_id=ai.id
  where c.name_ru is distinct from ai.name_ru or c.name_en is distinct from ai.name_en;
  if v_count <> 0 then raise exception 'V2 component name mismatches found: %', v_count; end if;

  select count(*) into v_count
  from public.product_active_ingredients pai
  join public.glbd_product_components g on g.legacy_product_active_ingredient_id=pai.id
  where g.concentration_text is distinct from pai.concentration_text;
  if v_count <> 0 then raise exception 'V2 concentration text mismatches found: %', v_count; end if;

  select count(*) into v_count
  from public.glbd_product_components g join public.glbd_components c on c.id=g.component_id
  where c.component_type='unknown_component' and g.review_status='approved';
  if v_count <> 0 then raise exception 'Unknown links were approved: %', v_count; end if;

  select count(*) into v_count from public.glbd_components where review_status <> 'draft';
  if v_count <> 0 then raise exception 'Non-draft V2 components found: %', v_count; end if;

  select count(*) into v_count from public.glbd_product_components where review_status <> 'draft';
  if v_count <> 0 then raise exception 'Non-draft V2 product links found: %', v_count; end if;

  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('glbd_components','glbd_component_aliases','glbd_component_sources','glbd_product_components')
    and c.relrowsecurity;
  if v_count <> 4 then raise exception 'RLS is not enabled on all V2 tables: %', v_count; end if;

  if to_regclass('public.glbd_active_ingredients_v2_compat') is null then
    raise exception 'Compatibility view is missing';
  end if;
end;
$postflight$;

-- BLOCK 5: final read-only evidence emitted before COMMIT.
select
  (select count(*) from public.glbd_components) as components,
  (select count(*) from public.glbd_product_components) as product_components,
  (select count(*) from public.glbd_product_components g join public.products p on p.id=g.product_id where p.company_id is not null) as company_links,
  (select count(*) from public.glbd_components where component_type='unknown_component') as unknown_components,
  (select count(*) from public.glbd_product_components where review_status='approved') as approved_links;

commit;
