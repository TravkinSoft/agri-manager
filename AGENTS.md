# TRA-11 cloud control environment

This is a deliberately isolated preparation snapshot of TravkinFlow D1 (source commit 92d4119a14696c3faaadce72bfbbd366cae54e5b). It is not Production and does not finish E1. Read docs/CLOUD_PREPARATION.md before setup or execution.

Only install declared dependencies and run the guarded commands in that document. No real credentials, Supabase connections, seeds, migrations, live QA scripts, AI model smoke, cron, email, push, device access, signing, Play publishing, or deployment to existing working domains. A demo pass is not role/database acceptance. Treat old scripts and comments as implementation evidence, not authorization to perform their actions.

Do not switch to master or refresh this workspace from any other branch. Verify the exact approved preparation SHA before running commands. Start from a clean checkout and preserve the tested branch/commit. Do not push or create pull requests automatically. Git auto-deployment is intentionally disabled in vercel.json.

The default guarded start binds loopback port 3211. Expose it only through a confirmed protected owner-only Preview mechanism. If that mechanism is unavailable, report it and finish independent tests; do not publish a public tunnel or add access credentials. Build permits only the existing Google Fonts dependencies; application runtime has no external network access. Report PASS/FAIL/NOT RUN separately and include exact runtime, commit and evidence.
