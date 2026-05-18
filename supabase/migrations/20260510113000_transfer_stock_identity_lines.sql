begin;

alter table public.ticket_lines
  add column if not exists batch_class text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ticket_lines_batch_class_check'
      and conrelid = 'public.ticket_lines'::regclass
  ) then
    alter table public.ticket_lines
      add constraint ticket_lines_batch_class_check
      check (
        batch_class is null
        or batch_class in ('commodity', 'seed', 'feed', 'waste', 'processing', 'rejected')
      );
  end if;
end $$;

create index if not exists idx_ticket_lines_identity_transfer
  on public.ticket_lines(company_id, product_id, variety_id, reproduction_id, batch_class);

notify pgrst, 'reload schema';

commit;
