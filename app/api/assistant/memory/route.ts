import { NextRequest, NextResponse } from "next/server";
import {
  AssistantMemoryPolicyError,
  deleteAssistantMemory,
  extractExplicitApprovedMemories,
  isAssistantMemoryV2RuntimeEnabled,
  listAssistantMemoryRecords,
  upsertApprovedAssistantMemory,
} from "@/lib/assistant/memory-store";
import { getAssistantThreadById } from "@/lib/assistant/threads-store";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { getAuthenticatedServerClient } from "@/lib/supabase/server-user";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  if (!isAssistantMemoryV2RuntimeEnabled()) {
    throw new AssistantMemoryPolicyError(
      "MEMORY_V2_RUNTIME_DISABLED",
      "Memory Policy V2 is enabled only for the approved isolated A106 branch without service-role credentials.",
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
  supabase: SupabaseClient;
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
      supabase: getAuthenticatedServerClient(request),
      companyId,
      userId: actor.id,
      limit: Math.max(1, Math.min(Number(searchParams.get("limit") || 100), 300)),
    });
    const memories = result.memories.map((memory) => ({
      ...memory,
      category: memory.memory_type === "name" || memory.memory_type === "preferred_address" || memory.memory_type === "confirmed_role"
        ? "user_identity"
        : memory.memory_type.startsWith("company_")
          ? "company_context"
          : memory.memory_type === "durable_work_preference" || memory.memory_type === "durable_work_rule"
          ? "workflow_preference"
          : "communication_preference",
      value: memory.content,
      active: memory.active && memory.status === "approved" && (!memory.expires_at || Date.parse(memory.expires_at) > Date.now()),
    }));
    return NextResponse.json({
      memories,
      warning: result.warning,
      diagnostics: {
        count: memories.length,
        categories: Array.from(new Set(memories.map((memory) => memory.memory_type))),
        ids: memories.map((memory) => memory.id),
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
    const supabase = getAuthenticatedServerClient(request);
    const source = await loadOwnedSourceMessage({ supabase, companyId, userId: actor.id, sourceMessageId });
    const approvedInputs = extractExplicitApprovedMemories({
      message: source.content,
      sourceMessageId: source.id,
      actor: { companyId, userId: actor.id },
    });
    if (!approvedInputs.length) {
      throw new AssistantMemoryPolicyError("EXPLICIT_MEMORY_COMMAND_REQUIRED", "An explicit memory command is required.");
    }
    const memories = [];
    for (const input of approvedInputs) {
      memories.push(await upsertApprovedAssistantMemory({ supabase, input }));
    }
    return NextResponse.json({
      memory: memories[0],
      memories,
      confirmationRequired: false,
      autoApproved: true,
      policyVersion: "0.4",
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    assertPrototypeEnabled();
    throw new AssistantMemoryPolicyError(
      "MEMORY_CANDIDATE_TRANSITIONS_DISABLED",
      "Contract 0.4 has no candidate approve/reject transition.",
      405
    );
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
    const supabase = getAuthenticatedServerClient(request);
    const deleted = await deleteAssistantMemory({
      supabase,
      companyId,
      userId: actor.id,
      memoryId,
    });
    return NextResponse.json({ deleted: true, id: deleted.id, confirmationRequired: false, auditRequired: true });
  } catch (error) {
    return errorResponse(error);
  }
}
