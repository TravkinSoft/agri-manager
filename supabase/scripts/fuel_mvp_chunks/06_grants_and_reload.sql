-- 06: grants + schema reload

grant execute on function public.issue_fuel_mvp(uuid, uuid, uuid, uuid, uuid, numeric, timestamptz, text) to authenticated;
grant execute on function public.transfer_fuel_mvp(uuid, uuid, uuid, uuid, numeric, timestamptz, uuid, text) to authenticated;

notify pgrst, 'reload schema';
