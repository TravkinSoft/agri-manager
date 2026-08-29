begin;

-- Profile identity and authorization fields are server-managed. Existing
-- invitation and user-admin routes already use the service role. Authenticated
-- users retain only their own language preference mutation.
revoke insert, update, delete, truncate
  on table public.profiles
  from anon, authenticated;
grant update (preferred_language)
  on table public.profiles
  to authenticated;

drop policy if exists "Admins can update company member profiles"
  on public.profiles;
drop policy if exists "Users can update own profile"
  on public.profiles;
drop policy if exists "director_read_only_update_v1"
  on public.profiles;
drop policy if exists "Users can update own language"
  on public.profiles;

create policy "Users can update own language"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Every new operational reference participates in the same transaction-level
-- lock as warehouse archive/type changes. This prevents a concurrent insert
-- from appearing immediately after the archive preflight has passed.
create or replace function public.guard_active_warehouse_reference_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_column text;
  v_company_id uuid;
  v_warehouse_id uuid;
  v_archived boolean;
  v_is_archived boolean;
begin
  v_company_id := nullif(to_jsonb(new) ->> 'company_id', '')::uuid;
  if v_company_id is null then
    raise exception 'Компания для складской операции не определена.' using errcode = '23503';
  end if;

  -- Child operations share this company lock and remain concurrent with one
  -- another. Archive/type changes take the exclusive form of the same lock.
  perform pg_advisory_xact_lock_shared(
    hashtextextended('warehouse-company:' || v_company_id::text, 0)
  );

  foreach v_column in array tg_argv loop
    if tg_op = 'UPDATE'
      and (to_jsonb(new) ->> v_column) is not distinct from (to_jsonb(old) ->> v_column)
    then
      continue;
    end if;

    v_warehouse_id := nullif(to_jsonb(new) ->> v_column, '')::uuid;
    if v_warehouse_id is null then
      continue;
    end if;

    select coalesce(w.archived, false), coalesce(w.is_archived, false)
      into v_archived, v_is_archived
    from public.warehouses w
    where w.id = v_warehouse_id
      and w.company_id = v_company_id;

    if not found then
      raise exception 'Объект хранения не найден в выбранной компании.' using errcode = '23503';
    end if;
    if v_archived or v_is_archived then
      raise exception 'Архивный объект нельзя использовать в новой операции.' using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.guard_active_warehouse_reference_v1() from public, anon, authenticated;

-- Warehouse lifecycle mutations must pass through the existing server routes,
-- where role/company checks, usage/archive guards and audit attribution run.
revoke insert, update, delete, truncate
  on table public.warehouses
  from anon, authenticated;

drop policy if exists "Users can create own warehouses"
  on public.warehouses;
drop policy if exists "Users can insert company warehouses"
  on public.warehouses;
drop policy if exists "Users can update company warehouses"
  on public.warehouses;
drop policy if exists "Users can delete company warehouses"
  on public.warehouses;

-- Keep lifecycle decisions atomic with the row update. The application performs
-- the same checks to return a complete reason list; this trigger closes the race
-- between that preflight and the mutation itself.
create or replace function public.guard_warehouse_lifecycle_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_type_changed boolean;
  v_archive_started boolean;
