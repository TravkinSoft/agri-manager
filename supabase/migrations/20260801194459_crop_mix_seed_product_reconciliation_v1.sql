begin;

create or replace function public.reconcile_crop_mix_seed_product_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null
     or not (new.type = 'seed' or coalesce(new.is_seed_material, false))
     or new.crop_id is null
     or new.variety_id is null
     or new.seed_reproduction_id is null
     or coalesce(new.archived, false)
     or not coalesce(new.is_active, true) then
    return new;
  end if;

  update public.operation_materials material
  set product_id = new.id,
      notes = case
        when material.notes = 'seed_stock_deficit:product_not_received' then 'crop_mix_component'
        else material.notes
      end,
      updated_at = now()
  where material.company_id = new.company_id
    and material.product_id is null
    and material.material_type = 'seed'
    and material.source_mix_component_id is not null
    and material.crop_id = new.crop_id
    and material.variety_id = new.variety_id
    and material.reproduction_id = new.seed_reproduction_id;

  update public.warehouse_issue_request_items item
  set product_id = new.id,
      planned_product_id = new.id,
      actual_product_id = new.id,
      reconciliation_status = case
        when coalesce(item.issued_quantity, 0) > 0 then item.reconciliation_status
        else 'pending'
      end
  where item.company_id = new.company_id
    and item.product_id is null
    and item.material_kind = 'seed'
    and item.source_mix_component_id is not null
    and item.crop_id = new.crop_id
    and item.variety_id = new.variety_id
    and item.reproduction_id = new.seed_reproduction_id;

  return new;
end;
$$;

revoke all on function public.reconcile_crop_mix_seed_product_v1()
  from public, anon, authenticated;

drop trigger if exists reconcile_crop_mix_seed_product_v1 on public.products;
create trigger reconcile_crop_mix_seed_product_v1
after insert or update of company_id, type, is_seed_material, crop_id, variety_id,
  seed_reproduction_id, archived, is_active
on public.products
for each row
execute function public.reconcile_crop_mix_seed_product_v1();

commit;

notify pgrst, 'reload schema';
