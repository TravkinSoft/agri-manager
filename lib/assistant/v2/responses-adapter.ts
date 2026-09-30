import type { PlannerToolSchema } from "@/lib/assistant/engine/tool-schema";
import type { AssistantRuntimeMode } from "@/lib/assistant/v2/runtime-mode";
import { buildOpenAiChatCompletionBody } from "@/lib/assistant/openai";

export type RuntimeModelRequest = {
  mode: AssistantRuntimeMode;
  apiKey: string;
  model: string;
  temperature: number;
  messages: Array<Record<string, unknown>>;
  tools: PlannerToolSchema[];
  toolChoice: "auto" | "none";
  maxOutputTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  fetchImpl: typeof fetch;
  timeoutMs?: number;
};

export type RuntimeModelResponse = {
  ok: boolean;
  status: number | null;
  data: Record<string, any>;
  requestId: string | null;
  cachedInputTokens: number | null;
  latencyMs: number;
  endpoint: "/v1/chat/completions" | "/v1/responses";
  parseError: boolean;
  networkError: "timeout" | "network" | null;
};

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function openAiBaseUrl(): string {
  const configured = clean(process.env.ASSISTANT_OPENAI_BASE_URL);
  const localA106Mock = process.env.NODE_ENV !== "production" &&
    process.env.A106_BRANCH_REF === "gsglkmudcwkdetqtocae" &&
    configured &&
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(configured);
  return localA106Mock ? configured.replace(/\/$/, "") : "https://api.openai.com";
}

function responsesInstructions(messages: Array<Record<string, unknown>>): string | undefined {
  const value = messages
    .filter((message) => message.role === "system")
    .map((message) => clean(message.content))
    .filter((item): item is string => Boolean(item))
    .join("\n\n");
  return value || undefined;
}

export function toResponsesInput(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  messages.forEach((message) => {
    const role = clean(message.role);
    if (role === "system") return;

    if (role === "tool") {
      const callId = clean(message.tool_call_id);
      if (!callId) return;
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: clean(message.content) || JSON.stringify({ error: "empty_tool_output" }),
      });
      return;
    }

    if (role === "assistant") {
      const content = clean(message.content);
      if (content) input.push({ role: "assistant", content });
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      toolCalls.forEach((call: any) => {
        const callId = clean(call?.id);
        const name = clean(call?.function?.name);
        if (!callId || !name) return;
        input.push({
          type: "function_call",
          call_id: callId,
          name,
          arguments: clean(call?.function?.arguments) || "{}",
        });
      });
      return;
    }

    if (role === "user") {
      const content = clean(message.content);
      if (content) input.push({ role: "user", content });
    }
  });
  return input;
}

export function toResponsesTools(tools: PlannerToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }));
}

export function buildResponsesRequestBody(params: Omit<RuntimeModelRequest, "fetchImpl" | "apiKey" | "mode">) {
  const tools = toResponsesTools(params.tools);
  return {
    model: params.model,
    instructions: responsesInstructions(params.messages),
    input: toResponsesInput(params.messages),
    ...(tools.length ? { tools, tool_choice: params.toolChoice } : {}),
    ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
    max_output_tokens: params.maxOutputTokens,
    store: false,
  };
}

function extractResponsesText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  output.forEach((item: any) => {
    if (item?.type !== "message" || !Array.isArray(item.content)) return;
    item.content.forEach((content: any) => {
      if (content?.type === "output_text" && clean(content.text)) parts.push(String(content.text));
    });
  });
  return parts.join("\n").trim();
}

export function normalizeResponsesPayload(payload: Record<string, any>): Record<string, any> {
  const toolCalls = Array.isArray(payload.output)
    ? payload.output
        .filter((item: any) => item?.type === "function_call")
        .map((item: any) => ({
          id: clean(item.call_id) || clean(item.id) || "missing-call-id",
          type: "function",
          function: {
            name: clean(item.name) || "unknown",
            arguments: clean(item.arguments) || "{}",
          },
        }))
    : [];
  const inputTokens = Number.isFinite(Number(payload?.usage?.input_tokens)) ? Number(payload.usage.input_tokens) : null;
  const outputTokens = Number.isFinite(Number(payload?.usage?.output_tokens)) ? Number(payload.usage.output_tokens) : null;
  const totalTokens = Number.isFinite(Number(payload?.usage?.total_tokens))
    ? Number(payload.usage.total_tokens)
    : inputTokens == null && outputTokens == null
      ? null
      : (inputTokens || 0) + (outputTokens || 0);

  return {
    ...payload,
    choices: [{
      message: {
        role: "assistant",
        content: extractResponsesText(payload.output),
        tool_calls: toolCalls,
      },
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: totalTokens,
    },
  };
}

export async function requestRuntimeModel(params: RuntimeModelRequest): Promise<RuntimeModelResponse> {
  const startedAt = Date.now();
  const endpoint = params.mode === "responses_v2" ? "/v1/responses" : "/v1/chat/completions";
  const body = params.mode === "responses_v2"
    ? buildResponsesRequestBody(params)
    : buildOpenAiChatCompletionBody({
      model: params.model,
      temperature: params.temperature,
        messages: params.messages,
        tools: params.tools,
        toolChoice: params.toolChoice,
        maxCompletionTokens: params.maxOutputTokens,
      });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, params.timeoutMs ?? 45_000));
  let response: Response;
  try {
    response = await params.fetchImpl(`${openAiBaseUrl()}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const timeoutError = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: null,
      data: {},
      requestId: null,
      cachedInputTokens: null,
      latencyMs: Date.now() - startedAt,
      endpoint,
      parseError: false,
      networkError: timeoutError ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timeout);
  }

  const requestId = clean(response.headers.get("x-request-id"));
  let raw: Record<string, any>;
  try {
    raw = await response.json();
  } catch {
    return {
      ok: false,
      status: response.status,
      data: {},
      requestId,
      cachedInputTokens: null,
      latencyMs: Date.now() - startedAt,
      endpoint,
      parseError: true,
      networkError: null,
    };
  }
  const cachedInputTokens = params.mode === "responses_v2" && Number.isFinite(Number(raw?.usage?.input_tokens_details?.cached_tokens))
    ? Number(raw.usage.input_tokens_details.cached_tokens)
    : null;
  return {
    ok: response.ok,
    status: response.status,
    data: params.mode === "responses_v2" ? normalizeResponsesPayload(raw) : raw,
    requestId,
    cachedInputTokens,
    latencyMs: Date.now() - startedAt,
    endpoint,
    parseError: false,
    networkError: null,
  };
}
