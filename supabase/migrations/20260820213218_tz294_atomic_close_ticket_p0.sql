begin;

-- The QA ticket_lines contract predates the updated_at field used by the
-- atomic TZ294 finalizer. Keep the compatibility change additive so the
-- complete close transaction can run without touching ticket business data.
alter table public.ticket_lines
  add column if not exists updated_at timestamptz not null default now();

comment on column public.ticket_lines.updated_at is
  'Last ticket-line mutation timestamp; required by the atomic harvest close contract.';

create or replace function public.close_harvest_ticket_atomic(
  p_ticket_id uuid,
  p_session_token text,
  p_tare_weight_kg numeric,
  p_moisture_percent numeric default null,
  p_deduction_kg numeric default null,
  p_deduction_percent numeric default null,
  p_deduction_reason text default null,
  p_tare_variance_confirmed boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  select public.finalize_harvest_intake_for_session_v1(
    p_ticket_id,
    p_session_token,
    p_tare_weight_kg,
    p_moisture_percent,
    p_deduction_kg,
    p_deduction_percent,
    p_deduction_reason,
    p_tare_variance_confirmed,
    p_idempotency_key
  );
$function$;

revoke all on function public.close_harvest_ticket_atomic(
  uuid, text, numeric, numeric, numeric, numeric, text, boolean, text
) from public, anon;
grant execute on function public.close_harvest_ticket_atomic(
  uuid, text, numeric, numeric, numeric, numeric, text, boolean, text
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
