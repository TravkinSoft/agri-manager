-- Normalize seed reproduction master dictionary to one RU canonical list.
-- No large alias VALUES block here: safer for Supabase SQL editor copy/paste.

begin;

alter table public.seed_reproductions
  add column if not exists code text,
  add column if not exists name_ru text,
  add column if not exists is_active boolean not null default true,
  add column if not exists level_order integer not null default 0;

create temporary table tmp_seed_reproduction_canonical (
  code text primary key,
  name_ru text not null,
  level_order integer not null
) on commit drop;

insert into tmp_seed_reproduction_canonical(code, name_ru, level_order)
select 'SSE', U&'\0421\0443\043F\0435\0440\0441\0443\043F\0435\0440\044D\043B\0438\0442\0430', 10 union all
select 'SE',  U&'\0421\0443\043F\0435\0440\044D\043B\0438\0442\0430', 20 union all
select 'E',   U&'\042D\043B\0438\0442\0430', 30 union all
select 'R1',  U&'\041F\0435\0440\0432\0430\044F\0020\0440\0435\043F\0440\043E\0434\0443\043A\0446\0438\044F', 40 union all
select 'R2',  U&'\0412\0442\043E\0440\0430\044F\0020\0440\0435\043F\0440\043E\0434\0443\043A\0446\0438\044F', 50 union all
select 'R3',  U&'\0422\0440\0435\0442\044C\044F\0020\0440\0435\043F\0440\043E\0434\0443\043A\0446\0438\044F', 60 union all
select 'R4',  U&'\0427\0435\0442\0432\0451\0440\0442\0430\044F\0020\0440\0435\043F\0440\043E\0434\0443\043A\0446\0438\044F', 70;

insert into public.seed_reproductions(name, name_ru, code, company_id, archived, is_active, level_order, user_id)
select c.name_ru, c.name_ru, c.code, null, false, true, c.level_order,
  (
    select p.id
    from public.profiles p
    where p.status = 'active'
      and p.role in ('global_admin', 'admin')
    order by case when p.role = 'global_admin' then 0 else 1 end, p.created_at asc
    limit 1
  )
from tmp_seed_reproduction_canonical c
where not exists (
  select 1
  from public.seed_reproductions sr
  where sr.company_id is null
    and sr.archived = false
    and lower(trim(coalesce(sr.name_ru, sr.name))) = lower(trim(c.name_ru))
)
  and exists (
    select 1
    from public.profiles p
    where p.status = 'active'
      and p.role in ('global_admin', 'admin')
  );

create temporary table tmp_seed_reproduction_target (
  code text primary key,
  new_id uuid not null,
  canonical_name text not null,
  level_order integer not null
) on commit drop;

insert into tmp_seed_reproduction_target(code, new_id, canonical_name, level_order)
select distinct on (c.code)
  c.code,
  sr.id,
  c.name_ru,
  c.level_order
from tmp_seed_reproduction_canonical c
join public.seed_reproductions sr
  on sr.company_id is null
 and sr.archived = false
 and lower(trim(coalesce(sr.name_ru, sr.name))) = lower(trim(c.name_ru))
order by c.code, sr.created_at nulls last, sr.id;

update public.seed_reproductions sr
set
  name = t.canonical_name,
  name_ru = t.canonical_name,
  code = t.code,
  archived = false,
  is_active = true,
  level_order = t.level_order
from tmp_seed_reproduction_target t
where sr.id = t.new_id;

create temporary table tmp_seed_reproduction_map (
  old_id uuid primary key,
  new_id uuid not null,
  canonical_name text not null
) on commit drop;

insert into tmp_seed_reproduction_map(old_id, new_id, canonical_name)
select sr.id, t.new_id, t.canonical_name
from public.seed_reproductions sr
join tmp_seed_reproduction_target t on t.code = 'SSE'
where sr.id <> t.new_id
  and lower(trim(coalesce(sr.name_ru, sr.name, sr.code))) in ('super super elite', 'super-super-elite', 'sse', lower(t.canonical_name));

