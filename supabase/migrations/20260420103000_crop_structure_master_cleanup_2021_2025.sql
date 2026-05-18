/*
  Crop Structure cleanup for seasons 2021-2025:
  - remap local crop/variety/reproduction ids to global master ids
  - delete obvious junk/test rows that cannot be mapped
  - ensure global crop "Пар" (slug: fallow) exists
*/

do $$
declare
  v_owner_company uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_owner_user uuid;
  v_par_exists boolean := false;
  v_has_col_company_id boolean;
  v_has_col_user_id boolean;
  v_has_col_slug boolean;
  v_has_col_name_ru boolean;
  v_has_col_name_en boolean;
  v_has_col_category boolean;
  v_has_col_crop_kind boolean;
  v_has_col_priority_level boolean;
  v_has_col_is_active boolean;
  v_has_col_archived boolean;
  v_cols text := 'id,name,created_at,updated_at';
  v_vals text := 'gen_random_uuid(),''Пар'',now(),now()';
  v_sql text;
begin
  -- 1) Remap local crops -> global crops for 2021-2025
  create temporary table tmp_crop_map on commit drop as
  select lc.id as local_id, gc.id as global_id
  from public.crops lc
  join public.crops gc
    on gc.company_id is null
   and coalesce(gc.archived, false) = false
   and (
      (lc.slug is not null and gc.slug is not null and lower(lc.slug) = lower(gc.slug))
      or lower(coalesce(nullif(lc.name_ru, ''), nullif(lc.name_en, ''), lc.name))
         = lower(coalesce(nullif(gc.name_ru, ''), nullif(gc.name_en, ''), gc.name))
   )
  where lc.company_id is not null
    and coalesce(lc.archived, false) = false;

  update public.crop_structure cs
     set crop_id = m.global_id
  from tmp_crop_map m
  join public.seasons s on s.id = cs.season_id
  where cs.crop_id = m.local_id
    and s.year between 2021 and 2025
    and coalesce(cs.archived, false) = false;

  -- 2) Remap local varieties -> global varieties
  create temporary table tmp_variety_map on commit drop as
  select lv.id as local_id, gv.id as global_id
  from public.varieties lv
  join public.varieties gv
    on gv.company_id is null
   and coalesce(gv.archived, false) = false
   and lower(gv.name) = lower(lv.name)
  left join tmp_crop_map cm on cm.local_id = lv.crop_id
  where lv.company_id is not null
    and coalesce(lv.archived, false) = false
    and gv.crop_id = coalesce(cm.global_id, lv.crop_id);

  update public.crop_structure cs
     set variety_id = vm.global_id
  from tmp_variety_map vm
  join public.seasons s on s.id = cs.season_id
  where cs.variety_id = vm.local_id
    and s.year between 2021 and 2025
    and coalesce(cs.archived, false) = false;

  -- 3) Remap local seed reproductions -> global
  create temporary table tmp_rep_map on commit drop as
  select lr.id as local_id, gr.id as global_id
  from public.seed_reproductions lr
  join public.seed_reproductions gr
    on gr.company_id is null
   and coalesce(gr.archived, false) = false
   and lower(gr.name) = lower(lr.name)
  where lr.company_id is not null
    and coalesce(lr.archived, false) = false;

  update public.crop_structure cs
     set reproduction_id = rm.global_id
  from tmp_rep_map rm
  join public.seasons s on s.id = cs.season_id
  where cs.reproduction_id = rm.local_id
    and s.year between 2021 and 2025
    and coalesce(cs.archived, false) = false;

  -- 4) Delete unmappable obvious junk rows for 2021-2025
  delete from public.crop_structure cs
  using public.seasons s
  left join public.crops c on c.id = cs.crop_id
  where s.id = cs.season_id
    and s.year between 2021 and 2025
    and coalesce(cs.archived, false) = false
    and (
      cs.crop_id is null
      or (c.id is null)
      or (
        c.company_id is not null
        and lower(coalesce(c.name_ru, c.name_en, c.name, '')) ~ '(test|demo|tmp|local|junk)'
      )
    );

  -- 5) Ensure global crop "Пар" exists
  select exists(
    select 1
    from public.crops c
    where c.company_id is null
      and coalesce(c.archived, false) = false
      and (
        lower(coalesce(c.slug, '')) = 'fallow'
        or lower(coalesce(c.name_ru, c.name, '')) = 'пар'
      )
  ) into v_par_exists;

  if not v_par_exists then
    select p.id
      into v_owner_user
    from public.profiles p
    where p.company_id = v_owner_company
      and p.status = 'active'
    order by p.created_at asc
    limit 1;

    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'company_id') into v_has_col_company_id;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'user_id') into v_has_col_user_id;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'slug') into v_has_col_slug;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'name_ru') into v_has_col_name_ru;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'name_en') into v_has_col_name_en;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'category') into v_has_col_category;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'crop_kind') into v_has_col_crop_kind;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'priority_level') into v_has_col_priority_level;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'is_active') into v_has_col_is_active;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crops' and column_name = 'archived') into v_has_col_archived;

    if v_has_col_company_id then
      v_cols := v_cols || ',company_id';
      v_vals := v_vals || ',null';
    end if;
    if v_has_col_user_id then
      v_cols := v_cols || ',user_id';
      v_vals := v_vals || ',''' || coalesce(v_owner_user::text, '00000000-0000-0000-0000-000000000000') || '''::uuid';
    end if;
    if v_has_col_slug then
      v_cols := v_cols || ',slug';
      v_vals := v_vals || ',''fallow''';
    end if;
    if v_has_col_name_ru then
      v_cols := v_cols || ',name_ru';
      v_vals := v_vals || ',''Пар''';
    end if;
    if v_has_col_name_en then
      v_cols := v_cols || ',name_en';
      v_vals := v_vals || ',''Fallow''';
    end if;
    if v_has_col_category then
      v_cols := v_cols || ',category';
      v_vals := v_vals || ',''cover_crop''';
    end if;
    if v_has_col_crop_kind then
      v_cols := v_cols || ',crop_kind';
      v_vals := v_vals || ',''fallow''';
    end if;
    if v_has_col_priority_level then
      v_cols := v_cols || ',priority_level';
      v_vals := v_vals || ',''low''';
    end if;
    if v_has_col_is_active then
      v_cols := v_cols || ',is_active';
      v_vals := v_vals || ',true';
    end if;
    if v_has_col_archived then
      v_cols := v_cols || ',archived';
      v_vals := v_vals || ',false';
    end if;

    v_sql := 'insert into public.crops (' || v_cols || ') select ' || v_vals ||
      ' where not exists (select 1 from public.crops c where c.company_id is null and coalesce(c.archived,false)=false and (lower(coalesce(c.slug,''''))=''fallow'' or lower(coalesce(c.name_ru,c.name,''''))=''пар''))';
    execute v_sql;
  end if;
end $$;