begin
  v_type_changed :=
    new.place_type is distinct from old.place_type
    or (
      coalesce(new.place_type, 'WAREHOUSE') = 'WAREHOUSE'
      and coalesce(old.place_type, 'WAREHOUSE') = 'WAREHOUSE'
      and new.warehouse_type is distinct from old.warehouse_type
    );

  v_archive_started :=
    (coalesce(new.archived, false) or coalesce(new.is_archived, false))
    and not (coalesce(old.archived, false) or coalesce(old.is_archived, false));

  if v_type_changed or v_archive_started then
    perform pg_advisory_xact_lock(
      hashtextextended('warehouse-company:' || new.company_id::text, 0)
    );
  end if;

  if v_type_changed and (
    exists (select 1 from public.tickets t where t.company_id = new.company_id and (t.warehouse_from_id = new.id or t.warehouse_to_id = new.id))
    or exists (select 1 from public.ticket_lines tl where tl.company_id = new.company_id and (tl.warehouse_from_id = new.id or tl.warehouse_to_id = new.id))
    or exists (select 1 from public.inventory_batches b where b.company_id = new.company_id and b.warehouse_id = new.id)
    or exists (select 1 from public.stock_ledger_entries l where l.company_id = new.company_id and l.warehouse_id = new.id)
    or exists (select 1 from public.inventory_transactions i where i.company_id = new.company_id and (i.warehouse_id = new.id or i.source_warehouse_id = new.id or i.destination_warehouse_id = new.id))
    or exists (select 1 from public.batch_transformation_inputs i where i.company_id = new.company_id and (i.warehouse_from_id = new.id or i.node_warehouse_id = new.id))
    or exists (select 1 from public.batch_transformation_outputs o where o.company_id = new.company_id and o.warehouse_to_id = new.id)
    or exists (select 1 from public.batch_transformations t where t.company_id = new.company_id and t.node_warehouse_id = new.id)
    or exists (select 1 from public.processing_documents d where d.company_id = new.company_id and (d.source_warehouse_id = new.id or d.destination_warehouse_id = new.id))
    or exists (select 1 from public.processing_nodes n where n.company_id = new.company_id and n.linked_warehouse_id = new.id)
    or exists (select 1 from public.warehouse_inventory_documents d where d.company_id = new.company_id and d.warehouse_id = new.id)
    or exists (select 1 from public.warehouse_issue_requests r where r.company_id = new.company_id and r.source_warehouse_id = new.id)
    or exists (select 1 from public.warehouse_issue_request_item_allocations a where a.company_id = new.company_id and a.warehouse_id = new.id)
    or exists (select 1 from public.warehouse_transfer_documents d where d.company_id = new.company_id and (d.source_warehouse_id = new.id or d.destination_warehouse_id = new.id))
    or exists (select 1 from public.weighbridge_active_harvests h where h.company_id = new.company_id and h.warehouse_id = new.id)
    or exists (select 1 from public.field_material_consumptions c where c.company_id = new.company_id and c.warehouse_id = new.id)
  ) then
    raise exception 'Тип используемого объекта изменить нельзя. Архивируйте его и создайте новый объект.'
      using errcode = '23514';
  end if;

  if v_archive_started then
    if exists (
      select 1
      from public.v_stock_balance_canonical b
      where b.company_id = new.company_id
        and b.warehouse_id = new.id
        and abs(coalesce(b.quantity, 0)) > 0.000001
    ) or exists (
      select 1
      from public.inventory_batches b
      where b.company_id = new.company_id
        and b.warehouse_id = new.id
        and greatest(
          abs(coalesce(b.current_weight_kg, 0)),
          abs(coalesce(b.current_quantity, 0)),
          abs(coalesce(b.mass_kg, 0))
        ) > 0.000001
    ) then
      raise exception 'Объект нельзя архивировать: ненулевой остаток' using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.tickets t
      left join public.ticket_lines tl on tl.ticket_id = t.id and tl.company_id = t.company_id
      where t.company_id = new.company_id
        and t.status in ('draft', 'active', 'ready_to_close')
        and (
          t.warehouse_from_id = new.id or t.warehouse_to_id = new.id
          or tl.warehouse_from_id = new.id or tl.warehouse_to_id = new.id
        )
    ) then
      raise exception 'Объект нельзя архивировать: есть открытые талоны' using errcode = '23514';
    end if;

    if exists (
      select 1 from public.weighbridge_active_harvests h
      where h.company_id = new.company_id and h.warehouse_id = new.id and h.status = 'active'
    ) then
      raise exception 'Объект нельзя архивировать: активная приёмка' using errcode = '23514';
    end if;

    if exists (
      select 1 from public.batch_transformations t
      where t.company_id = new.company_id
        and t.node_warehouse_id = new.id
        and (t.status = 'draft' or t.processing_state in ('in_processing', 'processing_pending_outputs'))
    ) or exists (
      select 1 from public.processing_documents d
      where d.company_id = new.company_id
        and (d.source_warehouse_id = new.id or d.destination_warehouse_id = new.id)
        and d.status = 'draft'
    ) or exists (
      select 1 from public.processing_nodes n
      where n.company_id = new.company_id
        and n.linked_warehouse_id = new.id
        and n.is_active = true
        and n.archived = false
    ) then
      raise exception 'Объект нельзя архивировать: незавершённая обработка' using errcode = '23514';
    end if;

    if exists (
      select 1 from public.inventory_transactions i
      where i.company_id = new.company_id
        and (i.warehouse_id = new.id or i.source_warehouse_id = new.id or i.destination_warehouse_id = new.id)
        and i.status = 'draft'
    ) or exists (
      select 1 from public.warehouse_inventory_documents d
      where d.company_id = new.company_id
        and d.warehouse_id = new.id
        and d.status in ('in_progress', 'awaiting_approval', 'rejected')
    ) or exists (
      select 1 from public.warehouse_issue_requests r
      where r.company_id = new.company_id
        and r.source_warehouse_id = new.id
        and r.status in ('new', 'active', 'preparing', 'ready', 'partially_issued', 'issued_by_warehouse', 'issued')
    ) or exists (
      select 1 from public.warehouse_issue_request_item_allocations a
      where a.company_id = new.company_id
        and a.warehouse_id = new.id
        and coalesce(a.prepared_quantity, 0) - coalesce(a.issued_quantity, 0) > 0.000001
    ) then
      raise exception 'Объект нельзя архивировать: незавершённая операция или перемещение' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_warehouse_lifecycle_v1() from public, anon, authenticated;

drop trigger if exists warehouses_lifecycle_guard_v1 on public.warehouses;
create trigger warehouses_lifecycle_guard_v1
before update of place_type, warehouse_type, archived, is_archived
on public.warehouses
for each row
execute function public.guard_warehouse_lifecycle_v1();

drop trigger if exists tickets_active_warehouse_guard_v1 on public.tickets;
create trigger tickets_active_warehouse_guard_v1 before insert or update of warehouse_from_id, warehouse_to_id
on public.tickets for each row execute function public.guard_active_warehouse_reference_v1('warehouse_from_id', 'warehouse_to_id');

