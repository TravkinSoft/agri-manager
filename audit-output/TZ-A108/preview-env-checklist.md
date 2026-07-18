# TZ-A108 preview environment checklist

No secret values are recorded in this file.

## Required public/runtime variables

- `NEXT_PUBLIC_SUPABASE_URL`: exact HTTPS URL for test branch `gsglkmudcwkdetqtocae`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: test-branch anon key; secret value is supplied by the preview environment and is never logged.
- `SUPABASE_URL`: same exact test-branch HTTPS URL.
- `SUPABASE_ANON_KEY`: same test-branch anon key; never logged.
- `A107_BRANCH_REF`: exact value `gsglkmudcwkdetqtocae`.
- `A106_BRANCH_REF`: exact value `gsglkmudcwkdetqtocae`.
- `ASSISTANT_ACCESS_STRICT`: `1`.
- `ASSISTANT_RUNTIME_MODE`: `responses_v2`.
- `OPENAI_ASSISTANT_MODEL`: `gpt-5.6-terra`.
- `REASONING_EFFORT`: `medium`.
- `ASSISTANT_RESPONSES_STORE`: `false`.
- `ASSISTANT_MEMORY_V2_ENABLED`: `1`.
- `ASSISTANT_MEMORY_V1_ENABLED`: `1` for the current compatibility gate.
- `OPENAI_API_KEY`: runtime-only secret; must be supplied separately after the safe bundle scan and never exposed to client chunks.

## Local validation only

- `A106_LOCAL_RUNTIME`: `1` only for the isolated local validation runtime.
- `ASSISTANT_LOCAL_QA_MODEL_OVERRIDE`: `gpt-5.6-terra` only for isolated local validation.

## Forbidden

- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, all admin/access/management tokens.
- `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_DB_URL`, all Postgres URLs and direct database credentials.
- Any Supabase URL or project ref other than the exact test branch.

The runtime must stop before auth, OpenAI, or ERP access if either Supabase URL is missing, malformed, non-HTTPS, or has a hostname other than `gsglkmudcwkdetqtocae.supabase.co`.
