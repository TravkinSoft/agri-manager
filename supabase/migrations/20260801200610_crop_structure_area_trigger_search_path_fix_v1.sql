begin;

create or replace function public.validate_crop_structure_area()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field_area decimal(10, 2);
begin
  select field_row.area
  into field_area
  from public.fields field_row
  where field_row.id = new.field_id;

  if new.area > field_area then
    raise exception 'Crop area (% ha) cannot exceed field area (% ha)', new.area, field_area;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_crop_structure_area()
  from public, anon, authenticated;

commit;
