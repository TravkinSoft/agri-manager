# Windows 7 connector preparation — 2026-09-21

## Scope and baseline

Owner confirmed Windows 7 and RS-232, supplied photographs of METRA Микросим-06 М0601-БМ-2.1, then authorised work and requested Telegram reporting.

Isolated worktree/branch: `.worktrees/connector-win7-rs232-20260921`, `codex/connector-win7-rs232-20260921`.
Exact existing Production source baseline: `e662c20362543e4efd4994e731c79a3902946e30`, from the account-deletion deployment record and matching live health deployment `agri-manager-iq2la44j9-travkin-ais-projects.vercel.app` / `dpl_Bb9CajA35xcmymHaK28JSzNzi1cZ`. Health commit is null, not a SHA proof. Fetched origin/master is older `e4c58ae`; do not deploy that old branch or overwrite its lineage.

## Implemented first stage, not full scale integration

- New separate .NET Framework 4.8 AnyCPU diagnostic application and x86 per-user MSI suitable for 32/64-bit Windows 7 SP1 prerequisites. The pre-existing .NET 8 connector and its untracked source remain untouched.
- Explicit COM/baud selection and confirmation; no automatic port opening, scanning baud rates, reconnecting to occupied ports, autostart or driver installation.
- Read-only binary-safe serial capture: no CRLF assumption; records HEX/escaped ASCII, timestamps and receive count. Bounded ring buffer, stale/no-byte warnings, explicit file export. No interpreted weight, no network listener, no commands, no zero/tare/calibration, no TF credentials.
- Weighbridge workspace menu `⋯ → Подключение весов` with MSI, portable ZIP, official .NET 4.8 link, prerequisites, checksums and explicit limitations. No fetch, polling, ticket hooks or database changes.
- Build/native sources are excluded from website upload; only the intentionally distributable artifacts are public.

## Local verification

- C# compilation PASS; 18 executable capture/settings tests PASS, no COM port opened.
- MSI AppSearch and runtime launch-condition checks PASS; raw registry DWORD prefix `#` handled correctly; accepted .NET 4.8/4.8.1 releases and rejected missing/older runtimes. Package is inspected, NOT installed on the user's PC.
- Download file hash/size, UI/read-only contracts PASS.
- TypeScript and scoped ESLint PASS. Mobile actual-component browser fixture: 390px viewport has 390px document width; menu/dialog render, no page errors; only CSS/bundle/favicon requests, zero business requests.
- Native UI rendered off-screen on Windows 11; it is NOT a physical Windows 7 test. Default and minimum-width layouts inspected.
- Automated local browser MSI and ZIP downloads returned `Download was canceled`; do not claim those tests passed or tell the user to disable browser protections. Both artifacts were subsequently verified over HTTPS independently, on staging and live.
- MSI administrative extraction (not installation) PASS after running outside the restricted sandbox; extracted EXE matches the compiled executable. Initial restricted extraction exit 1603 was an environment failure, not silently counted as a pass.

## Remaining acceptance gates

Physical Windows 7 SP1/.NET/adapter driver, actual cable wiring, exact COM settings and the scale's output mode remain NOT LIVE VERIFIED. Binary is unsigned; no certificate purchase or security bypass performed. Need real empty/loaded capture with display units, gross/net and stable indicator before implementing a verified parser or any ticket-weight application. This release does not enable automatic weighing or change a real ticket.

## Publication

## Deploy Result

- URL: https://travkinflow.com/weighbridge
- Target: Production. State: READY.
- Source commit: `fc0ba489b1047b2f82c13559ab5cea7016032c63`.
- Deployment: `dpl_G5ya8aLGuUSz8fneULLRjcZLJp9s`, `agri-manager-gbxb8q4e4-travkin-ais-projects.vercel.app`.
- Framework: Next.js 13.5.1. Cloud build output: 50 seconds, model smoke passed. Existing Browserslist/Supabase/ws warnings remain.
- First staging build failed because an unanchored `.vercelignore` excluded nested download assets. Fixed root anchoring, added regression check, second full build PASS. No failed build was promoted.
- Staging HTTPS checks through authorised Vercel access: manifest/MSI/ZIP all match. An unauthenticated staging fetch returned the hosting login HTML, correctly rejected as a hash mismatch.
- Pre-promotion guard confirmed unchanged old live deployment; promoted the tested deployment, no rebuild. Post-promotion health: ok=true, environment=production, expected deployment. Commit field still null.
- Public downloads: HTTP 200, MSI 49,152 bytes SHA-256 `5638077d89f85caf6e594211b22894cdee4eac76db658464c27082e36d18527c`; ZIP 12,826 bytes SHA-256 `7d2460ef3b9b486dcdb8b70137b508668157978aeb45a032e2575b17d930ef32`. Live manifest matches both.
- Authenticated live menu interaction is NOT LIVE VERIFIED. Actual-component desktop/mobile fixture was verified, and live artifact delivery was separately verified.
- Private GitHub branch pushed; master unchanged. No business data writes, migrations, scale commands, live scale reads or working-PC installations.

### Post-Deploy Observability

- Error scan: no logs found on this deployment for `level=error`, `since=10m` immediately after promotion. This is a bounded snapshot, not comprehensive traffic acceptance.
- Drains: not inspected. No recurring monitoring created.
- Native Windows 7/hardware and browser-download acceptance gates above remain open. Diagnostic delivery is complete; automatic scale-to-ticket integration is not.
