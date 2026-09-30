import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AssistantMemoryPolicyError,
  USER_GLOBAL_MEMORY_TYPES,
  deleteMatchingAssistantMemories,
  extractExplicitApprovedMemories,
  extractMemoryDeleteIntent,
  isDurableMemoryContentSafe,
  memoryKeyFor,
  upsertApprovedAssistantMemory,
  type AssistantApprovedMemoryInput,
  type AssistantMemoryActor,
  type AssistantMemoryWriteResult,
  type UserGlobalMemoryType,
} from "@/lib/assistant/memory-store";
import { resolveAssistantModelConfig } from "@/lib/assistant/openai";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import { requestRuntimeModel } from "@/lib/assistant/v2/responses-adapter";

const INFERRED_CONFIDENCE_THRESHOLD = 0.85;

type InferenceDecision = {
  action: "save" | "noop";
  memoryType: UserGlobalMemoryType | null;
  normalizedFact: string | null;
  confidence: number;
};

export type AssistantMemoryPolicyV2Result = AssistantMemoryWriteResult & {
  action: "save" | "delete" | "noop";
  deletedCount: number;
  provenance: "user_explicit" | "assistant_inferred" | "company_explicit" | null;
  ids: string[];
  requestedModel: string | null;
  effectiveModel: string | null;
};

function clean(value: unknown, max = 500): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max).trim() : text;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeInferenceDecision(payload: Record<string, unknown> | null): InferenceDecision {
  if (!payload || payload.action !== "save") {
    return { action: "noop", memoryType: null, normalizedFact: null, confidence: 0 };
  }
  const memoryType = clean(payload.memory_type) as UserGlobalMemoryType | null;
  const normalizedFact = clean(payload.normalized_fact);
  const confidence = Number(payload.confidence);
  if (
    !memoryType ||
    !USER_GLOBAL_MEMORY_TYPES.includes(memoryType) ||
    !normalizedFact ||
    !Number.isFinite(confidence) ||
    confidence < INFERRED_CONFIDENCE_THRESHOLD ||
    confidence > 1 ||
    !isDurableMemoryContentSafe(normalizedFact)
  ) {
    return { action: "noop", memoryType: null, normalizedFact: null, confidence: 0 };
  }
  return { action: "save", memoryType, normalizedFact, confidence };
}

function inferenceInstructions(): string {
  return [
    "You are a strict memory policy classifier for Travkin Assistant Contract 0.4.",
    "Return exactly one JSON object and no markdown.",
    "Allowed save schema: {\"action\":\"save\",\"memory_type\":\"...\",\"normalized_fact\":\"...\",\"confidence\":0.000}.",
    "Noop schema: {\"action\":\"noop\",\"memory_type\":null,\"normalized_fact\":null,\"confidence\":0}.",
    `Allowlist only: ${USER_GLOBAL_MEMORY_TYPES.join(", ")}.`,
    "Save only stable, useful facts about the current user: name, preferred form of address, language, response style, brevity, or durable work preference.",
    "Never save live inventory, operation status, temporary selections, temporary state, emotions, reasoning, guesses, assistant claims, secrets, credentials, sensitive identifiers, or data about another user.",
    "Never infer company-wide memory. Never invent or generalize beyond the message.",
    "Use action save only when confidence is at least 0.850; otherwise noop.",
  ].join("\n");
}

function obviousNoop(message: string): string | null {
  if (!isDurableMemoryContentSafe(message)) return "content_not_durable";
  if (/\b(?:сколько|какой\s+остаток|покажи|найди|создай|измени|удали\s+(?:операц|поле|склад)|how\s+much|show|find)\b/i.test(message)) {
    return "operational_request";
  }
  return null;
}

