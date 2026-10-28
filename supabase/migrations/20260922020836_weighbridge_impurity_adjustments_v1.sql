-- A reconciliation document is not a weighbridge ticket or an invented trip.
-- Service-only, company scoped, append-only. No business rows are posted here.
create table public.weighbridge_impurity_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  shift_id uuid not null references public.weighbridge_shifts(id),
  warehouse_id uuid not null references public.warehouses(id),
  crop_structure_id uuid not null references public.crop_structure(id),
  field_id uuid not null references public.fields(id),
  crop_id uuid not null references public.crops(id),
  variety_id uuid,
  reproduction_id uuid,
  document_no text not null,
  accounting_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  recorded_impurity_kg numeric not null check (recorded_impurity_kg >= 0),
  confirmed_impurity_kg numeric not null check (confirmed_impurity_kg > recorded_impurity_kg),
  quantity_kg numeric not null check (quantity_kg > 0 and quantity_kg = confirmed_impurity_kg - recorded_impurity_kg),
  reason text not null check (length(btrim(reason)) >= 20),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  allocations jsonb not null check (jsonb_typeof(allocations) = 'array' and jsonb_array_length(allocations) > 0),
  request_key uuid not null,
  request_fingerprint text not null,
  unique(company_id, request_key),
  unique(company_id, shift_id, warehouse_id, crop_structure_id)
);
alter table public.weighbridge_impurity_adjustments enable row level security;
revoke all on public.weighbridge_impurity_adjustments from public, anon, authenticated;
grant select, insert on public.weighbridge_impurity_adjustments to service_role;
create index on public.weighbridge_impurity_adjustments(company_id, accounting_at, id);
create index on public.weighbridge_impurity_adjustments(shift_id);
create index on public.weighbridge_impurity_adjustments(warehouse_id);
create index on public.weighbridge_impurity_adjustments(crop_structure_id);
create index on public.weighbridge_impurity_adjustments(field_id);
create index on public.weighbridge_impurity_adjustments(crop_id);
create index on public.weighbridge_impurity_adjustments(created_by);

create function public.weighbridge_plot_impurity_totals_v1(p_company_id uuid,p_shift_id uuid)
returns table(crop_structure_id uuid,warehouse_id uuid,quantity_kg numeric)
language sql stable security invoker set search_path='' as $$
  with measured as (
    select m.crop_structure_id,g.source_warehouse_id warehouse_id,m.allocated_impurity_kg quantity_kg
    from public.weighbridge_shared_impurity_members m
    join public.weighbridge_shared_impurity_groups g on g.id=m.group_id and g.company_id=m.company_id
    join public.tickets t on t.id=g.ticket_id and t.company_id=g.company_id
    where g.company_id=p_company_id and t.shift_id=p_shift_id and g.state='finalized'
      and t.status='finalized' and t.is_finalized and not coalesce(t.is_voided,false) and t.replacement_ticket_id is null
    union all
    select t.crop_structure_allocation_id,t.warehouse_from_id,t.net_weight_kg
    from public.tickets t where t.company_id=p_company_id and t.shift_id=p_shift_id
      and t.op_type='weighbridge_impurities' and t.status='finalized' and t.is_finalized
      and not coalesce(t.is_voided,false) and t.replacement_ticket_id is null
      and not exists(select 1 from public.weighbridge_shared_impurity_groups g where g.ticket_id=t.id and g.company_id=p_company_id)
  ) select m.crop_structure_id,m.warehouse_id,sum(m.quantity_kg) from measured m group by m.crop_structure_id,m.warehouse_id;
$$;
revoke all on function public.weighbridge_plot_impurity_totals_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.weighbridge_plot_impurity_totals_v1(uuid,uuid) to service_role;

-- Preserve the exact existing preview implementation; the same public RPC remains
-- the single preview/closure contract. Closed historical snapshots never change.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.preview_weighbridge_shift_snapshot_v2(uuid,uuid)'::regprocedure);
  definition := replace(definition,'public.preview_weighbridge_shift_snapshot_v2(', 'public.preview_weighbridge_shift_snapshot_base_v2(');
  execute definition;
end $$;
revoke all on function public.preview_weighbridge_shift_snapshot_base_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preview_weighbridge_shift_snapshot_base_v2(uuid,uuid) to service_role;

