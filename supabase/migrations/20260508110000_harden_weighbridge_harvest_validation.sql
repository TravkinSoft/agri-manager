-- Harden weighbridge validations at DB/business layer.
-- Prevent invalid harvest incoming tickets and lines even if API/UI is bypassed.

begin;

create or replace function public.validate_harvest_ticket_required_fields()
returns trigger
language plpgsql
as $$
declare
  v_is_harvest boolean;
begin
  v_is_harvest :=
    coalesce(new.direction::text, '') = 'incoming'
    and lower(coalesce(new.op_type, '')) = 'harvest_incoming';

  if v_is_harvest then
    if new.field_id is null then
      raise exception 'field_id is required for harvest incoming';
    end if;
    if new.warehouse_to_id is null then
      raise exception 'warehouse_to_id is required for harvest incoming';
    end if;
    if new.vehicle_id is null then
      raise exception 'vehicle_id is required for harvest incoming';
    end if;
    if new.driver_id is null then
      raise exception 'driver_id is required for harvest incoming';
    end if;
    if new.gross_weight_kg is null or new.gross_weight_kg <= 0 then
      raise exception 'gross_weight_kg must be > 0 for harvest incoming';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_harvest_ticket_required_fields on public.tickets;
create trigger trg_validate_harvest_ticket_required_fields
before insert or update on public.tickets
for each row
execute function public.validate_harvest_ticket_required_fields();

create or replace function public.validate_harvest_ticket_line_required_fields()
returns trigger
language plpgsql
as $$
declare
  v_direction text;
  v_op_type text;
begin
  select t.direction::text, lower(coalesce(t.op_type, ''))
    into v_direction, v_op_type
  from public.tickets t
  where t.id = new.ticket_id;

  if v_direction = 'incoming' and v_op_type = 'harvest_incoming' then
    if new.variety_id is null then
      raise exception 'variety_id is required for harvest incoming ticket lines';
    end if;
    if new.reproduction_id is null then
      raise exception 'reproduction_id is required for harvest incoming ticket lines';
    end if;
    if coalesce(new.quantity, 0) <= 0 then
      raise exception 'quantity must be > 0 for harvest incoming ticket lines';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_harvest_ticket_line_required_fields on public.ticket_lines;
create trigger trg_validate_harvest_ticket_line_required_fields
before insert or update on public.ticket_lines
for each row
execute function public.validate_harvest_ticket_line_required_fields();

commit;

