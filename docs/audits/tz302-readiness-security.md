# TZ302 Readiness and Security Audit

## Server-side role contract

| Role | Weighbridge | Reconciliation metadata | Manual loss approval | Admin health |
| --- | --- | --- | --- | --- |
| weighbridge operator (`weighman`) | read/write with active operator session | read/write | no | no |
| agronomist | read-only ticket/summary access | read-only | no | no |
| director | read-only plus explicitly approved processing supervision | read-only | role-gated only | no |
| company_admin | company-scoped administration | read/write | allowed by processing contract | own company |
| global_admin | explicit company context | read/write | allowed by processing contract | selected company |

The API/RPC/RLS layer remains authoritative. Hidden controls are not treated as authorization.

## TZ302 additions

- `weighbridge_reconciliation_controls` is company-scoped with RLS.
- Read access follows the existing weighbridge read roles.
- Writes are restricted to `global_admin`, `company_admin`, and `weighman` in both the API and RLS policy.
- Paper control totals are metadata only; their API contains no ticket, batch, stock, or ledger mutation.
- `/api/operations-health` is restricted server-side to `global_admin` and `company_admin`.
- Health results detect and report anomalies only. No repair endpoint or action is exposed.
- The public `/api/healthz` exposes runtime identity only and contains no company or business data.

## Required live verification before release

1. Execute role-specific API checks with user JWTs for all five roles.
2. Confirm cross-company reads and writes return no data/403 as appropriate.
3. Verify RPC grants for ticket finalize, correction, storno, processing losses, and shift lifecycle.
4. Verify RLS policies after the migration is applied in QA.
5. Run Truth Engine and full weighbridge regression with zero Production business writes.
