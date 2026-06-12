begin;

-- Operations Execution V5 is additive: old status/work_status columns stay intact
-- for existing pages, while canonical execution state gets its own columns.

alter table public.operations
  add column if not exists operation_status text,
  add column if not exists specialist_task_status text,
  add column if not exists planned_area_ha numeric(12, 4),
  add column if not exists completed_area_ha numeric(12, 4) not null default 0,
  add column if not exists remaining_area_ha numeric(12, 4),
  add column if not exists progress_percent numeric(7, 2) not null default 0,
  add column if not exists last_progress_at timestamptz,
  add column if not exists last_stop_reason text;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'operations'
      and constraint_name = 'operations_operation_status_v5_check'
  ) then
    alter table public.operations
      add constraint operations_operation_status_v5_check
      check (
        operation_status is null or operation_status in (
          'planned',
          'accepted',
          'in_progress',
          'paused',
          'ready_to_close',
          'completed',
          'cancelled'
        )
      );
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'operations'
      and constraint_name = 'operations_specialist_task_status_v5_check'
  ) then
    alter table public.operations
      add constraint operations_specialist_task_status_v5_check
      check (
        specialist_task_status is null or specialist_task_status in (
          'new',
          'accepted',
          'waiting_materials',
          'materials_ready',
          'materials_received',
          'in_progress',
          'paused',
          'ready_to_close',
          'completed'
        )
      );
  end if;
end $$;

update public.operations
set
  operation_status = coalesce(
    operation_status,
    case
      when coalesce(work_status, status) = 'completed' then 'completed'
      when coalesce(work_status, status) = 'in_progress' then 'in_progress'
      when status = 'accepted' then 'accepted'
      when status = 'cancelled' then 'cancelled'
      else 'planned'
    end
  ),
  specialist_task_status = coalesce(
    specialist_task_status,
    case
      when coalesce(work_status, status) = 'completed' then 'completed'
      when coalesce(work_status, status) = 'in_progress' then 'in_progress'
      when status = 'accepted' then 'accepted'
      else 'new'
    end
  )
where operation_status is null
   or specialist_task_status is null;

create table if not exists public.operation_progress (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  reported_by uuid references public.profiles(id) on delete set null,
  reported_at timestamptz not null default now(),
  completed_area_ha numeric(12, 4) not null check (completed_area_ha >= 0),
  remaining_area_ha numeric(12, 4) not null check (remaining_area_ha >= 0),
  progress_percent numeric(7, 2) not null check (progress_percent >= 0),
  status_after_report text not null check (
    status_after_report in (
      'in_progress',
      'paused',
      'ready_to_close',
      'completed'
    )
  ),
  stop_reason text,
  comment text,
  weather_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_operation_progress_company_operation
  on public.operation_progress(company_id, operation_id, reported_at desc);

create index if not exists idx_operation_progress_reported_by
  on public.operation_progress(company_id, reported_by, reported_at desc);

alter table public.operation_progress enable row level security;

drop policy if exists "Users can view company operation progress" on public.operation_progress;
create policy "Users can view company operation progress"
  on public.operation_progress for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.company_id = operation_progress.company_id
        and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can insert company operation progress" on public.operation_progress;
create policy "Users can insert company operation progress"
  on public.operation_progress for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.company_id = operation_progress.company_id
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier')
    )
  );

alter table public.warehouse_issue_requests
  add column if not exists warehouse_request_status text,
  add column if not exists collecting_at timestamptz,
  add column if not exists picked_up_at timestamptz,
  add column if not exists return_expected_at timestamptz,
  add column if not exists return_received_at timestamptz,
  add column if not exists return_closed_at timestamptz,
  add column if not exists return_requested_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists return_received_by_user_id uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'warehouse_issue_requests'
      and constraint_name = 'warehouse_issue_requests_v5_status_check'
  ) then
    alter table public.warehouse_issue_requests
      add constraint warehouse_issue_requests_v5_status_check
      check (
        warehouse_request_status is null or warehouse_request_status in (
          'pending',
          'collecting',
          'ready_for_pickup',
          'picked_up_by_specialist',
          'issued',
          'return_expected',
          'return_received',
          'closed',
          'cancelled'
        )
      );
  end if;
end $$;

update public.warehouse_issue_requests
set warehouse_request_status = coalesce(
  warehouse_request_status,
  case status
    when 'new' then 'pending'
    when 'active' then 'pending'
    when 'preparing' then 'collecting'
    when 'ready' then 'ready_for_pickup'
    when 'received_confirmed' then 'picked_up_by_specialist'
    when 'partially_issued' then 'issued'
    when 'issued_by_warehouse' then 'issued'
    when 'issued' then 'issued'
    when 'cancelled' then 'cancelled'
    else 'pending'
  end
)
where warehouse_request_status is null;

alter table public.warehouse_issue_request_items
  add column if not exists expected_return_quantity numeric(12, 4) not null default 0,
  add column if not exists return_received_quantity numeric(12, 4) not null default 0,
  add column if not exists loss_quantity numeric(12, 4) not null default 0,
  add column if not exists loss_reason text,
  add column if not exists loss_comment text,
  add column if not exists return_comment text;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'warehouse_issue_request_items'
      and constraint_name = 'warehouse_issue_request_items_return_loss_nonnegative_check'
  ) then
    alter table public.warehouse_issue_request_items
      add constraint warehouse_issue_request_items_return_loss_nonnegative_check
      check (
        expected_return_quantity >= 0
        and return_received_quantity >= 0
        and loss_quantity >= 0
      );
  end if;
end $$;

create index if not exists idx_operations_execution_v5_status
  on public.operations(company_id, operation_status, specialist_task_status);

create index if not exists idx_warehouse_issue_requests_v5_status
  on public.warehouse_issue_requests(company_id, warehouse_request_status, created_at desc);

commit;
