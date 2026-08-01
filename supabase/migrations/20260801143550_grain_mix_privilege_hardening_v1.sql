-- TZ-242: keep the new RLS table read/write only through row-level policies.
revoke all on table public.crop_structure_mix_components from public, anon, authenticated;
grant select, insert, update, delete on table public.crop_structure_mix_components to authenticated;
