# TRA-11 Android preparation boundary

- Start owner-facing reports with GOOGLE MARKET and a task percentage.
- Independent root-history branch in EXISTING TravkinSoft/agri-manager; not a
  replacement repository or a branch to merge into the TF website.
- No website, original Git history, business data, secrets, credentials, keystores,
  password.clixml, .env, SDK licenses or build caches in Git.
- Preserve vercel.json git.deploymentEnabled=false and crons=[]; no GitHub workflows.
- No Production/DB writes, deployment, official signing, Play, app launch/login.
- Release tasks forbidden. Debug key disposable and copy-local only.
- No SDK license acceptance, permanent credentials or paid resources.
- Four source-contract tests allowed with JDK17. Full debug build requires
  separately approved and provisioned SDK36/build-tools35.0.0.
- QA URL does not prove backend isolation. Runtime QA needs separate authorization.
- Do not alter the original checkout, bundle or other active work.
- Commit allowed here; push reserved for headquarters after independent review.
