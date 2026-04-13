/*
  Warehouse card demo data + schema extension

  - Adds optional warehouse metadata for UI:
    warehouse_type, storage_capacity_kg
  - Seeds realistic warehouse names
  - Seeds initial balances through confirmed inventory movements (initial_balance)
*/

alter table public.warehouses
  add column if not exists warehouse_type text,
  add column if not exists storage_capacity_kg numeric(14, 2);

do $$
declare
  company_rec record;
  actor_user_id uuid;
  wh_potato uuid;
  wh_seed uuid;
  wh_grain_1 uuid;
  wh_grain_2 uuid;
  wh_veg uuid;
  wh_universal uuid;
  p_potato uuid;
  p_wheat uuid;
  p_carrot_goods uuid;
  p_carrot_seed uuid;
  p_onion uuid;
  p_rapeseed uuid;
  p_flax uuid;
  p_oats uuid;
begin
  for company_rec in
    select id
    from public.companies
  loop
    select p.id
      into actor_user_id
    from public.profiles p
    where p.company_id = company_rec.id
      and p.status = 'active'
      and p.role in ('admin', 'warehouse')
    order by case when p.role = 'admin' then 0 else 1 end, p.created_at asc
    limit 1;

    if actor_user_id is null then
      continue;
    end if;

    insert into public.warehouses (name, company_id, user_id, archived, warehouse_type, storage_capacity_kg)
    select 'Склад картофеля', company_rec.id, actor_user_id, false, 'vegetable', 3500000
    where not exists (
      select 1
      from public.warehouses w
      where w.company_id = company_rec.id
        and lower(w.name) = lower('Склад картофеля')
    );

    insert into public.warehouses (name, company_id, user_id, archived, warehouse_type, storage_capacity_kg)
    select 'Семенной склад', company_rec.id, actor_user_id, false, 'seed', 250000
    where not exists (
      select 1
      from public.warehouses w
      where w.company_id = company_rec.id
        and lower(w.name) = lower('Семенной склад')
    );

    insert into public.warehouses (name, company_id, user_id, archived, warehouse_type, storage_capacity_kg)
    select 'Зернохранилище №1', company_rec.id, actor_user_id, false, 'grain', 50000000
    where not exists (
      select 1
      from public.warehouses w
      where w.company_id = company_rec.id
        and lower(w.name) = lower('Зернохранилище №1')
    );

    insert into public.warehouses (name, company_id, user_id, archived, warehouse_type, storage_capacity_kg)
    select 'Зернохранилище №2', company_rec.id, actor_user_id, false, 'grain', 30000000
    where not exists (
      select 1
      from public.warehouses w
      where w.company_id = company_rec.id
        and lower(w.name) = lower('Зернохранилище №2')
    );

    insert into public.warehouses (name, company_id, user_id, archived, warehouse_type, storage_capacity_kg)
    select 'Овощной склад', company_rec.id, actor_user_id, false, 'vegetable', 5000000
    where not exists (
      select 1
      from public.warehouses w
      where w.company_id = company_rec.id
        and lower(w.name) = lower('Овощной склад')
    );

    insert into public.warehouses (name, company_id, user_id, archived, warehouse_type, storage_capacity_kg)
    select 'Универсальный склад', company_rec.id, actor_user_id, false, 'universal', 10000000
    where not exists (
      select 1
      from public.warehouses w
      where w.company_id = company_rec.id
        and lower(w.name) = lower('Универсальный склад')
    );

    select w.id into wh_potato from public.warehouses w where w.company_id = company_rec.id and lower(w.name) = lower('Склад картофеля') limit 1;
    select w.id into wh_seed from public.warehouses w where w.company_id = company_rec.id and lower(w.name) = lower('Семенной склад') limit 1;
    select w.id into wh_grain_1 from public.warehouses w where w.company_id = company_rec.id and lower(w.name) = lower('Зернохранилище №1') limit 1;
    select w.id into wh_grain_2 from public.warehouses w where w.company_id = company_rec.id and lower(w.name) = lower('Зернохранилище №2') limit 1;
    select w.id into wh_veg from public.warehouses w where w.company_id = company_rec.id and lower(w.name) = lower('Овощной склад') limit 1;
    select w.id into wh_universal from public.warehouses w where w.company_id = company_rec.id and lower(w.name) = lower('Универсальный склад') limit 1;

    update public.warehouses
       set warehouse_type = case
         when lower(name) = lower('Склад картофеля') then 'vegetable'
         when lower(name) = lower('Семенной склад') then 'seed'
         when lower(name) = lower('Зернохранилище №1') then 'grain'
         when lower(name) = lower('Зернохранилище №2') then 'grain'
         when lower(name) = lower('Овощной склад') then 'vegetable'
         when lower(name) = lower('Универсальный склад') then 'universal'
         else warehouse_type
       end,
       storage_capacity_kg = case
         when lower(name) = lower('Склад картофеля') then 3500000
         when lower(name) = lower('Семенной склад') then 250000
         when lower(name) = lower('Зернохранилище №1') then 50000000
         when lower(name) = lower('Зернохранилище №2') then 30000000
         when lower(name) = lower('Овощной склад') then 5000000
         when lower(name) = lower('Универсальный склад') then 10000000
         else storage_capacity_kg
       end
     where company_id = company_rec.id;

    insert into public.products (name, type, unit, company_id, user_id, archived)
    select 'Картофель', 'produce', 'kg', company_rec.id, actor_user_id, false
    where not exists (
      select 1 from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Картофель')
    );

    insert into public.products (name, type, unit, company_id, user_id, archived)
    select 'Пшеница', 'produce', 'kg', company_rec.id, actor_user_id, false
    where not exists (
      select 1 from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Пшеница')
    );

    insert into public.products (name, type, unit, company_id, user_id, archived)
    select 'Морковь (товарная)', 'produce', 'kg', company_rec.id, actor_user_id, false
    where not exists (
      select 1 from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Морковь (товарная)')
    );

    insert into public.products (name, type, unit, company_id, user_id, archived)
    select 'Морковь (семена)', 'seed', 'kg', company_rec.id, actor_user_id, false
    where not exists (
      select 1 from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Морковь (семена)')
    );

    insert into public.products (name, type, unit, company_id, user_id, archived)
    select 'Лук', 'produce', 'kg', company_rec.id, actor_user_id, false
    where not exists (
      select 1 from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Лук')
    );

    insert into public.products (name, type, unit, company_id, user_id, archived)
    select 'Рапс', 'produce', 'kg', company_rec.id, actor_user_id, false
    where not exists (
      select 1 from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Рапс')
    );

    insert into public.products (name, type, unit, company_id, user_id, archived)
    select 'Лен', 'produce', 'kg', company_rec.id, actor_user_id, false
    where not exists (
      select 1 from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Лен')
    );

    insert into public.products (name, type, unit, company_id, user_id, archived)
    select 'Овес', 'produce', 'kg', company_rec.id, actor_user_id, false
    where not exists (
      select 1 from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Овес')
    );

    select p.id into p_potato from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Картофель') limit 1;
    select p.id into p_wheat from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Пшеница') limit 1;
    select p.id into p_carrot_goods from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Морковь (товарная)') limit 1;
    select p.id into p_carrot_seed from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Морковь (семена)') limit 1;
    select p.id into p_onion from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Лук') limit 1;
    select p.id into p_rapeseed from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Рапс') limit 1;
    select p.id into p_flax from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Лен') limit 1;
    select p.id into p_oats from public.products p where p.company_id = company_rec.id and lower(p.name) = lower('Овес') limit 1;

    delete from public.inventory_transactions it
     where it.company_id = company_rec.id
       and it.notes = '[seed] initial_balance_warehouse_cards_20260410';

    insert into public.inventory_transactions (
      warehouse_id,
      source_warehouse_id,
      destination_warehouse_id,
      product_id,
      quantity,
      transaction_type,
      movement_type,
      status,
      operation_datetime,
      date,
      notes,
      responsible_user_id,
      confirmed_at,
      user_id,
      company_id
    )
    values
      (wh_potato, null, wh_potato, p_potato, 2000000, 'in', 'adjustment', 'confirmed', now(), now()::date, '[seed] initial_balance_warehouse_cards_20260410', actor_user_id, now(), actor_user_id, company_rec.id),
      (wh_grain_1, null, wh_grain_1, p_wheat, 30000000, 'in', 'adjustment', 'confirmed', now(), now()::date, '[seed] initial_balance_warehouse_cards_20260410', actor_user_id, now(), actor_user_id, company_rec.id),
      (wh_veg, null, wh_veg, p_carrot_goods, 800000, 'in', 'adjustment', 'confirmed', now(), now()::date, '[seed] initial_balance_warehouse_cards_20260410', actor_user_id, now(), actor_user_id, company_rec.id),
      (wh_seed, null, wh_seed, p_carrot_seed, 30, 'in', 'adjustment', 'confirmed', now(), now()::date, '[seed] initial_balance_warehouse_cards_20260410', actor_user_id, now(), actor_user_id, company_rec.id),
      (wh_veg, null, wh_veg, p_onion, 500000, 'in', 'adjustment', 'confirmed', now(), now()::date, '[seed] initial_balance_warehouse_cards_20260410', actor_user_id, now(), actor_user_id, company_rec.id),
      (wh_grain_2, null, wh_grain_2, p_rapeseed, 12000000, 'in', 'adjustment', 'confirmed', now(), now()::date, '[seed] initial_balance_warehouse_cards_20260410', actor_user_id, now(), actor_user_id, company_rec.id),
      (wh_grain_2, null, wh_grain_2, p_flax, 7000000, 'in', 'adjustment', 'confirmed', now(), now()::date, '[seed] initial_balance_warehouse_cards_20260410', actor_user_id, now(), actor_user_id, company_rec.id),
      (wh_universal, null, wh_universal, p_oats, 9000000, 'in', 'adjustment', 'confirmed', now(), now()::date, '[seed] initial_balance_warehouse_cards_20260410', actor_user_id, now(), actor_user_id, company_rec.id);
  end loop;
end $$;

