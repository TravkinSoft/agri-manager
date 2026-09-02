-- Cover every opening-balance foreign key used by PostgreSQL parent-row checks.
-- Additive and repeat-safe; no business rows are changed.

create index if not exists warehouse_opening_balance_documents_season_v1
  on public.warehouse_opening_balance_documents(season_id);
create index if not exists warehouse_opening_balance_documents_creator_v1
  on public.warehouse_opening_balance_documents(created_by_profile_id);

create index if not exists warehouse_opening_balance_lines_season_v1
  on public.warehouse_opening_balance_lines(season_id);
create index if not exists warehouse_opening_balance_lines_warehouse_v1
  on public.warehouse_opening_balance_lines(warehouse_id);
create index if not exists warehouse_opening_balance_lines_inventory_batch_v1
  on public.warehouse_opening_balance_lines(inventory_batch_id);
create index if not exists warehouse_opening_balance_lines_harvest_lot_v1
  on public.warehouse_opening_balance_lines(harvest_lot_id);
create index if not exists warehouse_opening_balance_lines_ledger_v1
  on public.warehouse_opening_balance_lines(ledger_entry_id);
create index if not exists warehouse_opening_balance_lines_product_v1
  on public.warehouse_opening_balance_lines(product_id);
create index if not exists warehouse_opening_balance_lines_crop_v1
  on public.warehouse_opening_balance_lines(crop_id);
create index if not exists warehouse_opening_balance_lines_variety_v1
  on public.warehouse_opening_balance_lines(variety_id);
create index if not exists warehouse_opening_balance_lines_reproduction_v1
  on public.warehouse_opening_balance_lines(reproduction_id);
create index if not exists warehouse_opening_balance_lines_parent_batch_v1
  on public.warehouse_opening_balance_lines(parent_batch_id)
  where parent_batch_id is not null;

create index if not exists warehouse_opening_balance_sources_season_v1
  on public.warehouse_opening_balance_line_sources(season_id);
create index if not exists warehouse_opening_balance_sources_structure_v1
  on public.warehouse_opening_balance_line_sources(crop_structure_id);
create index if not exists warehouse_opening_balance_sources_field_v1
  on public.warehouse_opening_balance_line_sources(field_id);
