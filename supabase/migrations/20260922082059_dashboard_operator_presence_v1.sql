begin;
set local lock_timeout = '1500ms';
-- Operational telemetry only; no ticket, shift, stock or user session is modified.
create table public.dashboard_operator_presence (
  company_id uuid not null references public.companies(id),
  profile_id uuid not null references public.profiles(id),
  workspace text not null check (workspace in ('weighbridge','combine')),
  last_seen_at timestamptz not null default now(),
  primary key (company_id, profile_id, workspace)
);
create index dashboard_presence_company_workspace_seen_idx
  on public.dashboard_operator_presence(company_id, workspace, last_seen_at desc);
alter table public.dashboard_operator_presence enable row level security;
-- Only server routes after live profile/tenant checks can read/write telemetry.
revoke all on public.dashboard_operator_presence from public, anon, authenticated;
grant select, insert, update on public.dashboard_operator_presence to service_role;
comment on table public.dashboard_operator_presence is 'Foreground operator-app heartbeats; not shift status, not proof a person is present. Server only.';
commit;
