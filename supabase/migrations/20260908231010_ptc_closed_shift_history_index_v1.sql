-- Additive read-path index for bounded keyset pagination of closed PTC shifts.
-- Open shifts remain covered by the existing partial uniqueness index.
create index if not exists ptc_combine_shift_company_closed_history_v1
  on public.ptc_combine_shifts(company_id, closed_at desc, id desc)
  where closed_at is not null;
