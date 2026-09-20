# Production company cleanup — 2026-09-20

## Outcome

The three owner-identified email-named orphan companies were archived, not deleted.
There are now four active companies: Астык-STEM, КХ Звольский,
TravkinFlowTest1 and TravkinFlow Google Play Demo. Their rows were not changed.
The active company list, selection, user administration and platform counts exclude archives.

No accounts were created, activated, moved or invited as part of this repair.
All 20 profiles have the same before/after fingerprint:
`cda7344ffdb28ae9591e730449dbe4ce`.
The Google reviewer remains banned, pending, with zero sessions.

## Cause and fix

- The legacy markerless Auth fallback created `<email>'s Company` when no company name
  was provided. A failed invitation followed by Auth cleanup could leave an orphan;
  retrying created another. This path was reproduced in an isolated PostgreSQL engine.
  Historical HTTP payloads are not available, so this is a reproduced mechanism,
  not a claim to have recovered every original request.
- Active company names had no uniqueness constraint. An expression index now rejects
  duplicates after case and whitespace normalization, including non-breaking spaces.
- Trusted generic and PTC invitation markers still bind pending, non-owner profiles
  to the requested active company. Markerless registration now requires an explicit
  company name, and cannot silently create an email-named tenant.
- Failed new-company provisioning archives its own empty company after confirmed
  Auth cleanup. Failed or ambiguous Auth cleanup keeps the company visible for recovery.

## Repair safeguards

Before the repair, all 132 discovered company references were checked. No linked
profiles or business rows existed for these targets. One Global Admin notification
preference existed and was preserved. The exact original rows are backed up in
`phantom-companies-backup-20260920.json`.

A physical-delete dry run was rolled back when the immutable warehouse opening-balance
guard rejected the FK cascade even though no warehouse records belonged to the targets.
That guard was NOT bypassed or disabled. The successful repair only set `archived_at`
and `updated_at` on the three exact verified company IDs.

The operational repair is intentionally separate from reusable schema migrations.
Applied order:

1. `20260920075104_company_creation_identity_guard_v1`
2. `archive-phantom-companies-20260920.sql` (first dry run with rollback, then committed)
3. `20260920075215_company_active_name_unique_v1`

Reversibility: archive rows and the preference remain in place. Restore only after
checking the intended company identity and active-name uniqueness; do not restore
both duplicate names at once or weaken the unique constraint.

## Validation

- Company creation/archive regression: 51 checks passed, isolated PGlite only.
- Accountant/invitation security regression: 67 checks passed, isolated DB only.
- TypeScript typecheck passed.
- Production build and configured model smoke passed (54-second build).
- Hosted rollback probe confirmed a case/space-varied duplicate is rejected.
- Supabase security advisors: no findings related to the changed companies table or
  handle_new_user function. Unrelated existing project findings were not remediated here.
- Main-domain health at 07:57:16 UTC identifies the deployment below.
- Unauthenticated company API returns 401; no administrative access was opened.
- Authenticated browser rendering: NOT LIVE VERIFIED. The in-app browser automation
  failed during kernel initialization (missing assets path). DB results, deployed source
  filters and public health were verified independently. Refresh /platform to reload its list.

## Deploy Result

- URL: https://agri-manager-q41df3kks-travkin-ais-projects.vercel.app
- Main site: https://travkinflow.com/platform
- Target: production
- Status: READY, promoted
- Deployment: dpl_AKqTDkuDEnhSWyRzihrDbyUvBoFx
- Source: codex/fix-phantom-companies-20260920, based on f359461; working-tree build
  (platform API reports commit=null, so no fabricated deployment SHA).
- Framework: Next.js 13.5.1
- Build duration: 54 seconds

### Post-Deploy Observability

- Error scan: no error/fatal runtime logs for this deployment from 07:56:30 to 07:57:37 UTC.
  This is a short smoke window, not proof of all workflows or long-term monitoring.
- Drains: not inspected.
- Monitoring: health and post-release logs checked; no new recurring monitor created.

Future deployments must include this branch's application filters. Deploying an older
company API would show archived records again even though the database guards remain.
