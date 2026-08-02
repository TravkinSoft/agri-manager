/*
  # Superseded demo products and warehouses seed

  This migration originally inserted demo products, warehouses and inventory
  for Auth user 00000000-0000-0000-0000-000000000001.

  That identity and its rows do not exist in production. Current products,
  warehouses and stock are company-scoped business data created through the
  application workflows. Recreating the old seed would both fail on clean Auth
  and revive data that is outside the modern architecture.

  Keep this version as an explicit, repeat-safe no-op. It creates no user,
  product, warehouse, inventory movement or other persistent object.
*/

do $superseded_demo_products$
begin
  raise notice '20260327175004: superseded demo products and warehouses skipped';
end
$superseded_demo_products$;
