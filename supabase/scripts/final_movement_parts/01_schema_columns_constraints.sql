
-- Final movement model: shipment, field material categories, and processing lineage.

alter table public.tickets
  add column if not exists season_id uuid references public.seasons(id) on delete set null,
  add column if not exists buyer_id uuid,
  add column if not exists shipment_purpose text,
  add column if not exists destination_text text,
  add column if not exists external_document_no text,
  add column if not exists field_material_category text,
  add column if not exists disposal_category text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_field_material_category_check'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_field_material_category_check
      check (
        field_material_category is null
        or field_material_category in (
          'seed_planting_material',
          'fertilizer',
          'crop_protection',
          'organic',
          'fuel',
          'other'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_disposal_category_check'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_disposal_category_check
      check (
        disposal_category is null
        or disposal_category in ('utilization', 'spoilage', 'shortage', 'waste', 'other_removal')
      );
  end if;
end $$;

create index if not exists idx_tickets_company_buyer
  on public.tickets(company_id, buyer_id);

create index if not exists idx_tickets_company_field_material_category
  on public.tickets(company_id, field_material_category);

alter table public.inventory_batches
  add column if not exists parent_batch_id uuid references public.inventory_batches(id) on delete set null,
  add column if not exists source_transformation_id uuid,
  add column if not exists origin_type text,
  add column if not exists origin_ref_id uuid,
  add column if not exists supplier_lot text,
  add column if not exists treatment_status text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_batches_treatment_status_check'
      and conrelid = 'public.inventory_batches'::regclass
  ) then
    alter table public.inventory_batches
      add constraint inventory_batches_treatment_status_check
      check (
        treatment_status is null
        or treatment_status in ('untreated', 'treated', 'in_treatment', 'not_applicable')
      );
  end if;
end $$;

create index if not exists idx_inventory_batches_parent
  on public.inventory_batches(company_id, parent_batch_id);

create index if not exists idx_inventory_batches_transformation
  on public.inventory_batches(company_id, source_transformation_id);

alter table public.batch_transformations
  add column if not exists source_ticket_id uuid references public.tickets(id) on delete set null;

alter table public.batch_transformation_outputs
  add column if not exists batch_class text;

do $$
begin
  alter table public.batch_transformations
    drop constraint if exists batch_transformations_transformation_type_check;

  alter table public.batch_transformations
    add constraint batch_transformations_transformation_type_check
    check (
      transformation_type in (
        'drying',
        'cleaning',
        'sorting',
        'calibration',
        'seed_treatment',
        'seed_selection',
        'packaging',
        'aeration',
        'conditioning',
        'reclassification',
        'potato_sorting',
        'other'
      )
    );

  alter table public.batch_transformation_outputs
    drop constraint if exists batch_transformation_outputs_line_type_check;

  alter table public.batch_transformation_outputs
    add constraint batch_transformation_outputs_line_type_check
    check (
      line_type in (
        'cleaned_seed',
        'commodity',
        'forage_fraction',
        'waste_fraction',
        'soil',
        'shrink_loss',
        'process_loss',
        'treated_seed',
        'calibrated_fraction',
        'packaged',
        'reclassified',
        'potato_marketable',
        'potato_seed',
        'potato_small',
        'potato_rotten',
        'potato_soil',
        'other'
      )
    );

  if not exists (
    select 1
    from pg_constraint
    where conname = 'batch_transformation_outputs_batch_class_check'
      and conrelid = 'public.batch_transformation_outputs'::regclass
  ) then
    alter table public.batch_transformation_outputs
      add constraint batch_transformation_outputs_batch_class_check
      check (
        batch_class is null
        or batch_class in ('commodity', 'seed', 'feed', 'waste', 'processing', 'rejected')
      );
  end if;
end $$;

create index if not exists idx_batch_transformations_company_status
  on public.batch_transformations(company_id, status, created_at desc);

create index if not exists idx_batch_transformation_inputs_identity
  on public.batch_transformation_inputs(company_id, warehouse_from_id, batch_id);

create index if not exists idx_batch_transformation_outputs_identity
  on public.batch_transformation_outputs(company_id, warehouse_to_id, output_batch_id);
