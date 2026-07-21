begin;

create index if not exists idx_counterparties_created_by
  on public.counterparties(created_by)
  where created_by is not null;
create index if not exists idx_counterparty_audit_actor
  on public.counterparty_audit_log(actor_user_id)
  where actor_user_id is not null;
create index if not exists idx_counterparty_audit_company_counterparty
  on public.counterparty_audit_log(company_counterparty_id)
  where company_counterparty_id is not null;

revoke all on function public.normalize_counterparty_name_v1(text) from public, anon;
grant execute on function public.normalize_counterparty_name_v1(text) to authenticated;

commit;

notify pgrst, 'reload schema';
