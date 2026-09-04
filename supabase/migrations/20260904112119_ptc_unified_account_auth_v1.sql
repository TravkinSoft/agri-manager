-- Additive switch from module passwords to ordinary TravkinFlow accounts.
-- Apply with the central operator-role migration before releasing the new UI.
alter table public.ptc_events add column actor_user_id uuid references public.profiles(id);
alter table public.ptc_events alter column access_id drop not null;
alter table public.ptc_events add constraint ptc_event_actor_present check (access_id is not null or actor_user_id is not null);
create index ptc_events_actor_user on public.ptc_events(actor_user_id) where actor_user_id is not null;

create function public.ptc_actor_transition_v1(p_actor uuid,p_vehicle uuid,p_version integer,p_target text,p_key uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.profiles%rowtype; person public.company_people%rowtype; s public.ptc_vehicle_states%rowtype; e public.ptc_events%rowtype; company uuid; linked_count integer;
begin
  select * into a from public.profiles where id=p_actor for share;
  if not found or a.status is distinct from 'active' or a.company_id is null or coalesce(a.role,'') not in ('mechanic_operator','vegetable_brigadier') then raise exception 'PTC_UNAUTHORIZED'; end if;
  company:=a.company_id;
  perform 1 from public.ptc_flows where company_id=company and enabled for share;
  if not found then raise exception 'PTC_DISABLED'; end if;
  -- Invitation binding serializes on the profile. Reject ambiguous person links.
  perform 1 from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null order by id for share;
  select count(*) into linked_count from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null;
  if linked_count<>1 then raise exception 'PTC_PERSON_LINK_REQUIRED'; end if;
  select * into person from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null;
  select * into s from public.ptc_vehicle_states where company_id=company and vehicle_id=p_vehicle and assigned for update;
  if not found then raise exception 'PTC_NOT_ASSIGNED'; end if;
  select * into e from public.ptc_events where company_id=company and idempotency_key=p_key;
  if found then
    if e.vehicle_id<>p_vehicle or e.actor_user_id is distinct from p_actor or e.expected_version<>p_version or e.to_state<>p_target then raise exception 'PTC_KEY_CONFLICT'; end if;
    return jsonb_build_object('replayed',true,'eventId',e.id);
  end if;
  if s.version<>p_version then raise exception 'PTC_VERSION_CONFLICT'; end if;
  if not ((a.role='mechanic_operator' and s.state='empty' and p_target='loaded') or
    (a.role='vegetable_brigadier' and s.state='loaded' and p_target='unloading') or
    (a.role='vegetable_brigadier' and s.state='unloading' and p_target='empty')) then raise exception 'PTC_FORBIDDEN_TRANSITION'; end if;
  update public.ptc_vehicle_states set state=p_target,version=version+1,since=now(),cycle=cycle+case when p_target='loaded' then 1 else 0 end
    where company_id=company and vehicle_id=p_vehicle;
  insert into public.ptc_events(company_id,vehicle_id,actor_user_id,actor_name,field_id,idempotency_key,expected_version,from_state,to_state,cycle)
    values(company,p_vehicle,p_actor,person.full_name,(select field_id from public.ptc_flows where company_id=company),p_key,p_version,s.state,p_target,s.cycle+case when p_target='loaded' then 1 else 0 end) returning * into e;
  return jsonb_build_object('replayed',false,'eventId',e.id);
end $$;
revoke all on function public.ptc_actor_transition_v1(uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.ptc_actor_transition_v1(uuid,uuid,integer,text,uuid) to service_role;

-- Keep legacy rows/events, permanently retire the password transition path.
create or replace function public.ptc_transition_v1(p_token_hash text,p_vehicle uuid,p_version integer,p_target text,p_key uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin raise exception 'PTC_LEGACY_AUTH_RETIRED'; end $$;
revoke all on function public.ptc_transition_v1(text,uuid,integer,text,uuid),public.ptc_take_login_attempt_v1(text,integer) from public,anon,authenticated,service_role;
revoke all on public.ptc_access,public.ptc_sessions,public.ptc_login_limits from public,anon,authenticated,service_role;
