-- PTC operational notifications are derived from committed fleet and turnover
-- events. Browser push remains best-effort; this table is the durable source.

alter table public.user_notifications
  drop constraint if exists user_notifications_category_check;
alter table public.user_notifications
  add constraint user_notifications_category_check
  check (category in ('operation', 'warehouse', 'weighbridge', 'assistant', 'traffic', 'system'));

alter table public.user_notification_preferences
  add column if not exists traffic_updates_enabled boolean not null default true;

create or replace function private.enqueue_user_notification_v1(
  p_company_id uuid,
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_category text,
  p_event_type text,
  p_title text,
  p_body text,
  p_href text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_recipient_user_id is null
     or p_recipient_user_id = p_actor_user_id
     or p_company_id is null then
    return;
  end if;

  insert into public.user_notifications (
    company_id,
    recipient_user_id,
    actor_user_id,
    category,
    event_type,
    title,
    body,
    href,
    entity_type,
    entity_id,
    idempotency_key,
    metadata
  )
  select
    p_company_id,
    p_recipient_user_id,
    p_actor_user_id,
    p_category,
    p_event_type,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  from public.profiles profile
  left join public.user_notification_preferences preference
    on preference.profile_id = profile.id
   and preference.company_id = p_company_id
  where profile.id = p_recipient_user_id
    and profile.company_id = p_company_id
    and profile.status = 'active'
    and case
      when p_category = 'operation'
        then coalesce(preference.operation_updates_enabled, true)
      when p_category = 'warehouse'
        then coalesce(preference.warehouse_updates_enabled, true)
      when p_category = 'weighbridge'
        then coalesce(preference.weighbridge_updates_enabled, true)
      when p_category = 'assistant'
        then coalesce(preference.proactive_assist_enabled, true)
      when p_category = 'traffic'
        then coalesce(preference.traffic_updates_enabled, true)
      else true
    end
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke all on function private.enqueue_user_notification_v1(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function private.enqueue_user_notification_v1(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, text, jsonb
) to service_role;

create table public.ptc_line_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_ids uuid[] not null,
  assigned boolean not null,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (cardinality(vehicle_ids) between 1 and 100),
  check (array_position(vehicle_ids, null) is null)
);

create index ptc_line_events_company_created_idx
  on public.ptc_line_events(company_id, created_at desc);
create index ptc_line_events_actor_idx
  on public.ptc_line_events(actor_id, created_at desc);

alter table public.ptc_line_events enable row level security;
revoke all on public.ptc_line_events from public, anon, authenticated;
grant select, insert on public.ptc_line_events to service_role;
revoke update, delete, truncate on public.ptc_line_events from service_role;

create table public.ptc_idle_alert_state (
  company_id uuid primary key references public.ptc_flows(company_id) on delete cascade,
  last_load_event_id uuid not null references public.ptc_events(id),
  last_loaded_at timestamptz not null,
  alerted_15_at timestamptz,
  alerted_30_at timestamptz,
  updated_at timestamptz not null default now()
);

create index ptc_idle_alert_due_idx
  on public.ptc_idle_alert_state(last_loaded_at)
  where alerted_30_at is null;

alter table public.ptc_idle_alert_state enable row level security;
revoke all on public.ptc_idle_alert_state from public, anon, authenticated;
grant select, insert, update on public.ptc_idle_alert_state to service_role;

create table public.user_push_subscriptions (
  endpoint_hash text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  check (left(endpoint, 8) = 'https://'),
  check (length(endpoint) between 20 and 2048),
  check (length(p256dh) between 40 and 512),
  check (length(auth) between 8 and 128)
);

create index user_push_subscriptions_recipient_idx
  on public.user_push_subscriptions(recipient_user_id, company_id);

alter table public.user_push_subscriptions enable row level security;
revoke all on public.user_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.user_push_subscriptions to service_role;

create or replace function private.validate_user_push_subscription_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = new.recipient_user_id
      and profile.company_id = new.company_id
      and profile.status = 'active'
  ) then
    raise exception 'PUSH_SUBSCRIPTION_PROFILE_MISMATCH';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.validate_user_push_subscription_v1()
  from public, anon, authenticated;
