begin;

with ranked_open_shifts as (
  select
    id,
    row_number() over (
      partition by company_id
      order by opened_at desc nulls last, created_at desc nulls last, id desc
    ) as open_rank
  from public.weighbridge_shifts
  where status = 'open'
)
update public.weighbridge_shifts s
set
  status = 'closed',
  closed_at = coalesce(s.closed_at, now()),
  closing_note = coalesce(
    nullif(s.closing_note, ''),
    'auto-closed duplicate open shift during single-open-shift hardening'
  ),
  updated_at = now()
from ranked_open_shifts r
where s.id = r.id
  and r.open_rank > 1;

create unique index if not exists idx_weighbridge_shifts_company_open_unique
  on public.weighbridge_shifts(company_id)
  where status = 'open';

commit;

notify pgrst, 'reload schema';
