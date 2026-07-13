import { NextRequest, NextResponse } from "next/server";
import { writeAssistantAuditLog } from "@/lib/assistant/audit-log";
import {
  AssistantMemoryPolicyError,
  createAssistantMemoryCandidate,
  deleteAssistantMemory,
  extractExplicitMemoryCandidate,
  isAssistantMemoryV1RuntimeEnabled,
  listAssistantMemoryRecords,
  setAssistantMemoryStatus,
} from "@/lib/assistant/memory-store";
import { getAssistantThreadById } from "@/lib/assistant/threads-store";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function asString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
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

function errorResponse(error: unknown): NextResponse {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message, code: mapSessionErrorCode(error) }, { status: error.status });
  }
  if (error instanceof AssistantMemoryPolicyError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Assistant memory request failed", code: "ASSISTANT_MEMORY_FAILED" },
    { status: 500 }
  );
}

function assertPrototypeEnabled(): void {
  if (!isAssistantMemoryV1RuntimeEnabled()) {
    throw new AssistantMemoryPolicyError(
      "MEMORY_SCHEMA_APPROVAL_REQUIRED",
      "Confirmed memory V1 is disabled until the Core schema contract is approved.",
      409
    );
  }
}

function assertNoUserSpoof(payload: Record<string, unknown>, actorId: string): void {
  const requested = asString(payload.userId);
  if (requested && requested !== actorId) {
    throw new AssistantMemoryPolicyError("MEMORY_USER_SPOOF_DENIED", "userId is derived from the authenticated session.", 403);
  }
}

async function loadOwnedSourceMessage(params: {
  supabase: ReturnType<typeof getServiceClient>;
  companyId: string;
  userId: string;
  sourceMessageId: string;
}): Promise<{ id: string; content: string }> {
  const result = await params.supabase
    .from("chat_messages")
    .select("id,chat_id,role,content,metadata")
    .eq("id", params.sourceMessageId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new AssistantMemoryPolicyError("SOURCE_MESSAGE_NOT_FOUND", "Source message not found.", 404);
  const thread = await getAssistantThreadById({
    supabase: params.supabase,
    companyId: params.companyId,
    userId: params.userId,
    threadId: String(result.data.chat_id),
  });
  const role = asString((result.data.metadata as Record<string, unknown> | null)?.message_role) || asString(result.data.role);
  if (!thread || role !== "user") {
    throw new AssistantMemoryPolicyError("SOURCE_MESSAGE_SCOPE_DENIED", "Source message is outside the current user/company scope.", 403);
  }
  return { id: String(result.data.id), content: String(result.data.content || "") };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const { searchParams } = new URL(request.url);
    const companyId = resolveCompanyForActor(actor, asString(searchParams.get("companyId")));
    assertPrototypeEnabled();
    const result = await listAssistantMemoryRecords({
      supabase: getServiceClient(),
      companyId,
      userId: actor.id,
      limit: Math.max(1, Math.min(Number(searchParams.get("limit") || 100), 300)),
    });
    return NextResponse.json({
      memories: result.memories,
      warning: result.warning,
      diagnostics: {
        count: result.memories.length,
        categories: Array.from(new Set(result.memories.map((memory) => memory.memory_type))),
        ids: result.memories.map((memory) => memory.id),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const payload = await request.json().catch(() => ({} as Record<string, unknown>));
    const companyId = resolveCompanyForActor(actor, asString(payload.companyId));
    assertNoUserSpoof(payload, actor.id);
    assertPrototypeEnabled();
    const sourceMessageId = asString(payload.sourceMessageId);
    if (!sourceMessageId) {
      throw new AssistantMemoryPolicyError("SOURCE_MESSAGE_REQUIRED", "sourceMessageId is required.");
    }
    const supabase = getServiceClient();
    const source = await loadOwnedSourceMessage({ supabase, companyId, userId: actor.id, sourceMessageId });
    const candidate = extractExplicitMemoryCandidate({
      message: source.content,
      sourceMessageId: source.id,
      actor: { companyId, userId: actor.id },
    });
    if (!candidate) {
      throw new AssistantMemoryPolicyError("EXPLICIT_MEMORY_COMMAND_REQUIRED", "An explicit memory command is required.");
    }
    const memory = await createAssistantMemoryCandidate({ supabase, candidate });
    return NextResponse.json({ memory, confirmationRequired: true, autoApproved: false }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const payload = await request.json().catch(() => ({} as Record<string, unknown>));
    const companyId = resolveCompanyForActor(actor, asString(payload.companyId));
    assertNoUserSpoof(payload, actor.id);
    assertPrototypeEnabled();
    const memoryId = asString(payload.memoryId);
    const action = payload.action === "approve" || payload.action === "reject" ? payload.action : null;
    if (!memoryId || !action) {
      throw new AssistantMemoryPolicyError("MEMORY_ACTION_INVALID", "memoryId and approve/reject action are required.");
    }
    if (payload.confirmed !== true) {
      throw new AssistantMemoryPolicyError("MEMORY_CONFIRMATION_REQUIRED", "Explicit confirmation is required.", 409);
    }
    const memory = await setAssistantMemoryStatus({
      supabase: getServiceClient(), companyId, userId: actor.id, memoryId, action,
    });
    return NextResponse.json({ memory, autoApproved: false });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const payload = await request.json().catch(() => ({} as Record<string, unknown>));
    const companyId = resolveCompanyForActor(actor, asString(payload.companyId));
    assertNoUserSpoof(payload, actor.id);
    assertPrototypeEnabled();
    const memoryId = asString(payload.memoryId);
    if (!memoryId) throw new AssistantMemoryPolicyError("MEMORY_ID_REQUIRED", "memoryId is required.");
    if (payload.confirmed !== true) {
      throw new AssistantMemoryPolicyError("MEMORY_DELETE_CONFIRMATION_REQUIRED", "Explicit delete confirmation is required.", 409);
    }
    const supabase = getServiceClient();
    const deleted = await deleteAssistantMemory({
      supabase,
      companyId,
      userId: actor.id,
      memoryId,
      beforeDelete: async (record) => writeAssistantAuditLog(supabase, {
        actor_user_id: actor.id,
        company_id: companyId,
        role: actor.role,
        intent: "assistant_memory_delete",
        tool_calls: [],
        runtime_context: { memory_id: record.id, memory_type: record.memory_type, scope: "user", phase: "authorized_before_delete" },
        request_excerpt: "Explicit confirmed deletion of own assistant memory",
        response_excerpt: "Deletion authorized after ownership check",
      }, { required: true }),
    });
    return NextResponse.json({ deleted: true, id: deleted.id });
  } catch (error) {
    return errorResponse(error);
  }
}