drop trigger if exists ticket_lines_active_warehouse_guard_v1 on public.ticket_lines;
create trigger ticket_lines_active_warehouse_guard_v1 before insert or update of warehouse_from_id, warehouse_to_id
on public.ticket_lines for each row execute function public.guard_active_warehouse_reference_v1('warehouse_from_id', 'warehouse_to_id');

drop trigger if exists inventory_batches_active_warehouse_guard_v1 on public.inventory_batches;
create trigger inventory_batches_active_warehouse_guard_v1 before insert or update of warehouse_id
on public.inventory_batches for each row execute function public.guard_active_warehouse_reference_v1('warehouse_id');

drop trigger if exists stock_ledger_active_warehouse_guard_v1 on public.stock_ledger_entries;
create trigger stock_ledger_active_warehouse_guard_v1 before insert or update of warehouse_id
on public.stock_ledger_entries for each row execute function public.guard_active_warehouse_reference_v1('warehouse_id');

drop trigger if exists inventory_transactions_active_warehouse_guard_v1 on public.inventory_transactions;
create trigger inventory_transactions_active_warehouse_guard_v1 before insert or update of warehouse_id, source_warehouse_id, destination_warehouse_id
on public.inventory_transactions for each row execute function public.guard_active_warehouse_reference_v1('warehouse_id', 'source_warehouse_id', 'destination_warehouse_id');

drop trigger if exists batch_inputs_active_warehouse_guard_v1 on public.batch_transformation_inputs;
create trigger batch_inputs_active_warehouse_guard_v1 before insert or update of warehouse_from_id, node_warehouse_id
on public.batch_transformation_inputs for each row execute function public.guard_active_warehouse_reference_v1('warehouse_from_id', 'node_warehouse_id');

drop trigger if exists batch_outputs_active_warehouse_guard_v1 on public.batch_transformation_outputs;
create trigger batch_outputs_active_warehouse_guard_v1 before insert or update of warehouse_to_id
on public.batch_transformation_outputs for each row execute function public.guard_active_warehouse_reference_v1('warehouse_to_id');

drop trigger if exists transformations_active_warehouse_guard_v1 on public.batch_transformations;
create trigger transformations_active_warehouse_guard_v1 before insert or update of node_warehouse_id
on public.batch_transformations for each row execute function public.guard_active_warehouse_reference_v1('node_warehouse_id');

drop trigger if exists processing_documents_active_warehouse_guard_v1 on public.processing_documents;
create trigger processing_documents_active_warehouse_guard_v1 before insert or update of source_warehouse_id, destination_warehouse_id
on public.processing_documents for each row execute function public.guard_active_warehouse_reference_v1('source_warehouse_id', 'destination_warehouse_id');

drop trigger if exists processing_nodes_active_warehouse_guard_v1 on public.processing_nodes;
create trigger processing_nodes_active_warehouse_guard_v1 before insert or update of linked_warehouse_id
on public.processing_nodes for each row execute function public.guard_active_warehouse_reference_v1('linked_warehouse_id');

drop trigger if exists inventory_documents_active_warehouse_guard_v1 on public.warehouse_inventory_documents;
create trigger inventory_documents_active_warehouse_guard_v1 before insert or update of warehouse_id
on public.warehouse_inventory_documents for each row execute function public.guard_active_warehouse_reference_v1('warehouse_id');

drop trigger if exists issue_requests_active_warehouse_guard_v1 on public.warehouse_issue_requests;
create trigger issue_requests_active_warehouse_guard_v1 before insert or update of source_warehouse_id
on public.warehouse_issue_requests for each row execute function public.guard_active_warehouse_reference_v1('source_warehouse_id');

drop trigger if exists issue_allocations_active_warehouse_guard_v1 on public.warehouse_issue_request_item_allocations;
create trigger issue_allocations_active_warehouse_guard_v1 before insert or update of warehouse_id
on public.warehouse_issue_request_item_allocations for each row execute function public.guard_active_warehouse_reference_v1('warehouse_id');

drop trigger if exists transfer_documents_active_warehouse_guard_v1 on public.warehouse_transfer_documents;
create trigger transfer_documents_active_warehouse_guard_v1 before insert or update of source_warehouse_id, destination_warehouse_id
on public.warehouse_transfer_documents for each row execute function public.guard_active_warehouse_reference_v1('source_warehouse_id', 'destination_warehouse_id');

drop trigger if exists active_harvests_warehouse_guard_v1 on public.weighbridge_active_harvests;
create trigger active_harvests_warehouse_guard_v1 before insert or update of warehouse_id
on public.weighbridge_active_harvests for each row execute function public.guard_active_warehouse_reference_v1('warehouse_id');

drop trigger if exists field_consumptions_active_warehouse_guard_v1 on public.field_material_consumptions;
create trigger field_consumptions_active_warehouse_guard_v1 before insert or update of warehouse_id
on public.field_material_consumptions for each row execute function public.guard_active_warehouse_reference_v1('warehouse_id');

commit;

notify pgrst, 'reload schema';
