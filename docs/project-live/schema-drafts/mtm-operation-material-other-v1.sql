-- DRAFT ONLY: not applied to QA or Production.
-- Operation UI, API and create_operation_plan_atomic_v12 already support
-- material_type='other' and route it into the existing warehouse request.
-- products.type='material' remains unchanged; it is NOT a new material_type.
-- Extend only the stale finite allowlist. Do not backfill/reclassify rows,
-- change roles, bypass E1 guards or alter warehouse/ledger behavior.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.operation_materials in access exclusive mode;

do $mtm_other$
declare
  actual_definition text;
  expected_old text;
  expected_new text;
  is_validated boolean;
begin
  select pg_get_constraintdef(c.oid), c.convalidated
    into actual_definition, is_validated
  from pg_constraint c
  where c.conrelid = 'public.operation_materials'::regclass
    and c.conname = 'operation_materials_material_type_check'
    and c.contype = 'c';

  -- Let this PostgreSQL version render the expected expressions itself.
  -- No parsing/replacing an unknown live constraint and no widening to ANY text.
  create temporary table mtm_other_constraint_probe (
    material_type text,
    constraint mtm_other_old check (material_type in (
      'seed','fertilizer','pesticide','adjuvant','ph_corrector','defoamer','biological','fuel','organic'
    )),
    constraint mtm_other_new check (material_type in (
      'seed','fertilizer','pesticide','adjuvant','ph_corrector','defoamer','biological','fuel','organic','other'
    ))
  ) on commit drop;
  select pg_get_constraintdef(oid) into expected_old from pg_constraint
    where conrelid = 'pg_temp.mtm_other_constraint_probe'::regclass and conname = 'mtm_other_old';
  select pg_get_constraintdef(oid) into expected_new from pg_constraint
    where conrelid = 'pg_temp.mtm_other_constraint_probe'::regclass and conname = 'mtm_other_new';

  if actual_definition is null or is_validated is distinct from true
     or actual_definition not in (expected_old, expected_new) then
    raise exception 'MTM_OTHER_PRECONDITION: unexpected operation material type constraint'
      using errcode = '55000';
  end if;
  if actual_definition = expected_new then return; end if;

  alter table public.operation_materials drop constraint operation_materials_material_type_check;
  alter table public.operation_materials add constraint operation_materials_material_type_check
    check (material_type in (
      'seed','fertilizer','pesticide','adjuvant','ph_corrector','defoamer','biological','fuel','organic','other'
    ));
end;
$mtm_other$;
commit;

-- Rollback is NOT a blind restoration of the old CHECK after new 'other' rows
-- exist. Stop new creates and retain those rows; a narrow UI rollback is safe.
-- Database restriction rollback requires separate row-aware reconciliation.
