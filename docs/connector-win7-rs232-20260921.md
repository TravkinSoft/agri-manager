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
- First automated browser MSI download returned `Download was canceled`; do not claim that test passed or tell the user to disable browser protections. HTTP artifact and final published-download verification are separate gates.

## Remaining acceptance gates

Physical Windows 7 SP1/.NET/adapter driver, actual cable wiring, exact COM settings and the scale's output mode remain NOT LIVE VERIFIED. Binary is unsigned; no certificate purchase or security bypass performed. Need real empty/loaded capture with display units, gross/net and stable indicator before implementing a verified parser or any ticket-weight application. This release does not enable automatic weighing or change a real ticket.

## Publication

Pending staged cloud build, baseline recheck, promotion and public artifact verification. No Production write/migration/deployment has yet been performed for this feature at this checkpoint.
