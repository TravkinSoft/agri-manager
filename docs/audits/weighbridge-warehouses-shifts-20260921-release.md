# Релиз удаления чемпионов — 21.09.2026

- Runtime commit: `c2172e8153aa337faf529cc9b7765a0578c80fa0`.
- Branch pushed: `codex/audit-weighbridge-warehouse-shifts-20260921`.
- Parent/baseline: `a22de90ae41808eebe10e1465b6daa22e65b0b3c`.
- Deployment: `dpl_3pdxoqoJGLppKuUdXFih4vaxoBdQ`, READY.
- URL: `https://agri-manager-4f6hjvw7g-travkin-ais-projects.vercel.app`.
- Built with production configuration using `--prod --skip-domain`, checked health with authenticated Vercel CLI, then promoted. Before promotion `travkinflow.com` still pointed to baseline deployment `dpl_7q2kEtdsuT8TmDRXCNBizLxYVXmT`.

## Проверено после переключения

- `https://travkinflow.com/api/healthz`: `ok=true`, `environment=production`, commit `c2172e8153aa`.
- Vercel lookup of `travkinflow.com`: new deployment ID above, READY.
- `/dashboard` HTTP 200. Inspected all 27 JS chunk references from its HTML/RSC payload: no `Таблица чемпионов`, no `refreshDrivers`.
- Deployed dashboard chunk `static/chunks/app/(dashboard)/dashboard/page-8271adde867d930c.js` contains `includeDriverStats:!1`.
- New deployment runtime 5xx count query over first 10-minute window: no entries. This is an immediate smoke check, not long-term monitoring.
- Local typecheck and production build passed; remote build and its model smoke passed. 17/20 selected regression suites passed; three limitations are documented in the main audit.

Authenticated visual dashboard verification: **NOT LIVE VERIFIED**; browser tooling was unavailable. Asset inspection does not substitute for role-based UI testing.

## Data boundary

No migrations, real tickets, warehouse ledger entries, shifts or role records were changed. Local-only PGlite repros performed writes solely in test database memory.

Additional read-only countercheck after the main audit: active/non-void/non-replaced open tickets attached to closed shifts = 0 at query time. The 26 historical handover shifts without summary snapshots do not by themselves prove lost documents or currently stranded open tickets.

Only champions removal was implemented. All other findings remain an audit backlog, not a completed fix. Deleted component and obsolete champions browser test remain recoverable in Git history.
