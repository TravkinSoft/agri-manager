/*
  Material classification V1.

  Goal:
  - native product_type groups: pesticide / fertilizer / additive
  - transition-safe support for legacy product_type values until a separate backfill
  - no data backfill in this migration

  products.type is intentionally not changed here.
*/

alter table public.products
  drop constraint if exists products_product_type_check;

alter table public.products
  add constraint products_product_type_check
  check (
    product_type is null
    or product_type in (
      'pesticide',
      'fertilizer',
      'additive',
      'growth_regulator',
      'adjuvant'
    )
  );

alter table public.products
  drop constraint if exists products_product_subcategory_check_v1;

alter table public.products
  add constraint products_product_subcategory_check_v1
  check (
    product_type is null
    or subcategory is null
    or product_type in ('growth_regulator', 'adjuvant')
    or (
      product_type = 'pesticide'
      and subcategory in (
        'herbicide',
        'fungicide',
        'insecticide',
        'acaricide',
        'desiccant',
        'seed_treatment',
        'growth_regulator',
        'other'
      )
    )
    or (
      product_type = 'fertilizer'
      and subcategory in (
        'macro',
        'micro',
        'foliar',
        'water_soluble',
        'organic',
        'organomineral',
        'biostimulant',
        'other'
      )
    )
    or (
      product_type = 'additive'
      and subcategory in (
        'adjuvant',
        'sticker',
        'pH_corrector',
        'antifoam',
        'water_conditioner',
        'anti_salt',
        'other'
      )
    )
  ) not valid;

create index if not exists idx_products_global_material_classification
  on public.products (product_type, subcategory, category)
  where company_id is null and archived = false;

