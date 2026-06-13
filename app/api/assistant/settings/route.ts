import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings, saveAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import { DEFAULT_ASSISTANT_PLATFORM_SETTINGS } from "@/lib/assistant/settings-types";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { normalizeRoleKey, parseCanonicalRole } from "@/lib/auth/role-contract";
import { resolveTravkinCorePrompt } from "@/lib/assistant/prompts/travkin-core-prompt";

function sanitizeRoleList(input: unknown): AssistantPlatformSettings["allowedRoles"] {
  if (!Array.isArray(input)) return DEFAULT_ASSISTANT_PLATFORM_SETTINGS.allowedRoles;
  const allowed = new Set([
    "global_admin",
    "company_admin",
    "agronomist",
    "director",
    "warehouse_operator",
    "weighman",
    "specialist",
    "brigadier",
    "legal_operator",
    "fuel_operator",
  ]);
  return Array.from(
    new Set(
      input
        .map((x) => {
          const key = normalizeRoleKey(x);
          if (!allowed.has(key)) return null;
          return parseCanonicalRole(key);
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .filter((x) => allowed.has(x))
    )
  ) as AssistantPlatformSettings["allowedRoles"];
}

function sanitizeSettingsPayload(raw: unknown): AssistantPlatformSettings {
  const base = { ...DEFAULT_ASSISTANT_PLATFORM_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  const row = raw as Record<string, unknown>;

  return {
    ...base,
    ...row,
    systemPrompt: typeof row.systemPrompt === "string" ? row.systemPrompt : base.systemPrompt,
    provider: "openai",
    model: typeof row.model === "string" && row.model.trim() ? row.model.trim() : base.model,
    temperature: Number.isFinite(Number(row.temperature)) ? Number(row.temperature) : base.temperature,
    reasoningEffort:
      row.reasoningEffort === "low" || row.reasoningEffort === "high" || row.reasoningEffort === "medium"
        ? row.reasoningEffort
        : base.reasoningEffort,
    enabled: typeof row.enabled === "boolean" ? row.enabled : base.enabled,
    allowedRoles: sanitizeRoleList(row.allowedRoles),
    allowedTools: Array.isArray(row.allowedTools) ? row.allowedTools.map((x) => String(x || "").trim()).filter(Boolean) : base.allowedTools,
    forbiddenActions: Array.isArray(row.forbiddenActions)
      ? row.forbiddenActions.map((x) => String(x || "").trim()).filter(Boolean)
      : base.forbiddenActions,
    responseRules: {
      ...base.responseRules,
      ...(typeof row.responseRules === "object" && row.responseRules ? (row.responseRules as Record<string, unknown>) : {}),
    },
    groundingRules: {
      ...base.groundingRules,
      ...(typeof row.groundingRules === "object" && row.groundingRules ? (row.groundingRules as Record<string, unknown>) : {}),
    },
    companyDataAccess: {
      ...base.companyDataAccess,
      ...(typeof row.companyDataAccess === "object" && row.companyDataAccess
        ? (row.companyDataAccess as Record<string, unknown>)
        : {}),
    },
    actionConfirmation: {
      ...base.actionConfirmation,
      ...(typeof row.actionConfirmation === "object" && row.actionConfirmation
        ? (row.actionConfirmation as Record<string, unknown>)
        : {}),
    },
    knowledgePolicy: {
      ...base.knowledgePolicy,
      ...(typeof row.knowledgePolicy === "object" && row.knowledgePolicy
        ? (row.knowledgePolicy as Record<string, unknown>)
        : {}),
    },
    memoryPolicy: {
      ...base.memoryPolicy,
      ...(typeof row.memoryPolicy === "object" && row.memoryPolicy ? (row.memoryPolicy as Record<string, unknown>) : {}),
    },
    companyPolicy: {
      ...base.companyPolicy,
      ...(typeof row.companyPolicy === "object" && row.companyPolicy ? (row.companyPolicy as Record<string, unknown>) : {}),
    },
    limits: {
      ...base.limits,
      ...(typeof row.limits === "object" && row.limits ? (row.limits as Record<string, unknown>) : {}),
    },
    logging: {
      ...base.logging,
      ...(typeof row.logging === "object" && row.logging ? (row.logging as Record<string, unknown>) : {}),
    },
    features: {
      ...base.features,
      ...(typeof row.features === "object" && row.features ? (row.features as Record<string, unknown>) : {}),
    },
  };
}

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
    const promptBundle = resolveTravkinCorePrompt({
      settings,
      runtimeContext: {
        currentPage: "assistant-settings",
        currentRoute: "/platform/assistant/settings",
        season: "2026",
      },
      actorRole: actor.role,
      locale: "ru",
    });
    return NextResponse.json({
      settings,
      prompt: {
        version: promptBundle.version,
        source: promptBundle.source,
        updated_at: promptBundle.updatedAt,
        active_prompt: promptBundle.text,
      },
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load assistant settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    requireGlobalAdmin(actor.role);
    const payload = await request.json().catch(() => ({}));
    const settings = sanitizeSettingsPayload(payload?.settings ?? payload);
    const supabase = getServiceClient();
    const saved = await saveAssistantPlatformSettings(supabase, actor.id, settings);
    const promptBundle = resolveTravkinCorePrompt({
      settings: saved,
      runtimeContext: {
        currentPage: "assistant-settings",
        currentRoute: "/platform/assistant/settings",
        season: "2026",
      },
      actorRole: actor.role,
      locale: "ru",
    });
    return NextResponse.json({
      settings: saved,
      prompt: {
        version: promptBundle.version,
        source: promptBundle.source,
        updated_at: promptBundle.updatedAt,
        active_prompt: promptBundle.text,
      },
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to save assistant settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
