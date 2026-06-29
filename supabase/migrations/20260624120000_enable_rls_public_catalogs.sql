/*
  Enable RLS for public global catalog/reference tables.

  Draft only until explicitly applied.

  Intent:
  - keep global catalogs readable by the UI;
  - block direct client mutations on global/reference tables by not creating
    INSERT/UPDATE/DELETE policies for anon/authenticated;
  - keep server API/service-role catalog management working;
  - keep company-scoped legacy working tables isolated by company.
*/

-- ---------------------------------------------------------------------------
-- GROUP A: Global read-only catalogs and code tables
-- ---------------------------------------------------------------------------

alter table public.active_ingredients enable row level security;
drop policy if exists "Allow public read active global catalog" on public.active_ingredients;
create policy "Allow public read active global catalog"
  on public.active_ingredients
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true and coalesce(archived, false) = false);

alter table public.pesticide_categories enable row level security;
drop policy if exists "Allow public read active global catalog" on public.pesticide_categories;
create policy "Allow public read active global catalog"
  on public.pesticide_categories
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true and coalesce(archived, false) = false);

alter table public.agricultural_machine_models enable row level security;
drop policy if exists "Allow public read active global catalog" on public.agricultural_machine_models;
create policy "Allow public read active global catalog"
  on public.agricultural_machine_models
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true and coalesce(archived, false) = false);

alter table public.transport_models enable row level security;
drop policy if exists "Allow public read active global catalog" on public.transport_models;
create policy "Allow public read active global catalog"
  on public.transport_models
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true and coalesce(archived, false) = false);

alter table public.agrochem_formulations enable row level security;
drop policy if exists "Allow public read active global catalog" on public.agrochem_formulations;
create policy "Allow public read active global catalog"
  on public.agrochem_formulations
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true and coalesce(archived, false) = false);

alter table public.agrochem_manufacturers enable row level security;
drop policy if exists "Allow public read active global catalog" on public.agrochem_manufacturers;
create policy "Allow public read active global catalog"
  on public.agrochem_manufacturers
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true and coalesce(archived, false) = false);

alter table public.agrochem_mode_of_actions enable row level security;
drop policy if exists "Allow public read active global catalog" on public.agrochem_mode_of_actions;
create policy "Allow public read active global catalog"
  on public.agrochem_mode_of_actions
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true and coalesce(archived, false) = false);

alter table public.master_crop_categories enable row level security;
drop policy if exists "Allow public read active code rows" on public.master_crop_categories;
create policy "Allow public read active code rows"
  on public.master_crop_categories
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.master_crop_subcategories enable row level security;
drop policy if exists "Allow public read active code rows" on public.master_crop_subcategories;
create policy "Allow public read active code rows"
  on public.master_crop_subcategories
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.master_crop_priority_levels enable row level security;
drop policy if exists "Allow public read active code rows" on public.master_crop_priority_levels;
create policy "Allow public read active code rows"
  on public.master_crop_priority_levels
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.master_fertilizer_types enable row level security;
drop policy if exists "Allow public read active code rows" on public.master_fertilizer_types;
create policy "Allow public read active code rows"
  on public.master_fertilizer_types
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.master_fleet_types enable row level security;
drop policy if exists "Allow public read active code rows" on public.master_fleet_types;
create policy "Allow public read active code rows"
  on public.master_fleet_types
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.master_machinery_categories enable row level security;
drop policy if exists "Allow public read active code rows" on public.master_machinery_categories;
create policy "Allow public read active code rows"
  on public.master_machinery_categories
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.master_pesticide_categories enable row level security;
drop policy if exists "Allow public read active code rows" on public.master_pesticide_categories;
create policy "Allow public read active code rows"
  on public.master_pesticide_categories
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.farming_intensity_codes enable row level security;
drop policy if exists "Allow public read active code rows" on public.farming_intensity_codes;
create policy "Allow public read active code rows"
  on public.farming_intensity_codes
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.growth_stages enable row level security;
drop policy if exists "Allow public read active code rows" on public.growth_stages;
create policy "Allow public read active code rows"
  on public.growth_stages
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.production_direction_codes enable row level security;
drop policy if exists "Allow public read active code rows" on public.production_direction_codes;
create policy "Allow public read active code rows"
  on public.production_direction_codes
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.program_goals enable row level security;
drop policy if exists "Allow public read active code rows" on public.program_goals;
create policy "Allow public read active code rows"
  on public.program_goals
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.program_target_risks enable row level security;
drop policy if exists "Allow public read active code rows" on public.program_target_risks;
create policy "Allow public read active code rows"
  on public.program_target_risks
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.program_step_type_codes enable row level security;
drop policy if exists "Allow public read active code rows" on public.program_step_type_codes;
create policy "Allow public read active code rows"
  on public.program_step_type_codes
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.global_vehicle_brands enable row level security;
drop policy if exists "Allow public read active code rows" on public.global_vehicle_brands;
create policy "Allow public read active code rows"
  on public.global_vehicle_brands
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

