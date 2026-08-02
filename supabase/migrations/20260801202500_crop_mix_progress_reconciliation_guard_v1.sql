-- Reporting additional completed area must not reopen a fully reconciled grain-mix seed row.

create or replace function public.save_operation_progress_atomic_v12(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_completed_area_ha numeric,
  p_stop_reason text,
  p_comment text,
  p_weather_note text,
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
  v_response jsonb;
  v_completed numeric;
  v_planned numeric;
  v_overrun numeric;
  v_last_line_id uuid;
begin
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'progress_v12', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_response := public.save_operation_progress_atomic_v1(
    p_company_id, p_actor_profile_id, p_operation_id, p_completed_area_ha,
    true, p_stop_reason, p_comment, p_weather_note,
    p_idempotency_key || ':v12-core', p_request_fingerprint
  );

  update public.warehouse_issue_request_items i
  set reconciliation_status = 'reconciled',
      shortage_quantity = 0
  from public.warehouse_issue_requests r,
       public.operations o,
       public.crop_structure cs
  where r.id = i.request_id
    and r.operation_id = p_operation_id
    and r.company_id = p_company_id
    and i.company_id = p_company_id
    and o.id = p_operation_id
    and o.company_id = p_company_id
    and cs.id = o.crop_structure_id
    and cs.company_id = p_company_id
    and cs.land_use_type = 'crop_mix'
    and i.source_mix_component_id is not null
    and i.consumed_quantity is not null
    and abs(
      coalesce(i.issued_quantity, 0)
      - coalesce(i.consumed_quantity, 0)
      - coalesce(i.returned_quantity, 0)
      - coalesce(i.loss_quantity, 0)
    ) <= 0.0001
    and coalesce(i.return_received_quantity, 0) + 0.000001 >= coalesce(i.returned_quantity, 0);

  select completed_area_ha, planned_area_ha
    into v_completed, v_planned
  from public.operations
  where id = p_operation_id
    and company_id = p_company_id
  for update;

  v_overrun := greatest(coalesce(v_completed, 0) - coalesce(v_planned, 0), 0);
  if v_overrun > 0.000001 then
    select id into v_last_line_id
    from public.operation_lines
    where operation_id = p_operation_id
      and company_id = p_company_id
    order by created_at desc, id desc
    limit 1
    for update;

    if v_last_line_id is not null then
      update public.operation_lines
      set actual_area_ha = round(planned_area_ha + v_overrun, 4),
          completed_by = p_actor_profile_id,
          completed_at = coalesce(completed_at, now()),
          updated_by_user_id = auth.uid()
      where id = v_last_line_id;
    end if;
  end if;

  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'progress_v12', p_operation_id, p_idempotency_key,
    p_request_fingerprint, p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.save_operation_progress_atomic_v12(
  uuid, uuid, uuid, numeric, text, text, text, text, text
) from public, anon;
grant execute on function public.save_operation_progress_atomic_v12(
  uuid, uuid, uuid, numeric, text, text, text, text, text
) to authenticated;

comment on function public.save_operation_progress_atomic_v12(uuid, uuid, uuid, numeric, text, text, text, text, text)
  is 'Persists operation progress and preserves fully reconciled crop-mix seed component rows.';
