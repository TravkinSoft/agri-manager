-- TZ-240: restore the canonical crop-independent snow-retention work type.
INSERT INTO public.operation_types (
  slug,
  category_slug,
  name_ru,
  name_en,
  requires_field,
  requires_machine,
  requires_product,
  affects_inventory,
  affects_field_history,
  is_active
)
VALUES (
  'snow_retention',
  'soil_preparation',
  'Снегозадержание',
  'Snow retention',
  true,
  true,
  false,
  false,
  true,
  true
)
ON CONFLICT (slug) DO UPDATE
SET
  category_slug = EXCLUDED.category_slug,
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  requires_field = EXCLUDED.requires_field,
  requires_machine = EXCLUDED.requires_machine,
  requires_product = EXCLUDED.requires_product,
  affects_inventory = EXCLUDED.affects_inventory,
  affects_field_history = EXCLUDED.affects_field_history,
  is_active = EXCLUDED.is_active,
  updated_at = now()
WHERE (
  operation_types.category_slug,
  operation_types.name_ru,
  operation_types.name_en,
  operation_types.requires_field,
  operation_types.requires_machine,
  operation_types.requires_product,
  operation_types.affects_inventory,
  operation_types.affects_field_history,
  operation_types.is_active
) IS DISTINCT FROM (
  EXCLUDED.category_slug,
  EXCLUDED.name_ru,
  EXCLUDED.name_en,
  EXCLUDED.requires_field,
  EXCLUDED.requires_machine,
  EXCLUDED.requires_product,
  EXCLUDED.affects_inventory,
  EXCLUDED.affects_field_history,
  EXCLUDED.is_active
);
