# TZ302 Recovery Runbook

This runbook is deliberately manual. Health checks detect and report; they never repair domains, shifts, stock, ledger, or business records.

## A. Bad deploy

1. Record the failing deployment ID, runtime SHA, time, HTTP status, and the last known good deployment.
2. Stop new releases. Keep the database unchanged.
3. Promote the last known good Vercel deployment or revert the bad runtime commit through the normal Git flow.
4. Verify `/api/healthz`, login, `/weighbridge`, `/warehouses`, runtime errors, and 5xx.

Do not rewrite `master`, force-push, or run database rollback SQL for a runtime-only failure.

## B. Bad migration

1. Stop runtime writes that depend on the new contract.
2. Capture migration history, exact schema fingerprint, affected functions/tables, and business-row counts.
3. Prefer an additive forward repair. Use prepared rollback SQL only when it is proven data-safe.
4. Reconcile tickets, weighings, batches, lots, and ledger before reopening writes.

Do not edit migration history manually, delete business rows, or disable integrity triggers to make the symptom disappear.

## C. Domain alias failure

1. Run `npm run health:check:strict -- -BaseUrl https://travkinflow.com -ExpectedSha <sha>`.
2. Confirm the target deployment still exists and is `READY`.
3. Rebind the alias to that exact deployment through the approved Vercel flow.
4. Re-run the strict check and verify there is no `DEPLOYMENT_NOT_FOUND` response.

Do not create a new deployment when the approved deployment is healthy, and do not alter the database.

## D. Business-data mistake

1. Freeze the affected document chain and capture its Truth Engine/Black Box fingerprint.
2. Use the existing correction, storno, void, or reassignment contract for that document type.
3. Verify the source link, idempotency key, resulting batches/lots, and net ledger effect.
4. Preserve the original document and audit history.

Do not issue raw SQL updates to mass, ticket status, batches, lots, or ledger.

## E. Supabase outage

1. Keep the current runtime deployment and domain stable.
2. Confirm provider status, project reachability, Auth, PostgREST, and database connectivity separately.
3. Prevent blind retries from creating duplicate business actions; preserve the operator's unsent form state.
4. After recovery, validate migration history and schema fingerprint before writes resume.

Do not repoint Production to QA, expose service-role credentials, or treat cached critical stock as current truth.

## Recovery evidence

- Git: exact release SHA and clean source branch.
- Vercel: deployment ID, state, alias target, and rollback candidate.
- Supabase: backup policy/PITR availability verified in the project dashboard, migration history, and schema fingerprint.
- Data: tickets, `ticket_weighings`, `stock_ledger_entries`, `inventory_batches`, `harvest_lots`, processing transformations/events, users, and configuration included in the recovery scope.

An isolated restore is required before claiming restore readiness. Until that drill is completed, report it as `N/A`, not `PASS`.
