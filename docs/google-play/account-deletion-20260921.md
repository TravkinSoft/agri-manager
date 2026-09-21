# Account deletion request page — 2026-09-21

## Authorization and scope

Owner approved a public request-instructions page using travkin.group@gmail.com.
No automatic deletion, business writes, migrations, authentication changes or permission changes.
The public allowlist addition exposes only the static informational page, not a protected business route.

## Source and deployment

- Isolated worktree: `.worktrees/google-account-deletion-20260921`.
- Branch: `codex/google-account-deletion-20260921`.
- Live baseline verified via health: `c2172e8153aa337faf529cc9b7765a0578c80fa0`, deployment `dpl_3pdxoqoJGLppKuUdXFih4vaxoBdQ`.
- Source commit: `e662c20362543e4efd4994e731c79a3902946e30`.
- Scope: new static page, one public-route allowlist entry, links in privacy page and profile menu, contract test.
- Build: Next.js 13.5.1, Vercel READY, build output reports about 1 minute. Existing Supabase/ws/Browserslist warnings remain.
- Staged with `--prod --skip-domain`, checked before promote. Baseline guard immediately before promote confirmed unchanged Production.
- Active deployment: `dpl_Bb9CajA35xcmymHaK28JSzNzi1cZ` / `agri-manager-iq2la44j9-travkin-ais-projects.vercel.app`.
- Production URL: https://travkinflow.com/account-deletion
- Health returns ok=true, environment=production, expected deployment. Health commit field is null; do not use it as SHA evidence.
- Main/master not modified or merged. Its last fetched SHA remains e4c58aed; branch divergence 23/1 due to existing Production lineage.

## Verification

- Contract tests 3/3 passed; TypeScript noEmit and scoped ESLint passed.
- Cloud full build passed.
- Anonymous page loads, heading/email/mailto template present. No login or installation required.
- Mobile browser 390x844: no horizontal overflow, no error overlay; public privacy navigation works.
- Live HTTPS response 200, no redirect; expected title, email and request link confirmed.
- Scoped deployment error-log query since 10 minutes: no logs found. This is not evidence of a comprehensive monitoring/drain setup.
- No mail sent. No Production DB writes performed by this task. No Android/device or profile-menu interaction acceptance claimed.

## Open gates — not a Play approval

- The owner has NOT yet confirmed proposed support response 7 calendar days / completion 30 calendar days after identity verification. Those promises are intentionally NOT published.
- Retained data categories, applicable retention periods, backup handling and operational deletion execution still require a truthful agreed policy before claiming full Play deletion compliance.
- Official reference: https://support.google.com/googleplay/android-developer/answer/13327111
- Data Safety declaration was not submitted or marked complete; new URL was not entered in Console during this turn.
- Reviewer credentials remain for personal entry. No password accessed or transmitted.
- Public Google Play release not submitted. Last confirmed setup is 7/11 (64%); Internal 4.0.0 remains, local signed 4.0.1/code5 not uploaded.
