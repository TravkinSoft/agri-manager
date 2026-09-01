begin;

-- Production history contains warehouse_canonical_units_v2, but a later legacy
-- schema replay restored the old field-material constraint and removed the
-- canonical trigger. Repair only this physical drift; existing rows are not
-- updated or validated by this migration.
do $migration$
declare
  v_definition text;
begin
  if to_regclass('public.field_material_consumptions') is null then
    raise exception 'Required table public.field_material_consumptions is missing';
  end if;

  select pg_get_constraintdef(constraint_row.oid, true)
    into v_definition
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.field_material_consumptions'::regclass
    and constraint_row.conname = 'field_material_consumptions_batch_class_check';

  if v_definition is null then
    raise exception 'Required constraint public.field_material_consumptions_batch_class_check is missing';
  end if;

  if v_definition ilike '%material%'
     and v_definition ilike '%commodity%'
     and v_definition ilike '%rejected%' then
    null;
  elsif v_definition ilike '%commodity%'
     and v_definition ilike '%seed%'
     and v_definition ilike '%feed%'
     and v_definition ilike '%waste%'
     and v_definition ilike '%processing%'
     and v_definition ilike '%rejected%'
     and v_definition not ilike '%material%' then
    alter table public.field_material_consumptions
      drop constraint field_material_consumptions_batch_class_check;
    alter table public.field_material_consumptions
      add constraint field_material_consumptions_batch_class_check
      check (
        batch_class is null
        or batch_class in (
          'commodity', 'seed', 'material', 'feed', 'waste', 'processing', 'rejected'
        )
      ) not valid;
  else
    raise exception 'Unexpected field material batch class constraint: %', v_definition;
  end if;

  select pg_get_constraintdef(constraint_row.oid, true)
    into v_definition
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.field_material_consumptions'::regclass
    and constraint_row.conname = 'field_material_consumptions_unit_contract_v2';

  if v_definition is null then
    alter table public.field_material_consumptions
      add constraint field_material_consumptions_unit_contract_v2
      check (
        unit_contract_version is null
        or (
          unit_contract_version = 2
          and quantity > 0
          and uom in ('kg', 'l', 'pcs')
          and batch_class in (
            'commodity', 'seed', 'material', 'feed', 'waste', 'processing', 'rejected'
          )
        )
      ) not valid;
  elsif v_definition not ilike '%unit_contract_version%'
     or v_definition not ilike '%material%'
     or v_definition not ilike '%quantity%'
     or v_definition not ilike '%uom%' then
    raise exception 'Unexpected field material unit contract: %', v_definition;
  end if;
end
$migration$;

create or replace function public.enforce_field_material_contract_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_line public.ticket_lines%rowtype;
begin
  if new.unit_contract_version is null and new.ticket_line_id is not null then
    select * into v_line
    from public.ticket_lines
    where id = new.ticket_line_id
      and unit_contract_version = 2;
    if not found then
      raise exception 'Canonical ticket line contract not found for field material fact';
    end if;
    new.quantity := v_line.quantity;
    new.uom := v_line.uom;
    new.mass_kg := v_line.mass_kg;
    new.quantity_kg := v_line.mass_kg;
    new.batch_class := v_line.batch_class;
    new.density_kg_per_l := v_line.density_kg_per_l;
    new.density_unit := v_line.density_unit;
    new.density_source := v_line.density_source;
    new.density_verification_status := v_line.density_verification_status;
    new.density_verified_at := v_line.density_verified_at;
    new.unit_contract_version := 2;
  elsif new.unit_contract_version is null then
    raise exception 'Canonical unit contract is required for new field material facts';
  end if;

  perform public.validate_stock_quantity_contract(
    new.product_id, new.quantity, new.uom, new.batch_class, new.mass_kg,
    new.density_kg_per_l, new.density_unit, new.density_source,
    new.density_verification_status, new.density_verified_at
  );
  return new;
end;
$$;

do $migration$
begin
  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.field_material_consumptions'::regclass
      and trigger_row.tgname = 'trg_enforce_field_material_contract_v2'
      and not trigger_row.tgisinternal
  ) then
    create trigger trg_enforce_field_material_contract_v2
      before insert or update on public.field_material_consumptions
      for each row execute function public.enforce_field_material_contract_v2();
  end if;
end
$migration$;

notify pgrst, 'reload schema';

commit;
