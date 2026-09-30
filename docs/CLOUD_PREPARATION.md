# TRA-11: isolated D1 preparation

Base: 92d4119a14696c3faaadce72bfbbd366cae54e5b; original tree 29632bd98c40e33c7c3d6fe64138366b04e95516.
This branch is an environment transfer exercise. E1 remains a separate preserved dirty overlay; no business model, migration or Production update is part of this branch.

Node 24.14.1 and npm 11.11.0; package-lock.json is authoritative. Install with `npm ci --ignore-scripts --no-audit --no-fund`. The lock includes esbuild and optional macOS fsevents install hooks; neither arbitrary root hooks nor model-smoke are run.

Commands (repository root):

```
node scripts/cloud/run-offline.cjs typecheck
node scripts/cloud/run-offline.cjs lint
node scripts/cloud/run-offline.cjs unit qa-agro-a1-calculation.ts
node scripts/cloud/run-offline.cjs unit qa-agro-c1-calculation.ts
node scripts/cloud/run-offline.cjs unit qa-agro-d1-summary.ts
node scripts/cloud/run-offline.cjs unit account-deletion-contract.test.cjs
node scripts/cloud/run-offline.cjs build
node scripts/cloud/run-offline.cjs start
```

Preparation runs have no real credentials, use a non-listening loopback backend, deny external Node sockets/fetch, and refuse local .env files. The build alone allows fonts.googleapis.com and fonts.gstatic.com for the existing next/font dependencies; running the app denies those hosts too. They cannot certify login, role permissions, database persistence or tasks workflows. No dummy UI result counts as those passes. The existing QA database remains blocked for application acceptance until isolation and exact schema compatibility are proven. Cloud worker credentials/network guards must remain in the environment; the child process removes application secrets only.

`npm run build` on this preparation branch runs the guarded build only. No AI smoke or cron is allowed. `vercel.json` disables Git auto-deploys on this branch; do not merge its preparation policy into working branches. Do not put local backups, private legal documents, media, agronomy copyrighted originals, sessions or secret values in this public repository.

Restart: reinstall from this exact branch/commit into a second empty workspace; run the same checks; compare commit/tree/lock hash, build success and HTTP response. A Windows/WSL result is a local portability check, not a cloud acceptance result. Publish a saved cloud environment only after its config/network/checkout and owner-only access are reviewed.

## Transfer scope

This is a new root snapshot, not an E1 or Production release and not a full historical clone. All application source files match D1. Local originals, dirty work and history remain preserved separately. Data exports, operational repair SQL, internal audit documents, credential-bearing QA tools, old download installers and unrelated directories are deliberately excluded. Database migrations, Android and device drivers are not part of this web-only branch. Installer links may return 404. Only the listed offline package scripts are supported. A successful demo does not prove any database or device workflow.
