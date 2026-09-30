// The exact Preview branch is the approved test surface. A rename cannot inherit access.
const QA_ORIGIN = "https://gsglkmudcwkdetqtocae.supabase.co";
const PREVIEW_BRANCH = "codex/tf-assist-harvest-foundation-20260913";

/** @param {string | undefined} value */
function sourceOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** @param {Record<string, string | undefined>} env */
function previewEnabled(env) {
  if (env.TF_ASSIST_HARVEST_V1 === "0") return false;
  const origin = sourceOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  // Production is deliberately opt-in. Removing or setting this server-side
  // value to anything other than "1" is the immediate kill switch.
  if (env.VERCEL_ENV === "production")
    return env.TF_ASSIST_HARVEST_V1 === "1" && Boolean(origin);
  if (origin !== QA_ORIGIN) return false;
  if (env.VERCEL_ENV === "preview")
    return env.VERCEL_GIT_COMMIT_REF === PREVIEW_BRANCH;
  return env.TF_ASSIST_HARVEST_V1 === "1";
}
module.exports = { QA_ORIGIN, PREVIEW_BRANCH, previewEnabled, sourceOrigin };
