-- Dev utility: reset ONLY operational weighbridge/warehouse data
-- Scope: company "ТОО \"Астык-STEM\"" only
-- Safe: keeps master/reference data untouched
-- Idempotent: can be run multiple times

begin;

do $$
declare
  v_company_id uuid;
  v_matches int;
begin
  -- 1) Resolve company id strictly by name pattern
  select count(*)::int
    into v_matches
  from public.companies c
  where lower(c.name) like lower('%астык-stem%');

  if v_matches = 0 then
    raise exception 'Company "ТОО Астык-STEM" not found.';
  end if;

  if v_matches > 1 then
    raise exception 'More than one company matched "Астык-STEM". Refine selector first.';
  end if;

  select c.id
    into v_company_id
  from public.companies c
  where lower(c.name) like lower('%астык-stem%')
  limit 1;

  raise notice 'Reset company_id = %', v_company_id;

  -- 2) Temporary id sets to keep delete-order safe
  create temporary table if not exists tmp_reset_ticket_ids(id uuid primary key) on commit drop;
  create temporary table if not exists tmp_reset_batch_ids(id uuid primary key) on commit drop;
  create temporary table if not exists tmp_reset_transformation_ids(id uuid primary key) on commit drop;

  truncate table tmp_reset_ticket_ids;
  truncate table tmp_reset_batch_ids;
  truncate table tmp_reset_transformation_ids;

  insert into tmp_reset_ticket_ids(id)
  select t.id
  from public.tickets t
  where t.company_id = v_company_id
  on conflict do nothing;

  if to_regclass('public.inventory_batches') is not null then
    insert into tmp_reset_batch_ids(id)
    select b.id
    from public.inventory_batches b
    where b.company_id = v_company_id
    on conflict do nothing;
  end if;

  if to_regclass('public.batch_transformations') is not null then
    insert into tmp_reset_transformation_ids(id)
    select bt.id
    from public.batch_transformations bt
    where bt.company_id = v_company_id
    on conflict do nothing;
  end if;

  -- 3) Child tables first
  if to_regclass('public.ticket_weighings') is not null then
    delete from public.ticket_weighings tw
    where tw.company_id = v_company_id
       or tw.ticket_id in (select id from tmp_reset_ticket_ids);
  end if;

  if to_regclass('public.ticket_lines') is not null then
    delete from public.ticket_lines tl
    where tl.company_id = v_company_id
       or tl.ticket_id in (select id from tmp_reset_ticket_ids);
  end if;

  if to_regclass('public.batch_transformation_outputs') is not null then
    delete from public.batch_transformation_outputs bto
    where bto.company_id = v_company_id
       or bto.transformation_id in (select id from tmp_reset_transformation_ids);
  end if;

  if to_regclass('public.batch_transformation_inputs') is not null then
    delete from public.batch_transformation_inputs bti
    where bti.company_id = v_company_id
       or bti.transformation_id in (select id from tmp_reset_transformation_ids);
  end if;

  if to_regclass('public.stock_ledger_entries') is not null then
    delete from public.stock_ledger_entries sle
    where sle.company_id = v_company_id
       or sle.ticket_id in (select id from tmp_reset_ticket_ids);
  end if;

  if to_regclass('public.inventory_transactions') is not null then
    delete from public.inventory_transactions it
    where it.company_id = v_company_id;
  end if;

  if to_regclass('public.container_registry') is not null then
    delete from public.container_registry cr
    where cr.company_id = v_company_id
       or cr.linked_ticket_id in (select id from tmp_reset_ticket_ids);
  end if;

  if to_regclass('public.processing_documents') is not null then
    delete from public.processing_documents pd
    where pd.company_id = v_company_id
       or pd.source_ticket_id in (select id from tmp_reset_ticket_ids);
  end if;

  -- 4) Parent operational tables
  if to_regclass('public.batch_transformations') is not null then
    delete from public.batch_transformations bt
    where bt.company_id = v_company_id;
  end if;

  if to_regclass('public.tickets') is not null then
    delete from public.tickets t
    where t.company_id = v_company_id;
  end if;

  if to_regclass('public.inventory_batches') is not null then
    delete from public.inventory_batches b
    where b.company_id = v_company_id;
  end if;

  if to_regclass('public.weighbridge_shifts') is not null then
    delete from public.weighbridge_shifts ws
    where ws.company_id = v_company_id;
  end if;

  -- 5) Ticket-related audit/debug logs (keep non-operational business master logs)
  if to_regclass('public.audit_log') is not null then
    delete from public.audit_log al
    where al.company_id = v_company_id
      and (
        al.entity_type in (
          'ticket',
          'ticket_line',
          'ticket_weighing',
          'stock_ledger_entry',
          'inventory_transaction',
          'weighbridge_shift',
          'processing_document',
          'inventory_batch',
          'batch_transformation'
        )
        or al.entity_id in (select id::text from tmp_reset_ticket_ids)
      );
  end if;

  raise notice 'Operational reset completed for company_id = %', v_company_id;
end $$;

commit;

-- Post-checks (run and verify after script):
-- 1) No tickets
select c.id as company_id, c.name as company_name, count(*) as tickets_count
from public.companies c
left join public.tickets t on t.company_id = c.id
where lower(c.name) like lower('%астык-stem%')
group by c.id, c.name;

-- 2) No stock movements (ledger + inventory transactions)
select
  c.id as company_id,
  c.name as company_name,
  (select count(*) from public.stock_ledger_entries sle where sle.company_id = c.id) as ledger_rows,
  (select count(*) from public.inventory_transactions it where it.company_id = c.id) as inventory_tx_rows
from public.companies c
where lower(c.name) like lower('%астык-stem%');

-- 3) Canonical balances should be zero/empty
select
  b.company_id,
  sum(abs(b.quantity)) as total_abs_qty,
  count(*) as balance_rows
from public.v_stock_balance_canonical b
where b.company_id in (
  select id from public.companies where lower(name) like lower('%астык-stem%')
)
group by b.company_id;

