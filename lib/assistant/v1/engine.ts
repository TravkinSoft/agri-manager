import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { ServerActorContext } from "@/lib/auth/server-session";
import {
  assistantModelSupportsCustomTemperature,
  buildOpenAiChatCompletionBody,
  resolveAssistantModelConfig,
} from "@/lib/assistant/openai";
import { getAssistantTool } from "@/lib/assistant/engine/tools";
import { normalizeAssistantUiContext } from "@/lib/assistant/engine/runtime";
import { EMPTY_ASSISTANT_SESSION_STATE } from "@/lib/assistant/engine/session-state";
import type {
  AssistantEngineResult,
  AssistantIntent,
  AssistantIntentName,
  AssistantOutputType,
  AssistantSessionState,
  AssistantToolContext,
  AssistantToolOutput,
  AssistantUiContext,
} from "@/lib/assistant/engine/types";
import {
  A101_PROMPT_VERSION,
  buildBoundedConversation,
  normalizeReadOnlyThreadState,
} from "@/lib/assistant/v1/conversation";
import { parseTypedFieldSearchParameters } from "@/lib/assistant/v1/field-parameters";
import {
  ReadOnlyPolicyError,
  assertReadOnlyRequestPolicy,
  assertReadOnlyResultCompany,
  assertReadOnlyToolPolicy,
  boundReadOnlyToolOutput,
  isReadOnlyModelToolName,
} from "@/lib/assistant/v1/policy";
import { getReadOnlyModelToolSchemas } from "@/lib/assistant/v1/tool-schemas";
import {
  READ_ONLY_MODEL_TOOL_NAMES,
  type ReadOnlyAssistantV1Result,
  type ReadOnlyHistoryMessage,
  type ReadOnlyModelToolName,
  type ReadOnlyRuntimeDiagnostics,
  type ReadOnlyThreadState,
} from "@/lib/assistant/v1/types";

type Usage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type LlmStatus = AssistantEngineResult["model"]["llm"];

export type ReadOnlyToolExecutor = (params: {
  name: ReadOnlyModelToolName;
  args: Record<string, unknown>;
  context: AssistantToolContext;
}) => Promise<AssistantToolOutput>;

export type ReadOnlyEngineDependencies = {
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  executeTool?: ReadOnlyToolExecutor;
};

export type ReadOnlyAssistantV1Input = {
  message: string;
  threadId: string;
  historyThreadId: string | null;
  history?: ReadOnlyHistoryMessage[] | null;
  runtimeContext?: Partial<AssistantUiContext> | null;
  threadState?: Record<string, unknown> | ReadOnlyThreadState | null;
  locale?: "ru" | "kz" | "en" | null;
};

const PROMPT_UPDATED_AT = "2026-07-13T00:00:00.000Z";
const MAX_TOOL_CALLS = 4;
const MAX_MODEL_TURNS = 3;

const INTENT_BY_TOOL: Record<ReadOnlyModelToolName, AssistantIntentName> = {
  get_current_context: "company_context",
  search_fields: "fields_overview",
  get_field_card: "fields_overview",
  get_field_land_bank_summary: "field_total_area",
  get_field_materials: "fields_overview",
  get_warehouse_stock: "inventory_balance",
  get_crop_structure_summary: "crop_structure_area",
  get_active_operations_summary: "operations_recent",
};

const OUTPUT_BY_TOOL: Record<ReadOnlyModelToolName, AssistantOutputType> = {
  get_current_context: "filtered_summary",
  search_fields: "list",
  get_field_card: "filtered_summary",
  get_field_land_bank_summary: "summary_total",
  get_field_materials: "list",
  get_warehouse_stock: "balance",
  get_crop_structure_summary: "summary_total",
  get_active_operations_summary: "summary_total",
};

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}
function safeArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  const raw = clean(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function asIntentParameters(args: Record<string, unknown>): AssistantIntent["parameters"] {
  const out: AssistantIntent["parameters"] = {};
  Object.entries(args).forEach(([key, value]) => {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value as string | number | boolean | null;
    }
  });
  return out;
}