grant execute on function private.validate_user_push_subscription_v1() to service_role;

create trigger validate_user_push_subscription_v1
before insert or update on public.user_push_subscriptions
for each row execute function private.validate_user_push_subscription_v1();

create or replace function private.ptc_vehicle_notification_identity_v1(
  p_company uuid,
  p_vehicle uuid
)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select concat_ws(
    ' · ',
    coalesce(
      nullif(trim(vehicle.name), ''),
      nullif(trim(concat_ws(' ', vehicle.brand, vehicle.model)), ''),
      'Машина'
    ),
    coalesce(
      nullif(trim(vehicle.license_plate), ''),
      nullif(trim(vehicle.plate_number), '')
    )
  )
  from public.reference_vehicles vehicle
  where vehicle.id = p_vehicle
    and vehicle.company_id = p_company
$$;

revoke all on function private.ptc_vehicle_notification_identity_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.ptc_vehicle_notification_identity_v1(uuid, uuid)
  to service_role;

create or replace function public.fleet_set_vehicle_repair_v1(
  p_actor uuid,
  p_company uuid,
  p_vehicle uuid,
  p_in_repair boolean,
  p_expected_version integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.profiles%rowtype;
  r public.fleet_vehicle_repairs%rowtype;
  v_recipient uuid;
  v_vehicle_label text;
  v_actor_label text;
  v_cargo_state text;
  v_cargo_label text;
  v_assigned boolean;
  v_event_key text;
begin
  select * into a from public.profiles where id = p_actor for share;
  if not found
     or a.status is distinct from 'active'
     or coalesce(a.role, '') not in ('fleet_manager', 'company_admin', 'global_admin')
     or (a.role <> 'global_admin' and a.company_id is distinct from p_company) then
    raise exception 'FLEET_REPAIR_FORBIDDEN';
  end if;
  if p_in_repair is null
     or p_expected_version is null
     or p_expected_version < 0
     or p_expected_version >= 2147483647 then
    raise exception 'FLEET_REPAIR_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fleet-repair:' || p_vehicle::text, 0));
  perform 1
  from public.reference_vehicles
  where id = p_vehicle
    and company_id = p_company
    and not archived
    and is_active
  for share;
  if not found then
    raise exception 'FLEET_REPAIR_VEHICLE_UNAVAILABLE';
  end if;

  select * into r
  from public.fleet_vehicle_repairs
  where vehicle_id = p_vehicle
  for update;
  if found and r.company_id <> p_company then
    raise exception 'FLEET_REPAIR_FORBIDDEN';
  end if;
  if coalesce(r.version, 0) <> p_expected_version then
    if r.version = p_expected_version + 1 and r.in_repair = p_in_repair then
      v_event_key := concat('ptc:repair:', p_vehicle, ':', r.version);
      return jsonb_build_object(
        'companyId', p_company,
        'vehicleId', p_vehicle,
        'inRepair', r.in_repair,
        'version', r.version,
        'changedAt', r.changed_at,
        'notificationEventKey', v_event_key
      );
    end if;
    raise exception 'FLEET_REPAIR_CONFLICT';
  end if;
  if coalesce(r.in_repair, false) = p_in_repair then
    return jsonb_build_object(
      'companyId', p_company,
      'vehicleId', p_vehicle,
      'inRepair', p_in_repair,
      'version', coalesce(r.version, 0),
      'changedAt', r.changed_at,
      'notificationEventKey', null
    );
  end if;

  insert into public.fleet_vehicle_repairs(
    vehicle_id, company_id, in_repair, version, changed_at, changed_by
  )
  values(p_vehicle, p_company, p_in_repair, p_expected_version + 1, now(), p_actor)
  on conflict(vehicle_id) do update set
    in_repair = excluded.in_repair,
    version = excluded.version,
    changed_at = excluded.changed_at,
    changed_by = excluded.changed_by
  returning * into r;

  insert into public.fleet_vehicle_repair_events(
    vehicle_id, version, company_id, in_repair, actor_id, created_at
  )
  values(p_vehicle, r.version, p_company, r.in_repair, p_actor, r.changed_at);

  v_event_key := concat('ptc:repair:', p_vehicle, ':', r.version);
  v_vehicle_label := coalesce(
    private.ptc_vehicle_notification_identity_v1(p_company, p_vehicle),
    'Машина'
  );
  v_actor_label := coalesce(nullif(trim(a.full_name), ''), nullif(trim(a.email), ''), 'Сотрудник');
  select state, assigned
  into v_cargo_state, v_assigned
  from public.ptc_vehicle_states
  where company_id = p_company
    and vehicle_id = p_vehicle;
  v_cargo_state := coalesce(v_cargo_state, 'empty');
  v_assigned := coalesce(v_assigned, false);
  v_cargo_label := case v_cargo_state
    when 'loaded' then 'с грузом'
    when 'unloading' then 'на выгрузке'
    else 'без груза'
  end;

  for v_recipient in
    select profile.id
    from public.profiles profile
    where profile.company_id = p_company
      and profile.status = 'active'
      and lower(profile.role) = 'agronomist'
  loop
    perform private.enqueue_user_notification_v1(
      p_company,
      v_recipient,
      p_actor,
      'traffic',
      case when r.in_repair then 'ptc_vehicle_sent_to_repair' else 'ptc_vehicle_returned_from_repair' end,
      case when r.in_repair then 'Машина отправлена в ремонт' else 'Машина вышла из ремонта' end,
      concat_ws(
        ' · ',
        v_vehicle_label,
        v_cargo_label,
        case when v_assigned then 'на линии' else 'не на линии' end,
        'Изменил: ' || v_actor_label
      ),
      '/traffic',
      'fleet_vehicle',
      p_vehicle,
      concat(v_event_key, ':', v_recipient),
      jsonb_build_object(
        'event_key', v_event_key,
        'vehicle_id', p_vehicle,
        'repair_version', r.version,
        'in_repair', r.in_repair,
        'cargo_state', v_cargo_state,
        'assigned', v_assigned,
        'actor_name', v_actor_label,
        'occurred_at', r.changed_at
      )
    );
  end loop;

  return jsonb_build_object(
    'companyId', p_company,
    'vehicleId', p_vehicle,
    'inRepair', r.in_repair,
    'version', r.version,
    'changedAt', r.changed_at,
    'notificationEventKey', v_event_key
  );
