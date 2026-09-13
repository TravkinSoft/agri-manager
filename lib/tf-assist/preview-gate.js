// The exact Preview branch is the approved test surface. A rename cannot inherit access.
const QA_ORIGIN = "https://gsglkmudcwkdetqtocae.supabase.co";
const PREVIEW_BRANCH = "codex/tf-assist-harvest-foundation-20260913";
/** @param {Record<string, string | undefined>} env */
function previewEnabled(env) {
  if (env.VERCEL_ENV === "production" || env.TF_ASSIST_HARVEST_V1 === "0")
    return false;
  if (env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== QA_ORIGIN)
    return false;
  return (
    env.TF_ASSIST_HARVEST_V1 === "1" ||
    (env.VERCEL_ENV === "preview" &&
      env.VERCEL_GIT_COMMIT_REF === PREVIEW_BRANCH)
  );
}
module.exports = { QA_ORIGIN, PREVIEW_BRANCH, previewEnabled };
