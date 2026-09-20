-- One-time owner-authorized repair, NOT a portable migration.
-- Exact row backup: phantom-companies-backup-20260920.json.
-- Abort on any target drift or newly discovered dependency. No rows are deleted.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';
do $repair$
declare
  targets uuid[] := array[
    '4510373b-62d6-49fd-9904-de2b6ebd31dc'::uuid,
    '85f0b46e-a467-4885-a397-ce586c73dc9d'::uuid,
    '8c652a76-b085-45bd-b883-0bfb1e5f7cd9'::uuid
  ];
  r record;
  found_rows bigint;
begin
  perform 1 from public.companies where id=any(targets) for update;
  select count(*) into found_rows from public.companies where
    (id=targets[1] and name='astykstemm@gmail.com''s Company' and created_at='2026-09-16T06:10:45.29619Z') or
    (id=targets[2] and name='astykkaraagash@mail.ru''s Company' and created_at='2026-09-17T06:20:00.827854Z') or
    (id=targets[3] and name='astykkaraagash@mail.ru''s Company' and created_at='2026-09-17T06:20:11.312089Z');
  if found_rows<>3 then raise exception 'REPAIR_ABORT_TARGETS_CHANGED'; end if;

  for r in
    select distinct n.nspname as schema_name,cl.relname as table_name,a.attname as column_name
    from pg_constraint con
    join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace
    join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
    where con.confrelid='public.companies'::regclass
    union
    select t.table_schema,t.table_name,t.column_name
    from information_schema.columns t join information_schema.tables b on b.table_schema=t.table_schema and b.table_name=t.table_name
    where t.table_schema in('public','private') and t.column_name='company_id' and t.udt_name='uuid' and b.table_type='BASE TABLE'
  loop
    if r.schema_name='public' and r.table_name='user_notification_preferences' and r.column_name='company_id' then continue; end if;
    execute format('select count(*) from %I.%I where %I=any($1)',r.schema_name,r.table_name,r.column_name) into found_rows using targets;
    if found_rows<>0 then raise exception 'REPAIR_ABORT_DEPENDENCY %.% % rows',r.schema_name,r.table_name,found_rows; end if;
  end loop;

  select count(*) into found_rows from public.user_notification_preferences where company_id=any(targets);
  if found_rows<>1 or not exists (
    select 1 from public.user_notification_preferences where company_id=targets[1]
      and profile_id='cb27c2ac-2312-4cb9-b819-372d1cf5e2ca'
      and created_at='2026-09-17T05:59:55.918235Z'
  ) then raise exception 'REPAIR_ABORT_PREFERENCES_CHANGED'; end if;

  update public.companies set archived_at=now(),updated_at=now() where id=any(targets) and archived_at is null;
  get diagnostics found_rows=row_count;
  if found_rows<>3 then raise exception 'REPAIR_ABORT_ARCHIVE_COUNT'; end if;
end $repair$;
select 'archived_three_verified_orphan_companies_all_related_records_preserved' as result;
commit;
