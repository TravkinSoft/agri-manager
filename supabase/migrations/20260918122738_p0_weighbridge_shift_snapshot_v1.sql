-- Read-only clean-harvest projection. Service-only: callers must resolve company
-- and role in the authenticated API before invoking either RPC.
create or replace function public.harvest_impurities_by_receipt_v1(p_company_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with recursive harvest as (
    select id,replacement_ticket_id,status,is_voided from public.tickets
    where company_id=p_company_id and op_type='harvest_incoming'
  ), lineage as (
    select b.id,b.source_ticket_id,array[b.id] path
    from public.inventory_batches b join harvest h on h.id=b.source_ticket_id
    where b.company_id=p_company_id
    union all
    select b.id,l.source_ticket_id,l.path || b.id
    from lineage l join public.inventory_batches b on b.parent_batch_id=l.id and b.company_id=p_company_id
    where not b.id=any(l.path) and not exists(select 1 from harvest h where h.id=b.source_ticket_id)
  ), replacements as (
    select id original_id,id,replacement_ticket_id,array[id] path from harvest
    union all
    select r.original_id,h.id,h.replacement_ticket_id,r.path || h.id
    from replacements r join harvest h on h.id=r.replacement_ticket_id
    where not h.id=any(r.path)
  ), debits as (
    select r.id ticket_id,-sum(e.delta_qty_signed) impurity_kg
    from public.stock_ledger_entries e
    join lineage l on l.id=coalesce(e.inventory_batch_id,
      case when e.batch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.batch_id_text::uuid end,
      case when e.batch_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.batch_id::uuid end)
    join replacements r on r.original_id=l.source_ticket_id and r.replacement_ticket_id is null
    join harvest h on h.id=r.id and h.status='finalized' and not coalesce(h.is_voided,false)
    where e.company_id=p_company_id and e.reason_type ilike '%impurit%'
    group by r.id
  ) select coalesce(jsonb_object_agg(ticket_id::text,impurity_kg),'{}'::jsonb) from debits;
$$;
revoke all on function public.harvest_impurities_by_receipt_v1(uuid) from public,anon,authenticated;
grant execute on function public.harvest_impurities_by_receipt_v1(uuid) to service_role;

-- Serialize new receipts with closing. Do not block historical corrections.
create or replace function public.guard_ticket_open_shift_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if new.shift_id is null then return new; end if;
  select status into v_status from public.weighbridge_shifts
    where id=new.shift_id and company_id=new.company_id for share;
  if v_status is null then raise exception 'Смена не принадлежит компании' using errcode='23514'; end if;
  if v_status <> 'open' and new.correction_of_ticket_id is null then
    raise exception 'Смена уже закрыта. Выберите весовщика и откройте новую смену.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_ticket_open_shift_v1() from public,anon,authenticated;
create trigger guard_ticket_open_shift_v1 before insert on public.tickets
for each row execute function public.guard_ticket_open_shift_v1();

create or replace function public.close_weighbridge_shift_snapshot_v1(
  p_company_id uuid,p_shift_id uuid,p_actor_id uuid,p_operator_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout='3s' as $$
declare
  v_shift public.weighbridge_shifts%rowtype;
  v_open text;
  v_impurities jsonb;
  v_summary jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':weighbridge_shift',0));
  select * into v_shift from public.weighbridge_shifts
    where id=p_shift_id and company_id=p_company_id for update;
  if not found then raise exception 'Смена не найдена' using errcode='23503'; end if;
  if v_shift.status='closed' and v_shift.summary_json->>'version'='weighbridge_shift_snapshot_v1' then
    return to_jsonb(v_shift);
  end if;
  if v_shift.status <> 'open' then raise exception 'Смена уже закрыта' using errcode='23514'; end if;
  if v_shift.operator_person_id is distinct from p_operator_id then
    raise exception 'Весовщик сменился. Обновите страницу.' using errcode='23514';
  end if;
  -- Lock the stable ticket set; the insert trigger serializes new receipts.
  perform id from public.tickets where company_id=p_company_id and shift_id=p_shift_id order by id for update;
  select string_agg(ticket_no,', ' order by created_at) into v_open
    from public.tickets where company_id=p_company_id and shift_id=p_shift_id
      and status not in ('finalized','voided') and not coalesce(is_voided,false) and replacement_ticket_id is null;
  if v_open is not null then
    raise exception 'Сначала закройте талоны: %',v_open using errcode='23514';
  end if;
  if exists(select 1 from public.tickets where company_id=p_company_id and shift_id=p_shift_id
    and local_sync_status is not null and local_sync_status <> 'synced') then
    raise exception 'Есть несинхронизированные талоны. Дождитесь синхронизации.' using errcode='23514';
  end if;
  v_impurities := public.harvest_impurities_by_receipt_v1(p_company_id);
  with effective as (
    select t.*,greatest(0,coalesce(t.accepted_weight_kg,t.net_weight_kg,0)-coalesce((v_impurities->>t.id::text)::numeric,0)) clean_kg,
      coalesce(c.name_ru,c.name,'Культура не указана') crop_name,
      coalesce(f.name,'Поле не указано') field_name
    from public.tickets t
    left join lateral (select crop_id from public.ticket_lines where ticket_id=t.id order by id limit 1) tl on true
    left join public.crops c on c.id=tl.crop_id
    left join public.fields f on f.id=t.field_id and f.company_id=p_company_id
    where t.company_id=p_company_id and t.shift_id=p_shift_id and t.status='finalized'
      and t.is_finalized and not coalesce(t.is_voided,false) and t.replacement_ticket_id is null
  ), ops as (
    select op_type,count(*) trips,sum(coalesce(net_weight_kg,0)) net_kg from effective group by op_type
  ), plots as (
    select crop_structure_allocation_id,field_id,field_name,crop_name,count(*) trips,
      sum(coalesce(net_weight_kg,0)) net_kg,sum(clean_kg) clean_kg
    from effective where op_type='harvest_incoming' group by crop_structure_allocation_id,field_id,field_name,crop_name
  ) select jsonb_build_object(
    'version','weighbridge_shift_snapshot_v1','capturedAt',v_now,
    'openedAt',v_shift.opened_at,'closedAt',v_now,
    'ticketCount',(select count(*) from public.tickets where company_id=p_company_id and shift_id=p_shift_id),
    'closedTicketCount',(select count(*) from effective),
    'voidedTicketCount',(select count(*) from public.tickets where company_id=p_company_id and shift_id=p_shift_id and (status='voided' or is_voided)),
    'grossTotalKg',coalesce((select sum(gross_weight_kg) from effective),0),
    'netTotalKg',coalesce((select sum(net_weight_kg) from effective),0),
    'potatoNetKg',coalesce((select sum(net_weight_kg) from effective where op_type='harvest_incoming' and crop_name ilike '%картоф%'),0),
    'potatoCleanKg',coalesce((select sum(clean_kg) from effective where op_type='harvest_incoming' and crop_name ilike '%картоф%'),0),
    'impuritiesRemovedKg',coalesce((select sum(net_weight_kg) from effective where op_type='weighbridge_impurities'),0),
    'operations',coalesce((select jsonb_agg(to_jsonb(ops) order by op_type) from ops),'[]'::jsonb),
    'plots',coalesce((select jsonb_agg(to_jsonb(plots) order by field_name) from plots),'[]'::jsonb),
    'ticketIds',coalesce((select jsonb_agg(id order by id) from effective),'[]'::jsonb)
  ) into v_summary;
  update public.weighbridge_shifts set status='closed',closed_at=v_now,closed_by=p_actor_id,
    closed_by_person_id=p_operator_id,close_reason='manual',summary_json=v_summary,
    ticket_count=(v_summary->>'ticketCount')::integer,closed_ticket_count=(v_summary->>'closedTicketCount')::integer,
    voided_ticket_count=(v_summary->>'voidedTicketCount')::integer,
    gross_total_kg=(v_summary->>'grossTotalKg')::numeric,net_total_kg=(v_summary->>'netTotalKg')::numeric,
    unresolved_ticket_count=0,unsynced_count=0
    where id=p_shift_id and company_id=p_company_id returning * into v_shift;
  return to_jsonb(v_shift);
end $$;
revoke all on function public.close_weighbridge_shift_snapshot_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.close_weighbridge_shift_snapshot_v1(uuid,uuid,uuid,uuid) to service_role;