alter table public.global_vehicle_models enable row level security;
drop policy if exists "Allow public read active code rows" on public.global_vehicle_models;
create policy "Allow public read active code rows"
  on public.global_vehicle_models
  for select
  to anon, authenticated
  using (coalesce(is_active, true) = true);

-- ---------------------------------------------------------------------------
-- GROUP A with optional company scope: global rows public, company rows private
-- ---------------------------------------------------------------------------

alter table public.seed_originators enable row level security;
drop policy if exists "Allow public read global seed originators" on public.seed_originators;
create policy "Allow public read global seed originators"
  on public.seed_originators
  for select
  to anon, authenticated
  using (
    company_id is null
    and coalesce(is_active, true) = true
    and coalesce(archived, false) = false
  );
drop policy if exists "Allow authenticated read company seed originators" on public.seed_originators;
create policy "Allow authenticated read company seed originators"
  on public.seed_originators
  for select
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and coalesce(is_active, true) = true
    and coalesce(archived, false) = false
  );

alter table public.diseases enable row level security;
drop policy if exists "Allow public read global diseases" on public.diseases;
create policy "Allow public read global diseases"
  on public.diseases
  for select
  to anon, authenticated
  using (
    company_id is null
    and coalesce(is_active, true) = true
    and coalesce(archived, false) = false
  );
drop policy if exists "Allow authenticated read company diseases" on public.diseases;
create policy "Allow authenticated read company diseases"
  on public.diseases
  for select
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and coalesce(is_active, true) = true
    and coalesce(archived, false) = false
  );

alter table public.pests enable row level security;
drop policy if exists "Allow public read global pests" on public.pests;
create policy "Allow public read global pests"
  on public.pests
  for select
  to anon, authenticated
  using (
    company_id is null
    and coalesce(is_active, true) = true
    and coalesce(archived, false) = false
  );
drop policy if exists "Allow authenticated read company pests" on public.pests;
create policy "Allow authenticated read company pests"
  on public.pests
  for select
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and coalesce(is_active, true) = true
    and coalesce(archived, false) = false
  );

alter table public.weeds enable row level security;
drop policy if exists "Allow public read global weeds" on public.weeds;
create policy "Allow public read global weeds"
  on public.weeds
  for select
  to anon, authenticated
  using (
    company_id is null
    and coalesce(is_active, true) = true
    and coalesce(archived, false) = false
  );
drop policy if exists "Allow authenticated read company weeds" on public.weeds;
create policy "Allow authenticated read company weeds"
  on public.weeds
  for select
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and coalesce(is_active, true) = true
    and coalesce(archived, false) = false
  );

-- ---------------------------------------------------------------------------
-- GROUP B: Relation/alias tables. Read only when the parent global/company row
-- is visible to the same role.
-- ---------------------------------------------------------------------------

alter table public.product_active_ingredients enable row level security;
drop policy if exists "Allow public read global product active ingredient links" on public.product_active_ingredients;
create policy "Allow public read global product active ingredient links"
  on public.product_active_ingredients
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_active_ingredients.product_id
        and p.company_id is null
        and coalesce(p.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company product active ingredient links" on public.product_active_ingredients;
create policy "Allow authenticated read company product active ingredient links"
  on public.product_active_ingredients
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_active_ingredients.product_id
        and p.company_id = public.get_user_company_id()
        and coalesce(p.archived, false) = false
    )
  );

alter table public.crop_diseases enable row level security;
drop policy if exists "Allow public read global crop diseases" on public.crop_diseases;
create policy "Allow public read global crop diseases"
  on public.crop_diseases
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.diseases d
      where d.id = crop_diseases.disease_id
        and d.company_id is null
        and coalesce(d.is_active, true) = true
        and coalesce(d.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company crop diseases" on public.crop_diseases;
create policy "Allow authenticated read company crop diseases"
  on public.crop_diseases
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.diseases d
      where d.id = crop_diseases.disease_id
        and d.company_id = public.get_user_company_id()
        and coalesce(d.is_active, true) = true
        and coalesce(d.archived, false) = false
    )
  );

alter table public.disease_aliases enable row level security;
drop policy if exists "Allow public read global disease aliases" on public.disease_aliases;
create policy "Allow public read global disease aliases"
  on public.disease_aliases
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.diseases d
      where d.id = disease_aliases.disease_id
        and d.company_id is null
        and coalesce(d.is_active, true) = true
        and coalesce(d.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company disease aliases" on public.disease_aliases;
create policy "Allow authenticated read company disease aliases"
  on public.disease_aliases
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.diseases d
      where d.id = disease_aliases.disease_id
        and d.company_id = public.get_user_company_id()
        and coalesce(d.is_active, true) = true
        and coalesce(d.archived, false) = false
    )
  );

