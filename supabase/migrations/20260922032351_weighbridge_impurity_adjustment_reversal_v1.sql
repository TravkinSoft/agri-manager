-- Exact reversal with append-only evidence and saved report revisions.
create table public.weighbridge_impurity_adjustment_reversals (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 adjustment_id uuid not null references public.weighbridge_impurity_adjustments(id),
 shift_id uuid not null references public.weighbridge_shifts(id),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),
 document_no text not null,
 quantity_kg numeric not null check(quantity_kg>0),
 reason text not null check(length(btrim(reason))>=20),
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 allocations jsonb not null check(jsonb_typeof(allocations)='array' and jsonb_array_length(allocations)>0),
 summary_before jsonb not null,
 summary_after jsonb not null,
 request_key uuid not null,
 request_fingerprint text not null,
 unique(company_id,adjustment_id),unique(company_id,request_key)
);
alter table public.weighbridge_impurity_adjustment_reversals enable row level security;
revoke all on public.weighbridge_impurity_adjustment_reversals from public,anon,authenticated;
grant select,insert on public.weighbridge_impurity_adjustment_reversals to service_role;
create index on public.weighbridge_impurity_adjustment_reversals(adjustment_id);
create index on public.weighbridge_impurity_adjustment_reversals(shift_id);
create index on public.weighbridge_impurity_adjustment_reversals(created_by);
alter table public.weighbridge_impurity_adjustments add column reversed_at timestamptz;
alter table public.weighbridge_impurity_adjustments add column reversal_id uuid references public.weighbridge_impurity_adjustment_reversals(id);
alter table public.weighbridge_impurity_adjustments add constraint impurity_reversal_state check ((reversed_at is null)=(reversal_id is null));
create index on public.weighbridge_impurity_adjustments(reversal_id);
grant update(reversed_at,reversal_id) on public.weighbridge_impurity_adjustments to service_role;
-- Retain the current preview contract, excluding explicitly reversed documents.
do $$
declare definition text; needle text := 'a.company_id=p_company_id and a.shift_id=p_shift_id';
begin
 definition:=pg_get_functiondef('public.preview_weighbridge_shift_snapshot_v2(uuid,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
   raise exception 'REVERSAL_PREVIEW_CONTRACT_CHANGED';
 end if;
 execute replace(definition,needle,needle||' and a.reversed_at is null');
end $$;

create function public.reverse_weighbridge_impurity_adjustment_v1(
 p_company_id uuid,p_adjustment_id uuid,p_actor_id uuid,p_request_key uuid,
 p_snapshot_hash text,p_reason text,p_evidence jsonb
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
 a public.weighbridge_impurity_adjustments%rowtype;
 s public.weighbridge_shifts%rowtype;
 b public.inventory_batches%rowtype;
 e public.stock_ledger_entries%rowtype;
 previous public.weighbridge_impurity_adjustment_reversals%rowtype;
 reversal_id uuid:=gen_random_uuid(); entry_id uuid; item jsonb; before_report jsonb; after_report jsonb;
 allocations jsonb:='[]'; report_rows jsonb; balance numeric; qty numeric; returned numeric:=0;
 fingerprint text; recorded_at timestamptz:=clock_timestamp(); seen_batches uuid[]:='{}';
begin
 if p_request_key is null or p_actor_id is null or not exists(select 1 from public.profiles where id=p_actor_id and role='global_admin' and status='active') then raise exception 'REVERSAL_ACTOR_FORBIDDEN'; end if;
 if length(btrim(coalesce(p_reason,'')))<20 or jsonb_typeof(p_evidence) is distinct from 'object'
   or p_evidence->'ownerConfirmed' is distinct from 'true'::jsonb
   or p_evidence->'primaryRowsVerified' is distinct from 'true'::jsonb then raise exception 'REVERSAL_EVIDENCE_REQUIRED'; end if;
 fingerprint:=md5(jsonb_build_array(p_company_id,p_adjustment_id,p_actor_id,p_reason,p_evidence)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':weighbridge_shift',0));
 select * into previous from public.weighbridge_impurity_adjustment_reversals where company_id=p_company_id and request_key=p_request_key;
 if found then
   if previous.request_fingerprint<>fingerprint then raise exception 'REVERSAL_IDEMPOTENCY_CONFLICT'; end if;
   return to_jsonb(previous);
 end if;
 select * into a from public.weighbridge_impurity_adjustments where company_id=p_company_id and id=p_adjustment_id for update;
 if not found then raise exception 'REVERSAL_ADJUSTMENT_NOT_FOUND'; end if;
 if a.reversed_at is not null then raise exception 'REVERSAL_ALREADY_REVERSED'; end if;
 select * into s from public.weighbridge_shifts where company_id=p_company_id and id=a.shift_id for update;
 if not found or s.status<>'closed' or s.summary_json->>'reportVersion' is distinct from '2' then raise exception 'REVERSAL_CLOSED_V2_REPORT_REQUIRED'; end if;
 before_report:=s.summary_json;
 if p_snapshot_hash is null or md5(before_report::text)<>p_snapshot_hash then raise exception 'REVERSAL_SNAPSHOT_CHANGED'; end if;
 if (select count(*) from jsonb_array_elements(before_report->'impurityAdjustments') j where j->>'id'=a.id::text and (j->>'quantityKg')::numeric=a.quantity_kg)<>1
   or coalesce((before_report->>'impurityAdjustmentKg')::numeric,0)<a.quantity_kg
   or (select count(*) from jsonb_array_elements(before_report->'periodPlots') j where j->>'cropStructureId'=a.crop_structure_id::text and (j->>'adjustmentKg')::numeric>=a.quantity_kg)<>1
   or (select count(*) from jsonb_array_elements(before_report->'plots') j where j->>'crop_structure_allocation_id'=a.crop_structure_id::text and j->>'warehouse_to_id'=a.warehouse_id::text)<>1
 then raise exception 'REVERSAL_SNAPSHOT_SCOPE_INVALID'; end if;
 if (select count(*) from public.stock_ledger_entries where company_id=p_company_id and reason_ref_id=a.id and reason_type='weighbridge_impurity_adjustment_out')<>jsonb_array_length(a.allocations)
 then raise exception 'REVERSAL_SOURCE_COUNT_MISMATCH'; end if;
 perform ib.id from public.inventory_batches ib where ib.company_id=p_company_id
   and ib.id in (select (j->>'inventoryBatchId')::uuid from jsonb_array_elements(a.allocations) j) order by ib.id for update;
 for item in select value from jsonb_array_elements(a.allocations) order by value->>'inventoryBatchId' loop
   qty:=(item->>'quantityKg')::numeric;
   if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or round(qty,3)<>qty or (item->>'inventoryBatchId')::uuid=any(seen_batches) then raise exception 'REVERSAL_ALLOCATION_INVALID'; end if;
   seen_batches:=array_append(seen_batches,(item->>'inventoryBatchId')::uuid);
   select * into e from public.stock_ledger_entries where company_id=p_company_id and id=(item->>'ledgerEntryId')::uuid;
   if not found or e.reason_ref_id is distinct from a.id or e.reason_type is distinct from 'weighbridge_impurity_adjustment_out'
      or e.delta_qty_signed is distinct from -qty or e.quantity is distinct from qty or e.direction is distinct from 'out' or e.uom is distinct from 'kg'
      or e.inventory_batch_id is distinct from (item->>'inventoryBatchId')::uuid or e.warehouse_id is distinct from a.warehouse_id
   then raise exception 'REVERSAL_ORIGINAL_LEDGER_MISMATCH'; end if;
   select * into b from public.inventory_batches where company_id=p_company_id and id=e.inventory_batch_id;
   if not found or b.warehouse_id is distinct from a.warehouse_id or b.crop_structure_id is distinct from a.crop_structure_id
      or b.source_ticket_id is distinct from (item->>'sourceTicketId')::uuid or b.product_id is distinct from e.product_id
      or b.crop_id is distinct from a.crop_id or b.batch_class is distinct from e.batch_class or b.parent_batch_id is not null
      or b.variety_id is distinct from e.variety_id or b.reproduction_id is distinct from e.reproduction_id
      or coalesce(b.is_mixed_harvest,false)
      or exists(select 1 from public.inventory_batches where company_id=p_company_id and parent_batch_id=b.id)
   then raise exception 'REVERSAL_BATCH_SCOPE_CHANGED'; end if;
   if exists(select 1 from public.weighbridge_shared_impurity_source_batches sb join public.weighbridge_shared_impurity_groups g on g.id=sb.group_id and g.company_id=sb.company_id
     where sb.company_id=p_company_id and sb.inventory_batch_id=b.id and g.state not in ('finalized','voided')) then raise exception 'REVERSAL_BATCH_BUSY'; end if;
   select coalesce(sum(delta_qty_signed),0) into balance from public.stock_ledger_entries where company_id=p_company_id and warehouse_id=b.warehouse_id
     and product_id=b.product_id and uom='kg' and batch_class=b.batch_class and coalesce(inventory_batch_id::text,batch_id_text,batch_id)=b.id::text;
   if b.current_weight_kg is null or abs(b.current_weight_kg-balance)>0.001 then raise exception 'REVERSAL_BATCH_BALANCE_MISMATCH'; end if;
   insert into public.stock_ledger_entries(company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,
      reason_type,reason_ref_id,inventory_batch_id,batch_id,batch_id_text,batch_class,crop_id,variety_id,reproduction_id,
      mass_kg,unit_source,unit_contract_version,created_by,notes)
   values(p_company_id,e.product_id,e.warehouse_id,'in',qty,'kg',qty,'weighbridge_impurity_adjustment_reversal',reversal_id,
      b.id,b.id::text,b.id::text,e.batch_class,e.crop_id,e.variety_id,e.reproduction_id,qty,'impurity_adjustment_reversal',2,p_actor_id,p_reason)
   returning id into entry_id;
   update public.inventory_batches set current_weight_kg=balance+qty,
     current_quantity=case when current_quantity is null then null else balance+qty end,updated_at=recorded_at where company_id=p_company_id and id=b.id;
   returned:=returned+qty;
   allocations:=allocations||jsonb_build_array(jsonb_build_object('inventoryBatchId',b.id,'originalLedgerEntryId',e.id,'ledgerEntryId',entry_id,'quantityKg',qty,'balanceBeforeKg',balance));
 end loop;
 if returned<>a.quantity_kg then raise exception 'REVERSAL_TOTAL_MISMATCH'; end if;
 -- Apply only the exact historical delta; do not pull later activity into it.
 after_report:=before_report||jsonb_build_object(
   'impurityAdjustmentKg',(before_report->>'impurityAdjustmentKg')::numeric-a.quantity_kg,
   'impurityAdjustmentCount',(before_report->>'impurityAdjustmentCount')::int-1,
   'manualCorrectionCount',(before_report->>'manualCorrectionCount')::int-1,
   'potatoPeriodImpuritiesKg',(before_report->>'potatoPeriodImpuritiesKg')::numeric-a.quantity_kg,
   'impuritiesRemovedKg',(before_report->>'impuritiesRemovedKg')::numeric-a.quantity_kg,
   'potatoPeriodResultKg',(before_report->>'potatoPeriodResultKg')::numeric+a.quantity_kg,
   'potatoCleanKg',(before_report->>'potatoCleanKg')::numeric+a.quantity_kg,
   'reportRevision',coalesce((before_report->>'reportRevision')::int,1)+1,'revisedAt',recorded_at);
 select coalesce(jsonb_agg(j order by ord),'[]') into report_rows from jsonb_array_elements(before_report->'impurityAdjustments') with ordinality x(j,ord) where j->>'id'<>a.id::text;
 after_report:=after_report||jsonb_build_object('impurityAdjustments',report_rows);
 select jsonb_agg(case when j->>'cropStructureId'=a.crop_structure_id::text then j||jsonb_build_object(
   'adjustmentKg',(j->>'adjustmentKg')::numeric-a.quantity_kg,'removedKg',(j->>'removedKg')::numeric-a.quantity_kg,'resultKg',(j->>'resultKg')::numeric+a.quantity_kg) else j end order by ord)
 into report_rows from jsonb_array_elements(before_report->'periodPlots') with ordinality x(j,ord);
 after_report:=after_report||jsonb_build_object('periodPlots',report_rows);
 select jsonb_agg(case when j->>'crop_structure_allocation_id'=a.crop_structure_id::text and j->>'warehouse_to_id'=a.warehouse_id::text
   then j||jsonb_build_object('clean_kg',(j->>'clean_kg')::numeric+a.quantity_kg) else j end order by ord)
 into report_rows from jsonb_array_elements(before_report->'plots') with ordinality x(j,ord);
 after_report:=after_report||jsonb_build_object('plots',report_rows,'impurityAdjustmentReversals',coalesce(before_report->'impurityAdjustmentReversals','[]')||jsonb_build_array(
   jsonb_build_object('id',reversal_id,'documentNo','REV-SOIL-'||left(reversal_id::text,8),'originalDocumentNo',a.document_no,'quantityKg',a.quantity_kg,'reason',p_reason,'recordedAt',recorded_at)));
 after_report:=after_report||jsonb_build_object('reviewToken',md5((after_report-'reviewToken')::text));
 insert into public.weighbridge_impurity_adjustment_reversals(id,company_id,adjustment_id,shift_id,created_at,created_by,document_no,quantity_kg,reason,evidence,allocations,summary_before,summary_after,request_key,request_fingerprint)
 values(reversal_id,p_company_id,a.id,a.shift_id,recorded_at,p_actor_id,'REV-SOIL-'||left(reversal_id::text,8),a.quantity_kg,p_reason,p_evidence,allocations,before_report,after_report,p_request_key,fingerprint)
 returning * into previous;
 update public.weighbridge_impurity_adjustments set reversed_at=recorded_at,reversal_id=previous.id where company_id=p_company_id and id=a.id;
 update public.weighbridge_shifts set summary_json=after_report,manual_correction_count=(after_report->>'manualCorrectionCount')::int where company_id=p_company_id and id=s.id;
 return to_jsonb(previous);
end $$;
revoke all on function public.reverse_weighbridge_impurity_adjustment_v1(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reverse_weighbridge_impurity_adjustment_v1(uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;
