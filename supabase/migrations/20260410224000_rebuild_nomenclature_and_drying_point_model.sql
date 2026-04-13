/*
  Rebuild nomenclature model + drying point workflow foundation
  - separates crop from concrete stock nomenclature
  - introduces accounting modes for product forms
  - keeps movements unified in base mass (kg) per nomenclature position
*/

do $$ begin
  create type public.product_accounting_mode as enum ('bulk_mass', 'unit_with_weight', 'package_count');
exception when duplicate_object then null;
end $$;

alter table public.products
  add column if not exists crop_id uuid references public.crops(id),
  add column if not exists product_form text,
  add column if not exists accounting_mode public.product_accounting_mode not null default 'bulk_mass',
  add column if not exists base_uom text not null default 'kg',
  add column if not exists pack_uom text,
  add column if not exists unit_weight_kg numeric(14,6),
  add column if not exists units_per_pack numeric(14,6),
  add column if not exists is_seed_material boolean not null default false;

create index if not exists idx_products_company_crop on public.products(company_id, crop_id);
create index if not exists idx_products_company_type_mode on public.products(company_id, type, accounting_mode);

alter table public.products
  add constraint products_unit_weight_positive
  check (unit_weight_kg is null or unit_weight_kg > 0);

alter table public.products
  add constraint products_units_per_pack_positive
  check (units_per_pack is null or units_per_pack > 0);

create unique index if not exists ux_products_company_name_form
  on public.products(company_id, lower(name), coalesce(lower(product_form), ''));

alter table public.inventory_transactions
  add column if not exists quantity_input numeric(14,3),
  add column if not exists input_uom text,
  add column if not exists base_quantity_kg numeric(14,3);

update public.inventory_transactions
set
  quantity_input = coalesce(quantity_input, quantity),
  input_uom = coalesce(input_uom, 'kg'),
  base_quantity_kg = coalesce(base_quantity_kg, quantity)
where quantity_input is null or input_uom is null or base_quantity_kg is null;

alter table public.inventory_transactions
  add constraint inventory_transactions_base_qty_non_negative
  check (base_quantity_kg is null or base_quantity_kg >= 0);

create or replace function public.normalize_to_kg(
  p_qty numeric,
  p_uom text
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_uom text := lower(coalesce(trim(p_uom), 'kg'));
begin
  if p_qty is null then
    return 0;
  end if;

  if v_uom in ('kg', 'кг') then
    return p_qty;
  end if;

  if v_uom in ('t', 'ton', 'tons', 'т') then
    return p_qty * 1000;
  end if;

  return p_qty;
end;
$$;

create or replace function public.calc_product_base_qty_kg(
  p_product_id uuid,
  p_qty numeric,
  p_input_uom text default 'kg'
)
returns numeric
language plpgsql
stable
as $$
declare
  v_product record;
  v_qty numeric := coalesce(p_qty, 0);
begin
  select
    id,
    accounting_mode,
    unit_weight_kg,
    units_per_pack
  into v_product
  from public.products
  where id = p_product_id;

  if not found then
    return public.normalize_to_kg(v_qty, p_input_uom);
  end if;

  if v_product.accounting_mode = 'bulk_mass' then
    return public.normalize_to_kg(v_qty, p_input_uom);
  end if;

  if v_product.accounting_mode = 'unit_with_weight' then
    return v_qty * coalesce(v_product.unit_weight_kg, 1);
  end if;

  if v_product.accounting_mode = 'package_count' then
    return v_qty * coalesce(v_product.units_per_pack, 1) * coalesce(v_product.unit_weight_kg, 1);
  end if;

  return public.normalize_to_kg(v_qty, p_input_uom);
end;
$$;

comment on column public.products.crop_id is 'Base crop link: crop != nomenclature position';
comment on column public.products.product_form is 'Storage/form: seed, товарная, bulk, bag, canister, etc.';
comment on column public.products.accounting_mode is 'How quantity is counted before normalization to kg';
comment on column public.inventory_transactions.base_quantity_kg is 'Unified quantity in kg for cross-form analytics';

