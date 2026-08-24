begin;

create table if not exists public.weighbridge_reconciliation_controls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reconciliation_date date not null,
  field_id uuid null references public.fields(id) on delete restrict,
  paper_total_kg numeric(18, 3) null check (paper_total_kg is null or paper_total_kg >= 0),
  note text null,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weighbridge_reconciliation_controls_day_uidx
  on public.weighbridge_reconciliation_controls(company_id, reconciliation_date)
  where field_id is null;

create unique index if not exists weighbridge_reconciliation_controls_day_field_uidx
  on public.weighbridge_reconciliation_controls(company_id, reconciliation_date, field_id)
  where field_id is not null;

create index if not exists weighbridge_reconciliation_controls_company_date_idx
  on public.weighbridge_reconciliation_controls(company_id, reconciliation_date desc);

drop trigger if exists trg_weighbridge_reconciliation_controls_updated_at
  on public.weighbridge_reconciliation_controls;
create trigger trg_weighbridge_reconciliation_controls_updated_at
before update on public.weighbridge_reconciliation_controls
for each row execute function public.update_updated_at_column();

alter table public.weighbridge_reconciliation_controls enable row level security;

drop policy if exists "Company members can view weighbridge reconciliation controls"
  on public.weighbridge_reconciliation_controls;
create policy "Company members can view weighbridge reconciliation controls"
on public.weighbridge_reconciliation_controls for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = weighbridge_reconciliation_controls.company_id)
  )
);

drop policy if exists "Weighbridge roles can manage reconciliation controls"
  on public.weighbridge_reconciliation_controls;
create policy "Weighbridge roles can manage reconciliation controls"
on public.weighbridge_reconciliation_controls for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'weighman')
      and (p.role = 'global_admin' or p.company_id = weighbridge_reconciliation_controls.company_id)
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'weighman')
      and (p.role = 'global_admin' or p.company_id = weighbridge_reconciliation_controls.company_id)
  )
);

comment on table public.weighbridge_reconciliation_controls is
  'Paper-journal control metadata only. Never posts tickets, batches, stock or ledger movements.';

commit;
