/*
  # Superseded demo seed

  This migration originally inserted 2024-2025 demo fields, crop structure,
  operations, warehouse stock and reference rows for the first Auth user.

  The seed is no longer part of the TravkinFlow production contract:
  - production contains none of the original demo-owned rows;
  - later migrations provide the canonical catalogs and company model;
  - business data must be created through normal company workflows;
  - replay must not depend on an arbitrary pre-existing Auth user.

  Keep this version as an explicit, repeat-safe no-op so migration history can
  be reproduced without resurrecting obsolete demo data.
*/

do $superseded_demo_seed$
begin
  raise notice '20260308153257: superseded demo seed skipped';
end
$superseded_demo_seed$;
