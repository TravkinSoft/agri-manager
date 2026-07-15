/*
  Cleanup + alignment for company context:
  ТОО "Астык-STEM"

  Scope:
  - map local crops/varieties/seed reproductions to global master rows
  - archive company-local duplicates after remap
  - align company agrochem products to global master_product_id
  - collapse duplicate company agrochem rows
  - seed realistic STEM warehouse stock for assistant grounding
*/

do $$
declare
  v_company_id uuid;
  v_actor_user_id uuid;
  v_wh_pesticides uuid;
  v_wh_fertilizers uuid;
  v_now timestamptz := now();
begin
  select c.id
    into v_company_id
  from public.companies c
  where lower(c.name) like '%астык-stem%'
     or lower(c.name) like '%astyk-stem%'
     or lower(c.name) like '%agrotech solutions%'
  order by c.created_at asc
  limit 1;

  if v_company_id is null then
    raise notice 'Skipping legacy company cleanup: target company is absent';
    return;
  end if;

  select p.id
    into v_actor_user_id
  from public.profiles p
  where p.company_id = v_company_id
    and p.status = 'active'
    and p.role in ('company_admin', 'admin', 'warehouse', 'agronomist', 'global_admin')
  order by
    case
      when p.role = 'company_admin' then 0
      when p.role = 'admin' then 1
      when p.role = 'warehouse' then 2
      else 3
    end,
    p.created_at asc
  limit 1;

  if v_actor_user_id is null then
    raise notice 'Skipping legacy company cleanup: no active operator exists for company %', v_company_id;
    return;
  end if;

  -- =====================================================
  -- 1) CROP / VARIETY / SEED REPRODUCTION REMAP TO GLOBAL
  -- =====================================================
  create temporary table tmp_crop_map (
    local_id uuid primary key,
    global_id uuid not null
  ) on commit drop;

  insert into tmp_crop_map(local_id, global_id)
  select lc.id as local_id, gc.id as global_id
  from public.crops lc
  join public.crops gc
    on gc.company_id is null
   and gc.archived = false
   and (
        (lc.slug is not null and gc.slug is not null and lower(lc.slug) = lower(gc.slug))
        or lower(coalesce(nullif(lc.name_ru, ''), nullif(lc.name_en, ''), lc.name))
           = lower(coalesce(nullif(gc.name_ru, ''), nullif(gc.name_en, ''), gc.name))
       )
  where lc.company_id = v_company_id
    and lc.archived = false;

  -- avoid collisions: remove would-be duplicate rows in crop_structure before remap
  delete from public.crop_structure cs
  using tmp_crop_map cm, public.crop_structure cs2
  where cs.company_id = v_company_id
    and cs.crop_id = cm.local_id
    and cs2.company_id = v_company_id
    and cs2.id <> cs.id
    and cs2.field_id = cs.field_id
    and cs2.season_id = cs.season_id
    and cs2.crop_id = cm.global_id
    and coalesce(cs2.variety_id::text, '') = coalesce(cs.variety_id::text, '')
    and coalesce(cs2.reproduction_id::text, '') = coalesce(cs.reproduction_id::text, '');

  update public.crop_structure cs
     set crop_id = cm.global_id
  from tmp_crop_map cm
  where cs.company_id = v_company_id
    and cs.crop_id = cm.local_id;

  update public.crops lc
     set archived = true,
         is_active = false
  from tmp_crop_map cm
  where lc.id = cm.local_id
    and not exists (
      select 1
      from public.crop_structure cs
      where cs.company_id = v_company_id
        and cs.crop_id = lc.id
        and cs.archived = false
    );

  create temporary table tmp_variety_map (
    local_id uuid primary key,
    global_id uuid not null
  ) on commit drop;

  insert into tmp_variety_map(local_id, global_id)
  select lv.id as local_id, gv.id as global_id
  from public.varieties lv
  join public.varieties gv
    on gv.company_id is null
   and gv.archived = false
   and lower(gv.name) = lower(lv.name)
  left join tmp_crop_map cm on cm.local_id = lv.crop_id
  where lv.company_id = v_company_id
    and lv.archived = false
    and gv.crop_id = coalesce(cm.global_id, lv.crop_id);

  delete from public.crop_structure cs
  using tmp_variety_map vm, public.crop_structure cs2
  where cs.company_id = v_company_id
    and cs.variety_id = vm.local_id
    and cs2.company_id = v_company_id
    and cs2.id <> cs.id
    and cs2.field_id = cs.field_id
    and cs2.season_id = cs.season_id
    and coalesce(cs2.crop_id::text, '') = coalesce(cs.crop_id::text, '')
    and cs2.variety_id = vm.global_id
    and coalesce(cs2.reproduction_id::text, '') = coalesce(cs.reproduction_id::text, '');

  update public.crop_structure cs
     set variety_id = vm.global_id
  from tmp_variety_map vm
  where cs.company_id = v_company_id
    and cs.variety_id = vm.local_id;

  update public.varieties lv
     set archived = true,
         is_active = false
  from tmp_variety_map vm
  where lv.id = vm.local_id
    and not exists (
      select 1
      from public.crop_structure cs
      where cs.company_id = v_company_id
        and cs.variety_id = lv.id
        and cs.archived = false
    );

  create temporary table tmp_reproduction_map (
    local_id uuid primary key,
    global_id uuid not null
  ) on commit drop;

  insert into tmp_reproduction_map(local_id, global_id)
  select lr.id as local_id, gr.id as global_id
  from public.seed_reproductions lr
  join public.seed_reproductions gr
    on gr.company_id is null
   and gr.archived = false
   and lower(gr.name) = lower(lr.name)
  where lr.company_id = v_company_id
    and lr.archived = false;

  delete from public.crop_structure cs
  using tmp_reproduction_map rm, public.crop_structure cs2
  where cs.company_id = v_company_id
    and cs.reproduction_id = rm.local_id
    and cs2.company_id = v_company_id
    and cs2.id <> cs.id
    and cs2.field_id = cs.field_id
    and cs2.season_id = cs.season_id
    and coalesce(cs2.crop_id::text, '') = coalesce(cs.crop_id::text, '')
    and coalesce(cs2.variety_id::text, '') = coalesce(cs.variety_id::text, '')
    and cs2.reproduction_id = rm.global_id;

  update public.crop_structure cs
     set reproduction_id = rm.global_id
  from tmp_reproduction_map rm
  where cs.company_id = v_company_id
    and cs.reproduction_id = rm.local_id;

  update public.seed_reproductions lr
     set archived = true,
         is_active = false
  from tmp_reproduction_map rm
  where lr.id = rm.local_id
    and not exists (
      select 1
      from public.crop_structure cs
      where cs.company_id = v_company_id
        and cs.reproduction_id = lr.id
        and cs.archived = false
    );

  -- =====================================================
  -- 2) AGROCHEM COMPANY PRODUCTS ALIGNMENT TO GLOBAL
  -- =====================================================
  update public.products cp
     set master_product_id = gp.id
  from public.products gp
  where cp.company_id = v_company_id
    and cp.archived = false
    and cp.type in ('pesticide', 'fertilizer')
    and cp.master_product_id is null
    and gp.company_id is null
    and gp.archived = false
    and gp.type = cp.type
    and lower(coalesce(nullif(cp.trade_name, ''), cp.name)) = lower(coalesce(nullif(gp.trade_name, ''), gp.name));

  -- collapse duplicate company rows that point to same master product
  create temporary table tmp_company_product_keep (
    keep_id uuid primary key,
    master_product_id uuid not null
  ) on commit drop;

  insert into tmp_company_product_keep(keep_id, master_product_id)
  select min(cp.id) as keep_id, cp.master_product_id
  from public.products cp
  where cp.company_id = v_company_id
    and cp.archived = false
    and cp.master_product_id is not null
    and cp.type in ('pesticide', 'fertilizer', 'growth_regulator', 'adjuvant')
  group by cp.master_product_id;

  create temporary table tmp_company_product_dups (
    id uuid primary key,
    keep_id uuid not null
  ) on commit drop;

  insert into tmp_company_product_dups(id, keep_id)
  select cp.id, k.keep_id
  from public.products cp
  join tmp_company_product_keep k on k.master_product_id = cp.master_product_id
  where cp.company_id = v_company_id
    and cp.archived = false
    and cp.master_product_id is not null
    and cp.id <> k.keep_id
    and cp.type in ('pesticide', 'fertilizer', 'growth_regulator', 'adjuvant');

  update public.inventory_transactions it
     set product_id = d.keep_id
  from tmp_company_product_dups d
  where it.company_id = v_company_id
    and it.product_id = d.id;

  update public.products cp
     set archived = true
  from tmp_company_product_dups d
  where cp.id = d.id;

  -- =====================================================
  -- 3) WAREHOUSE SETUP + TEST STOCK FOR STEM
  -- =====================================================
  insert into public.warehouses (name, company_id, user_id, warehouse_type, storage_capacity_kg, archived)
  select 'Склад СЗР', v_company_id, v_actor_user_id, 'pesticide', 500000, false
  where not exists (
    select 1
    from public.warehouses w
    where w.company_id = v_company_id
      and lower(w.name) = lower('Склад СЗР')
      and coalesce(w.archived, false) = false
  );

  insert into public.warehouses (name, company_id, user_id, warehouse_type, storage_capacity_kg, archived)
  select 'Склад удобрений', v_company_id, v_actor_user_id, 'fertilizer', 3000000, false
  where not exists (
    select 1
    from public.warehouses w
    where w.company_id = v_company_id
      and lower(w.name) = lower('Склад удобрений')
      and coalesce(w.archived, false) = false
  );

  select w.id
    into v_wh_pesticides
  from public.warehouses w
  where w.company_id = v_company_id
    and coalesce(w.archived, false) = false
    and (
      lower(w.name) like '%сзр%'
      or lower(w.name) like '%пестиц%'
    )
  order by w.created_at asc
  limit 1;

  select w.id
    into v_wh_fertilizers
  from public.warehouses w
  where w.company_id = v_company_id
    and coalesce(w.archived, false) = false
    and (
      lower(w.name) like '%удобрен%'
      or lower(w.name) like '%fert%'
    )
  order by w.created_at asc
  limit 1;

  if v_wh_pesticides is null then
    select w.id into v_wh_pesticides
    from public.warehouses w
    where w.company_id = v_company_id
      and coalesce(w.archived, false) = false
    order by w.created_at asc
    limit 1;
  end if;

  if v_wh_fertilizers is null then
    select w.id into v_wh_fertilizers
    from public.warehouses w
    where w.company_id = v_company_id
      and coalesce(w.archived, false) = false
    order by w.created_at asc
    limit 1;
  end if;

  -- Ensure company-linked product rows from global masters exist.
  create temporary table tmp_stock_seed(
    trade_name text,
    type text,
    qty numeric,
    unit text,
    warehouse_kind text
  ) on commit drop;

  insert into tmp_stock_seed(trade_name, type, qty, unit, warehouse_kind)
  values
    ('Amistar Extra', 'pesticide', 1200, 'l', 'pesticide'),
    ('Ridomil Gold', 'pesticide', 900, 'kg', 'pesticide'),
    ('Bravo', 'pesticide', 1500, 'l', 'pesticide'),
    ('Roundup', 'pesticide', 3000, 'l', 'pesticide'),
    ('Actara', 'pesticide', 450, 'kg', 'pesticide'),
    ('Epin Extra', 'pesticide', 180, 'l', 'pesticide'),
    ('Trend 90', 'pesticide', 250, 'l', 'pesticide'),
    ('Ammonium Nitrate', 'fertilizer', 450000, 'kg', 'fertilizer'),
    ('Urea', 'fertilizer', 320000, 'kg', 'fertilizer'),
    ('Calcium Nitrate', 'fertilizer', 90000, 'kg', 'fertilizer'),
    ('MAP 12-52', 'fertilizer', 210000, 'kg', 'fertilizer'),
    ('DAP 18-46', 'fertilizer', 170000, 'kg', 'fertilizer'),
    ('NPK 16-16-16', 'fertilizer', 290000, 'kg', 'fertilizer'),
    ('Potassium Sulfate', 'fertilizer', 110000, 'kg', 'fertilizer');

  -- create missing company-linked products
  insert into public.products (
    company_id,
    user_id,
    type,
    product_type,
    master_product_id,
    name,
    trade_name,
    unit,
    is_active,
    archived
  )
  select
    v_company_id,
    v_actor_user_id,
    gp.type,
    gp.product_type,
    gp.id,
    coalesce(gp.name, gp.trade_name),
    gp.trade_name,
    coalesce(nullif(gp.default_unit, ''), nullif(gp.unit, ''), 'kg'),
    true,
    false
  from tmp_stock_seed s
  join public.products gp
    on gp.company_id is null
   and gp.archived = false
   and gp.type = s.type
   and lower(coalesce(nullif(gp.trade_name, ''), gp.name)) = lower(s.trade_name)
  where not exists (
    select 1
    from public.products cp
    where cp.company_id = v_company_id
      and cp.archived = false
      and cp.master_product_id = gp.id
  );

  -- clear previous seed movements from this cleanup
  delete from public.inventory_transactions it
  where it.company_id = v_company_id
    and it.notes = '[seed] stem_agrochem_stock_cleanup_20260417';

  -- load confirmed initial stock
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
  select
    case when s.warehouse_kind = 'pesticide' then v_wh_pesticides else v_wh_fertilizers end as warehouse_id,
    null,
    case when s.warehouse_kind = 'pesticide' then v_wh_pesticides else v_wh_fertilizers end as destination_warehouse_id,
    cp.id as product_id,
    s.qty as quantity,
    'in' as transaction_type,
    'adjustment' as movement_type,
    'confirmed' as status,
    v_now,
    v_now::date,
    '[seed] stem_agrochem_stock_cleanup_20260417',
    v_actor_user_id,
    v_now,
    v_actor_user_id,
    v_company_id
  from tmp_stock_seed s
  join public.products gp
    on gp.company_id is null
   and gp.archived = false
   and gp.type = s.type
   and lower(coalesce(nullif(gp.trade_name, ''), gp.name)) = lower(s.trade_name)
  join public.products cp
    on cp.company_id = v_company_id
   and cp.archived = false
   and cp.master_product_id = gp.id;
end $$;

-- Validation summary
with stem as (
  select id
  from public.companies
  where lower(name) like '%астык-stem%'
     or lower(name) like '%astyk-stem%'
     or lower(name) like '%agrotech solutions%'
  order by created_at asc
  limit 1
)
select 'stem_warehouses' as metric, count(*)::text as value
from public.warehouses w
join stem s on s.id = w.company_id
where coalesce(w.archived, false) = false
union all
select 'stem_company_products_linked_to_master', count(*)::text
from public.products p
join stem s on s.id = p.company_id
where coalesce(p.archived, false) = false
  and p.master_product_id is not null
union all
select 'stem_inventory_rows_seeded_20260417', count(*)::text
from public.inventory_transactions it
join stem s on s.id = it.company_id
where it.notes = '[seed] stem_agrochem_stock_cleanup_20260417';