function legacySessionState(threadState: ReadOnlyThreadState, runtimeContext: AssistantUiContext): AssistantSessionState {
  return {
    ...EMPTY_ASSISTANT_SESSION_STATE,
    lastField: threadState.selectedFieldLabel,
    lastFieldId: threadState.selectedFieldId,
    lastFieldLabel: threadState.selectedFieldLabel,
    lastWarehouseId: threadState.selectedWarehouseId,
    lastOperationId: threadState.selectedOperationId,
    lastIntent: threadState.lastIntent,
    lastSeason: runtimeContext.season,
    focusEntityType: threadState.selectedFieldId || threadState.selectedFieldLabel
      ? "field"
      : threadState.selectedWarehouseId
        ? "warehouse"
        : threadState.selectedOperationId
          ? "operation"
          : null,
    focusEntityId:
      threadState.selectedFieldId || threadState.selectedWarehouseId || threadState.selectedOperationId,
    focusEntityLabel: threadState.selectedFieldLabel,
    focusModule: runtimeContext.currentModule,
    focusRoute: runtimeContext.currentRoute,
    focusSource: threadState.selectedFieldId || threadState.selectedFieldLabel ? "tool_output" : null,
  };
}

function normalizedToolArgs(params: {
  name: ReadOnlyModelToolName;
  rawArgs: Record<string, unknown>;
  message: string;
  state: ReadOnlyThreadState;
  runtimeContext: AssistantUiContext;
}): Record<string, unknown> {
  const { name, rawArgs, message, state, runtimeContext } = params;
  if (name === "search_fields" || name === "get_field_card" || name === "get_field_materials") {
    const typed = parseTypedFieldSearchParameters(message, rawArgs);
    const focusLabel = state.selectedFieldLabel || null;
    const fieldReference = clean(rawArgs.field_id) || typed.number || typed.name || focusLabel || state.selectedFieldId;
    const args: Record<string, unknown> = {
      ...typed,
      ...(clean(rawArgs.field_id) ? { field_id: clean(rawArgs.field_id) } : {}),
      ...(fieldReference ? { field: fieldReference } : {}),
      season: typed.season_id || runtimeContext.season,
      limit: rawArgs.limit,
    };
    if (name === "search_fields") {
      if (typed.area_ha != null) {
        args.query = "";
        args.output_type = "list";
        delete args.field;
      } else if (typed.number) {
        args.query = typed.number;
        args.output_type = "filtered_summary";
      } else if (typed.name) {
        args.query = typed.name;
        args.output_type = "filtered_summary";
      } else {
        args.query = "";
        args.output_type = "list";
      }
    } else {
      args.query = fieldReference || "";
      args.output_type = name === "get_field_materials" ? "list" : "filtered_summary";
    }
    return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
  }
  if (name === "get_warehouse_stock") {
    return {
      query: message,
      product: clean(rawArgs.product),
      warehouse: clean(rawArgs.warehouse),
      warehouse_alias: clean(rawArgs.warehouse),
      allWarehouses: !clean(rawArgs.warehouse),
      output_type: "balance",
      limit: rawArgs.limit,
    };
  }
  if (name === "get_crop_structure_summary") {
    return {
      query: message,
      crop: clean(rawArgs.crop),
      crop_alias: clean(rawArgs.crop),
      crop_group: clean(rawArgs.crop_group),
      variety: clean(rawArgs.variety),
      season: clean(rawArgs.season_id) || runtimeContext.season,
      season_id: clean(rawArgs.season_id),
      output_type: clean(rawArgs.crop) || clean(rawArgs.crop_group) ? "filtered_summary" : "summary_total",
      limit: rawArgs.limit,
    };
  }
  if (name === "get_active_operations_summary") {
    return {
      query: message,
      status: "active",
      season: clean(rawArgs.season_id) || runtimeContext.season,
      season_id: clean(rawArgs.season_id),
      output_type: "summary_total",
      limit: rawArgs.limit,
    };
  }
  if (name === "get_field_land_bank_summary") {
    return { query: message, output_type: "summary_total" };
  }
  return { query: message, output_type: "filtered_summary" };
}

