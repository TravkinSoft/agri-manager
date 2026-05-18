-- Verification after parts 01..04
select
  obj,
  to_regclass(obj) is not null as exists
from (values
  ('public.import_batches'),
  ('public.import_batch_rows'),
  ('public.field_season_flags'),
  ('public.field_history_entries'),
  ('public.field_cadastre_links')
) t(obj);

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('import_batches', 'import_batch_rows', 'field_season_flags')
order by tablename;

select indexname, tablename
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_import_batches_company_created',
    'ux_import_batch_rows_unique_source_row',
    'idx_import_batch_rows_scope',
    'idx_field_season_flags_scope',
    'idx_field_cadastre_links_import_batch'
  )
order by indexname;
