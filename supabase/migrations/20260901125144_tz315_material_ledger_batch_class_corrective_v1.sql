begin;

-- The canonical unit contract has allowed `material` since
-- 20260713183038_warehouse_canonical_units_v2. Repair only the known legacy
-- stock-ledger constraint; refuse an unknown physical definition.
do $migration$
declare
  v_definition text;
begin
  select pg_get_constraintdef(constraint_row.oid)
    into v_definition
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.stock_ledger_entries'::regclass
    and constraint_row.conname = 'stock_ledger_entries_batch_class_check';

  if v_definition is null then
    raise exception 'Required constraint public.stock_ledger_entries_batch_class_check is missing';
  end if;

  if v_definition ilike '%material%'
     and v_definition ilike '%commodity%'
     and v_definition ilike '%rejected%' then
    return;
  end if;

  if v_definition not ilike '%commodity%'
     or v_definition not ilike '%seed%'
     or v_definition not ilike '%feed%'
     or v_definition not ilike '%waste%'
     or v_definition not ilike '%processing%'
     or v_definition not ilike '%rejected%'
     or v_definition ilike '%material%' then
    raise exception 'Unexpected stock ledger batch class constraint: %', v_definition;
  end if;

  alter table public.stock_ledger_entries
    drop constraint stock_ledger_entries_batch_class_check;
  alter table public.stock_ledger_entries
    add constraint stock_ledger_entries_batch_class_check
    check (
      batch_class is null
      or batch_class in (
        'commodity', 'seed', 'material', 'feed', 'waste', 'processing', 'rejected'
      )
    ) not valid;
end
$migration$;

notify pgrst, 'reload schema';

commit;