create or replace function public.preview_weighbridge_shift_snapshot_v2(p_company_id uuid,p_shift_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; adjustments jsonb; amount numeric; n integer; period_plots jsonb;
begin
  result := public.preview_weighbridge_shift_snapshot_base_v2(p_company_id,p_shift_id);
  if result->>'closedAt' is not null then return result; end if;
  select coalesce(sum(a.quantity_kg),0),count(*),coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'documentNo',a.document_no,'quantityKg',a.quantity_kg,'reason',a.reason,
    'accountingAt',a.accounting_at,'recordedAt',a.created_at,'cropStructureId',a.crop_structure_id,
    'fieldName',f.name,'warehouseName',w.name,'recordedImpurityKg',a.recorded_impurity_kg,
    'confirmedImpurityKg',a.confirmed_impurity_kg,'basis','owner_confirmed_reconciliation'
  ) order by a.created_at,a.id),'[]'::jsonb) into amount,n,adjustments
  from public.weighbridge_impurity_adjustments a
  join public.fields f on f.id=a.field_id and f.company_id=p_company_id
  join public.warehouses w on w.id=a.warehouse_id and w.company_id=p_company_id
  where a.company_id=p_company_id and a.shift_id=p_shift_id;
  if n=0 then return result; end if;
  with receipts as (
    select t.crop_structure_allocation_id plot_id,t.warehouse_to_id warehouse_id,t.field_id,sum(t.net_weight_kg) net_kg
    from public.tickets t where t.company_id=p_company_id and t.shift_id=p_shift_id
      and t.op_type='harvest_incoming' and t.status='finalized' and t.is_finalized
      and not coalesce(t.is_voided,false) and t.replacement_ticket_id is null
    group by t.crop_structure_allocation_id,t.warehouse_to_id,t.field_id
  ), measured as (select * from public.weighbridge_plot_impurity_totals_v1(p_company_id,p_shift_id)),
  corrected as (select a.crop_structure_id,a.warehouse_id,sum(a.quantity_kg) kg
    from public.weighbridge_impurity_adjustments a where a.company_id=p_company_id and a.shift_id=p_shift_id group by a.crop_structure_id,a.warehouse_id)
  select coalesce(jsonb_agg(jsonb_build_object('cropStructureId',r.plot_id,'fieldName',f.name,'areaHa',cs.area,
    'receivedKg',r.net_kg,'measuredImpurityKg',coalesce(m.quantity_kg,0),'adjustmentKg',coalesce(c.kg,0),
    'removedKg',coalesce(m.quantity_kg,0)+coalesce(c.kg,0),'resultKg',r.net_kg-coalesce(m.quantity_kg,0)-coalesce(c.kg,0)
  ) order by r.plot_id,r.warehouse_id),'[]'::jsonb) into period_plots from receipts r
  join public.fields f on f.id=r.field_id and f.company_id=p_company_id
  join public.crop_structure cs on cs.id=r.plot_id and cs.company_id=p_company_id
  left join measured m on m.crop_structure_id=r.plot_id and m.warehouse_id=r.warehouse_id
  left join corrected c on c.crop_structure_id=r.plot_id and c.warehouse_id=r.warehouse_id;
  result := result || jsonb_build_object('impurityAdjustments',adjustments,'impurityAdjustmentKg',amount,
    'impurityAdjustmentCount',n,'periodPlots',period_plots,
    'potatoPeriodImpuritiesKg',(result->>'potatoPeriodImpuritiesKg')::numeric+amount,
    'potatoPeriodResultKg',(result->>'potatoPeriodResultKg')::numeric-amount,
    'impuritiesRemovedKg',(result->>'impuritiesRemovedKg')::numeric+amount,
    'manualCorrectionCount',(result->>'manualCorrectionCount')::integer+n);
  -- Reconciliation is not included in tickets, operation trip counts, gross or tare.
  return result || jsonb_build_object('reviewToken',md5((result-'capturedAt'-'closedAt'-'reviewToken')::text));
end $$;

