begin;

-- TZ315 Production corrective: the migration history contains the original
-- canonical-units migration, but the physical validator function is absent.
-- Recreate only the missing repeat-safe contract; no table or business rows
-- are changed.
create or replace function public.validate_stock_quantity_contract(
  p_product_id uuid,
  p_quantity numeric,
  p_uom text,
  p_batch_class text,
  p_mass_kg numeric default null,
  p_density_kg_per_l numeric default null,
  p_density_unit text default null,
  p_density_source text default null,
  p_density_verification_status text default null,
  p_density_verified_at timestamptz default null
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_product_uom text;
  v_product_type text;
  v_is_seed boolean;
  v_uom text := public.canonical_stock_uom(p_uom);
begin
  select public.canonical_stock_uom(coalesce(nullif(base_uom, ''), unit)),
         lower(trim(coalesce(product_type, type, ''))),
         coalesce(is_seed_material, false)
    into v_product_uom, v_product_type, v_is_seed
  from public.products
  where id = p_product_id;

  if not found then raise exception 'Stock product not found'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Stock quantity must be positive'; end if;
  if v_uom is null then raise exception 'Unknown warehouse unit. Allowed units: kg, l, pcs'; end if;
  if v_product_uom is null then raise exception 'Product warehouse unit is missing or unsupported'; end if;
  if v_uom <> v_product_uom then raise exception 'Movement unit does not match product warehouse unit'; end if;
  if p_batch_class is null or p_batch_class not in ('commodity','seed','material','feed','waste','processing','rejected') then
    raise exception 'Canonical batch class is required';
  end if;
  if (v_is_seed or v_product_type in ('seed','seeds','planting_material')) and p_batch_class <> 'seed' then
    raise exception 'Seed material cannot be stored as commodity or material';
  end if;
  if v_product_type in ('pesticide','fertilizer','additive','adjuvant','defoamer','fuel','material','organic')
     and p_batch_class = 'commodity' then
    raise exception 'Material cannot be stored as commodity';
  end if;
  if p_mass_kg is not null and p_mass_kg < 0 then raise exception 'Mass must be non-negative'; end if;
  if v_uom = 'kg' and abs(coalesce(p_mass_kg, -1) - p_quantity) > 0.000001 then
    raise exception 'Kilogram quantity and mass must match';
  end if;
  if v_uom = 'pcs' and p_mass_kg is not null then
    raise exception 'Piece quantity cannot silently become mass';
  end if;
  if v_uom = 'l' and p_mass_kg is not null and not (
    p_density_kg_per_l > 0
    and lower(trim(coalesce(p_density_unit, ''))) = 'kg/l'
    and nullif(trim(coalesce(p_density_source, '')), '') is not null
    and lower(trim(coalesce(p_density_verification_status, ''))) = 'verified'
    and p_density_verified_at is not null
    and abs(p_mass_kg - p_quantity * p_density_kg_per_l) <= 0.001
  ) then
    raise exception 'Verified density evidence is required for liquid mass';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
