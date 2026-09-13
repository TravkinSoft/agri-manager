import { planQuestion, plannerTransport, type PlannerConfig } from "./planner";
import { previewEnabled } from "./preview-gate";

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
  const result = await plan("Какая урожайность картофеля в тоннах на гектар?", config);
  return {
    event: "tf_assist_model_smoke",
    status: result.state === "model" && result.intent === "yield" ? "passed" : "failed",
    sha,
    transport,
    state: result.state,
    intent: result.intent,
    code: result.code,
  } as const;
}
