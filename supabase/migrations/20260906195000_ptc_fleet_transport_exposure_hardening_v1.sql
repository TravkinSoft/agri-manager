-- The legacy compatibility view is not used by the application. Keep it
-- available to trusted server code only and make underlying RLS authoritative.
alter view public.fleet_transport set (security_invoker = true);

revoke all on table public.fleet_transport from public, anon, authenticated;
grant select on table public.fleet_transport to service_role;