alter table public.crop_pests enable row level security;
drop policy if exists "Allow public read global crop pests" on public.crop_pests;
create policy "Allow public read global crop pests"
  on public.crop_pests
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.pests p
      where p.id = crop_pests.pest_id
        and p.company_id is null
        and coalesce(p.is_active, true) = true
        and coalesce(p.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company crop pests" on public.crop_pests;
create policy "Allow authenticated read company crop pests"
  on public.crop_pests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.pests p
      where p.id = crop_pests.pest_id
        and p.company_id = public.get_user_company_id()
        and coalesce(p.is_active, true) = true
        and coalesce(p.archived, false) = false
    )
  );

alter table public.pest_aliases enable row level security;
drop policy if exists "Allow public read global pest aliases" on public.pest_aliases;
create policy "Allow public read global pest aliases"
  on public.pest_aliases
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.pests p
      where p.id = pest_aliases.pest_id
        and p.company_id is null
        and coalesce(p.is_active, true) = true
        and coalesce(p.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company pest aliases" on public.pest_aliases;
create policy "Allow authenticated read company pest aliases"
  on public.pest_aliases
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.pests p
      where p.id = pest_aliases.pest_id
        and p.company_id = public.get_user_company_id()
        and coalesce(p.is_active, true) = true
        and coalesce(p.archived, false) = false
    )
  );

alter table public.crop_weeds enable row level security;
drop policy if exists "Allow public read global crop weeds" on public.crop_weeds;
create policy "Allow public read global crop weeds"
  on public.crop_weeds
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.weeds w
      where w.id = crop_weeds.weed_id
        and w.company_id is null
        and coalesce(w.is_active, true) = true
        and coalesce(w.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company crop weeds" on public.crop_weeds;
create policy "Allow authenticated read company crop weeds"
  on public.crop_weeds
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.weeds w
      where w.id = crop_weeds.weed_id
        and w.company_id = public.get_user_company_id()
        and coalesce(w.is_active, true) = true
        and coalesce(w.archived, false) = false
    )
  );

alter table public.weed_aliases enable row level security;
drop policy if exists "Allow public read global weed aliases" on public.weed_aliases;
create policy "Allow public read global weed aliases"
  on public.weed_aliases
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.weeds w
      where w.id = weed_aliases.weed_id
        and w.company_id is null
        and coalesce(w.is_active, true) = true
        and coalesce(w.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company weed aliases" on public.weed_aliases;
create policy "Allow authenticated read company weed aliases"
  on public.weed_aliases
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.weeds w
      where w.id = weed_aliases.weed_id
        and w.company_id = public.get_user_company_id()
        and coalesce(w.is_active, true) = true
        and coalesce(w.archived, false) = false
    )
  );

-- ---------------------------------------------------------------------------
-- GROUP C: Image metadata. Read follows parent visibility; no client writes.
-- ---------------------------------------------------------------------------

alter table public.disease_images enable row level security;
drop policy if exists "Allow public read global disease images" on public.disease_images;
create policy "Allow public read global disease images"
  on public.disease_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.diseases d
      where d.id = disease_images.disease_id
        and d.company_id is null
        and coalesce(d.is_active, true) = true
        and coalesce(d.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company disease images" on public.disease_images;
create policy "Allow authenticated read company disease images"
  on public.disease_images
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.diseases d
      where d.id = disease_images.disease_id
        and d.company_id = public.get_user_company_id()
        and coalesce(d.is_active, true) = true
        and coalesce(d.archived, false) = false
    )
  );

alter table public.pest_images enable row level security;
drop policy if exists "Allow public read global pest images" on public.pest_images;
create policy "Allow public read global pest images"
  on public.pest_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.pests p
      where p.id = pest_images.pest_id
        and p.company_id is null
        and coalesce(p.is_active, true) = true
        and coalesce(p.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company pest images" on public.pest_images;
create policy "Allow authenticated read company pest images"
  on public.pest_images
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.pests p
      where p.id = pest_images.pest_id
        and p.company_id = public.get_user_company_id()
        and coalesce(p.is_active, true) = true
        and coalesce(p.archived, false) = false
    )
  );

alter table public.weed_images enable row level security;
drop policy if exists "Allow public read global weed images" on public.weed_images;
create policy "Allow public read global weed images"
  on public.weed_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.weeds w
      where w.id = weed_images.weed_id
        and w.company_id is null
        and coalesce(w.is_active, true) = true
        and coalesce(w.archived, false) = false
    )
  );
