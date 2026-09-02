-- TZ315 P1 corrective: the company-total invariant belongs only to transfers.
-- A valid correction of an outgoing/incoming ticket intentionally preserves the
-- replacement document's business effect after the original effect is stornoed.
-- Patch the verified physical function in place and fail closed on drift.

do $migration$
declare
  v_signature regprocedure :=
    'public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)'::regprocedure;
  v_definition text;
  v_old constant text := 'if abs(coalesce(('
  ;
  v_new constant text := E'-- TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1\n  if v_old.direction::text = ''transfer''\n     and abs(coalesce(('
  ;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if strpos(v_definition, 'TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1') > 0 then
    if strpos(v_definition, 'if v_old.direction::text = ''transfer''') = 0 then
      raise exception 'TZ315 correction marker exists without the transfer guard';
    end if;
    return;
  end if;

  if strpos(v_definition, v_old) = 0
     or strpos(substr(v_definition, strpos(v_definition, v_old) + length(v_old)), v_old) > 0 then
    raise exception 'TZ315 correction function drift: expected stock postcondition not found';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;

  select pg_get_functiondef(v_signature) into v_definition;
  if strpos(v_definition, 'TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1') = 0
     or strpos(v_definition, 'if v_old.direction::text = ''transfer''') = 0
     or strpos(v_definition, v_old) > 0 then
    raise exception 'TZ315 correction stock postcondition patch failed';
  end if;
end
$migration$;

comment on function public.finalize_weighbridge_ticket_correction_v1(uuid, uuid, uuid)
  is 'Canonical ticket correction; transfer-only company-total invariant, non-transfer replacements preserve their business effect.';

notify pgrst, 'reload schema';
