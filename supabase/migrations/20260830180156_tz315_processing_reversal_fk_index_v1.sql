-- TZ315 additive FK coverage for reversal receipt season lookups.
-- Kept separate because the canonical migration was already applied to QA.
create index if not exists idx_batch_processing_reversals_season_fk_v1
  on public.batch_processing_reversals(season_id);
