create or replace function public.is_current_user_director_v1()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'director'
      and lower(coalesce(p.status, 'active')) = 'active'
  );
$$;

revoke all on function public.is_current_user_director_v1() from public;
grant execute on function public.is_current_user_director_v1() to authenticated;

do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format(
      'drop policy if exists director_read_only_insert_v1 on %I.%I',
      target.schema_name,
      target.table_name
    );
    execute format(
      'create policy director_read_only_insert_v1 on %I.%I as restrictive for insert to authenticated with check (not public.is_current_user_director_v1())',
      target.schema_name,
      target.table_name
    );

    execute format(
      'drop policy if exists director_read_only_update_v1 on %I.%I',
      target.schema_name,
      target.table_name
    );
    execute format(
      'create policy director_read_only_update_v1 on %I.%I as restrictive for update to authenticated using (not public.is_current_user_director_v1()) with check (not public.is_current_user_director_v1())',
      target.schema_name,
      target.table_name
    );

    execute format(
      'drop policy if exists director_read_only_delete_v1 on %I.%I',
      target.schema_name,
      target.table_name
    );
    execute format(
      'create policy director_read_only_delete_v1 on %I.%I as restrictive for delete to authenticated using (not public.is_current_user_director_v1())',
      target.schema_name,
      target.table_name
    );
  end loop;
end;
$$;
