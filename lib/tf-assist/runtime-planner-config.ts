import { getVercelOidcTokenSync } from "@vercel/oidc";
import type { PlannerConfig } from "./planner";

// Resolve on each request: Vercel Functions use request context, builds use env.
// The synchronous SDK accessor never refreshes through local CLI credentials.
export function runtimePlannerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  currentToken: () => string = getVercelOidcTokenSync,
): PlannerConfig {
  const config: PlannerConfig = {
    apiKey: env.OPENAI_API_KEY,
    // Production is pinned to the approved Terra default. A stale dashboard
    // override must not silently select an unavailable model for this release.
    model: env.VERCEL_ENV === "production" ? undefined : env.OPENAI_ASSISTANT_MODEL,
  };
  if (config.apiKey) return config;
  if (env.VERCEL === "1") {
    try {
      config.oidcToken = currentToken();
    } catch {
      // Missing context is expected outside a Vercel Function; never log tokens.
    }
  }
  config.oidcToken ||= env.VERCEL_OIDC_TOKEN;
  return config;
}
