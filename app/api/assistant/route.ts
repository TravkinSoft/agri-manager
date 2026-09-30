import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import { runAssistantEngine } from "@/lib/assistant/engine/query";
import { writeAssistantAuditLog } from "@/lib/assistant/audit-log";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function mapSessionErrorCode(error: SessionAuthError): string {
  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("missing authorization")) return "AUTH_MISSING";
  if (msg.includes("invalid or expired")) return "AUTH_INVALID";
  if (msg.includes("profile not found")) return "PROFILE_NOT_FOUND";
  if (msg.includes("unknown user role")) return "ROLE_UNKNOWN";
  if (msg.includes("inactive user profile")) return "PROFILE_INACTIVE";
  if (msg.includes("not available for current role")) return "ROLE_FORBIDDEN";
  if (msg.includes("legacy role alias")) return "ROLE_LEGACY_ALIAS";
  if (msg.includes("company context is not selected")) return "COMPANY_CONTEXT_REQUIRED";
  if (msg.includes("company context is not configured")) return "COMPANY_CONTEXT_MISSING";
  if (msg.includes("invalid company id")) return "COMPANY_CONTEXT_INVALID";
  if (msg.includes("company mismatch")) return "COMPANY_CONTEXT_MISMATCH";
  return "SESSION_AUTH_ERROR";
}

export async function GET() {
  return NextResponse.json(
    {
      error: "Legacy assistant route is deprecated. Use /api/assistant/query.",
      code: "ASSISTANT_ROUTE_DEPRECATED",
    },
    { status: 410 }
  );
}

export async function POST(request: NextRequest) {
  let actorId = "";
  let companyId = "";
  let role = "";
  let chatId: string | null = null;
  let sessionId: string | null = null;
  let requestMessage: string | null = null;
  let shouldWriteAuditLog = true;

  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    role = actor.role;
    actorId = actor.id;

    const payload = await request.json().catch(() => ({}));
    requestMessage = asString(payload?.message);
    if (!requestMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    companyId = resolveCompanyForActor(actor, asString(payload?.companyId));
    chatId = asString(payload?.chatId);
    sessionId = asString(payload?.sessionId);

    const supabase = getServiceClient();
    const settings = await getAssistantPlatformSettings(supabase, actor.id);
    shouldWriteAuditLog = !!settings.logging?.enabled;
    const result = await runAssistantEngine({
      supabase,
      actor,
      companyId,
      settings,
      input: {
        message: requestMessage,
        locale: payload?.locale || "ru",
        chatId,
        chatHistory: Array.isArray(payload?.chatHistory) ? payload.chatHistory : [],
        runtimeContext: payload?.runtimeContext || null,
        sessionState: payload?.sessionState || null,
      },
    });

    if (shouldWriteAuditLog) {
      await writeAssistantAuditLog(supabase, {
        actor_user_id: actor.id,
        company_id: companyId,
        role: actor.role,
        chat_id: chatId,
        session_id: sessionId,
        intent: result.intent.name,
        tool_calls: result.toolCalls.map((toolCall) => ({
          tool: toolCall.tool,
          ok: toolCall.ok,
          rows: toolCall.rows || 0,
          error: toolCall.error || null,
        })),
        runtime_context: payload?.runtimeContext || {},
        request_excerpt: requestMessage,
        response_excerpt: result.answer,
        error_text: null,
      });
    }

    return NextResponse.json({
      response: result.answer,
      sessionState: result.sessionState,
      meta: {
        intent: result.intent,
        sourceHints: result.sourceHints,
      },
    });
  } catch (error) {
    const supabase = getServiceClient();
    if (actorId && companyId && shouldWriteAuditLog) {
      await writeAssistantAuditLog(supabase, {
        actor_user_id: actorId,
        company_id: companyId,
        role,
        chat_id: chatId,
        session_id: sessionId,
        intent: "error",
        tool_calls: [],
        runtime_context: {},
        request_excerpt: requestMessage,
        response_excerpt: null,
        error_text: error instanceof Error ? error.message : "Assistant query failed",
      });
    }

    if (error instanceof SessionAuthError) {
      return NextResponse.json(
        {
          error: error.message,
          code: mapSessionErrorCode(error),
        },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Assistant query failed",
        code: "ASSISTANT_QUERY_FAILED",
      },
      { status: 500 }
    );
  }
}
