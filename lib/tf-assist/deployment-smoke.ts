import { planQuestion, plannerTransport, plannerModel, type PlannerConfig } from "./planner";
import { previewEnabled } from "./preview-gate";

// Map provider text to a fixed vocabulary; never log arbitrary response content.
export function smokeFailureKind(body: string) {
  if (/model_not_available_on_plan|free tier|model.{0,60}(?:not available|not allowed|not permitted)/i.test(body)) return "model_plan_restricted";
  if (/oidc|jwt|token.{0,40}(?:invalid|expired)|verif.{0,40}token/i.test(body)) return "oidc_rejected";
  if (/credit|budget|billing|payment/i.test(body)) return "billing_or_budget";
  if (/country|region.{0,40}(?:not|unsupported|restrict)/i.test(body)) return "region_restricted";
  if (/not enabled|enable.{0,30}gateway|activate/i.test(body)) return "activation_required";
  if (/access_denied|access denied|forbidden/i.test(body)) return "access_denied";
  return "unclassified";
}

/** Internal build-only smoke: one fixed synthetic question, no auth bypass or DB.
 * Never imports the application service, source reader, or business data. */
export async function deploymentModelSmoke(
  env: Record<string, string | undefined>,
  plan: typeof planQuestion = planQuestion,
) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" || !previewEnabled(env))
    return { event: "tf_assist_model_smoke", status: "skipped" } as const;
  const config: PlannerConfig = {
    apiKey: env.OPENAI_API_KEY,
    oidcToken: env.VERCEL_OIDC_TOKEN,
    model: env.OPENAI_ASSISTANT_MODEL,
  };
  // Only a validated commit and enum metadata may enter build logs.
  const sha = /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || "")
    ? env.VERCEL_GIT_COMMIT_SHA
    : "unknown";
  const transport = plannerTransport(config);
  let httpFailure: string | undefined;
  config.transport = async (url, init) => {
    const response = await fetch(url, init);
    if (!response.ok) {
      try { httpFailure = smokeFailureKind((await response.clone().text()).slice(0, 8000)); }
      catch { httpFailure = "unclassified"; }
    }
    return response;
  };
  const result = await plan("Какая урожайность картофеля в тоннах на гектар?", config);
  return {
    event: "tf_assist_model_smoke",
    status: result.state === "model" && result.intent === "yield" ? "passed" : "failed",
    sha,
    transport,
    defaultModel: plannerModel({ ...config, model: undefined }),
    modelOverridden: Boolean(config.model),
    state: result.state,
    intent: result.intent,
    code: result.code,
    httpFailure,
  } as const;
}