end;
$$;

revoke all on function public.fleet_set_vehicle_repair_v1(
  uuid, uuid, uuid, boolean, integer
) from public, anon, authenticated;
grant execute on function public.fleet_set_vehicle_repair_v1(
  uuid, uuid, uuid, boolean, integer
) to service_role;

create or replace function public.ptc_set_vehicle_line_v1(
  p_actor uuid,
  p_company uuid,
  p_vehicles uuid[],
  p_assigned boolean,
  p_expected_revision timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.profiles%rowtype;
  f public.ptc_flows%rowtype;
  vid uuid;
  wanted uuid[];
  changed uuid[];
  revision timestamptz;
  v_line_event_id uuid;
  v_event_key text;
  v_actor_label text;
  v_vehicle_labels text;
  v_recipient uuid;
  v_changed_count integer;
begin
  select * into a from public.profiles where id = p_actor for share;
  if not found
     or a.status is distinct from 'active'
     or coalesce(a.role, '') not in ('fleet_manager', 'agronomist', 'company_admin', 'global_admin')
     or (a.role <> 'global_admin' and a.company_id is distinct from p_company) then
    raise exception 'PTC_LINE_FORBIDDEN';
  end if;
  if p_assigned is null
     or p_vehicles is null
     or cardinality(p_vehicles) < 1
     or cardinality(p_vehicles) > 100
     or array_position(p_vehicles, null) is not null then
    raise exception 'PTC_INVALID_FLEET';
  end if;

  select * into f
  from public.ptc_flows
  where company_id = p_company
  for update;
  if not found then
    if p_expected_revision is not null then
      raise exception 'PTC_LINE_CONFLICT';
    end if;
    insert into public.ptc_flows(company_id)
    values(p_company)
    on conflict do nothing
    returning updated_at into revision;
    if not found then
      raise exception 'PTC_LINE_CONFLICT';
    end if;
    select * into f
    from public.ptc_flows
    where company_id = p_company
    for update;
    if exists(select 1 from public.ptc_vehicle_states where company_id = p_company) then
      raise exception 'PTC_LINE_CONFLICT';
    end if;
  elsif f.updated_at is distinct from p_expected_revision then
    raise exception 'PTC_LINE_CONFLICT';
  end if;

  for vid in select distinct unnest(p_vehicles) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('fleet-repair:' || vid::text, 0));
    perform 1
    from public.reference_vehicles
    where id = vid
      and company_id = p_company
    for share;
    if not found then
      raise exception 'PTC_COMPANY_MISMATCH';
    end if;
    if p_assigned and exists(
      select 1
      from public.fleet_vehicle_repairs
      where company_id = p_company
        and vehicle_id = vid
        and in_repair
    ) then
      raise exception 'FLEET_VEHICLE_IN_REPAIR';
    end if;
  end loop;

  select coalesce(array_agg(candidate.id order by candidate.id), array[]::uuid[])
  into changed
  from (
    select distinct unnest(p_vehicles) as id
  ) candidate
  left join public.ptc_vehicle_states state
    on state.company_id = p_company
   and state.vehicle_id = candidate.id
  where coalesce(state.assigned, false) is distinct from p_assigned;

  if cardinality(changed) = 0 then
    return jsonb_build_object(
      'companyId', p_company,
      'vehicleIds', p_vehicles,
      'assigned', p_assigned,
      'flowRevision', f.updated_at,
      'lineEventId', null,
      'notificationEventKey', null
    );
  end if;

  select coalesce(array_agg(vehicle_id order by vehicle_id), array[]::uuid[])
  into wanted
  from public.ptc_vehicle_states
  where company_id = p_company
    and assigned
    and (p_assigned or not (vehicle_id = any(p_vehicles)));
  if p_assigned then
    select array_agg(id order by id)
    into wanted
    from (
      select distinct unnest(wanted || p_vehicles) as id
    ) all_ids;
  end if;

  perform public.ptc_configure_v1(
    p_company,
    case when p_assigned then true else f.enabled end,
    f.field_id,
    wanted
  );
  update public.ptc_flows
  set updated_at = greatest(clock_timestamp(), f.updated_at + interval '1 microsecond')
  where company_id = p_company
  returning updated_at into revision;

  insert into public.ptc_line_events(company_id, vehicle_ids, assigned, actor_id, created_at)
  values(p_company, changed, p_assigned, p_actor, now())
  returning id into v_line_event_id;

  v_event_key := concat('ptc:line:', v_line_event_id);
  v_actor_label := coalesce(nullif(trim(a.full_name), ''), nullif(trim(a.email), ''), 'Сотрудник');
  v_changed_count := cardinality(changed);
  select string_agg(
    coalesce(private.ptc_vehicle_notification_identity_v1(p_company, item.vehicle_id), 'Машина'),
    ', '
    order by item.position
  )
  into v_vehicle_labels
  from unnest(changed) with ordinality as item(vehicle_id, position)
  where item.position <= 5;
  if v_changed_count > 5 then
    v_vehicle_labels := concat(v_vehicle_labels, ', и ещё ', v_changed_count - 5);
  end if;

  for v_recipient in
    select profile.id
    from public.profiles profile
    where profile.company_id = p_company
      and profile.status = 'active'
      and lower(profile.role) = 'agronomist'
  loop
    perform private.enqueue_user_notification_v1(
      p_company,
      v_recipient,
      p_actor,
      'traffic',
      case when p_assigned then 'ptc_vehicles_added_to_line' else 'ptc_vehicles_removed_from_line' end,
      case
        when p_assigned and v_changed_count = 1 then 'Машина добавлена на линию'
        when p_assigned then 'Машины добавлены на линию: ' || v_changed_count
        when v_changed_count = 1 then 'Машина убрана с линии'
        else 'Машины убраны с линии: ' || v_changed_count
      end,
      concat_ws(' · ', v_vehicle_labels, 'Изменил: ' || v_actor_label),
      '/traffic',
      'ptc_line_event',
      v_line_event_id,
      concat(v_event_key, ':', v_recipient),
      jsonb_build_object(
        'event_key', v_event_key,
        'line_event_id', v_line_event_id,
        'vehicle_ids', to_jsonb(changed),
        'vehicle_count', v_changed_count,
        'assigned', p_assigned,
        'actor_name', v_actor_label,
        'occurred_at', now()
      )
    );
  end loop;

  return jsonb_build_object(
    'companyId', p_company,
    'vehicleIds', changed,
    'assigned', p_assigned,
    'flowRevision', revision,
    'lineEventId', v_line_event_id,
    'notificationEventKey', v_event_key
  );
