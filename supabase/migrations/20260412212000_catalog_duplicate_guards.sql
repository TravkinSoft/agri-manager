/*
  Duplicate guards for catalogs (active, non-archived scope)
*/

create unique index if not exists ux_crops_company_name_active
  on public.crops(company_id, lower(name))
  where archived = false;

create unique index if not exists ux_varieties_company_crop_name_active
  on public.varieties(company_id, crop_id, lower(name))
  where archived = false;

create unique index if not exists ux_seed_reproductions_company_name_active
  on public.seed_reproductions(company_id, lower(name))
  where archived = false;

create unique index if not exists ux_reference_machines_company_name_active
  on public.reference_machines(company_id, lower(name))
  where archived = false;

create unique index if not exists ux_reference_specialists_company_name_active
  on public.reference_specialists(company_id, lower(full_name))
  where archived = false;

create unique index if not exists ux_reference_vehicles_company_plate_active
  on public.reference_vehicles(company_id, lower(plate_number))
  where archived = false;

