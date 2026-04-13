/*
  Strict agrochemistry policy:
  - Company cannot create pesticide/fertilizer from scratch.
  - Company entries must be linked to global master_product_id.
  - Company cannot modify master identity fields.
*/

create or replace function public.enforce_agrochem_master_only()
returns trigger
language plpgsql
as $$
declare
  master_row public.products%rowtype;
begin
  if new.type not in ('pesticide', 'fertilizer') then
    return new;
  end if;

  if new.company_id is not null then
    if new.master_product_id is null then
      raise exception 'Company agrochemical must reference global master_product_id';
    end if;

    select *
    into master_row
    from public.products
    where id = new.master_product_id
      and company_id is null
      and archived = false
    limit 1;

    if not found then
      raise exception 'master_product_id must point to active global agrochemical';
    end if;

    if master_row.type <> new.type then
      raise exception 'Master product type mismatch';
    end if;

    new.name := master_row.name;
    new.trade_name := master_row.trade_name;
    new.active_ingredient := master_row.active_ingredient;
    new.pesticide_category := master_row.pesticide_category;
    new.pesticide_subcategories := master_row.pesticide_subcategories;
    new.fertilizer_type := master_row.fertilizer_type;
    new.formulation := master_row.formulation;
    new.manufacturer := master_row.manufacturer;
    new.package_size := master_row.package_size;
    new.package_unit := master_row.package_unit;
    new.default_unit := master_row.default_unit;
    new.unit := master_row.unit;
  end if;

  if tg_op = 'UPDATE' and old.company_id is not null then
    if old.master_product_id is distinct from new.master_product_id then
      raise exception 'Company agrochemical cannot change master_product_id';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_agrochem_master_only on public.products;
create trigger trg_enforce_agrochem_master_only
before insert or update on public.products
for each row
execute function public.enforce_agrochem_master_only();

create unique index if not exists ux_products_company_master_agrochem
  on public.products(company_id, master_product_id)
  where company_id is not null
    and type in ('pesticide', 'fertilizer')
    and archived = false;

