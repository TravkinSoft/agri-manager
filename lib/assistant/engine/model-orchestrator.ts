import { getAssistantTool } from "@/lib/assistant/engine/tools";
import type {
  AssistantIntent,
  AssistantNavigationAction,
  AssistantSessionState,
  AssistantToolCallLog,
  AssistantToolOutput,
  AssistantUiContext,
} from "@/lib/assistant/engine/types";
import {
  buildAssistantModelCandidateList,
  resolveAssistantModelConfig,
} from "@/lib/assistant/openai";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerActorContext } from "@/lib/auth/server-session";
import {
  buildPlannerIntent,
  getPlannerToolSchemas,
  resolvePlannerToolCall,
} from "@/lib/assistant/engine/tool-schema";
import { updateSessionStateFromToolOutput } from "@/lib/assistant/engine/session-state";

type UsageStats = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type LlmDiagnostics = {
  status: "not_called" | "ok" | "missing_api_key" | "network_error" | "http_error" | "invalid_response";
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  missingEnv: string[];
};

type PromptMeta = {
  promptVersion: string;
  promptSource: "code_default" | "db_override" | "env_override";
  promptUpdatedAt: string;
};

export type ModelOrchestratorResult = {
  ok: boolean;
  answer: string;
  toolCalls: AssistantToolCallLog[];
  outputs: AssistantToolOutput[];
  sourceHints: string[];
  toolActivity: string[];
  sessionState: AssistantSessionState;
  actualModel: string | null;
  usage: UsageStats;
  llm: LlmDiagnostics;
  navigationActions: AssistantNavigationAction[];
};

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function usageFrom(data: any): UsageStats {
  return {
    promptTokens: Number.isFinite(Number(data?.usage?.prompt_tokens)) ? Number(data.usage.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(data?.usage?.completion_tokens))
      ? Number(data.usage.completion_tokens)
      : null,
    totalTokens: Number.isFinite(Number(data?.usage?.total_tokens)) ? Number(data.usage.total_tokens) : null,
  };
}

function mergeUsage(base: UsageStats, next: UsageStats): UsageStats {
  const add = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return Number(a || 0) + Number(b || 0);
  };
  return {
    promptTokens: add(base.promptTokens, next.promptTokens),
    completionTokens: add(base.completionTokens, next.completionTokens),
    totalTokens: add(base.totalTokens, next.totalTokens),
  };
}

