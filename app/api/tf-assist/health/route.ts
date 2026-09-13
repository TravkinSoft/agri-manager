import { NextResponse } from "next/server";
import { QA_ORIGIN } from "@/lib/tf-assist/policy";
import { previewEnabled } from "@/lib/tf-assist/preview-gate";
import { plannerTransport } from "@/lib/tf-assist/planner";
import { runtimePlannerConfig } from "@/lib/tf-assist/runtime-planner-config";
export const dynamic = "force-dynamic";
export function GET() {
  // Safe preflight metadata. No keys, URLs, users or business data are exposed.
  const qaBound =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") === QA_ORIGIN;
  const enabled = previewEnabled(process.env);
  const aiTransport = plannerTransport(runtimePlannerConfig());
  return NextResponse.json(
    {
      feature: "tf-assist-harvest-v1",
      enabled,
      qaBound,
      uiEnabled: process.env.NEXT_PUBLIC_TF_ASSIST_HARVEST_V1 === "1",
      aiConfigured: aiTransport !== "none",
      aiTransport,
      // Credential presence is not proof of live provider availability.
      aiAvailability: "not_checked",
      sourceCredentialConfigured: Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
      productionLocked: process.env.VERCEL_ENV === "production",
    },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
