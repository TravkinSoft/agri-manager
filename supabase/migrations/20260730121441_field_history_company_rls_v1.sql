-- Field history is company-scoped through its required field relation.
-- Remove legacy public CRUD access before the package-aware QA pilot.
begin;

alter table public.field_history enable row level security;

drop policy if exists "Allow public delete access to field_history"
  on public.field_history;
drop policy if exists "Allow public insert access to field_history"
  on public.field_history;
drop policy if exists "Allow public read access to field_history"
  on public.field_history;
drop policy if exists "Allow public update access to field_history"
  on public.field_history;

drop policy if exists field_history_company_select_v1
  on public.field_history;
drop policy if exists field_history_company_insert_v1
  on public.field_history;
drop policy if exists field_history_company_update_v1
  on public.field_history;

revoke all privileges on table public.field_history
  from public, anon, authenticated;
grant select, insert, update on table public.field_history
  to authenticated;

create policy field_history_company_select_v1
on public.field_history
for select
to authenticated
using (
  exists (
    select 1
    from public.fields
    where fields.id = field_history.field_id
      and fields.company_id = public.get_user_company_id()
  )
);

create policy field_history_company_insert_v1
on public.field_history
for insert
to authenticated
with check (
  exists (
    select 1
    from public.fields
    where fields.id = field_history.field_id
      and fields.company_id = public.get_user_company_id()
  )
);

create policy field_history_company_update_v1
on public.field_history
for update
to authenticated
using (
  exists (
    select 1
    from public.fields
    where fields.id = field_history.field_id
      and fields.company_id = public.get_user_company_id()
  )
)
with check (
  exists (
    select 1
    from public.fields
    where fields.id = field_history.field_id
      and fields.company_id = public.get_user_company_id()
  )
);

do $postcheck$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'field_history'
      and 'public' = any(roles)
  ) then
    raise exception 'field_history still has a public RLS policy';
  end if;

  if has_table_privilege('anon', 'public.field_history', 'SELECT')
     or has_table_privilege('anon', 'public.field_history', 'INSERT')
     or has_table_privilege('anon', 'public.field_history', 'UPDATE')
     or has_table_privilege('anon', 'public.field_history', 'DELETE') then
    raise exception 'anon still has field_history CRUD privileges';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.field_history',
    'SELECT'
  )
     or not has_table_privilege(
       'authenticated',
       'public.field_history',
       'INSERT'
     )
     or not has_table_privilege(
       'authenticated',
       'public.field_history',
       'UPDATE'
     )
     or has_table_privilege(
       'authenticated',
       'public.field_history',
       'DELETE'
     ) then
    raise exception 'authenticated field_history privileges are incorrect';
  end if;
end;
$postcheck$;

commit;
