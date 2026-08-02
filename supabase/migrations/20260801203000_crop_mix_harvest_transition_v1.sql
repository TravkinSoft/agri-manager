-- Seed readiness belongs to crop-mix planting only; harvesting has no seed issue dependency.

create or replace function public.transition_operation_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_operation public.operations%rowtype;
  v_response jsonb;
  v_is_crop_mix boolean := false;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier']::text[]
  );
  if p_transition not in ('accept', 'start') then
    raise exception 'Unsupported operation transition' using errcode = '22023';
  end if;
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'activate', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Operation was not found' using errcode = 'P0002'; end if;
  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) = 'completed' then
    raise exception 'Operation is already completed' using errcode = '23514';
  end if;
  if v_operation.responsible_user_id is not null
     and v_operation.responsible_user_id <> p_actor_profile_id
     and public.assert_operation_mutation_actor_v1(
       p_company_id, p_actor_profile_id,
       array['global_admin', 'company_admin', 'agronomist']::text[]
     ) is null then
    raise exception 'Operation is assigned to another specialist' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.crop_structure cs
    where cs.id = v_operation.crop_structure_id
      and cs.company_id = p_company_id and cs.land_use_type = 'crop_mix'
  ) into v_is_crop_mix;

  if p_transition = 'accept' then
    update public.operations
    set status = 'accepted', operation_status = 'accepted', specialist_task_status = 'accepted',
        accepted_at = coalesce(accepted_at, now()), updated_at = now()
    where id = p_operation_id returning * into v_operation;
    update public.warehouse_issue_requests
    set status = case when status = 'new' then 'active' else status end,
        warehouse_request_status = coalesce(warehouse_request_status, 'pending'), updated_at = now()
    where operation_id = p_operation_id and company_id = p_company_id
      and status not in ('cancelled', 'issued', 'issued_by_warehouse');
  else
    if v_is_crop_mix
       and coalesce(v_operation.operation_category_slug, '') = 'planting'
       and exists (
      select 1
      from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_operation.crop_structure_id
        and mc.company_id = p_company_id
        and not exists (
          select 1
          from public.warehouse_issue_requests r
          join public.warehouse_issue_request_items i
            on i.request_id = r.id and i.company_id = r.company_id
          where r.operation_id = p_operation_id
            and r.company_id = p_company_id
            and i.source_mix_component_id = mc.id
            and i.product_id is not null
            and coalesce(i.issued_quantity, 0) + 0.0001 >= i.required_quantity
            and coalesce(i.reconciliation_status, '') <> 'blocked'
        )
    ) then
      raise exception 'Все компоненты зерносмеси должны быть полностью выданы до начала посева'
        using errcode = '23514';
    end if;
    if not v_is_crop_mix and exists (
      select 1 from public.warehouse_issue_requests r
      where r.operation_id = p_operation_id and r.company_id = p_company_id
        and coalesce(r.status, '') not in ('issued', 'issued_by_warehouse', 'partially_issued')
    ) then
      raise exception 'Materials must be issued before operation start' using errcode = '23514';
    end if;
    update public.operations
    set status = 'in_progress', work_status = 'in_progress', operation_status = 'in_progress',
        specialist_task_status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
    where id = p_operation_id returning * into v_operation;
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (p_company_id, p_actor_profile_id, 'operation', p_operation_id::text,
          p_transition || '_atomic', to_jsonb(v_operation));
  v_response := jsonb_build_object('operation', to_jsonb(v_operation), 'transition', p_transition);
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'activate', p_operation_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text)
  to authenticated;

comment on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text)
  is 'Transitions operations atomically; crop-mix seed readiness is enforced only for planting.';
