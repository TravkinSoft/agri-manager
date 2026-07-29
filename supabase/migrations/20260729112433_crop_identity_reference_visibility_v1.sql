-- TZ-236: make canonical global crop identity references visible to authenticated
-- company users without granting catalog writes to operational roles.

drop policy if exists "Users can read varieties" on public.varieties;
drop policy if exists "Users can view company varieties" on public.varieties;
drop policy if exists "Users can manage own varieties" on public.varieties;
drop policy if exists "Users can insert company varieties" on public.varieties;
drop policy if exists "Users can update company varieties" on public.varieties;
drop policy if exists "Users can delete company varieties" on public.varieties;

create policy "Authenticated users can read visible varieties"
  on public.varieties
  for select
  to authenticated
  using (
    company_id is null
    or company_id = public.get_user_company_id()
  );

create policy "Crop planners can insert company varieties"
  on public.varieties
  for insert
  to authenticated
  with check (
    company_id = public.get_user_company_id()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Crop planners can update company varieties"
  on public.varieties
  for update
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  )
  with check (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Crop planners can delete company varieties"
  on public.varieties
  for delete
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Global admins can manage global varieties"
  on public.varieties
  for all
  to authenticated
  using (
    company_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role = 'global_admin'
    )
  )
  with check (
    company_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role = 'global_admin'
    )
  );

drop policy if exists "Users can read seed reproductions" on public.seed_reproductions;
drop policy if exists "Users can view company seed reproductions" on public.seed_reproductions;
drop policy if exists "Users can manage own seed reproductions" on public.seed_reproductions;
drop policy if exists "Users can insert company seed reproductions" on public.seed_reproductions;
drop policy if exists "Users can update company seed reproductions" on public.seed_reproductions;
drop policy if exists "Users can delete company seed reproductions" on public.seed_reproductions;

create policy "Authenticated users can read visible seed reproductions"
  on public.seed_reproductions
  for select
  to authenticated
  using (
    company_id is null
    or company_id = public.get_user_company_id()
  );

create policy "Crop planners can insert company seed reproductions"
  on public.seed_reproductions
  for insert
  to authenticated
  with check (
    company_id = public.get_user_company_id()
    and (user_id is null or user_id = auth.uid())
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Crop planners can update company seed reproductions"
  on public.seed_reproductions
  for update
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  )
  with check (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Crop planners can delete company seed reproductions"
  on public.seed_reproductions
  for delete
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Global admins can manage global seed reproductions"
  on public.seed_reproductions
  for all
  to authenticated
  using (
    company_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role = 'global_admin'
    )
  )
  with check (
    company_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role = 'global_admin'
    )
  );

grant select on public.varieties, public.seed_reproductions to authenticated;

-- This is a deliberately narrow, production-derived starter set for the
-- eight TZ-236 regression crops. Production already contains these identities,
-- so a later replay there is a no-op.
do $$
declare
  v_catalog_owner uuid;
