-- TZ-199: Full Pesticide Card V1, isolated QA branch only.
-- This is a reproducible branch schema script, not a production migration.

begin;

do $guard$
begin
  if not exists (
    select 1
    from public.assistant_glbd_snapshot_meta
    where branch_ref = 'gsglkmudcwkdetqtocae'
  ) then
    raise exception 'STOP: Full Pesticide Card V1 is allowed only on branch gsglkmudcwkdetqtocae';
  end if;
end;
$guard$;

create table if not exists public.glbd_product_sources (
  id uuid primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  source_type text not null,
  source_url text not null,
  source_title text not null,
  claim_fields text[] not null,
  checked_on date not null,
  confidence numeric(5,4) not null,
  verification_status text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_sources_product_pair unique (id, product_id),
  constraint glbd_product_sources_type_check check (
    source_type in ('official_label', 'official_registry', 'manufacturer_site', 'official_distributor')
  ),
  constraint glbd_product_sources_url_check check (source_url ~ '^https://'),
  constraint glbd_product_sources_title_check check (btrim(source_title) <> ''),
  constraint glbd_product_sources_claims_check check (cardinality(claim_fields) > 0),
  constraint glbd_product_sources_confidence_check check (confidence between 0 and 1),
  constraint glbd_product_sources_verification_check check (
    verification_status in ('verified', 'conflict', 'expired', 'blocked')
  )
);

create unique index if not exists ux_glbd_product_sources_identity
  on public.glbd_product_sources (product_id, lower(source_url), source_type);
create index if not exists ix_glbd_product_sources_product
  on public.glbd_product_sources (product_id);

create table if not exists public.glbd_product_registrations (
  id uuid primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  country_code text not null,
  registration_number text not null,
  registration_status text not null,
  valid_from date,
  valid_until date,
  registrant text,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_registrations_source_fk
    foreign key (source_id, product_id)
    references public.glbd_product_sources(id, product_id)
    on delete restrict,
  constraint glbd_product_registrations_country_check check (country_code ~ '^[A-Z]{2}$'),
  constraint glbd_product_registrations_number_check check (btrim(registration_number) <> ''),
  constraint glbd_product_registrations_status_check check (
    registration_status in ('active', 'expired', 'suspended', 'cancelled', 'unknown')
  ),
  constraint glbd_product_registrations_dates_check check (
    valid_from is null or valid_until is null or valid_from <= valid_until
  ),
  constraint glbd_product_registrations_product_country_number_unique
    unique (product_id, country_code, registration_number)
);

create index if not exists ix_glbd_product_registrations_product
  on public.glbd_product_registrations (product_id);
create index if not exists ix_glbd_product_registrations_source
  on public.glbd_product_registrations (source_id, product_id);

create table if not exists public.glbd_product_usage_rules (
  id uuid primary key,
  rule_key text not null unique,
  product_id uuid not null references public.products(id) on delete cascade,
  crop_id uuid not null references public.crops(id) on delete restrict,
  variety_id uuid references public.varieties(id) on delete restrict,
  target_type text not null,
  disease_id uuid references public.diseases(id) on delete restrict,
  pest_id uuid references public.pests(id) on delete restrict,
  weed_id uuid references public.weeds(id) on delete restrict,
  target_text text,
  rate_min numeric not null,
  rate_max numeric not null,
  rate_unit text not null,
  working_fluid_min numeric,
  working_fluid_max numeric,
  working_fluid_unit text,
  application_method text not null,
  crop_stage text,
  target_stage text,
  timing_condition text,
  max_treatments integer,
  harvest_interval_days integer,
  reentry_hours integer,
  restrictions text,
  notes text,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_usage_rules_source_fk
    foreign key (source_id, product_id)
    references public.glbd_product_sources(id, product_id)
    on delete restrict,
  constraint glbd_product_usage_rules_target_type_check check (
    target_type in ('disease', 'pest', 'weed', 'desiccation', 'growth_regulation', 'other')
  ),
  constraint glbd_product_usage_rules_target_check check (
    (target_type = 'disease' and disease_id is not null and pest_id is null and weed_id is null)
    or (target_type = 'pest' and disease_id is null and pest_id is not null and weed_id is null)
    or (target_type = 'weed' and disease_id is null and pest_id is null and weed_id is not null)
    or (target_type in ('desiccation', 'growth_regulation', 'other')
        and disease_id is null and pest_id is null and weed_id is null and nullif(btrim(target_text), '') is not null)
  ),
  constraint glbd_product_usage_rules_rate_check check (
    rate_min >= 0 and rate_max >= rate_min and btrim(rate_unit) <> ''
  ),
  constraint glbd_product_usage_rules_working_fluid_check check (
    (working_fluid_min is null and working_fluid_max is null and working_fluid_unit is null)
    or (
      working_fluid_min is not null and working_fluid_max is not null
      and working_fluid_min >= 0 and working_fluid_max >= working_fluid_min
      and nullif(btrim(working_fluid_unit), '') is not null
    )
  ),
  constraint glbd_product_usage_rules_counts_check check (
    (max_treatments is null or max_treatments > 0)
    and (harvest_interval_days is null or harvest_interval_days >= 0)
    and (reentry_hours is null or reentry_hours >= 0)
  ),
  constraint glbd_product_usage_rules_no_placeholders_check check (
    concat_ws(' ', target_text, application_method, crop_stage, target_stage, timing_condition, restrictions, notes)
      !~* '(не указано|проверить)'
  )
);

