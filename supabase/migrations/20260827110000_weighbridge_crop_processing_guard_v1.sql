-- Crop-aware processing route guard. Grain-processing places must never create
-- transformations for vegetable harvest lots.

create or replace function public.attach_route_processing_input_ticket_v1(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place_type text;
  v_crop_slug text;
  v_category_slug text;
  v_category_name text;
  v_subcategory text;
begin
  select
    upper(coalesce(w.place_type, 'WAREHOUSE')),
    lower(coalesce(c.slug, '')),
    lower(coalesce(cc.slug, '')),
    lower(coalesce(cc.name_ru, c.crop_category, c.category, '')),
    lower(coalesce(c.subcategory, c.crop_subcategory, ''))
  into
    v_place_type,
    v_crop_slug,
    v_category_slug,
    v_category_name,
    v_subcategory
  from public.tickets t
  join public.warehouses w
    on w.id = t.warehouse_to_id
   and w.company_id = t.company_id
  left join public.harvest_lots hl
    on hl.id = t.harvest_lot_id
   and hl.company_id = t.company_id
  left join public.crops c on c.id = hl.crop_id
  left join public.crop_categories cc on cc.id = c.category_id
  where t.id = p_ticket_id;

  if coalesce(v_place_type, 'WAREHOUSE') not in ('DRYER', 'CLEANER') then
    return null;
  end if;

  if v_category_slug = 'vegetable'
     or v_category_name like '%овощ%'
     or v_subcategory in ('tuber', 'root')
     or v_crop_slug in ('potato', 'carrot')
  then
    raise exception using
      errcode = '23514',
      message = 'VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED';
  end if;

  return public.attach_processing_input_ticket_live_v1(p_ticket_id);
end;
$$;

revoke all on function public.attach_route_processing_input_ticket_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.attach_route_processing_input_ticket_v1(uuid)
  to service_role;

comment on function public.attach_route_processing_input_ticket_v1(uuid) is
  'Routes eligible harvest lots into DRYER/CLEANER transformations and rejects vegetable lots.';