function normalizeFieldLabel(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/^\s*(?:поле|field|№)\s*/iu, "")
    .trim();
}

function postProcessFieldSearch(
  output: AssistantToolOutput,
  message: string,
  args: Record<string, unknown>
): AssistantToolOutput {
  const typed = parseTypedFieldSearchParameters(message, args);
  let rows = output.rows || [];
  if (typed.name) {
    const expected = typed.name.toLowerCase();
    rows = rows.filter((row) => String(row.field_name || row.name || "").toLowerCase().includes(expected));
  }
  if (typed.number) {
    const expected = normalizeFieldLabel(typed.number);
    rows = rows.filter((row) => {
      const label = normalizeFieldLabel(row.field_name || row.name);
      return label === expected || label.startsWith(`${expected}-`);
    });
  }
  if (typed.area_ha != null) {
    const tolerance = typed.area_tolerance_ha ?? 0.25;
    rows = rows.filter((row) => {
      const area = Number(row.area_ha ?? row.area);
      return Number.isFinite(area) && Math.abs(area - Number(typed.area_ha)) <= tolerance;
    });
  }
  return { ...output, rows };
}

function updateThreadState(params: {
  previous: ReadOnlyThreadState;
  name: ReadOnlyModelToolName;
  args: Record<string, unknown>;
  output: AssistantToolOutput;
  message: string;
}): ReadOnlyThreadState {
  const { previous, name, args, output, message } = params;
  const next: ReadOnlyThreadState = { ...previous, lastIntent: INTENT_BY_TOOL[name] };
  const rows = output.rows || [];
  if (name === "search_fields" || name === "get_field_card") {
    const typed = parseTypedFieldSearchParameters(message, args);
    const unique = new Map<string, { id: string | null; label: string | null }>();
    rows.forEach((row) => {
      const id = clean(row.field_id) || clean(row.id);
      const label = clean(row.field_name) || clean(row.name) || typed.number || typed.name || null;
      const key = id || label;
      if (key) unique.set(key, { id, label });
    });
    if (unique.size === 1) {
      const selected = Array.from(unique.values())[0];
      next.selectedFieldId = selected.id;
      next.selectedFieldLabel = selected.label;
      next.unresolvedQuestion = null;
    } else if (unique.size > 1) {
      next.selectedFieldId = null;
      next.selectedFieldLabel = null;
      next.unresolvedQuestion = "Найдено несколько полей. Уточните номер сегмента или название.";
    }
  }
  if (name === "get_field_materials") {
    next.selectedFieldId = clean(rows[0]?.field_id) || next.selectedFieldId;
    next.selectedFieldLabel = clean(rows[0]?.field_name) || next.selectedFieldLabel || clean(args.field);
    next.unresolvedQuestion = null;
  }
  if (name === "get_warehouse_stock") {
    const warehouseIds = Array.from(new Set(rows.map((row) => clean(row.warehouse_id)).filter(Boolean))) as string[];
    next.selectedWarehouseId = warehouseIds.length === 1 ? warehouseIds[0] : next.selectedWarehouseId;
  }
  if (name === "get_active_operations_summary") {
    const operationIds = Array.from(new Set(rows.map((row) => clean(row.operation_id)).filter(Boolean))) as string[];
    next.selectedOperationId = operationIds.length === 1 ? operationIds[0] : next.selectedOperationId;
  }
  return next;
}

function toolContent(output: AssistantToolOutput): string {
  const serialized = JSON.stringify({
    title: output.title,
    rows: output.rows,
    summary: output.summary || null,
    source: output.source,
  });
  return serialized.length <= 12_000 ? serialized : `${serialized.slice(0, 11_900)}...`;
}

