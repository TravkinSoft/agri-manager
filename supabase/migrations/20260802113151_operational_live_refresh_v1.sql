-- Operational Realtime is an invalidation signal only. Clients refetch
-- canonical company-scoped data through their authenticated JWT and RLS.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'operations',
    'operation_lines',
    'operation_materials',
    'warehouse_issue_requests',
    'warehouse_issue_request_items',
    'stock_ledger_entries',
    'warehouses',
    'inventory_batches',
    'tickets',
    'ticket_lines',
    'ticket_weighings',
    'weighbridge_shifts'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'Required operational table public.% is missing', v_table;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$$;
