/*
  Travkin Knowledge Engine V0.

  Purpose:
  - add a controlled Global Admin intake workflow for Product Passport metadata
  - store product matches, source evidence, and field-level suggestions
  - do not modify products, aliases, variants, warehouse, ledger, operations, or material requests

  This migration only creates the review/intake tables.
*/

create extension if not exists pgcrypto;

create table if not exists public.knowledge_intake_runs (
  id uuid primary key default gen_random_uuid(),
  input_type text not null
    check (input_type in ('name', 'url', 'pdf', 'photo', 'manual')),
  input_value text not null,
  input_manufacturer text null,
  status text not null default 'draft'
    check (status in ('draft', 'analyzing', 'matched', 'extracted', 'needs_review', 'approved', 'applied', 'rejected', 'failed')),
  entity_type text not null default 'product'
    check (entity_type in ('product')),
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  notes text null
);

create table if not exists public.knowledge_intake_matches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.knowledge_intake_runs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  match_type text not null
    check (match_type in ('exact', 'alias', 'transliteration', 'manufacturer_prefix', 'fuzzy', 'active_ingredient', 'possible_duplicate')),
  confidence numeric(5,4) not null default 0
    check (confidence >= 0 and confidence <= 1),
  reason text null,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_intake_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.knowledge_intake_runs(id) on delete cascade,
  source_type text not null
    check (source_type in ('official_label', 'manufacturer_page', 'manufacturer_pdf', 'registration_database', 'distributor_page', 'uploaded_file', 'manual')),
  source_url text null,
  source_title text null,
  source_confidence text not null default 'medium'
    check (source_confidence in ('low', 'medium', 'high')),
  extracted_text_summary text null,
  created_at timestamptz not null default now()
);

create table if not exists public.product_metadata_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.knowledge_intake_runs(id) on delete cascade,
  product_id uuid null references public.products(id) on delete cascade,
  field_name text not null
    check (
      field_name in (
        'trade_name',
        'manufacturer',
        'product_type',
        'subcategory',
        'formulation',
        'physical_state',
        'stock_unit',
        'default_rate_type',
        'default_rate_unit',
        'metadata_source_url',
        'metadata_confidence',
        'metadata_review_required'
      )
    ),
  current_value jsonb null,
  suggested_value jsonb not null,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  action_class text not null default 'NEED_REVIEW'
    check (
      action_class in (
        'SAFE_FIX',
        'NEED_REVIEW',
        'BLOCKED_BY_SOURCE',
        'BLOCKED_BY_IDENTITY',
        'CREATE_NEW_PRODUCT',
        'UPDATE_EXISTING_PRODUCT',
        'LINK_ALIAS',
        'KEEP_SEPARATE'
      )
    ),
  source_id uuid null references public.knowledge_intake_sources(id) on delete set null,
  reason text null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'applied', 'needs_review')),
  created_at timestamptz not null default now(),
  applied_at timestamptz null
);

create index if not exists idx_knowledge_intake_runs_status
  on public.knowledge_intake_runs(status, entity_type, created_at desc);

create index if not exists idx_knowledge_intake_matches_run
  on public.knowledge_intake_matches(run_id);

create index if not exists idx_knowledge_intake_matches_product
  on public.knowledge_intake_matches(product_id, match_type);

create index if not exists idx_knowledge_intake_sources_run
  on public.knowledge_intake_sources(run_id);

create index if not exists idx_product_metadata_suggestions_run_status
  on public.product_metadata_suggestions(run_id, status);

create index if not exists idx_product_metadata_suggestions_product_field
  on public.product_metadata_suggestions(product_id, field_name, status);

create index if not exists idx_product_metadata_suggestions_action
  on public.product_metadata_suggestions(action_class, status);

create or replace function public.knowledge_intake_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_knowledge_intake_runs_updated_at on public.knowledge_intake_runs;
create trigger trg_knowledge_intake_runs_updated_at
before update on public.knowledge_intake_runs
for each row execute function public.knowledge_intake_touch_updated_at();

alter table public.knowledge_intake_runs enable row level security;
alter table public.knowledge_intake_matches enable row level security;
alter table public.knowledge_intake_sources enable row level security;
alter table public.product_metadata_suggestions enable row level security;

drop policy if exists "Global admins can manage knowledge intake runs" on public.knowledge_intake_runs;
create policy "Global admins can manage knowledge intake runs"
  on public.knowledge_intake_runs for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'global_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'global_admin'
    )
  );

drop policy if exists "Global admins can manage knowledge intake matches" on public.knowledge_intake_matches;
create policy "Global admins can manage knowledge intake matches"
  on public.knowledge_intake_matches for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'global_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'global_admin'
    )
  );

drop policy if exists "Global admins can manage knowledge intake sources" on public.knowledge_intake_sources;
create policy "Global admins can manage knowledge intake sources"
  on public.knowledge_intake_sources for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'global_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'global_admin'
    )
  );

drop policy if exists "Global admins can manage product metadata suggestions" on public.product_metadata_suggestions;
create policy "Global admins can manage product metadata suggestions"
  on public.product_metadata_suggestions for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'global_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'global_admin'
    )
  );

