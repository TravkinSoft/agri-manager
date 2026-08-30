begin;

-- The physical balance view is the only archive stock authority. Durable
-- processing_nodes describe equipment/catalog identity; unfinished work is
-- represented by transformations and processing documents.
do $$
begin
  if to_regprocedure('public.guard_warehouse_lifecycle_v1()') is null then
    raise exception 'Required function public.guard_warehouse_lifecycle_v1() does not exist'
      using errcode = '42883';
  end if;
end
$$;

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

commit;
