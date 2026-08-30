begin;

-- Corrective-only guard for environments where the historical warehouse-admin
-- migration was recorded but this one physical trigger was not created.
-- Existing canonical triggers are left untouched; unexpected definitions fail
-- closed so drift is never overwritten silently.
do $$
declare
  v_table regclass := to_regclass('public.weighbridge_active_harvests');
  v_guard_function oid := to_regprocedure('public.guard_active_warehouse_reference_v1()');
  v_warehouse_attnum smallint;
  v_trigger record;
  v_expected_tgtype constant smallint := 23; -- ROW | BEFORE | INSERT | UPDATE
  v_expected_args_hex constant text := encode(convert_to('warehouse_id', 'UTF8'), 'hex') || '00';
begin
  if v_table is null then
    raise exception 'Required table public.weighbridge_active_harvests does not exist'
      using errcode = '42P01';
  end if;

  if v_guard_function is null then
    raise exception 'Required function public.guard_active_warehouse_reference_v1() does not exist'
      using errcode = '42883';
  end if;

  select a.attnum::smallint
  into v_warehouse_attnum
  from pg_attribute a
  where a.attrelid = v_table
    and a.attname = 'warehouse_id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_warehouse_attnum is null then
    raise exception 'Required column public.weighbridge_active_harvests.warehouse_id does not exist'
      using errcode = '42703';
  end if;

  select
    t.tgfoid,
    t.tgenabled,
    t.tgtype,
    t.tgattr::text as tgattr_text,
    t.tgnargs,
    encode(t.tgargs, 'hex') as tgargs_hex,
    t.tgisinternal,
    pg_get_triggerdef(t.oid, true) as definition
  into v_trigger
  from pg_trigger t
  where t.tgrelid = v_table
    and t.tgname = 'active_harvests_warehouse_guard_v1';

  if not found then
    execute $trigger$
      create trigger active_harvests_warehouse_guard_v1
      before insert or update of warehouse_id
      on public.weighbridge_active_harvests
      for each row
      execute function public.guard_active_warehouse_reference_v1('warehouse_id')
    $trigger$;
  elsif v_trigger.tgisinternal
     or v_trigger.tgfoid <> v_guard_function
     or v_trigger.tgenabled <> 'O'
     or v_trigger.tgtype <> v_expected_tgtype
     or v_trigger.tgattr_text <> v_warehouse_attnum::text
     or v_trigger.tgnargs <> 1
     or v_trigger.tgargs_hex <> v_expected_args_hex then
    raise exception 'Trigger active_harvests_warehouse_guard_v1 exists with a non-canonical definition'
      using
        errcode = '55000',
        detail = v_trigger.definition,
        hint = 'Audit the drift explicitly; do not replace this trigger silently.';
  end if;
end
$$;

commit;
