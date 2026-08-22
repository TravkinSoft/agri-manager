-- TZ297: covering indexes for event/loss foreign-key maintenance and lookups.

create index if not exists idx_batch_processing_events_transformation_fk_v1
  on public.batch_processing_events(transformation_id);

create index if not exists idx_batch_processing_events_actor_fk_v1
  on public.batch_processing_events(actor_user_id)
  where actor_user_id is not null;

create index if not exists idx_batch_transformation_losses_transformation_fk_v1
  on public.batch_transformation_losses(transformation_id);

create index if not exists idx_batch_transformation_losses_approved_by_fk_v1
  on public.batch_transformation_losses(approved_by)
  where approved_by is not null;