insert into tmp_seed_reproduction_map(old_id, new_id, canonical_name)
select sr.id, t.new_id, t.canonical_name
from public.seed_reproductions sr
join tmp_seed_reproduction_target t on t.code = 'SE'
where sr.id <> t.new_id
  and lower(trim(coalesce(sr.name_ru, sr.name, sr.code))) in ('super elite', 'super-elite', 'superelite', 'se', lower(t.canonical_name))
on conflict (old_id) do update set new_id = excluded.new_id, canonical_name = excluded.canonical_name;

insert into tmp_seed_reproduction_map(old_id, new_id, canonical_name)
select sr.id, t.new_id, t.canonical_name
from public.seed_reproductions sr
join tmp_seed_reproduction_target t on t.code = 'E'
where sr.id <> t.new_id
  and lower(trim(coalesce(sr.name_ru, sr.name, sr.code))) in ('elite', 'e', lower(t.canonical_name))
on conflict (old_id) do update set new_id = excluded.new_id, canonical_name = excluded.canonical_name;

insert into tmp_seed_reproduction_map(old_id, new_id, canonical_name)
select sr.id, t.new_id, t.canonical_name
from public.seed_reproductions sr
join tmp_seed_reproduction_target t on t.code = 'R1'
where sr.id <> t.new_id
  and lower(trim(coalesce(sr.name_ru, sr.name, sr.code))) in ('first reproduction', 'first generation', '1 reproduction', 'r1', lower(t.canonical_name))
on conflict (old_id) do update set new_id = excluded.new_id, canonical_name = excluded.canonical_name;

insert into tmp_seed_reproduction_map(old_id, new_id, canonical_name)
select sr.id, t.new_id, t.canonical_name
from public.seed_reproductions sr
join tmp_seed_reproduction_target t on t.code = 'R2'
where sr.id <> t.new_id
  and lower(trim(coalesce(sr.name_ru, sr.name, sr.code))) in ('second reproduction', 'second generation', '2 reproduction', 'r2', lower(t.canonical_name))
on conflict (old_id) do update set new_id = excluded.new_id, canonical_name = excluded.canonical_name;

insert into tmp_seed_reproduction_map(old_id, new_id, canonical_name)
select sr.id, t.new_id, t.canonical_name
from public.seed_reproductions sr
join tmp_seed_reproduction_target t on t.code = 'R3'
where sr.id <> t.new_id
  and lower(trim(coalesce(sr.name_ru, sr.name, sr.code))) in ('third reproduction', 'third generation', '3 reproduction', 'r3', lower(t.canonical_name))
on conflict (old_id) do update set new_id = excluded.new_id, canonical_name = excluded.canonical_name;

insert into tmp_seed_reproduction_map(old_id, new_id, canonical_name)
select sr.id, t.new_id, t.canonical_name
from public.seed_reproductions sr
join tmp_seed_reproduction_target t on t.code = 'R4'
where sr.id <> t.new_id
  and lower(trim(coalesce(sr.name_ru, sr.name, sr.code))) in ('fourth reproduction', 'fourth generation', '4 reproduction', 'r4', lower(t.canonical_name))
on conflict (old_id) do update set new_id = excluded.new_id, canonical_name = excluded.canonical_name;

update public.crop_structure cs
set reproduction_id = m.new_id
from tmp_seed_reproduction_map m
where cs.reproduction_id = m.old_id;

update public.ticket_lines tl
set
  reproduction_id = m.new_id,
  reproduction_name_snapshot = m.canonical_name
from tmp_seed_reproduction_map m
where tl.reproduction_id = m.old_id;

update public.stock_ledger_entries sle
set reproduction_id = m.new_id
from tmp_seed_reproduction_map m
where sle.reproduction_id = m.old_id;

update public.inventory_batches b
set reproduction_id = m.new_id
from tmp_seed_reproduction_map m
where b.reproduction_id = m.old_id;

update public.ticket_lines tl
set reproduction_name_snapshot = sr.name_ru
from public.seed_reproductions sr
where tl.reproduction_id = sr.id
  and sr.id in (select new_id from tmp_seed_reproduction_target);

update public.seed_reproductions sr
set archived = true, is_active = false
from tmp_seed_reproduction_map m
where sr.id = m.old_id;

notify pgrst, 'reload schema';

commit;
