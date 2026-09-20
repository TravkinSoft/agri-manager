-- Owner-requested recovery of the existing ticket. No new ticket/weight/warehouse.
-- Run first with final ROLLBACK, then COMMIT only after all assertions pass.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '25s';
-- Trusted database maintenance context; the core still verifies the explicit
-- active Global Admin actor. No browser session or operator is impersonated.
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
do $repair$
declare
  target constant uuid := '24b28bd9-284c-41d4-8614-8d65c36a4b42';
  admin_actor constant uuid := 'cb27c2ac-2312-4cb9-b819-372d1cf5e2ca';
  t public.tickets%rowtype;
  before_total numeric;
  after_total numeric;
begin
  perform private.acquire_ticket_processing_gate_for_actor_v1(target, admin_actor);
  select * into strict t from public.tickets where id=target for update;
  if t.company_id <> '10000000-0000-0000-0000-000000000001'
    or t.ticket_no <> 'WB-100000-20260920080110-I13K'
    or t.op_type <> 'weighbridge_impurities'
    or t.status::text <> 'ready_to_close' or t.is_finalized or t.is_voided
    or t.gross_weight_kg is distinct from 9440::numeric
    or t.tare_weight_kg is distinct from 5120::numeric
    or t.net_weight_kg is distinct from 4320::numeric
    or t.driver_id is distinct from '43f52575-f788-46ea-8b00-5ed6b8789808'::uuid
    or t.vehicle_id is distinct from 'a000a098-07ef-4f7a-aa37-de71a2b6de0f'::uuid
    or t.warehouse_from_id is distinct from '93fa746b-af1e-4ee1-9a49-080a47e1f8de'::uuid
    or t.harvest_lot_id is distinct from 'bd68ec0a-f26b-43db-9da0-92c397c3a0a9'::uuid
    or t.audit_json->>'impurity_type' is distinct from 'soil_and_trash'
  then raise exception 'REPAIR_ABORT_TICKET_DRIFT'; end if;
  if exists(select 1 from public.stock_ledger_entries where ticket_id=target)
    or (select count(*) from public.ticket_lines where ticket_id=target)<>1
    or (select count(*) from public.ticket_weighings where ticket_id=target)<>2
    or not exists(select 1 from public.ticket_weighings where ticket_id=target and weighing_no=1 and measured_weight_kg=9440)
    or not exists(select 1 from public.ticket_weighings where ticket_id=target and weighing_no=2 and measured_weight_kg=5120)
  then raise exception 'REPAIR_ABORT_ACCOUNTING_OR_WEIGHING_DRIFT'; end if;

  select coalesce(sum(delta_qty_signed),0) into before_total
    from public.stock_ledger_entries where company_id=t.company_id and warehouse_id=t.warehouse_from_id;
  -- Existing authorized actor-based canonical finalizer. Preserve all locks,
  -- reservations, stock checks, immutable ledger rules and idempotency checks.
  perform public.prepare_grain_lot_ticket_allocations_v1(target);
  perform public.finalize_weighbridge_ticket_v2(target, admin_actor);
  if (select sum(delta_qty_signed) from public.stock_ledger_entries where ticket_id=target) is distinct from -4320::numeric
    or exists(select 1 from public.stock_ledger_entries where ticket_id=target and (warehouse_id<>t.warehouse_from_id or company_id<>t.company_id or direction::text<>'out'))
    or not exists(select 1 from public.tickets where id=target and is_finalized and status::text='finalized' and not is_voided)
  then raise exception 'REPAIR_ABORT_FINALIZATION_INVARIANT'; end if;
  select coalesce(sum(delta_qty_signed),0) into after_total
    from public.stock_ledger_entries where company_id=t.company_id and warehouse_id=t.warehouse_from_id;
  if after_total-before_total <> -4320 then raise exception 'REPAIR_ABORT_WAREHOUSE_DELTA'; end if;
  update public.tickets set audit_json=coalesce(audit_json,'{}'::jsonb)||jsonb_build_object(
    'stock_source','aggregate_harvest_lot_fifo',
    'owner_requested_recovery_20260920',jsonb_build_object(
      'performed_at',now(),'actor_profile_id',admin_actor,
      'reason','Close existing saved tare after independent shared-impurity reservation released',
      'blocking_ticket_id','95aaf629-389b-4f12-b75c-c53de780bb51',
      'gross_kg_unchanged',9440,'tare_kg_unchanged',5120,'net_kg',4320
    )) where id=target;
end $repair$;
select jsonb_build_object(
  'ticket',(select jsonb_build_object('ticket_no',ticket_no,'status',status,'is_finalized',is_finalized,'net_weight_kg',net_weight_kg,'closed_by',closed_by) from public.tickets where id='24b28bd9-284c-41d4-8614-8d65c36a4b42'),
  'ledger',(select jsonb_build_object('rows',count(*),'delta_kg',sum(delta_qty_signed),'warehouses',count(distinct warehouse_id)) from public.stock_ledger_entries where ticket_id='24b28bd9-284c-41d4-8614-8d65c36a4b42')
) as result;
commit;
