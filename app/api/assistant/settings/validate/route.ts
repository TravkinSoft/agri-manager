import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export const runtime = "nodejs";

function requireGlobalAdmin(role: string | null | undefined) {
  if (role !== "global_admin") {
    throw new SessionAuthError("Assistant settings are available only for global_admin", 403);
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    requireGlobalAdmin(actor.role);

    const supabase = getServiceClient();
    const settings = await getAssistantPlatformSettings(supabase, actor.id);

    return NextResponse.json({
      runtime: {
        provider: "openai",
        model: settings.model,
        temperature: settings.temperature,
        reasoningEffort: settings.reasoningEffort,
        enabledTools: settings.allowedTools || [],
      },
      binding: {
        provider: "used",
        model: "used",
        temperature: "used",
        reasoningEffort: "reserved",
        allowedRoles: "used",
        allowedTools: "used",
        forbiddenActions: "reserved",
        companyDataAccess: "reserved",
        actionConfirmation: "reserved",
      },
      notes: [
        "reasoningEffort сохраняется в настройках и зарезервирован для следующей версии движка.",
        "forbiddenActions/companyDataAccess/actionConfirmation сохраняются как policy и будут подключены в action-router.",
      ],
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to validate assistant settings" },
      { status: 500 }
    );
  }
}
