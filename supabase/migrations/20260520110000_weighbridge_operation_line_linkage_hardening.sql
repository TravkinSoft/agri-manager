begin;

alter table public.ticket_lines
  add column if not exists operation_line_id uuid references public.operation_lines(id) on delete set null;

create index if not exists idx_ticket_lines_operation_line_id
  on public.ticket_lines(operation_line_id);

create or replace function public.backfill_ticket_operation_line_links_v1(
  p_ticket_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.field_material_consumptions fmc
  set
    operation_line_id = tl.operation_line_id,
    updated_at = now()
  from public.ticket_lines tl
  where fmc.ticket_id = p_ticket_id
    and tl.ticket_id = p_ticket_id
    and tl.id = fmc.ticket_line_id
    and tl.operation_line_id is not null
    and fmc.operation_line_id is distinct from tl.operation_line_id;

  with line_identity as (
    select
      tl.ticket_id,
      tl.operation_line_id,
      tl.product_id,
      tl.variety_id,
      tl.reproduction_id,
      coalesce(tl.batch_id::text, tl.lot_id, '') as batch_id_text,
      coalesce(tl.batch_class, 'commodity') as batch_class,
      row_number() over (
        partition by
          tl.ticket_id,
          tl.product_id,
          tl.variety_id,
          tl.reproduction_id,
          coalesce(tl.batch_id::text, tl.lot_id, ''),
          coalesce(tl.batch_class, 'commodity')
        order by tl.created_at, tl.id
      ) as rn
    from public.ticket_lines tl
    where tl.ticket_id = p_ticket_id
      and tl.operation_line_id is not null
  ),
  ledger_identity as (
    select
      sle.id,
      sle.ticket_id,
      sle.product_id,
      sle.variety_id,
      sle.reproduction_id,
      coalesce(sle.batch_id_text, '') as batch_id_text,
      coalesce(sle.batch_class, 'commodity') as batch_class,
      row_number() over (
        partition by
          sle.ticket_id,
          sle.product_id,
          sle.variety_id,
          sle.reproduction_id,
          coalesce(sle.batch_id_text, ''),
          coalesce(sle.batch_class, 'commodity')
        order by sle.occurred_at, sle.id
      ) as rn
    from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id
  )
  update public.stock_ledger_entries sle
  set operation_line_id = li.operation_line_id
  from ledger_identity le
  join line_identity li
    on li.ticket_id = le.ticket_id
   and li.product_id is not distinct from le.product_id
   and li.variety_id is not distinct from le.variety_id
   and li.reproduction_id is not distinct from le.reproduction_id
   and li.batch_id_text = le.batch_id_text
   and li.batch_class = le.batch_class
   and li.rn = le.rn
  where sle.id = le.id
    and sle.operation_line_id is distinct from li.operation_line_id;
end;
$$;

commit;

notify pgrst, 'reload schema';

