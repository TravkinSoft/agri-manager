-- One read-only report powers preview and the immutable saved shift report.
create or replace function public.preview_weighbridge_shift_snapshot_v2(p_company_id uuid,p_shift_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_shift public.weighbridge_shifts%rowtype;
  v_impurities jsonb;
  v_summary jsonb;
  v_now timestamptz := statement_timestamp();
begin
  select * into v_shift from public.weighbridge_shifts where id=p_shift_id and company_id=p_company_id;
  if not found then raise exception 'Смена не найдена' using errcode='23503'; end if;
  if v_shift.status='closed' and v_shift.summary_json is not null then return v_shift.summary_json; end if;
  v_impurities := public.harvest_impurities_by_receipt_v1(p_company_id);
  with effective as (
    select t.*,greatest(0,coalesce(t.accepted_weight_kg,t.net_weight_kg,0)-coalesce((v_impurities->>t.id::text)::numeric,0)) clean_kg,
      coalesce(c.name_ru,c.name,c.name_kz,c.name_en,'Культура не указана') crop_name,
      coalesce(f.name,'Поле не указано') field_name,
      coalesce(tl.variety_name_snapshot,'') variety_name,
      coalesce(tl.reproduction_name_snapshot,'') reproduction_name,
      coalesce(w.name,'Склад не указан') warehouse_name
    from public.tickets t
    left join lateral (select crop_id,variety_name_snapshot,reproduction_name_snapshot from public.ticket_lines where ticket_id=t.id order by id limit 1) tl on true
    left join public.crops c on c.id=tl.crop_id
    left join public.fields f on f.id=t.field_id and f.company_id=p_company_id
    left join public.warehouses w on w.id=t.warehouse_to_id and w.company_id=p_company_id
    where t.company_id=p_company_id and t.shift_id=p_shift_id and t.status='finalized'
      and t.is_finalized and not coalesce(t.is_voided,false) and t.replacement_ticket_id is null
  ), ops as (
    select op_type,count(*) trips,sum(coalesce(net_weight_kg,0)) net_kg from effective group by op_type
  ), plots as (
    select crop_structure_allocation_id,field_id,field_name,crop_name,variety_name,reproduction_name,warehouse_to_id,warehouse_name,count(*) trips,
      sum(coalesce(net_weight_kg,0)) net_kg,sum(clean_kg) clean_kg
    from effective where op_type='harvest_incoming' group by crop_structure_allocation_id,field_id,field_name,crop_name,variety_name,reproduction_name,warehouse_to_id,warehouse_name
  ) select jsonb_build_object(
    'version','weighbridge_shift_snapshot_v1','capturedAt',v_now,
    'openedAt',v_shift.opened_at,'closedAt',v_now,
    'ticketCount',(select count(*) from public.tickets where company_id=p_company_id and shift_id=p_shift_id),
    'closedTicketCount',(select count(*) from effective),
    'voidedTicketCount',(select count(*) from public.tickets where company_id=p_company_id and shift_id=p_shift_id and (status='voided' or is_voided)),
    'grossTotalKg',coalesce((select sum(gross_weight_kg) from effective),0),
    'netTotalKg',coalesce((select sum(net_weight_kg) from effective),0),
    'potatoNetKg',coalesce((select sum(net_weight_kg) from effective where op_type='harvest_incoming' and crop_name ~* 'картоф|potato|картоп'),0),
    'potatoCleanKg',coalesce((select sum(clean_kg) from effective where op_type='harvest_incoming' and crop_name ~* 'картоф|potato|картоп'),0),
    'impuritiesRemovedKg',coalesce((select sum(net_weight_kg) from effective where op_type='weighbridge_impurities'),0),
    'operations',coalesce((select jsonb_agg(to_jsonb(ops) order by op_type) from ops),'[]'::jsonb),
    'plots',coalesce((select jsonb_agg(to_jsonb(plots) order by field_name,crop_name,field_id,crop_structure_allocation_id,variety_name,reproduction_name,warehouse_to_id) from plots),'[]'::jsonb),
    'ticketIds',coalesce((select jsonb_agg(id order by id) from effective),'[]'::jsonb)
  ) into v_summary;
  -- Period accounting is separate from receipt-cohort soil allocation.
  -- This snapshot is immutable; preserve existing clean/yield fields for audit.
  v_summary := v_summary || (
    with removal_crops as (
      select t.id,t.net_weight_kg,count(l.id) line_count,count(c.id) known_count,
        count(l.id) filter (where coalesce(c.name_ru,c.name,c.name_kz,c.name_en,'') ~* 'картоф|potato|картоп') potato_count
      from public.tickets t
      left join public.ticket_lines l on l.ticket_id=t.id
      left join public.crops c on c.id=l.crop_id
      where t.company_id=p_company_id and t.shift_id=p_shift_id
        and t.op_type='weighbridge_impurities' and t.status='finalized'
        and t.is_finalized and not coalesce(t.is_voided,false) and t.replacement_ticket_id is null
      group by t.id,t.net_weight_kg
    ), totals as (
      select coalesce(sum(net_weight_kg) filter (where line_count>0 and potato_count=line_count and net_weight_kg>=0),0) removed_kg,
        count(*) filter (where line_count>0 and potato_count=line_count and net_weight_kg>=0) potato_trips,
        count(*) filter (where line_count=0 or known_count<line_count
          or (potato_count>0 and potato_count<line_count)
          or (potato_count>0 and (net_weight_kg is null or net_weight_kg<0))) unresolved
      from removal_crops
    ) select jsonb_build_object(
      'periodAccountingBasis','receipt_net_minus_period_removals_v1',
      'potatoPeriodImpuritiesKg',case when unresolved=0 then removed_kg else null end,
      'potatoPeriodImpurityTripCount',potato_trips,
      'potatoPeriodResultKg',case when unresolved=0 then (v_summary->>'potatoNetKg')::numeric-removed_kg else null end,
      'potatoPeriodUnresolvedCount',unresolved
    ) from totals
  );


  with all_tickets as (
    select * from public.tickets where company_id=p_company_id and shift_id=p_shift_id
  ), effective as (
    select * from all_tickets where status='finalized' and is_finalized and not coalesce(is_voided,false) and replacement_ticket_id is null
  ), detail as (
    select t.id,t.ticket_no,t.op_type,t.status,t.is_finalized,t.created_at,t.finalized_at,
      t.gross_weight_kg,t.tare_weight_kg,t.net_weight_kg,
      coalesce(t.is_voided,false) is_voided,t.replacement_ticket_id,
      coalesce(nullif(t.audit_json#>>'{transport,driver_name_snapshot}',''),d.full_name,'Не указан') driver_name,
      coalesce(nullif(t.audit_json#>>'{transport,vehicle_plate_snapshot}',''),nullif(v.plate_number,''),v.license_plate,'—') vehicle_plate,
      coalesce(nullif(t.audit_json#>>'{transport,vehicle_name_snapshot}',''),v.name,'—') vehicle_name,
      coalesce(f.name,'—') field_name,coalesce(c.name_ru,c.name,'Не указана') crop_name,
      coalesce(l.variety_name_snapshot,'') variety_name,coalesce(l.reproduction_name_snapshot,'') reproduction_name,
      coalesce(wf.name,'—') warehouse_from,coalesce(wt.name,'—') warehouse_to
    from all_tickets t
    left join public.company_people d on d.id=t.driver_id and d.company_id=p_company_id
    left join public.reference_vehicles v on v.id=t.vehicle_id and v.company_id=p_company_id
    left join public.fields f on f.id=t.field_id and f.company_id=p_company_id
    left join public.warehouses wf on wf.id=t.warehouse_from_id and wf.company_id=p_company_id
    left join public.warehouses wt on wt.id=t.warehouse_to_id and wt.company_id=p_company_id
    left join lateral (select crop_id,variety_name_snapshot,reproduction_name_snapshot from public.ticket_lines where ticket_id=t.id order by id limit 1) l on true
    left join public.crops c on c.id=l.crop_id
  )
  select v_summary || jsonb_build_object(
    'reportVersion',2,'shiftId',p_shift_id,'closedAt',v_shift.closed_at,
    'companyName',(select name from public.companies where id=p_company_id),
    'operatorName',(select full_name from public.company_people where id=v_shift.operator_person_id and company_id=p_company_id),
    'operatorId',v_shift.operator_person_id,
    'openTicketCount',(select count(*) from all_tickets where status<>'voided' and (status<>'finalized' or not coalesce(is_finalized,false)) and not coalesce(is_voided,false) and replacement_ticket_id is null),
    'unsyncedTicketCount',(select count(*) from all_tickets where local_sync_status is not null and local_sync_status<>'synced'),
    'manualCorrectionCount',(select count(*) from all_tickets where nullif(manual_correction_reason,'') is not null or correction_of_ticket_id is not null),
    'replacedTicketCount',(select count(*) from all_tickets where replacement_ticket_id is not null),
    'harvestReceiptCount',(select count(*) from effective where op_type='harvest_incoming'),
    'potatoReceiptCount',(select count(*) from detail where op_type='harvest_incoming' and status='finalized' and is_finalized and not is_voided and replacement_ticket_id is null and crop_name ~* 'картоф|potato|картоп'),
    'impurityTripCount',(select count(*) from effective where op_type='weighbridge_impurities'),
    'tickets',coalesce((select jsonb_agg(to_jsonb(detail) order by created_at,id) from detail),'[]'::jsonb)
  ) into v_summary;
  v_summary := v_summary || jsonb_build_object('reviewToken',md5((v_summary - 'capturedAt' - 'closedAt')::text));
  return v_summary;
end $$;
revoke all on function public.preview_weighbridge_shift_snapshot_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preview_weighbridge_shift_snapshot_v2(uuid,uuid) to service_role;

create or replace function public.close_weighbridge_shift_snapshot_v2(
  p_company_id uuid,p_shift_id uuid,p_actor_id uuid,p_operator_id uuid,p_review_token text
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  v_shift public.weighbridge_shifts%rowtype;
  v_summary jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':weighbridge_shift',0));
  select * into v_shift from public.weighbridge_shifts where id=p_shift_id and company_id=p_company_id for update;
  if not found then raise exception 'Смена не найдена' using errcode='23503'; end if;
  if v_shift.status='closed' and v_shift.summary_json->>'version'='weighbridge_shift_snapshot_v1' then return to_jsonb(v_shift); end if;
  if v_shift.status<>'open' then raise exception 'Смена уже закрыта' using errcode='23514'; end if;
  if v_shift.operator_person_id is distinct from p_operator_id then raise exception 'Весовщик сменился. Обновите страницу.' using errcode='23514'; end if;
  perform id from public.tickets where company_id=p_company_id and shift_id=p_shift_id order by id for update;
  perform l.id from public.ticket_lines l join public.tickets t on t.id=l.ticket_id
    where t.company_id=p_company_id and t.shift_id=p_shift_id order by l.id for update of l;
  v_summary := public.preview_weighbridge_shift_snapshot_v2(p_company_id,p_shift_id);
  if (v_summary->>'openTicketCount')::integer>0 then raise exception 'Сначала закройте талоны, ожидающие завершения.' using errcode='23514'; end if;
  if (v_summary->>'unsyncedTicketCount')::integer>0 then raise exception 'Есть несинхронизированные талоны. Дождитесь синхронизации.' using errcode='23514'; end if;
  if v_summary->>'potatoPeriodResultKg' is null then raise exception 'Не определена культура или масса примесей. Проверьте талоны перед закрытием.' using errcode='23514'; end if;
  if p_review_token is not null and p_review_token is distinct from v_summary->>'reviewToken' then
    raise exception 'SHIFT_PREVIEW_CHANGED' using errcode='P0001';
  end if;
  v_summary := v_summary || jsonb_build_object('capturedAt',v_now,'closedAt',v_now);
  update public.weighbridge_shifts set status='closed',closed_at=v_now,closed_by=p_actor_id,
    closed_by_person_id=p_operator_id,close_reason='manual',summary_json=v_summary,
    ticket_count=(v_summary->>'ticketCount')::integer,closed_ticket_count=(v_summary->>'closedTicketCount')::integer,
    voided_ticket_count=(v_summary->>'voidedTicketCount')::integer,manual_correction_count=(v_summary->>'manualCorrectionCount')::integer,
    gross_total_kg=(v_summary->>'grossTotalKg')::numeric,net_total_kg=(v_summary->>'netTotalKg')::numeric,
    unresolved_ticket_count=0,unsynced_count=0
    where id=p_shift_id and company_id=p_company_id returning * into v_shift;
  return to_jsonb(v_shift);
end $$;
revoke all on function public.close_weighbridge_shift_snapshot_v2(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.close_weighbridge_shift_snapshot_v2(uuid,uuid,uuid,uuid,text) to service_role;

-- Compatibility for the previous deployed API; never rewrite historical snapshots.
create or replace function public.close_weighbridge_shift_snapshot_v1(p_company_id uuid,p_shift_id uuid,p_actor_id uuid,p_operator_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.close_weighbridge_shift_snapshot_v2(p_company_id,p_shift_id,p_actor_id,p_operator_id,null);
$$;
revoke all on function public.close_weighbridge_shift_snapshot_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.close_weighbridge_shift_snapshot_v1(uuid,uuid,uuid,uuid) to service_role;