drop policy if exists "Allow authenticated read company weed images" on public.weed_images;
create policy "Allow authenticated read company weed images"
  on public.weed_images
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.weeds w
      where w.id = weed_images.weed_id
        and w.company_id = public.get_user_company_id()
        and coalesce(w.is_active, true) = true
        and coalesce(w.archived, false) = false
    )
  );

-- ---------------------------------------------------------------------------
-- GROUP D: Legacy crop-care program tables. Global templates/codes remain read
-- only; company assignments/execution statuses are company scoped.
-- ---------------------------------------------------------------------------

alter table public.program_templates enable row level security;
drop policy if exists "Allow public read approved global program templates" on public.program_templates;
create policy "Allow public read approved global program templates"
  on public.program_templates
  for select
  to anon, authenticated
  using (
    company_id is null
    and coalesce(is_active, true) = true
    and status = 'approved'
  );
drop policy if exists "Allow authenticated read company program templates" on public.program_templates;
create policy "Allow authenticated read company program templates"
  on public.program_templates
  for select
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and coalesce(is_active, true) = true
    and status <> 'archived'
  );

alter table public.program_steps enable row level security;
drop policy if exists "Allow public read approved global program steps" on public.program_steps;
create policy "Allow public read approved global program steps"
  on public.program_steps
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.program_templates pt
      where pt.id = program_steps.program_template_id
        and pt.company_id is null
        and coalesce(pt.is_active, true) = true
        and pt.status = 'approved'
    )
  );
drop policy if exists "Allow authenticated read company program steps" on public.program_steps;
create policy "Allow authenticated read company program steps"
  on public.program_steps
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.program_templates pt
      where pt.id = program_steps.program_template_id
        and pt.company_id = public.get_user_company_id()
        and coalesce(pt.is_active, true) = true
        and pt.status <> 'archived'
    )
  );

alter table public.program_step_products enable row level security;
drop policy if exists "Allow public read approved global program step products" on public.program_step_products;
create policy "Allow public read approved global program step products"
  on public.program_step_products
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.program_steps ps
      join public.program_templates pt on pt.id = ps.program_template_id
      where ps.id = program_step_products.program_step_id
        and pt.company_id is null
        and coalesce(pt.is_active, true) = true
        and pt.status = 'approved'
    )
  );
drop policy if exists "Allow authenticated read company program step products" on public.program_step_products;
create policy "Allow authenticated read company program step products"
  on public.program_step_products
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.program_steps ps
      join public.program_templates pt on pt.id = ps.program_template_id
      where ps.id = program_step_products.program_step_id
        and pt.company_id = public.get_user_company_id()
        and coalesce(pt.is_active, true) = true
        and pt.status <> 'archived'
    )
  );

alter table public.program_step_target_risks enable row level security;
drop policy if exists "Allow public read approved global program step target risks" on public.program_step_target_risks;
create policy "Allow public read approved global program step target risks"
  on public.program_step_target_risks
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.program_steps ps
      join public.program_templates pt on pt.id = ps.program_template_id
      where ps.id = program_step_target_risks.program_step_id
        and pt.company_id is null
        and coalesce(pt.is_active, true) = true
        and pt.status = 'approved'
    )
  );
drop policy if exists "Allow authenticated read company program step target risks" on public.program_step_target_risks;
create policy "Allow authenticated read company program step target risks"
  on public.program_step_target_risks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.program_steps ps
      join public.program_templates pt on pt.id = ps.program_template_id
      where ps.id = program_step_target_risks.program_step_id
        and pt.company_id = public.get_user_company_id()
        and coalesce(pt.is_active, true) = true
        and pt.status <> 'archived'
    )
  );

alter table public.program_assignments enable row level security;
drop policy if exists "Allow authenticated manage company program assignments" on public.program_assignments;
drop policy if exists "Allow authenticated read company program assignments" on public.program_assignments;
-- Legacy program tables are read-only for authenticated users during go-live.
-- Write access can be added later by explicit migration if the legacy module is reactivated.
create policy "Allow authenticated read company program assignments"
  on public.program_assignments
  for select
  to authenticated
  using (company_id = public.get_user_company_id());

alter table public.program_step_execution_statuses enable row level security;
drop policy if exists "Allow authenticated manage company program step execution statuses" on public.program_step_execution_statuses;
drop policy if exists "Allow authenticated read company program step execution statuses" on public.program_step_execution_statuses;
-- Legacy program tables are read-only for authenticated users during go-live.
-- Write access can be added later by explicit migration if the legacy module is reactivated.
create policy "Allow authenticated read company program step execution statuses"
  on public.program_step_execution_statuses
  for select
  to authenticated
  using (company_id = public.get_user_company_id());
