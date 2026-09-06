create index if not exists ptc_idle_alert_last_event_idx
  on public.ptc_idle_alert_state(last_load_event_id);

create index if not exists user_push_subscriptions_company_idx
  on public.user_push_subscriptions(company_id, recipient_user_id);
