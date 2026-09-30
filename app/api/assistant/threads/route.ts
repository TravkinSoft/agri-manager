import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { getAuthenticatedServerClient } from "@/lib/supabase/server-user";
import { createAssistantThread, listAssistantThreads } from "@/lib/assistant/threads-store";

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

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const companyId = resolveCompanyForActor(actor, asText(request.nextUrl.searchParams.get("companyId")));
    const limit = Number(request.nextUrl.searchParams.get("limit") || "50");

    const supabase = getAuthenticatedServerClient(request);
    const threads = await listAssistantThreads({
      supabase,
      companyId,
      userId: actor.id,
      limit,
    });

    return NextResponse.json({ threads });
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
        error: error instanceof Error ? error.message : "Failed to load assistant threads",
        code: "ASSISTANT_THREADS_LIST_FAILED",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const payload = await request.json().catch(() => ({}));
    const companyId = resolveCompanyForActor(actor, asText(payload?.companyId));

    const supabase = getAuthenticatedServerClient(request);
    const thread = await createAssistantThread({
      supabase,
      companyId,
      userId: actor.id,
      title: asText(payload?.title),
      currentPageContext:
        payload?.currentPageContext && typeof payload.currentPageContext === "object"
          ? (payload.currentPageContext as Record<string, unknown>)
          : null,
    });

    return NextResponse.json({ thread }, { status: 201 });
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
        error: error instanceof Error ? error.message : "Failed to create assistant thread",
        code: "ASSISTANT_THREAD_CREATE_FAILED",
      },
      { status: 500 }
    );
  }
}
