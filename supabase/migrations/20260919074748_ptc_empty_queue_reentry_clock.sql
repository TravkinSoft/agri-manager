-- Queue age is time in the current operational state, not the age of a vehicle.
-- Cover all writers (line configuration, ticket close, explicit vehicle swap).
-- Replaying configuration for already-assigned empty vehicles must not reshuffle
-- the queue. No existing state/event/ticket is rewritten by this migration.
create or replace function private.ptc_empty_queue_entry_clock_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.assigned and new.state = 'empty' then
    if tg_op = 'INSERT' then
      new.since := clock_timestamp();
    elsif not old.assigned or old.state <> 'empty' then
      new.since := clock_timestamp();
      -- Invalidate stale loading commands from before the off-line interval.
      new.version := greatest(new.version, old.version + 1);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.ptc_empty_queue_entry_clock_v1() from public, anon, authenticated;

create trigger ptc_empty_queue_entry_clock
before insert or update of assigned, state on public.ptc_vehicle_states
for each row execute function private.ptc_empty_queue_entry_clock_v1();
