import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  deactivateAssistantMemory,
  listAssistantMemoryRecords,
} from "@/lib/assistant/memory-store";
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
  if (msg.includes("company context")) return "COMPANY_CONTEXT_REQUIRED";
  if (msg.includes("company mismatch")) return "COMPANY_CONTEXT_MISMATCH";
  return "SESSION_AUTH_ERROR";
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const { searchParams } = new URL(request.url);
    const companyId = resolveCompanyForActor(actor, asString(searchParams.get("companyId")));
    const limit = Math.max(1, Math.min(Number(searchParams.get("limit") || 100), 300));

    const supabase = getServiceClient();
    const result = await listAssistantMemoryRecords({
      supabase,
      companyId,
      userId: actor.id,
      limit,
    });

    return NextResponse.json({
      memories: result.memories,
      warning: result.warning,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message, code: mapSessionErrorCode(error) }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load assistant memory", code: "ASSISTANT_MEMORY_FAILED" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const payload = await request.json().catch(() => ({}));
    const companyId = resolveCompanyForActor(actor, asString(payload?.companyId));
    const memoryId = asString(payload?.memoryId);
    const deactivateAll = payload?.all === true;

    const supabase = getServiceClient();
    const result = await deactivateAssistantMemory({
      supabase,
      companyId,
      userId: actor.id,
      memoryId,
      deactivateAll,
    });

    return NextResponse.json({
      deactivated: result.count,
      warning: result.warning,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message, code: mapSessionErrorCode(error) }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update assistant memory", code: "ASSISTANT_MEMORY_FAILED" },
      { status: 500 }
    );
  }
}
