import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import {
  appendAssistantThreadMessage,
  listAssistantThreadMessages,
  type AssistantThreadMessageRole,
} from "@/lib/assistant/threads-store";

export const runtime = "nodejs";

function asText(value: unknown): string | null {
  const text = String(value ?? "").trim();
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

function normalizeRole(value: unknown): AssistantThreadMessageRole {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "user") return "user";
  if (raw === "tool") return "tool";
  if (raw === "system") return "system";
  return "assistant";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> }
) {
  try {
    const { threadId } = await context.params;
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const companyId = resolveCompanyForActor(actor, asText(request.nextUrl.searchParams.get("companyId")));
    const limit = Number(request.nextUrl.searchParams.get("limit") || "300");

    const supabase = getServiceClient();
    const messages = await listAssistantThreadMessages({
      supabase,
      companyId,
      userId: actor.id,
      threadId,
      limit,
    });

    return NextResponse.json({ messages });
  } catch (error) {
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
        error: error instanceof Error ? error.message : "Failed to load assistant thread messages",
        code: "ASSISTANT_THREAD_MESSAGES_LIST_FAILED",
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> }
) {
  try {
    const { threadId } = await context.params;
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const payload = await request.json().catch(() => ({}));
    const companyId = resolveCompanyForActor(actor, asText(payload?.companyId));

    const content = asText(payload?.content);
    if (!content) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const message = await appendAssistantThreadMessage({
      supabase,
      companyId,
      userId: actor.id,
      threadId,
      role: normalizeRole(payload?.role),
      content,
      metadata:
        payload?.metadata && typeof payload.metadata === "object"
          ? (payload.metadata as Record<string, unknown>)
          : null,
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
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
        error: error instanceof Error ? error.message : "Failed to append assistant message",
        code: "ASSISTANT_THREAD_MESSAGE_APPEND_FAILED",
      },
      { status: 500 }
    );
  }
}