begin
  select p.id
    into v_catalog_owner
  from public.profiles p
  where p.role = 'global_admin'
    and coalesce(p.status, 'active') = 'active'
  order by p.created_at, p.id
  limit 1;

  if v_catalog_owner is null then
    raise exception 'TZ-236 canonical crop identity seed requires an active global_admin profile';
  end if;

  insert into public.varieties (
    id,
    crop_id,
    name,
    user_id,
    company_id,
    archived,
    is_active,
    origin_country,
    variety_type,
    is_common_in_kz,
    breeder_or_originator,
    maturity_group,
    notes
  )
  select
    gen_random_uuid(),
    c.id,
    seed.name,
    v_catalog_owner,
    null,
    false,
    true,
    seed.origin_country,
    seed.variety_type,
    true,
    seed.breeder_or_originator,
    seed.maturity_group,
    'Canonical production identity; restored for TZ-236 QA coverage'
  from (
    values
      ('wheat', 'Айна', 'Казахстан', 'яровая', null::text, 'среднеспелый'),
      ('wheat', 'Астана', 'Казахстан', 'яровая', null::text, 'среднеспелый'),
      ('barley', 'Ача', 'Казахстан', 'яровой', null::text, 'среднеспелый'),
      ('barley', 'Вакула', 'Украина', 'яровой', null::text, 'среднеспелый'),
      ('potato', 'Гала', 'Германия', 'столовый', null::text, 'ранний'),
      ('potato', 'Ред Скарлетт', 'Нидерланды', 'столовый', null::text, 'ранний'),
      ('rapeseed', 'Лорис', 'Франция', 'озимый', null::text, 'средний'),
      ('rapeseed', 'Шелби', 'Франция', 'озимый', null::text, 'средний'),
      ('pea', 'Аксайский усатый 5', 'Россия', 'зерновой', null::text, 'среднеспелый'),
      ('pea', 'Фараон', 'Россия', 'зерновой', null::text, 'среднеспелый'),
      ('maize', 'DKC 3511', 'США', 'гибрид', 'DEKALB', 'средний'),
      ('maize', 'P9241', 'США', 'гибрид', 'Pioneer', 'средний'),
      ('oat', 'Левша', 'Россия', 'яровой', null::text, 'среднеспелый'),
      ('oat', 'Скакун', 'Россия', 'яровой', null::text, 'среднеспелый'),
      ('alfalfa', 'Люция', 'Казахстан', 'кормовая', null::text, 'среднеспелый'),
      ('alfalfa', 'Семиреченская местная', 'Казахстан', 'кормовая', null::text, 'среднеспелый')
  ) as seed(crop_slug, name, origin_country, variety_type, breeder_or_originator, maturity_group)
  join public.crops c
    on c.slug = seed.crop_slug
   and c.company_id is null
   and coalesce(c.archived, false) = false
   and coalesce(c.is_active, true) = true
  where not exists (
    select 1
    from public.varieties existing
    join public.crops existing_crop on existing_crop.id = existing.crop_id
    where existing.company_id is null
      and existing_crop.slug = seed.crop_slug
      and lower(trim(existing.name)) = lower(trim(seed.name))
  );

  insert into public.seed_reproductions (
    id,
    name,
    name_ru,
    name_kz,
    name_en,
    level_order,
    description,
    code,
    user_id,
    company_id,
    archived,
    is_active
  )
  select
    gen_random_uuid(),
    seed.name,
    seed.name_ru,
    seed.name_kz,
    seed.name_en,
    seed.level_order,
    seed.description,
    seed.code,
    v_catalog_owner,
    null,
    false,
    true
  from (
    values
      ('Оригинальные', 'Оригинальные', 'Оригинал', 'Original', 1, 'Исходный селекционный материал высшего уровня', null::text),
      ('Суперсуперэлита', 'Суперсуперэлита', null::text, null::text, 10, 'Наивысшая ступень размножения после оригинальных семян', 'SSE'),
      ('Суперэлита', 'Суперэлита', null::text, null::text, 20, 'Высокий уровень семян для дальнейшего размножения', 'SE'),
      ('Элита', 'Элита', 'Элита', 'Elite', 30, 'Семена элитного уровня для хозяйственного использования и размножения', 'E'),
      ('Первая репродукция', '1 репродукция', '1 репродукция', 'First reproduction', 40, 'Первое поколение после элиты', 'R1'),
      ('Вторая репродукция', '2 репродукция', '2 репродукция', 'Second reproduction', 50, 'Второе поколение после элиты', 'R2'),
      ('Третья репродукция', '3 репродукция', '3 репродукция', 'Third reproduction', 60, 'Третье поколение после элиты', 'R3'),
      ('Четвёртая репродукция', 'Четвёртая репродукция', null::text, null::text, 70, null::text, 'R4')
  ) as seed(name, name_ru, name_kz, name_en, level_order, description, code)
  where not exists (
    select 1
    from public.seed_reproductions existing
    where existing.company_id is null
      and (
        (seed.code is not null and upper(trim(existing.code)) = upper(trim(seed.code)))
        or lower(trim(existing.name)) = lower(trim(seed.name))
      )
  );
end;
$$;