export async function inferAssistantMemoryV2(params: {
  message: string;
  sourceMessageId: string;
  actor: AssistantMemoryActor;
  settings: AssistantPlatformSettings;
  fetchImpl?: typeof fetch;
}): Promise<{
  input: AssistantApprovedMemoryInput | null;
  warning: string | null;
  requestedModel: string;
  effectiveModel: string;
}> {
  const modelConfig = resolveAssistantModelConfig(params.settings, { message: params.message });
  const skipped = obviousNoop(params.message);
  if (skipped) {
    return { input: null, warning: null, requestedModel: modelConfig.configuredModel, effectiveModel: modelConfig.actualModel };
  }
  const apiKey = clean(process.env.OPENAI_API_KEY, 1000);
  if (!apiKey) {
    return {
      input: null,
      warning: "MEMORY_INFERENCE_OPENAI_KEY_MISSING",
      requestedModel: modelConfig.configuredModel,
      effectiveModel: modelConfig.actualModel,
    };
  }
  const response = await requestRuntimeModel({
    mode: "responses_v2",
    apiKey,
    model: modelConfig.actualModel,
    temperature: modelConfig.temperature,
    reasoningEffort: modelConfig.reasoningEffort,
    messages: [
      { role: "system", content: inferenceInstructions() },
      { role: "user", content: params.message },
    ],
    tools: [],
    toolChoice: "none",
    maxOutputTokens: 300,
    fetchImpl: params.fetchImpl || fetch,
    timeoutMs: 45_000,
  });
  if (!response.ok) {
    return {
      input: null,
      warning: `MEMORY_INFERENCE_MODEL_FAILED:${response.status ?? response.networkError ?? "unknown"}:${response.requestId || "no_request_id"}`,
      requestedModel: modelConfig.configuredModel,
      effectiveModel: modelConfig.actualModel,
    };
  }
  const output = clean(response.data?.choices?.[0]?.message?.content, 4000) || "";
  const decision = normalizeInferenceDecision(parseJsonObject(output));
  if (decision.action === "noop" || !decision.memoryType || !decision.normalizedFact) {
    return { input: null, warning: null, requestedModel: modelConfig.configuredModel, effectiveModel: modelConfig.actualModel };
  }
  return {
    input: {
      company_id: params.actor.companyId,
      user_id: params.actor.userId,
      scope: "user_global",
      source_message_id: params.sourceMessageId,
      memory_type: decision.memoryType,
      memory_key: memoryKeyFor(decision.memoryType, decision.normalizedFact),
      content: decision.normalizedFact,
      normalized_fact: decision.normalizedFact,
      confidence: decision.confidence,
      provenance: "assistant_inferred",
      expires_at: null,
    },
    warning: null,
    requestedModel: modelConfig.configuredModel,
    effectiveModel: modelConfig.actualModel,
  };
}

export async function processAssistantMemoryPolicyV2(params: {
  supabase: SupabaseClient;
  message: string;
  sourceMessageId: string;
  actor: AssistantMemoryActor;
  settings: AssistantPlatformSettings;
  fetchImpl?: typeof fetch;
}): Promise<AssistantMemoryPolicyV2Result> {
  const deleteIntent = extractMemoryDeleteIntent(params.message);
  if (deleteIntent) {
    const deleted = await deleteMatchingAssistantMemories({
      supabase: params.supabase,
      companyId: params.actor.companyId,
      userId: params.actor.userId,
      intent: deleteIntent,
    });
    return {
      savedCount: 0,
      deletedCount: deleted.length,
      skippedReason: deleted.length ? null : "memory_not_found",
      warning: null,
      action: "delete",
      provenance: null,
      ids: deleted.map((record) => record.id),
      requestedModel: null,
      effectiveModel: null,
    };
  }

  const explicit = extractExplicitApprovedMemories({
    message: params.message,
    sourceMessageId: params.sourceMessageId,
    actor: params.actor,
  });
  if (explicit.length) {
    const memories = [];
    for (const input of explicit) {
      memories.push(await upsertApprovedAssistantMemory({ supabase: params.supabase, input }));
    }
    return {
      savedCount: memories.length,
      deletedCount: 0,
      skippedReason: null,
      warning: null,
      action: "save",
      provenance: explicit[0].provenance,
      ids: memories.map((memory) => memory.id),
      requestedModel: null,
      effectiveModel: null,
    };
  }

  const inferred = await inferAssistantMemoryV2(params);
  if (!inferred.input) {
    return {
      savedCount: 0,
      deletedCount: 0,
      skippedReason: inferred.warning ? "inference_failed" : "no_durable_memory",
      warning: inferred.warning,
      action: "noop",
      provenance: null,
      ids: [],
      requestedModel: inferred.requestedModel,
      effectiveModel: inferred.effectiveModel,
    };
  }
  if (inferred.input.provenance !== "assistant_inferred" || inferred.input.confidence < INFERRED_CONFIDENCE_THRESHOLD) {
    throw new AssistantMemoryPolicyError("MEMORY_INFERENCE_POLICY_DENIED", "Inferred memory failed Contract 0.4 validation.");
  }
  const memory = await upsertApprovedAssistantMemory({ supabase: params.supabase, input: inferred.input });
  return {
    savedCount: 1,
    deletedCount: 0,
    skippedReason: null,
    warning: null,
    action: "save",
    provenance: "assistant_inferred",
    ids: [memory.id],
    requestedModel: inferred.requestedModel,
    effectiveModel: inferred.effectiveModel,
  };
}