function usageFrom(value: any): Usage {
  return {
    promptTokens: Number.isFinite(Number(value?.prompt_tokens)) ? Number(value.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(value?.completion_tokens)) ? Number(value.completion_tokens) : null,
    totalTokens: Number.isFinite(Number(value?.total_tokens)) ? Number(value.total_tokens) : null,
  };
}

function mergeUsage(current: Usage, next: Usage): Usage {
  const add = (a: number | null, b: number | null) => a == null && b == null ? null : (a || 0) + (b || 0);
  return {
    promptTokens: add(current.promptTokens, next.promptTokens),
    completionTokens: add(current.completionTokens, next.completionTokens),
    totalTokens: add(current.totalTokens, next.totalTokens),
  };
}

function defaultLlm(): LlmStatus {
  return { status: "not_called", httpStatus: null, errorCode: null, errorMessage: null, missingEnv: [] };
}

function buildResult(params: {
  startedAt: number;
  answer: string;
  state: ReadOnlyThreadState;
  runtimeContext: AssistantUiContext;
  settings: AssistantPlatformSettings;
  modelConfig: ReturnType<typeof resolveAssistantModelConfig>;
  actualModel: string | null;
  llm: LlmStatus;
  usage: Usage;
  toolCalls: AssistantEngineResult["toolCalls"];
  outputs: AssistantToolOutput[];
  intent: AssistantIntent;
  answerSource: AssistantEngineResult["answerSource"];
  grounded: boolean;
  modelMs: number;
  toolMs: number;
  diagnostics: ReadOnlyRuntimeDiagnostics;
}): ReadOnlyAssistantV1Result {
  const sourceHints = params.outputs.map((output) =>
    `${output.source.module} • ${output.source.tableOrView} • ${output.source.season || "-"} • ${output.source.fetchedAt}`
  );
  return {
    answer: params.answer,
    threadState: params.state,
    runtimeDiagnostics: params.diagnostics,
    sessionState: legacySessionState(params.state, params.runtimeContext),
    intent: params.intent,
    outputType: params.toolCalls.length
      ? OUTPUT_BY_TOOL[params.toolCalls[params.toolCalls.length - 1].tool as ReadOnlyModelToolName]
      : "filtered_summary",
    mode: params.toolCalls.length ? "erp_data" : "agro_knowledge",
    toolCalls: params.toolCalls,
    toolActivity: params.toolCalls.map((call) => `${call.ok ? "✓" : "✗"} ${call.tool}${call.rows == null ? "" : ` (${call.rows})`}`),
    navigationActions: [],
    sourceHints,
    answerSource: params.answerSource,
    grounded: params.grounded,
    decisionSource: "model",
    explicitNavigationRequested: false,
    navigationPolicy: "not_applicable",
    model: {
      configuredModel: params.modelConfig.configuredModel,
      actualModel: params.actualModel,
      settingsSource: params.modelConfig.settingsSource,
      promptVersion: A101_PROMPT_VERSION,
      promptSource: "code_default",
      promptUpdatedAt: PROMPT_UPDATED_AT,
      requestMode: "model_first",
      llm: params.llm,
    },
    diagnostics: {
      expectedAnswerType: params.toolCalls.length
        ? OUTPUT_BY_TOOL[params.toolCalls[params.toolCalls.length - 1].tool as ReadOnlyModelToolName]
        : "filtered_summary",
      selectedSource: params.outputs[params.outputs.length - 1]?.source.tableOrView || null,
      selectedTool: params.toolCalls[params.toolCalls.length - 1]?.tool || null,
      fallbackSource: null,
      previousRelatedMemory: null,
      consistencyCheck: params.grounded ? "pass" : "skipped",
      contradictionDetected: false,
      correctionApplied: false,
    },
    performance: {
      promptTokens: params.usage.promptTokens,
      completionTokens: params.usage.completionTokens,
      totalTokens: params.usage.totalTokens,
      routerMs: 0,
      plannerMs: params.modelMs,
      toolMs: params.toolMs,
      validatorMs: 0,
      modelMs: params.modelMs,
      responseRenderMs: null,
      totalMs: Date.now() - params.startedAt,
    },
  };
}

