create or replace function public.validate_harvest_ticket_line_required_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_is_crop_mix boolean := false;
  v_review_reasons text[] := array[]::text[];
begin
  select t.* into v_ticket
  from public.tickets t
  where t.id = new.ticket_id;

  if v_ticket.direction::text = 'incoming'
     and lower(coalesce(v_ticket.op_type, '')) = 'harvest_incoming' then
    select exists (
      select 1
      from public.crop_structure cs
      where cs.id = v_ticket.crop_structure_allocation_id
        and cs.company_id = v_ticket.company_id
        and cs.field_id = v_ticket.field_id
        and cs.land_use_type = 'crop_mix'
        and coalesce(cs.archived, false) = false
    ) into v_is_crop_mix;

    if v_is_crop_mix then
      if new.crop_id is not null
         or new.variety_id is not null
         or new.reproduction_id is not null
         or not coalesce(new.is_mixed_harvest, false)
         or jsonb_array_length(coalesce(new.composition_snapshot, '[]'::jsonb)) < 2
         or nullif(btrim(new.composition_hash), '') is null
         or not exists (
           select 1
           from public.products p
           where p.id = new.product_id
             and p.company_id = v_ticket.company_id
             and coalesce(p.is_derived_inventory, false) = true
             and p.derived_identity_key = new.composition_hash
             and coalesce(p.archived, false) = false
         ) then
        raise exception 'Mixed harvest line requires verified composition and derived inventory identity';
      end if;
    else
      v_review_reasons := string_to_array(
        replace(lower(coalesce(v_ticket.review_reason, '')), ' ', ''),
        ','
      );

      if new.crop_id is null then
        raise exception 'crop_id is required for harvest incoming ticket lines';
      end if;

      if new.variety_id is null
         and (
           not coalesce(v_ticket.requires_review, false)
           or not ('missing_variety' = any(v_review_reasons))
         ) then
        raise exception 'missing variety requires ticket review_reason missing_variety';
      end if;

      if new.reproduction_id is null
         and (
           not coalesce(v_ticket.requires_review, false)
           or not ('missing_reproduction' = any(v_review_reasons))
         ) then
        raise exception 'missing reproduction requires ticket review_reason missing_reproduction';
      end if;
    end if;

    if coalesce(new.quantity, 0) <= 0 then
      raise exception 'quantity must be > 0 for harvest incoming ticket lines';
    end if;
  end if;

  return new;
end;
$function$;