end;
$$;

revoke all on function public.ptc_set_vehicle_line_v1(
  uuid, uuid, uuid[], boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.ptc_set_vehicle_line_v1(
  uuid, uuid, uuid[], boolean, timestamptz
) to service_role;

create or replace function private.track_ptc_last_load_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.to_state = 'loaded' then
    insert into public.ptc_idle_alert_state(
      company_id,
      last_load_event_id,
      last_loaded_at,
      alerted_15_at,
      alerted_30_at,
      updated_at
    )
    values(new.company_id, new.id, new.created_at, null, null, new.created_at)
    on conflict(company_id) do update set
      last_load_event_id = excluded.last_load_event_id,
      last_loaded_at = excluded.last_loaded_at,
      alerted_15_at = null,
      alerted_30_at = null,
      updated_at = excluded.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function private.track_ptc_last_load_v1()
  from public, anon, authenticated;
grant execute on function private.track_ptc_last_load_v1() to service_role;

create trigger track_ptc_last_load_v1
after insert on public.ptc_events
for each row execute function private.track_ptc_last_load_v1();

create or replace function public.ptc_emit_idle_alerts_v1(
  p_now timestamptz default now()
)
returns table(notification_id uuid, event_key text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  monitor public.ptc_idle_alert_state%rowtype;
  v_recipient uuid;
  v_threshold integer;
  v_event_key text;
  v_notification_id uuid;
  v_empty integer;
  v_loaded integer;
  v_unloading integer;
  v_repair integer;
  v_body text;
begin
  if p_now is null or p_now > now() + interval '5 minutes' then
    raise exception 'PTC_IDLE_ALERT_TIME_INVALID';
  end if;

  for monitor in
    select alert.*
    from public.ptc_idle_alert_state alert
    join public.ptc_flows flow on flow.company_id = alert.company_id
    where flow.enabled
      and alert.last_loaded_at <= p_now - interval '15 minutes'
      and alert.alerted_30_at is null
      and exists (
        select 1
        from public.ptc_vehicle_states state
        where state.company_id = alert.company_id
          and state.assigned
      )
    order by alert.company_id
    for update of alert skip locked
  loop
    if monitor.last_loaded_at <= p_now - interval '30 minutes' then
      v_threshold := 30;
    elsif monitor.alerted_15_at is null then
      v_threshold := 15;
    else
      continue;
    end if;

    select
      count(*) filter (where not coalesce(repair.in_repair, false) and state.state = 'empty'),
      count(*) filter (where not coalesce(repair.in_repair, false) and state.state = 'loaded'),
      count(*) filter (where not coalesce(repair.in_repair, false) and state.state = 'unloading'),
      count(*) filter (where coalesce(repair.in_repair, false))
    into v_empty, v_loaded, v_unloading, v_repair
    from public.ptc_vehicle_states state
    left join public.fleet_vehicle_repairs repair
      on repair.company_id = state.company_id
     and repair.vehicle_id = state.vehicle_id
     and repair.in_repair
    where state.company_id = monitor.company_id
      and state.assigned;

    v_event_key := concat(
      'ptc:idle:', monitor.last_load_event_id, ':', v_threshold
    );
    v_body := concat(
      'Пустые ', v_empty,
      ' · загруженные ', v_loaded,
      ' · на выгрузке ', v_unloading,
      ' · в ремонте ', v_repair,
      '. Проверьте подачу транспорта или работу комбайна.'
    );

    for v_recipient in
      select profile.id
      from public.profiles profile
      left join public.user_notification_preferences preference
        on preference.profile_id = profile.id
       and preference.company_id = monitor.company_id
      where profile.company_id = monitor.company_id
        and profile.status = 'active'
        and lower(profile.role) in ('agronomist', 'fleet_manager')
        and coalesce(preference.traffic_updates_enabled, true)
    loop
      v_notification_id := null;
      insert into public.user_notifications(
        company_id,
        recipient_user_id,
        actor_user_id,
        category,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        idempotency_key,
        metadata
      )
      values(
        monitor.company_id,
        v_recipient,
        null,
        'traffic',
        case when v_threshold = 15 then 'ptc_no_loads_15m' else 'ptc_no_loads_30m' end,
        case when v_threshold = 15
          then 'Нет новых загрузок 15 минут'
          else 'Простой продолжается 30 минут'
        end,
        v_body,
        '/traffic',
        'ptc_flow',
        monitor.company_id,
        concat(v_event_key, ':', v_recipient),
        jsonb_build_object(
          'event_key', v_event_key,
          'last_load_event_id', monitor.last_load_event_id,
          'last_loaded_at', monitor.last_loaded_at,
          'threshold_minutes', v_threshold,
          'empty_count', v_empty,
          'loaded_count', v_loaded,
          'unloading_count', v_unloading,
          'repair_count', v_repair
        )
      )
      on conflict(idempotency_key) do nothing
      returning id into v_notification_id;

      if v_notification_id is not null then
        notification_id := v_notification_id;
        event_key := v_event_key;
        return next;
      end if;
    end loop;

    update public.ptc_idle_alert_state
    set alerted_15_at = case
          when v_threshold = 30 then coalesce(alerted_15_at, p_now)
          else p_now
        end,
        alerted_30_at = case when v_threshold = 30 then p_now else alerted_30_at end,
        updated_at = p_now
    where company_id = monitor.company_id;
  end loop;
end;
$$;

revoke all on function public.ptc_emit_idle_alerts_v1(timestamptz)
  from public, anon, authenticated;
grant execute on function public.ptc_emit_idle_alerts_v1(timestamptz)
  to service_role;

grant select on public.user_notification_preferences to service_role;
grant select, insert on public.user_notifications to service_role;

comment on table public.ptc_idle_alert_state is
  'Armed only by new committed PTC load events; migration does not replay historical activity.';
comment on function public.ptc_emit_idle_alerts_v1(timestamptz) is
  'Emits one 15-minute alert and one 30-minute escalation per load gap, regardless of empty vehicle count.';