create function public.post_weighbridge_impurity_adjustment_v1(
  p_company_id uuid,p_shift_id uuid,p_warehouse_id uuid,p_plot_id uuid,
  p_confirmed_impurity_kg numeric,p_actor_id uuid,p_request_key uuid,
  p_review_token text,p_reason text,p_evidence jsonb
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  doc public.weighbridge_impurity_adjustments%rowtype;
  sh public.weighbridge_shifts%rowtype; plot public.crop_structure%rowtype;
  report jsonb; fingerprint text; measured numeric; amount numeric; available numeric;
  sources jsonb; allocations jsonb := '[]'; source jsonb; qty numeric; allocated numeric := 0; running numeric := 0;
  entry_id uuid; document_id uuid := gen_random_uuid(); account_at timestamptz; day_hour int;
begin
  if p_request_key is null or length(btrim(coalesce(p_reason,'')))<20
    or jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->>'ownerConfirmed' is distinct from 'true'
    or p_confirmed_impurity_kg is null or p_confirmed_impurity_kg<=0
    or p_confirmed_impurity_kg::text in ('NaN','Infinity','-Infinity') then
    raise exception 'ADJUSTMENT_EVIDENCE_REQUIRED';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='global_admin' and status='active') then raise exception 'ADJUSTMENT_ACTOR_FORBIDDEN'; end if;
  fingerprint := md5(jsonb_build_array(p_company_id,p_shift_id,p_warehouse_id,p_plot_id,p_confirmed_impurity_kg,p_actor_id,p_reason,p_evidence)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':weighbridge_shift',0));
  select * into doc from public.weighbridge_impurity_adjustments where company_id=p_company_id and request_key=p_request_key;
  if found then
    if doc.request_fingerprint is distinct from fingerprint then raise exception 'ADJUSTMENT_IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(doc);
  end if;
  select * into sh from public.weighbridge_shifts where id=p_shift_id and company_id=p_company_id for update;
  if not found or sh.status<>'open' then raise exception 'ADJUSTMENT_SHIFT_NOT_OPEN'; end if;
  perform id from public.tickets where company_id=p_company_id and shift_id=p_shift_id order by id for update;
  report := public.preview_weighbridge_shift_snapshot_v2(p_company_id,p_shift_id);
  if p_review_token is null or p_review_token is distinct from report->>'reviewToken' then raise exception 'SHIFT_PREVIEW_CHANGED'; end if;
  if (report->>'openTicketCount')::int<>0 or (report->>'unsyncedTicketCount')::int<>0 then raise exception 'ADJUSTMENT_SHIFT_HAS_PENDING_TICKETS'; end if;
  if report->>'potatoPeriodResultKg' is null then raise exception 'ADJUSTMENT_UNRESOLVED_REMOVAL'; end if;
  if exists(select 1 from public.weighbridge_impurity_adjustments where company_id=p_company_id and shift_id=p_shift_id and warehouse_id=p_warehouse_id and crop_structure_id=p_plot_id) then raise exception 'ADJUSTMENT_SCOPE_ALREADY_RECONCILED'; end if;
  select * into plot from public.crop_structure where id=p_plot_id and company_id=p_company_id;
  if not found or not exists(select 1 from public.crops where id=plot.crop_id and coalesce(name_ru,name,name_kz,name_en,'') ~* 'картоф|potato|картоп') then raise exception 'ADJUSTMENT_POTATO_PLOT_REQUIRED'; end if;
  if not exists(select 1 from public.warehouses where id=p_warehouse_id and company_id=p_company_id and not coalesce(archived,false) and not coalesce(is_archived,false)) then raise exception 'ADJUSTMENT_WAREHOUSE_UNAVAILABLE'; end if;
  if exists(select 1 from public.weighbridge_plot_impurity_totals_v1(p_company_id,p_shift_id) where crop_structure_id is null or quantity_kg is null) then raise exception 'ADJUSTMENT_UNRESOLVED_REMOVAL'; end if;
  select coalesce(sum(quantity_kg),0) into measured from public.weighbridge_plot_impurity_totals_v1(p_company_id,p_shift_id) where crop_structure_id=p_plot_id and warehouse_id=p_warehouse_id;
  amount := p_confirmed_impurity_kg-measured;
  if amount<=0 or round(amount,3)<>amount then raise exception 'ADJUSTMENT_POSITIVE_KG_REQUIRED'; end if;
  -- Lock actual source batches. Refuse transformed/mixed/reserved balances rather
  -- than inventing provenance. This function handles an idle exact-plot scope.
  perform b.id from public.inventory_batches b join public.tickets t on t.id=b.source_ticket_id and t.company_id=b.company_id
    where b.company_id=p_company_id and b.crop_structure_id=p_plot_id and b.warehouse_id=p_warehouse_id
      and t.shift_id=p_shift_id and t.op_type='harvest_incoming' and t.status='finalized' and t.is_finalized
      and not coalesce(t.is_voided,false) and t.replacement_ticket_id is null and b.parent_batch_id is null order by b.id for update of b;
  with source_rows as (
    select b.*,coalesce((select sum(e.delta_qty_signed) from public.stock_ledger_entries e where e.company_id=p_company_id
      and e.warehouse_id=p_warehouse_id and e.product_id=b.product_id and e.uom='kg' and e.batch_class=b.batch_class
      and coalesce(e.inventory_batch_id::text,e.batch_id_text,e.batch_id)=b.id::text),0) balance
    from public.inventory_batches b join public.tickets t on t.id=b.source_ticket_id and t.company_id=b.company_id
    where b.company_id=p_company_id and b.crop_structure_id=p_plot_id and b.warehouse_id=p_warehouse_id
      and t.shift_id=p_shift_id and t.op_type='harvest_incoming' and t.status='finalized' and t.is_finalized
      and not coalesce(t.is_voided,false) and t.replacement_ticket_id is null and b.parent_batch_id is null
  ) select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'),coalesce(sum(s.balance),0) into sources,available from source_rows s;
  if available<amount or jsonb_array_length(sources)=0 then raise exception 'ADJUSTMENT_INSUFFICIENT_STOCK'; end if;
  for source in select value from jsonb_array_elements(sources) loop
    if (source->>'balance')::numeric<0 or source->>'batch_class'<>'commodity'
      or (source->>'crop_id')::uuid is distinct from plot.crop_id
      or abs(coalesce((source->>'current_weight_kg')::numeric,-1)-(source->>'balance')::numeric)>0.001
      or coalesce((source->>'is_mixed_harvest')::boolean,false) then raise exception 'ADJUSTMENT_SOURCE_REQUIRES_REVIEW'; end if;
    if exists(select 1 from public.inventory_batches b where b.parent_batch_id=(source->>'id')::uuid and b.company_id=p_company_id)
      or exists(select 1 from public.weighbridge_shared_impurity_source_batches s join public.weighbridge_shared_impurity_groups g on g.id=s.group_id
        where s.company_id=p_company_id and s.inventory_batch_id=(source->>'id')::uuid and g.state not in ('finalized','voided')) then raise exception 'ADJUSTMENT_SOURCE_BUSY'; end if;
    running := running+(source->>'balance')::numeric;
    qty := trunc(amount*running/available,3)-allocated;
    if qty<=0 then continue; end if;
    if qty>(source->>'balance')::numeric then raise exception 'ADJUSTMENT_ALLOCATION_OVERDRAW'; end if;
    allocated := allocated+qty;
    insert into public.stock_ledger_entries(company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,
      reason_type,reason_ref_id,inventory_batch_id,batch_id,batch_id_text,batch_class,crop_id,variety_id,reproduction_id,
      mass_kg,unit_source,unit_contract_version,created_by,notes)
    values(p_company_id,(source->>'product_id')::uuid,p_warehouse_id,'out',qty,'kg',-qty,
      'weighbridge_impurity_adjustment_out',document_id,(source->>'id')::uuid,source->>'id',source->>'id','commodity',plot.crop_id,
      (source->>'variety_id')::uuid,(source->>'reproduction_id')::uuid,qty,'owner_confirmed_impurity_adjustment',2,p_actor_id,p_reason)
    returning id into entry_id;
    update public.inventory_batches set current_weight_kg=(source->>'balance')::numeric-qty,
      current_quantity=case when current_quantity is null then null else (source->>'balance')::numeric-qty end,updated_at=now()
      where id=(source->>'id')::uuid and company_id=p_company_id;
    allocations := allocations || jsonb_build_array(jsonb_build_object('inventoryBatchId',source->>'id','ledgerEntryId',entry_id,
      'sourceTicketId',source->>'source_ticket_id','quantityKg',qty,'balanceBeforeKg',(source->>'balance')::numeric,'method','proportional_remaining_balance'));
  end loop;
  if allocated<>amount then raise exception 'ADJUSTMENT_ALLOCATION_MISMATCH'; end if;
  select coalesce(operational_day_start_hour,7) into day_hour from public.companies where id=p_company_id;
  account_at := (date_trunc('day',(sh.opened_at at time zone 'Asia/Qyzylorda')-make_interval(hours=>day_hour))+make_interval(hours=>day_hour)) at time zone 'Asia/Qyzylorda';
  -- Accounting cutoff, not a claimed physical weighing time. A shift spanning
  -- multiple operational days requires a separately reviewed allocation.
  select greatest(sh.opened_at,max(finalized_at)) into account_at from public.tickets where company_id=p_company_id and shift_id=p_shift_id and status='finalized';
  if account_at >= ((date_trunc('day',(sh.opened_at at time zone 'Asia/Qyzylorda')-make_interval(hours=>day_hour))+make_interval(hours=>day_hour)) at time zone 'Asia/Qyzylorda')+interval '1 day' then raise exception 'ADJUSTMENT_MULTIDAY_SHIFT_REQUIRES_REVIEW'; end if;
  insert into public.weighbridge_impurity_adjustments(id,company_id,shift_id,warehouse_id,crop_structure_id,field_id,crop_id,variety_id,reproduction_id,
    document_no,accounting_at,created_by,recorded_impurity_kg,confirmed_impurity_kg,quantity_kg,reason,evidence,allocations,request_key,request_fingerprint)
  values(document_id,p_company_id,p_shift_id,p_warehouse_id,p_plot_id,plot.field_id,plot.crop_id,plot.variety_id,plot.reproduction_id,
    'ADJ-SOIL-'||left(document_id::text,8),account_at,p_actor_id,measured,p_confirmed_impurity_kg,amount,p_reason,p_evidence,allocations,p_request_key,fingerprint)
  returning * into doc;
  return to_jsonb(doc);
end $$;
revoke all on function public.post_weighbridge_impurity_adjustment_v1(uuid,uuid,uuid,uuid,numeric,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.post_weighbridge_impurity_adjustment_v1(uuid,uuid,uuid,uuid,numeric,uuid,uuid,text,text,jsonb) to service_role;
