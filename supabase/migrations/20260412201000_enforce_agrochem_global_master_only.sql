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
  master_row record;
begin
  if new.type not in ('pesticide', 'fertilizer') then
    return new;
  end if;

  if new.company_id is not null then
    if new.master_product_id is null then
      raise exception 'Company agrochemical must reference global master_product_id';
    end if;

    select
      id,
      type,
      name,
      active_ingredient,
      unit,
      archived,
      company_id
    into master_row
    from public.products
    where id = new.master_product_id
      and company_id is null
      and coalesce(archived, false) = false
    limit 1;

    if not found then
      raise exception 'master_product_id must point to active global agrochemical';
    end if;

    if master_row.type <> new.type then
      raise exception 'Master product type mismatch';
    end if;

    new.name := master_row.name;
    new.active_ingredient := coalesce(master_row.active_ingredient, new.active_ingredient, 'unknown');
    new.unit := coalesce(master_row.unit, new.unit, case when new.type = 'pesticide' then 'l' else 'kg' end);
  end if;

  if tg_op = 'UPDATE' and old.company_id is not null then
    if old.master_product_id is not null
       and old.master_product_id is distinct from new.master_product_id then
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

-- Canonical production trigger implementation.
CREATE OR REPLACE FUNCTION public.enforce_agrochem_master_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
declare
  master_row record;
begin
  if new.type not in ('pesticide', 'fertilizer') then
    return new;
  end if;

  if new.company_id is not null then
    if new.master_product_id is null then
      raise exception 'Company agrochemical must reference global master_product_id';
    end if;

    select
      id,
      type,
      name,
      active_ingredient,
      unit,
      archived,
      company_id
    into master_row
    from public.products
    where id = new.master_product_id
      and company_id is null
      and coalesce(archived, false) = false
    limit 1;

    if not found then
      raise exception 'master_product_id must point to active global agrochemical';
    end if;

    if master_row.type <> new.type then
      raise exception 'Master product type mismatch';
    end if;

    -- синхронизация базовых полей
    new.name := master_row.name;
    new.active_ingredient := coalesce(master_row.active_ingredient, new.active_ingredient, 'unknown');
    new.unit := coalesce(master_row.unit, new.unit, case when new.type = 'pesticide' then 'l' else 'kg' end);
  end if;

  -- ВАЖНО:
  -- Разрешаем только первичную установку (old null -> new not null)
  -- Запрещаем любую последующую смену master_product_id
  if tg_op = 'UPDATE' and old.company_id is not null then
    if old.master_product_id is not null
       and old.master_product_id is distinct from new.master_product_id then
      raise exception 'Company agrochemical cannot change master_product_id';
    end if;
  end if;

  return new;
end;
$$;