export async function runReadOnlyAssistantV1(params: {
  supabase: SupabaseClient;
  actor: ServerActorContext;
  companyId: string;
  companyName?: string | null;
  settings: AssistantPlatformSettings;
  input: ReadOnlyAssistantV1Input;
  dependencies?: ReadOnlyEngineDependencies;
}): Promise<ReadOnlyAssistantV1Result> {
  const startedAt = Date.now();
  const message = clean(params.input.message) || "";
  const runtimeContext = normalizeAssistantUiContext(params.input.runtimeContext);
  const state = normalizeReadOnlyThreadState({
    threadId: params.input.threadId,
    state: params.input.threadState,
    runtimeContext,
  });
  const modelConfig = resolveAssistantModelConfig(params.settings);
  const temperatureSupported = assistantModelSupportsCustomTemperature(modelConfig.actualModel);
  const emptyDiagnostics: ReadOnlyRuntimeDiagnostics = {
    requestedModel: modelConfig.configuredModel,
    effectiveModel: null,
    effectiveReasoning: "unsupported",
    requestedReasoning: modelConfig.reasoningEffort,
    effectiveTemperature: temperatureSupported ? modelConfig.temperature : null,
    temperatureSupported,
    historyMessageCount: 0,
    conversationMessageCount: 1,
    modelInputMessageCount: 0,
    availableTools: [...READ_ONLY_MODEL_TOOL_NAMES],
    blockedToolName: null,
    singleModelPath: true,
  };
  const generalIntent: AssistantIntent = {
    name: "general_question",
    confidence: 1,
    needsData: false,
    parameters: { query: message },
  };

  try {
    assertReadOnlyRequestPolicy({
      actor: params.actor,
      companyId: params.companyId,
      settings: params.settings,
      runtimeContext,
    });
  } catch (error) {
    const policy = error instanceof ReadOnlyPolicyError ? error : new ReadOnlyPolicyError("POLICY_DENIED", "Read-only policy denied the request.");
    return buildResult({
      startedAt,
      answer: "Доступ к данным для текущего пользователя или компании запрещён.",
      state,
      runtimeContext,
      settings: params.settings,
      modelConfig,
      actualModel: null,
      llm: { ...defaultLlm(), status: "not_called", errorCode: policy.code, errorMessage: policy.message },
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      toolCalls: [],
      outputs: [],
      intent: generalIntent,
      answerSource: "access_denied",
      grounded: false,
      modelMs: 0,
      toolMs: 0,
      diagnostics: emptyDiagnostics,
    });
  }

  const conversation = buildBoundedConversation({
    threadId: params.input.threadId,
    historyThreadId: params.input.historyThreadId,
    history: params.input.history,
    currentMessage: message,
    actor: { id: params.actor.id, role: params.actor.role },
    company: { id: params.companyId, name: params.companyName || null },
    runtimeContext,
    threadState: state,
  });
  const diagnostics: ReadOnlyRuntimeDiagnostics = {
    ...emptyDiagnostics,
    historyMessageCount: conversation.historyMessageCount,
    conversationMessageCount: conversation.conversationMessageCount,
    modelInputMessageCount: conversation.messages.length,
  };
  const apiKey = params.dependencies && Object.prototype.hasOwnProperty.call(params.dependencies, "apiKey")
    ? params.dependencies.apiKey
    : process.env.OPENAI_API_KEY;
  if (!clean(apiKey)) {
    return buildResult({
      startedAt,
      answer: "Локальный OpenAI API key не настроен. Для A101 используйте mocked OpenAI.",
      state,
      runtimeContext,
      settings: params.settings,
      modelConfig,
      actualModel: null,
      llm: { ...defaultLlm(), status: "missing_api_key", errorCode: "OPENAI_API_KEY_MISSING", missingEnv: ["OPENAI_API_KEY"] },
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      toolCalls: [],
      outputs: [],
      intent: generalIntent,
      answerSource: "policy_block",
      grounded: false,
      modelMs: 0,
      toolMs: 0,
      diagnostics,
    });
  }

  const fetchImpl = params.dependencies?.fetchImpl || fetch;
  const executeTool: ReadOnlyToolExecutor = params.dependencies?.executeTool || (async ({ name, context }) => {
    const tool = getAssistantTool(name);
    if (!tool) throw new ReadOnlyPolicyError("TOOL_NOT_IMPLEMENTED", `Tool implementation not found: ${name}`);
    return tool.run(context);
  });
  const messages: any[] = conversation.messages.map((item) => ({ ...item }));
  const toolSchemas = getReadOnlyModelToolSchemas();
  const toolCalls: AssistantEngineResult["toolCalls"] = [];
  const outputs: AssistantToolOutput[] = [];
  let nextState = state;
  let lastIntent = generalIntent;
  let finalAnswer = "";
  let actualModel: string | null = modelConfig.actualModel;
  let llm = defaultLlm();
  let usage: Usage = { promptTokens: null, completionTokens: null, totalTokens: null };
  let modelMs = 0;
  let toolMs = 0;

  for (let turn = 0; turn < MAX_MODEL_TURNS; turn += 1) {
    const modelStartedAt = Date.now();
    let response: Response | null = null;
    try {
      response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAiChatCompletionBody({
          model: modelConfig.actualModel,
          temperature: modelConfig.temperature,
          messages,
          tools: toolSchemas,
          toolChoice: "auto",
          maxCompletionTokens: 1_200,
        })),
      });
    } catch {
      response = null;
    }
    modelMs += Date.now() - modelStartedAt;
    if (!response) {
      llm = { status: "network_error", httpStatus: null, errorCode: "OPENAI_NETWORK_ERROR", errorMessage: "OpenAI request failed", missingEnv: [] };
      break;
    }
    const data: any = await response.json().catch(() => ({}));
    usage = mergeUsage(usage, usageFrom(data?.usage));
    actualModel = clean(data?.model) || actualModel;
    diagnostics.effectiveModel = actualModel;
    if (!response.ok) {
      llm = {
        status: "http_error",
        httpStatus: response.status,
        errorCode: clean(data?.error?.code),
        errorMessage: clean(data?.error?.message),
        missingEnv: [],
      };
      break;
    }

    const choice = data?.choices?.[0]?.message || {};
    const requestedToolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
    const answer = clean(choice.content) || "";
    if (!requestedToolCalls.length) {
      finalAnswer = answer;
      llm = { status: "ok", httpStatus: response.status, errorCode: null, errorMessage: null, missingEnv: [] };
      break;
    }
    messages.push({ role: "assistant", content: answer, tool_calls: requestedToolCalls });

    for (const call of requestedToolCalls) {
      const rawName = clean(call?.function?.name) || "unknown";
      if (!isReadOnlyModelToolName(rawName) || toolCalls.length >= MAX_TOOL_CALLS) {
        diagnostics.blockedToolName = rawName;
        llm = {
          status: "invalid_response",
          httpStatus: response.status,
          errorCode: isReadOnlyModelToolName(rawName) ? "TOOL_CALL_LIMIT" : "TOOL_NOT_ALLOWED",
          errorMessage: `Blocked model tool call: ${rawName}`,
          missingEnv: [],
        };
        return buildResult({
          startedAt,
          answer: "Это действие недоступно в read-only версии ассистента.",
          state: nextState,
          runtimeContext,
          settings: params.settings,
          modelConfig,
          actualModel,
          llm,
          usage,
          toolCalls,
          outputs,
          intent: lastIntent,
          answerSource: "policy_block",
          grounded: false,
          modelMs,
          toolMs,
          diagnostics,
        });
      }

      const rawArgs = safeArgs(call?.function?.arguments);
      const args = normalizedToolArgs({
        name: rawName,
        rawArgs,
        message,
        state: nextState,
        runtimeContext,
      });
      let policy;
      try {
        policy = assertReadOnlyToolPolicy({
          toolName: rawName,
          args,
          settings: params.settings,
          season: runtimeContext.season,
        });
      } catch (error) {
        const policyError = error instanceof ReadOnlyPolicyError ? error : new ReadOnlyPolicyError("TOOL_POLICY_DENIED", "Tool policy denied the call.");
        diagnostics.blockedToolName = rawName;
        llm = { status: "invalid_response", httpStatus: response.status, errorCode: policyError.code, errorMessage: policyError.message, missingEnv: [] };
        return buildResult({
          startedAt,
          answer: "Запрос инструмента заблокирован read-only политикой.",
          state: nextState,
          runtimeContext,
          settings: params.settings,
          modelConfig,
          actualModel,
          llm,
          usage,
          toolCalls,
          outputs,
          intent: lastIntent,
          answerSource: "policy_block",
          grounded: false,
          modelMs,
          toolMs,
          diagnostics,
        });
      }

      lastIntent = {
        name: INTENT_BY_TOOL[rawName],
        confidence: 1,
        needsData: true,
        parameters: asIntentParameters(args),
      };
      const context: AssistantToolContext = {
        supabase: params.supabase,
        actor: params.actor,
        companyId: params.companyId,
        settings: params.settings,
        runtimeContext,
        sessionState: legacySessionState(nextState, runtimeContext),
        intent: lastIntent,
      };
      const toolStartedAt = Date.now();
      try {
        let output = await executeTool({ name: rawName, args, context });
        assertReadOnlyResultCompany({ output, companyId: params.companyId });
        if (rawName === "search_fields") output = postProcessFieldSearch(output, message, args);
        output = boundReadOnlyToolOutput({ output, policy });
        toolMs += Date.now() - toolStartedAt;
        outputs.push(output);
        nextState = updateThreadState({ previous: nextState, name: rawName, args, output, message });
        toolCalls.push({ tool: rawName, params: args, ok: true, rows: output.rows.length, durationMs: Date.now() - toolStartedAt });
        messages.push({ role: "tool", tool_call_id: call.id, content: toolContent(output) });
      } catch (error) {
        toolMs += Date.now() - toolStartedAt;
        if (error instanceof ReadOnlyPolicyError) {
          diagnostics.blockedToolName = rawName;
          llm = { status: "invalid_response", httpStatus: response.status, errorCode: error.code, errorMessage: error.message, missingEnv: [] };
          return buildResult({
            startedAt,
            answer: "Результат инструмента заблокирован политикой изоляции компании.",
            state: nextState,
            runtimeContext,
            settings: params.settings,
            modelConfig,
            actualModel,
            llm,
            usage,
            toolCalls,
            outputs,
            intent: lastIntent,
            answerSource: "policy_block",
            grounded: false,
            modelMs,
            toolMs,
            diagnostics,
          });
        }
        toolCalls.push({
          tool: rawName,
          params: args,
          ok: false,
          error: error instanceof Error ? error.message : "Read-only tool failed",
          durationMs: Date.now() - toolStartedAt,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "read_only_tool_failed" }) });
      }
    }
  }

  if (llm.status === "not_called") {
    llm = { status: "invalid_response", httpStatus: null, errorCode: "MODEL_LOOP_EXHAUSTED", errorMessage: "Model loop ended without a final answer", missingEnv: [] };
  }
  const successfulTools = toolCalls.filter((call) => call.ok);
  const grounded = successfulTools.length > 0 && successfulTools.length === toolCalls.length;
  return buildResult({
    startedAt,
    answer: finalAnswer || (llm.status === "ok" ? "По текущему запросу ответ не сформирован." : "Не удалось получить безопасный ответ модели."),
    state: nextState,
    runtimeContext,
    settings: params.settings,
    modelConfig,
    actualModel,
    llm,
    usage,
    toolCalls,
    outputs,
    intent: lastIntent,
    answerSource: grounded ? "model_grounded" : llm.status === "ok" ? "llm_fallback" : "tool_error",
    grounded,
    modelMs,
    toolMs,
    diagnostics,
  });
}
