/*
  Catalog master-data improvements:
  - global + company product linkage
  - mandatory active ingredient (DW) for agrochemicals
  - pesticide subcategories support
*/

alter table public.products
  add column if not exists master_product_id uuid references public.products(id),
  add column if not exists active_ingredient text,
  add column if not exists pesticide_subcategories text[] not null default '{}';

create index if not exists idx_products_master_product_id on public.products(master_product_id);

update public.products
set active_ingredient = coalesce(nullif(active_ingredient, ''), 'unknown')
where type in ('pesticide', 'fertilizer');

alter table public.products
  alter column active_ingredient set default 'unknown';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_agrochem_active_ingredient_required'
  ) then
    alter table public.products
      add constraint products_agrochem_active_ingredient_required
      check (
        case
          when type in ('pesticide', 'fertilizer') then active_ingredient is not null and length(trim(active_ingredient)) > 0
          else true
        end
      );
  end if;
end $$;