function safeJsonParse(value: unknown): Record<string, unknown> {
  const text = clean(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

function buildToolActivity(toolCalls: AssistantToolCallLog[]): string[] {
  return toolCalls.map((item) =>
    item.ok ? `${item.tool}: ${item.rows || 0} rows` : `${item.tool}: error (${item.error || "unknown"})`
  );
}

function toToolContent(output: AssistantToolOutput): string {
  const rows = output.rows.slice(0, 30);
  return JSON.stringify(
    {
      title: output.title,
      rows,
      source: output.source,
      summary: output.summary || null,
    },
    null,
    2
  );
}

function llmMissingKey(): LlmDiagnostics {
  return {
    status: "missing_api_key",
    httpStatus: null,
    errorCode: "OPENAI_API_KEY_MISSING",
    errorMessage: "OPENAI_API_KEY is not configured",
    missingEnv: ["OPENAI_API_KEY"],
  };
}

function toIntentContext(intent: AssistantIntent): string {
  return JSON.stringify(
    {
      intent: intent.name,
      confidence: intent.confidence,
      parameters: intent.parameters,
    },
    null,
    2
  );
}

function toRuntimeContext(runtimeContext: AssistantUiContext): string {
  return JSON.stringify(
    {
      company: runtimeContext.companyName || runtimeContext.companyId,
      role: runtimeContext.userRole,
      current_page: runtimeContext.currentPage,
      current_route: runtimeContext.currentRoute,
      selected_season: runtimeContext.season,
      selected_field_id: runtimeContext.selectedFieldId,
      selected_warehouse_id: runtimeContext.selectedWarehouseId,
      selected_crop: runtimeContext.selectedCrop,
      filters: runtimeContext.filters,
    },
    null,
    2
  );
}

function toSessionSummary(sessionState: AssistantSessionState): string {
  return JSON.stringify(
    {
      last_intent: sessionState.lastIntent || null,
      last_crop: sessionState.lastCrop || null,
      last_variety: sessionState.lastVariety || null,
      last_field: sessionState.lastField || null,
      last_field_id: sessionState.lastFieldId || null,
      last_field_label: sessionState.lastFieldLabel || null,
      last_warehouse: sessionState.lastWarehouse || null,
      last_warehouse_id: sessionState.lastWarehouseId || null,
      last_warehouse_label: sessionState.lastWarehouseLabel || null,
      last_entity: sessionState.lastEntity || null,
      last_module: sessionState.lastModule || null,
      last_tool_source: sessionState.lastToolSource || null,
      last_answer_type: sessionState.lastAnswerType || null,
      last_result_context: sessionState.lastResultContext || null,
      last_warehouse_count: sessionState.lastWarehouseCount ?? null,
      last_inventory_kg: sessionState.lastInventoryTotalKg ?? null,
      last_crop_structure_area_ha: sessionState.lastCropStructureAreaHa ?? null,
      last_fields_area_ha: sessionState.lastFieldsAreaHa ?? null,
      last_inconsistency: sessionState.lastDetectedInconsistency || null,
      last_inconsistency_at: sessionState.lastInconsistencyAt || null,
    },
    null,
    2
  );
}

function normalizeNavigationActions(actions: AssistantNavigationAction[]): AssistantNavigationAction[] {
  return actions.filter(Boolean);
}

export async function runModelOrchestrator(params: {
  message: string;
  locale: "ru" | "en" | "kz";
  settings: AssistantPlatformSettings;
  runtimeContext: AssistantUiContext;
  sessionState: AssistantSessionState;
  intent: AssistantIntent;
  systemPrompt: string;
  promptMeta: PromptMeta;
  supabase: SupabaseClient;
  actor: ServerActorContext;
  companyId: string;
}): Promise<ModelOrchestratorResult> {
  const modelConfig = resolveAssistantModelConfig(params.settings, {
    intentName: params.intent.name,
    message: params.message,
  });
  const toolCalls: AssistantToolCallLog[] = [];
  const outputs: AssistantToolOutput[] = [];
  const sourceHints: string[] = [];
  let nextSessionState = params.sessionState;

  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      answer: "AI Assistant временно недоступен. Попробуйте позже.",
      toolCalls,
      outputs,
      sourceHints,
      toolActivity: [],
      sessionState: nextSessionState,
      actualModel: null,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      llm: llmMissingKey(),
      navigationActions: [],
    };
  }

  const candidateModels = buildAssistantModelCandidateList(modelConfig.actualModel);
  const plannerTools = getPlannerToolSchemas();

  let usedModel = modelConfig.actualModel;
  let llm: LlmDiagnostics = {
    status: "not_called",
    httpStatus: null,
    errorCode: null,
    errorMessage: null,
    missingEnv: [],
  };
  let totalUsage: UsageStats = {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  };

  for (const candidateModel of candidateModels) {
    usedModel = candidateModel;
    let messages: any[] = [
      { role: "system", content: params.systemPrompt },
      {
        role: "system",
        content: [
          "Вы — planner Travkin Copilot.",
          "Сначала поймите намерение пользователя, затем выберите tools при необходимости.",
          "ERP-данные и цифры берите только из tools.",
          "Если tool вернул пусто — честно скажите, что данных не найдено.",
          "Отвечайте коротко, по делу, на русском.",
          "Не добавляйте навигационные действия без явной команды пользователя.",
        ].join("\n"),
      },
      { role: "system", content: `Intent context:\n${toIntentContext(params.intent)}` },
      { role: "system", content: `Runtime context:\n${toRuntimeContext(params.runtimeContext)}` },
      { role: "system", content: `Session summary:\n${toSessionSummary(params.sessionState)}` },
      { role: "user", content: params.message },
    ];

    let finalAnswer = "";
    const navigationActions: AssistantNavigationAction[] = [];
    let hardFailure = false;

    for (let turn = 0; turn < 3; turn += 1) {
      const completionRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: candidateModel,
          temperature: modelConfig.temperature,
          messages,
          tools: plannerTools,
          tool_choice: "auto",
        }),
      }).catch(() => null);

      if (!completionRes) {
        llm = {
          status: "network_error",
          httpStatus: null,
          errorCode: "OPENAI_NETWORK_ERROR",
          errorMessage: "Network request to OpenAI failed",
          missingEnv: [],
        };
        hardFailure = true;
        break;
      }

      const completionData = await completionRes.json().catch(() => ({}));
      totalUsage = mergeUsage(totalUsage, usageFrom(completionData));

      if (!completionRes.ok) {
        const errCode = clean(completionData?.error?.code);
        const errType = clean(completionData?.error?.type);
        const errMessage = clean(completionData?.error?.message) || clean(completionData?.error?.type) || "";
        const lower = errMessage.toLowerCase();
        const modelUnavailable =
          errCode === "model_not_found" ||
          errType === "invalid_request_error" ||
          lower.includes("does not exist") ||
          lower.includes("not available") ||
          lower.includes("access");
        llm = {
          status: "http_error",
          httpStatus: completionRes.status,
          errorCode: errCode,
          errorMessage: errMessage,
          missingEnv: [],
        };
        if (modelUnavailable) {
          hardFailure = true;
          break;
        }
        hardFailure = true;
        break;
      }

      const choice = completionData?.choices?.[0]?.message || {};
      const toolCallsRaw = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
      const answerChunk = clean(choice?.content);

      if (!toolCallsRaw.length) {
        finalAnswer = answerChunk || "";
        llm = {
          status: "ok",
          httpStatus: completionRes.status,
          errorCode: null,
          errorMessage: null,
          missingEnv: [],
        };
        break;
      }

      messages.push({
        role: "assistant",
        content: answerChunk || "",
        tool_calls: toolCallsRaw,
      });

      for (const call of toolCallsRaw) {
        const fnName = clean(call?.function?.name) || "";
        const args = safeJsonParse(call?.function?.arguments);
        const mapping = resolvePlannerToolCall(fnName);
        if (!mapping) {
          toolCalls.push({
            tool: "get_current_context",
            params: args,
            ok: false,
            error: `Tool not implemented: ${fnName}`,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: `tool_not_implemented:${fnName}` }),
          });
          continue;
        }

        const tool = getAssistantTool(mapping.assistantTool);
        if (!tool) {
          toolCalls.push({
            tool: mapping.assistantTool,
            params: args,
            ok: false,
            error: "Tool definition missing",
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "tool_definition_missing" }),
          });
          continue;
        }

        const plannerIntent = buildPlannerIntent({
          mapping,
          args,
          message: params.message,
          runtimeContext: params.runtimeContext,
        });

        try {
          const output = await tool.run({
            supabase: params.supabase,
            actor: params.actor,
            companyId: params.companyId,
            settings: params.settings,
            runtimeContext: params.runtimeContext,
            sessionState: nextSessionState,
            intent: plannerIntent,
          });
          outputs.push(output);
          sourceHints.push(
            `${output.source.module} • ${output.source.tableOrView} • ${output.source.season || "-"} • ${output.source.fetchedAt}`
          );
          nextSessionState = updateSessionStateFromToolOutput({
            previous: nextSessionState,
            intent: plannerIntent,
            output,
            seasonFromContext: params.runtimeContext.season,
          });
          toolCalls.push({
            tool: mapping.assistantTool,
            params: args,
            ok: true,
            rows: output.rows.length,
          });
          if (mapping.buildNavigation) {
            const actions = mapping.buildNavigation(args, output.rows);
            navigationActions.push(...actions);
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: toToolContent(output),
          });
        } catch (error) {
          toolCalls.push({
            tool: mapping.assistantTool,
            params: args,
            ok: false,
            error: error instanceof Error ? error.message : "Tool execution failed",
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: error instanceof Error ? error.message : "tool_error" }),
          });
        }
      }
    }

    if (!hardFailure && llm.status === "ok") {
      return {
        ok: true,
        answer: finalAnswer || "Не смог сформировать ответ по данным инструментов.",
        toolCalls,
        outputs,
        sourceHints,
        toolActivity: buildToolActivity(toolCalls),
        sessionState: nextSessionState,
        actualModel: usedModel,
        usage: totalUsage,
        llm,
        navigationActions: normalizeNavigationActions(navigationActions),
      };
    }
  }

  return {
    ok: false,
    answer: "Не смог получить ответ от planner-модели. Переключаюсь на резервный путь.",
    toolCalls,
    outputs,
    sourceHints,
    toolActivity: buildToolActivity(toolCalls),
    sessionState: nextSessionState,
    actualModel: usedModel,
    usage: totalUsage,
    llm,
    navigationActions: [],
  };
}
