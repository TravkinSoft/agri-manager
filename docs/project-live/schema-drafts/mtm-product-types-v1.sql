-- UNAPPLIED MTM prerequisite. Expand only the existing products.type CHECK.
-- No product rows are inserted, renamed, reclassified or backfilled.
-- product_type remains the existing agrochemical classification (NULL for MTM).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- PostgreSQL normalizes both expressions, avoiding version-specific formatting
-- assumptions while still rejecting any different current restriction.
create temporary table mtm_product_type_preflight(type text not null) on commit drop;
alter table mtm_product_type_preflight add constraint mtm_expected_old_type_check
  check (type in ('produce','seed','fertilizer','pesticide'));

-- Lock before comparing the definition so a concurrent migration cannot change
-- the checked constraint between preflight and replacement. Timeout is bounded.
lock table public.products in access exclusive mode;
do $$
declare actual_definition text; expected_definition text;
begin
  if not exists(select 1 from pg_catalog.pg_attribute
    where attrelid='public.products'::regclass and attname='type'
      and atttypid='text'::regtype and attnotnull and not attisdropped) then
    raise exception 'MTM_PRODUCTS_TYPE_COLUMN_MISMATCH' using errcode='55000';
  end if;
  select pg_catalog.pg_get_constraintdef(oid) into actual_definition
  from pg_catalog.pg_constraint
  where conrelid='public.products'::regclass and conname='products_type_check' and contype='c';
  select pg_catalog.pg_get_constraintdef(oid) into expected_definition
  from pg_catalog.pg_constraint
  where conrelid='pg_temp.mtm_product_type_preflight'::regclass
    and conname='mtm_expected_old_type_check';
  if actual_definition is null or actual_definition is distinct from expected_definition then
    raise exception 'MTM_PRODUCTS_TYPE_CHECK_MISMATCH' using errcode='55000';
  end if;
end $$;

alter table public.products
  drop constraint products_type_check,
  add constraint products_type_check
    check (type in ('produce','seed','fertilizer','pesticide','material','fuel'));
commit;
