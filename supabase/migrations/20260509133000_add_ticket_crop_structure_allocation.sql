begin;

alter table public.tickets
  add column if not exists crop_structure_allocation_id uuid references public.crop_structure(id);

create index if not exists idx_tickets_company_crop_structure_allocation
  on public.tickets(company_id, crop_structure_allocation_id);

commit;

