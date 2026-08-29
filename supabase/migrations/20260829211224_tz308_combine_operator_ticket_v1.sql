begin;

alter table public.tickets
  add column if not exists combine_operator_person_id uuid;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_combine_operator_person_id_fkey'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_combine_operator_person_id_fkey
      foreign key (combine_operator_person_id)
      references public.company_people(id)
      on delete set null;
  end if;
end
$migration$;

create index if not exists tickets_combine_operator_recent_idx
  on public.tickets (
    company_id,
    season_id,
    crop_structure_allocation_id,
    created_at desc
  )
  where combine_operator_person_id is not null
    and op_type = 'harvest_incoming'
    and is_voided = false;

comment on column public.tickets.combine_operator_person_id is
  'Company person who operated the combine for this harvest incoming ticket.';

commit;
