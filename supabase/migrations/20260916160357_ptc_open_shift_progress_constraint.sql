-- An open combine shift can start in legacy mode with NULL totals and then
-- receive an exact crop-structure selection. ptc_set_combine_shift_v2 stores
-- non-negative interim totals when that selection is attached, so the legacy
-- constraint must allow both the initial NULL state and the active progress state.

alter table public.ptc_combine_shifts
  drop constraint if exists ptc_combine_shifts_check;

alter table public.ptc_combine_shifts
  add constraint ptc_combine_shifts_check
  check (
    (
      closed_at is null
      and (hectares_shift is null or hectares_shift >= 0)
      and (hectares_field_total is null or hectares_field_total >= 0)
    )
    or
    (
      closed_at is not null
      and closed_at >= opened_at
      and hectares_shift >= 0
      and hectares_field_total >= 0
    )
  );