create index if not exists ix_glbd_product_usage_rules_product
  on public.glbd_product_usage_rules (product_id);
create index if not exists ix_glbd_product_usage_rules_crop_target
  on public.glbd_product_usage_rules (crop_id, target_type);
create index if not exists ix_glbd_product_usage_rules_variety
  on public.glbd_product_usage_rules (variety_id);
create index if not exists ix_glbd_product_usage_rules_disease
  on public.glbd_product_usage_rules (disease_id);
create index if not exists ix_glbd_product_usage_rules_pest
  on public.glbd_product_usage_rules (pest_id);
create index if not exists ix_glbd_product_usage_rules_weed
  on public.glbd_product_usage_rules (weed_id);
create index if not exists ix_glbd_product_usage_rules_source
  on public.glbd_product_usage_rules (source_id, product_id);

create table if not exists public.glbd_product_assistant_safety (
  product_id uuid primary key references public.products(id) on delete cascade,
  read_allowed boolean not null default false,
  recommendation_allowed boolean not null default false,
  missing_critical_fields text[] not null default '{}',
  blocked_reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_assistant_safety_recommendation_check check (
    not recommendation_allowed
    or (read_allowed and cardinality(missing_critical_fields) = 0 and blocked_reason is null and verified_at is not null)
  ),
  constraint glbd_product_assistant_safety_block_check check (
    read_allowed or nullif(btrim(blocked_reason), '') is not null
  )
);

drop trigger if exists trg_glbd_product_sources_updated_at on public.glbd_product_sources;
create trigger trg_glbd_product_sources_updated_at
before update on public.glbd_product_sources
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_glbd_product_registrations_updated_at on public.glbd_product_registrations;
create trigger trg_glbd_product_registrations_updated_at
before update on public.glbd_product_registrations
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_glbd_product_usage_rules_updated_at on public.glbd_product_usage_rules;
create trigger trg_glbd_product_usage_rules_updated_at
before update on public.glbd_product_usage_rules
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_glbd_product_assistant_safety_updated_at on public.glbd_product_assistant_safety;
create trigger trg_glbd_product_assistant_safety_updated_at
before update on public.glbd_product_assistant_safety
for each row execute function public.update_updated_at_column();

alter table public.glbd_product_sources enable row level security;
alter table public.glbd_product_registrations enable row level security;
alter table public.glbd_product_usage_rules enable row level security;
alter table public.glbd_product_assistant_safety enable row level security;

revoke all on table public.glbd_product_sources, public.glbd_product_registrations,
  public.glbd_product_usage_rules, public.glbd_product_assistant_safety from anon, authenticated;
grant select on table public.glbd_product_sources, public.glbd_product_registrations,
  public.glbd_product_usage_rules, public.glbd_product_assistant_safety to authenticated;
grant all on table public.glbd_product_sources, public.glbd_product_registrations,
  public.glbd_product_usage_rules, public.glbd_product_assistant_safety to service_role;

drop policy if exists glbd_product_sources_authenticated_read on public.glbd_product_sources;
create policy glbd_product_sources_authenticated_read
on public.glbd_product_sources for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_sources.product_id and p.company_id is null
  )
);

drop policy if exists glbd_product_registrations_authenticated_read on public.glbd_product_registrations;
create policy glbd_product_registrations_authenticated_read
on public.glbd_product_registrations for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_registrations.product_id and p.company_id is null
  )
);

drop policy if exists glbd_product_usage_rules_authenticated_read on public.glbd_product_usage_rules;
create policy glbd_product_usage_rules_authenticated_read
on public.glbd_product_usage_rules for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_usage_rules.product_id and p.company_id is null
  )
);

drop policy if exists glbd_product_assistant_safety_authenticated_read on public.glbd_product_assistant_safety;
create policy glbd_product_assistant_safety_authenticated_read
on public.glbd_product_assistant_safety for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_assistant_safety.product_id and p.company_id is null
  )
);

commit;
