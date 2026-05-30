import fs from "node:fs/promises";
import path from "node:path";
import { getServiceClient } from "../lib/supabase/service";
import { getAssistantPlatformSettings } from "../lib/assistant/settings-store";
import { runAssistantEngine } from "../lib/assistant/engine/query";
import { getAssistantTool } from "../lib/assistant/engine/tools";
import { normalizeAssistantUiContext } from "../lib/assistant/engine/runtime";
import {
  EMPTY_ASSISTANT_SESSION_STATE,
  normalizeSessionState,
  updateSessionStateFromToolOutput,
} from "../lib/assistant/engine/session-state";
import { classifyAssistantIntent } from "../lib/assistant/engine/router";
import { resolveTravkinCorePrompt } from "../lib/assistant/prompts/travkin-core-prompt";
import { buildSemanticMemoryContext } from "../lib/assistant/knowledge/semantic-memory";
import type { AssistantNavigationAction, AssistantSessionState } from "../lib/assistant/engine/types";
import type { ServerActorContext } from "../lib/auth/server-session";
import { normalizeRoleKey, parseCanonicalRole } from "../lib/auth/role-contract";

type TestQuestion = {
  id: number;
  text: string;
};

type ToolReplaySummary = {
  tool: string;
  ok: boolean;
  tool_input: Record<string, unknown>;
  output_rows: number;
  output_title: string | null;
  output_source: string | null;
  output_module: string | null;
  output_summary: string | null;
  sample_rows: Array<Record<string, unknown>>;
  error: string | null;
};

type QuestionTrace = {
  question: string;
  backend_received: Record<string, unknown>;
  runtime_context_received: Record<string, unknown>;
  model_used: {
    configured_model: string | null;
    actual_model: string | null;
    settings_source: string;
  };
  openai_called: boolean;
  llm_status: string;
  prompt_sent_to_openai: {
    system_prompt: string;
    user_message: string;
    semantic_memory_context: string | null;
  } | null;
  model_raw_output_before_tools: string | null;
  intent_selected_by: string;
  intent: string;
  intent_parameters: Record<string, unknown>;
  tool_selected_by: string;
  tools_called: ToolReplaySummary[];
  model_received_tool_output_back: boolean;
  final_answer_written_by: string;
  final_answer_location: string;
  final_answer: string;
  navigation_action: {
    created: boolean;
    requested_explicitly: boolean;
    actions: AssistantNavigationAction[];
    reason: string;
  };
  problem_found: string | null;
  root_cause: string | null;
};

const QUESTIONS: TestQuestion[] = [
  { id: 1, text: "Последний талон" },
  { id: 2, text: "Назови склады" },
  { id: 3, text: "Что на поле 28?" },
  { id: 4, text: "Сколько картофеля в плане 2026?" },
  { id: 5, text: "Покажи последние 3 талона" },
  { id: 6, text: "Сколько складов?" },
  { id: 7, text: "Открой весовую" },
  { id: 8, text: "Сколько моркови?" },
  { id: 9, text: "Какие материалы по полю 28?" },
  { id: 10, text: "Что делал водитель Кайрат?" },
];

const NAVIGATION_EXPLICIT_MARKERS = [
  "открой",
  "перейди",
  "зайди",
  "покажи страницу",
  "open",
  "go to",
  "navigate",
];

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

async function loadEnvFromProjectFile(): Promise<void> {
  const envPath = path.join(process.cwd(), ".env");
  const raw = await fs.readFile(envPath, "utf8").catch(() => "");
  if (!raw) return;
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const idx = line.indexOf("=");
      if (idx <= 0) return;
      const key = line.slice(0, idx).trim();
      if (!key || process.env[key]) return;
      const value = line
        .slice(idx + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1")
        .replace(/^'(.*)'$/, "$1");
      process.env[key] = value;
    });
}

function parseNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeSampleRows(rows: Array<Record<string, unknown>>, limit = 2): Array<Record<string, unknown>> {
  return rows.slice(0, limit).map((row) => {
    const reduced: Record<string, unknown> = {};
    Object.entries(row).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        reduced[key] = value;
      } else if (typeof value === "object") {
        reduced[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
      } else {
        reduced[key] = value;
      }
    });
    return reduced;
  });
}

function makeActor(profile: Record<string, unknown>): ServerActorContext {
  const rawRole = clean(profile.role);
  const normalizedRoleKey = normalizeRoleKey(rawRole);
  const role =
    parseCanonicalRole(rawRole) ||
    parseCanonicalRole(normalizedRoleKey) ||
    parseCanonicalRole("global_admin") ||
    "global_admin";
  const profileId = clean(profile.id);
  const userId = clean(profile.user_id) || clean(profile.auth_user_id) || profileId;
  const companyId = clean(profile.company_id) || null;

  return {
    id: profileId,
    authUserId: userId,
    role,
    roleRawKey: normalizedRoleKey || rawRole,
    roleIsLegacyAlias: role !== normalizedRoleKey,
    companyId,
    homeCompanyId: companyId,
    contextCompanyId: companyId,
    status: clean(profile.status) || "active",
    email: clean(profile.email) || null,
    isImpersonating: false,
    impersonatedProfileId: null,
    impersonatedCompanyId: null,
    impersonatedByProfileId: null,
    impersonatedByAuthUserId: null,
  };
}

function pickActor(profiles: Array<Record<string, unknown>>): Record<string, unknown> {
  const rows = profiles.filter((row) => clean(row.id).length > 0);
  if (!rows.length) throw new Error("profiles table is empty");

  const byEmail = rows.find((row) => clean(row.email).toLowerCase() === "aimbeks@gmail.com");
  if (byEmail) return byEmail;

  const globalAdmin = rows.find(
    (row) => normalizeRoleKey(row.role) === "global_admin" && clean(row.status || "active").toLowerCase() === "active"
  );
  if (globalAdmin) return globalAdmin;

  return rows[0];
}

async function resolveCompanyName(companyId: string | null): Promise<string> {
  if (!companyId) return "Unknown Company";
  const supabase = getServiceClient();
  const { data } = await supabase.from("companies").select("name").eq("id", companyId).limit(1).maybeSingle();
  return clean(data?.name) || "Unknown Company";
}

function buildRuntimeContext(params: {
  companyId: string;
  companyName: string;
  actor: ServerActorContext;
}) {
  const { companyId, companyName, actor } = params;
  return {
    currentPage: "operations",
    currentRoute: "/operations",
    currentModule: "operations",
    season: null,
    defaultSeason: "2026",
    companyId,
    companyName,
    locale: "ru" as const,
    language: "ru" as const,
    entity: null,
    selectedRows: [],
    filters: {},
    selectedEntityType: null,
    selectedEntityId: null,
    selectedFieldId: null,
    selectedWarehouseId: null,
    selectedCrop: null,
    userId: actor.authUserId || actor.id,
    userRole: actor.role,
  };
}

function detectProblem(question: string, trace: QuestionTrace): { problem: string | null; rootCause: string | null } {
  const q = question.toLowerCase();
  const intent = trace.intent;
  const firstTool = trace.tools_called[0]?.tool || "";
  const navCreated = trace.navigation_action.created;
  const navExplicit = trace.navigation_action.requested_explicitly;

  if (q.includes("последний талон") && intent !== "weighbridge_tickets") {
    return {
      problem: `Ожидался intent weighbridge_tickets, получен ${intent}.`,
      rootCause: "Rule-router fallbackIntent отдал вопрос в другой intent до weighbridge-ветки.",
    };
  }

  if (
    (q.includes("последний талон") || q.includes("последние 3 талона")) &&
    /активные талоны|показать активные/i.test(trace.final_answer)
  ) {
    return {
      problem: "Ассистент переспрашивает active/recent вместо прямого ответа по последним талонам.",
      rootCause: "Formatter/answer branch после get_recent_tickets не строит short summary и уходит в clarification-style текст.",
    };
  }

  if (q.includes("назови склады") && firstTool !== "get_warehouse_count") {
    return {
      problem: `Ожидался tool get_warehouse_count, вызван ${firstTool || "none"}.`,
      rootCause: "Hardcoded getToolNamesForIntent выбрал не листинг складов, а другой источник.",
    };
  }

  if (q.includes("последние 3 талона") && intent === "clarification_required") {
    return {
      problem: "Запрошены последние 3 талона, но ассистент ушел в уточнение.",
      rootCause: "Router потерял явный параметр latest/limit=3 на этапе regex-ветки.",
    };
  }

  if (!navExplicit && navCreated) {
    return {
      problem: "Создана navigation action для информационного запроса.",
      rootCause: "Action создается по intent/navigation template, а не по явному user-navigation trigger.",
    };
  }

  return { problem: null, rootCause: null };
}

function isExplicitNavigationRequest(question: string): boolean {
  const normalized = String(question || "").toLowerCase();
  return NAVIGATION_EXPLICIT_MARKERS.some((marker) => normalized.includes(marker));
}

async function replayTools(params: {
  toolNames: string[];
  supabase: ReturnType<typeof getServiceClient>;
  actor: ServerActorContext;
  companyId: string;
  settings: Awaited<ReturnType<typeof getAssistantPlatformSettings>>;
  runtimeContext: ReturnType<typeof normalizeAssistantUiContext>;
  intent: Awaited<ReturnType<typeof classifyAssistantIntent>>;
  sessionState: AssistantSessionState;
}): Promise<ToolReplaySummary[]> {
  const { toolNames, supabase, actor, companyId, settings, runtimeContext, intent } = params;
  let replayState = params.sessionState;
  const results: ToolReplaySummary[] = [];

  for (const toolName of toolNames) {
    const tool = getAssistantTool(toolName as any);
    if (!tool) {
      results.push({
        tool: toolName,
        ok: false,
        tool_input: {
          companyId,
          season: intent.parameters?.season || runtimeContext.season || runtimeContext.defaultSeason || "2026",
          params: intent.parameters || {},
        },
        output_rows: 0,
        output_title: null,
        output_source: null,
        output_module: null,
        output_summary: null,
        sample_rows: [],
        error: "tool_not_found",
      });
      continue;
    }

    try {
      const output = await tool.run({
        supabase,
        actor,
        companyId,
        settings,
        runtimeContext,
        sessionState: replayState,
        intent,
      });

      replayState = updateSessionStateFromToolOutput({
        previous: replayState,
        intent,
        output,
        seasonFromContext: runtimeContext.season,
      });

      results.push({
        tool: tool.name,
        ok: true,
        tool_input: {
          companyId,
          season: intent.parameters?.season || runtimeContext.season || runtimeContext.defaultSeason || "2026",
          params: intent.parameters || {},
        },
        output_rows: output.rows.length,
        output_title: output.title || null,
        output_source: output.source.tableOrView || null,
        output_module: output.source.module || null,
        output_summary: output.summary || null,
        sample_rows: safeSampleRows(output.rows),
        error: null,
      });
    } catch (error) {
      results.push({
        tool: tool.name,
        ok: false,
        tool_input: {
          companyId,
          season: intent.parameters?.season || runtimeContext.season || runtimeContext.defaultSeason || "2026",
          params: intent.parameters || {},
        },
        output_rows: 0,
        output_title: null,
        output_source: null,
        output_module: null,
        output_summary: null,
        sample_rows: [],
        error: error instanceof Error ? error.message : "tool_execution_failed",
      });
    }
  }

  return results;
}

function modelRawOutputBeforeTools(traceResult: Awaited<ReturnType<typeof runAssistantEngine>>): string | null {
  if (traceResult.answerSource === "llm_fallback") return traceResult.answer;
  return null;
}

function finalAnswerWriter(traceResult: Awaited<ReturnType<typeof runAssistantEngine>>): {
  who: string;
  location: string;
} {
  if (traceResult.answerSource === "llm_fallback") {
    return {
      who: "OpenAI",
      location: "lib/assistant/engine/query.ts -> generateGeneralAnswer",
    };
  }
  if (traceResult.answerSource === "tools") {
    return {
      who: "formatter/template",
      location: "lib/assistant/engine/query.ts -> formatGroundedToolOutput + buildNavigationAnswerV2",
    };
  }
  return {
    who: "engine fallback branch",
    location: "lib/assistant/engine/query.ts -> policy/tool_error/clarification branches",
  };
}

async function main() {
  await loadEnvFromProjectFile();
  const supabase = getServiceClient();
  const profileRes = await supabase.from("profiles").select("*").limit(5000);
  if (profileRes.error || !Array.isArray(profileRes.data)) {
    throw new Error(`failed to read profiles: ${profileRes.error?.message || "unknown error"}`);
  }

  const actor = makeActor(pickActor(profileRes.data as Array<Record<string, unknown>>));
  if (!actor.companyId) throw new Error("selected actor has no company_id");

  const companyName = await resolveCompanyName(actor.companyId);
  const settings = await getAssistantPlatformSettings(supabase, actor.id);
  const runtimeContextRaw = buildRuntimeContext({
    companyId: actor.companyId,
    companyName,
    actor,
  });
  const runtimeContext = normalizeAssistantUiContext(runtimeContextRaw);
  const baseSessionState = {
    ...EMPTY_ASSISTANT_SESSION_STATE,
    ...normalizeSessionState({ lastSeason: runtimeContext.defaultSeason || "2026" }),
  };

  const traces: QuestionTrace[] = [];
  for (const question of QUESTIONS) {
    const payload = {
      message: question.text,
      locale: "ru" as const,
      runtimeContext: runtimeContextRaw,
      sessionState: { lastSeason: runtimeContext.defaultSeason || "2026" },
      chatHistory: [],
    };

    const intent = await classifyAssistantIntent({
      message: question.text,
      runtimeContext,
      sessionState: baseSessionState,
      settings,
    });

    const result = await runAssistantEngine({
      supabase,
      actor,
      companyId: actor.companyId,
      settings,
      input: payload,
    });

    const calledTools = (result.toolCalls || []).map((call) => call.tool);
    const toolReplay = await replayTools({
      toolNames: calledTools,
      supabase,
      actor,
      companyId: actor.companyId,
      settings,
      runtimeContext,
      intent,
      sessionState: baseSessionState,
    });

    const openaiCalled = result.model.llm.status !== "not_called";
    let promptData: QuestionTrace["prompt_sent_to_openai"] = null;
    if (openaiCalled) {
      const semanticContext = await buildSemanticMemoryContext({
        message: question.text,
        mode: result.mode,
        intentName: result.intent.name,
        runtimeContext,
      }).catch(() => ({ contextText: "" }));
      const promptBundle = resolveTravkinCorePrompt({
        settings,
        runtimeContext,
        actorRole: actor.role,
        locale: runtimeContext.locale || "ru",
        semanticMemoryContext: clean(semanticContext?.contextText) || undefined,
      });
      promptData = {
        system_prompt: promptBundle.text,
        user_message: question.text,
        semantic_memory_context: clean(semanticContext?.contextText) || null,
      };
    }

    const requestedExplicitNav = isExplicitNavigationRequest(question.text);
    const navReason =
      result.navigationActions.length > 0
        ? `intent=${result.intent.name}; action=${clean((result.intent.parameters as any)?.action) || "n/a"}`
        : "not_created";

    const problemCheck = detectProblem(question.text, {
      question: question.text,
      backend_received: payload,
      runtime_context_received: runtimeContextRaw,
      model_used: {
        configured_model: result.model.configuredModel,
        actual_model: result.model.actualModel,
        settings_source: result.model.settingsSource,
      },
      openai_called: openaiCalled,
      llm_status: result.model.llm.status,
      prompt_sent_to_openai: promptData,
      model_raw_output_before_tools: modelRawOutputBeforeTools(result),
      intent_selected_by: "regex/rule router (fallbackIntent)",
      intent: result.intent.name,
      intent_parameters: result.intent.parameters,
      tool_selected_by: "hardcoded mapping (getToolNamesForIntent in query.ts)",
      tools_called: toolReplay,
      model_received_tool_output_back: false,
      final_answer_written_by: finalAnswerWriter(result).who,
      final_answer_location: finalAnswerWriter(result).location,
      final_answer: result.answer,
      navigation_action: {
        created: result.navigationActions.length > 0,
        requested_explicitly: requestedExplicitNav,
        actions: result.navigationActions,
        reason: navReason,
      },
      problem_found: null,
      root_cause: null,
    });

    traces.push({
      question: question.text,
      backend_received: payload,
      runtime_context_received: runtimeContextRaw,
      model_used: {
        configured_model: result.model.configuredModel,
        actual_model: result.model.actualModel,
        settings_source: result.model.settingsSource,
      },
      openai_called: openaiCalled,
      llm_status: result.model.llm.status,
      prompt_sent_to_openai: promptData,
      model_raw_output_before_tools: modelRawOutputBeforeTools(result),
      intent_selected_by: "regex/rule router (fallbackIntent)",
      intent: result.intent.name,
      intent_parameters: result.intent.parameters,
      tool_selected_by: "hardcoded mapping (getToolNamesForIntent in query.ts)",
      tools_called: toolReplay,
      model_received_tool_output_back: false,
      final_answer_written_by: finalAnswerWriter(result).who,
      final_answer_location: finalAnswerWriter(result).location,
      final_answer: result.answer,
      navigation_action: {
        created: result.navigationActions.length > 0,
        requested_explicitly: requestedExplicitNav,
        actions: result.navigationActions,
        reason: navReason,
      },
      problem_found: problemCheck.problem,
      root_cause: problemCheck.rootCause,
    });
  }

  const openaiCalls = traces.filter((trace) => trace.openai_called).length;
  const toolsOnly = traces.filter((trace) => !trace.openai_called).length;
  const navOnInfoQuestions = traces.filter(
    (trace) => trace.navigation_action.created && !trace.navigation_action.requested_explicitly
  ).length;
  const problems = traces.filter((trace) => trace.problem_found).length;

  const finalSummary = {
    generated_at: new Date().toISOString(),
    actor: {
      profile_id: actor.id,
      role: actor.role,
      company_id: actor.companyId,
      company_name: companyName,
    },
    conclusion: {
      openai_decision_power:
        openaiCalls === 0
          ? "OpenAI does not decide intents/tools in tested prompts. Engine resolved all through router+tools path."
          : "OpenAI is used only in fallback prompts; intents/tools are still chosen by code router.",
      router_vs_model:
        "Router and hardcoded tool-map dominate. LLM is mostly fallback formatter/answerer when no grounded tool answer.",
      context_behavior:
        "Current page acts as strong heuristic in router short-query branches; not a hard lock, but high influence exists.",
      intelligence_loss_point:
        "Main loss happens before LLM: fallbackIntent + getToolNamesForIntent fix intent/tool path deterministically.",
      architecture_change_targets: [
        "intent router policy and precedence",
        "tool selection map",
        "navigation action gating for informational prompts",
        "optional LLM-assisted intent disambiguation before tool selection",
      ],
    },
    counters: {
      prompts_total: traces.length,
      prompts_openai_called: openaiCalls,
      prompts_tools_only: toolsOnly,
      prompts_with_navigation_action: traces.filter((trace) => trace.navigation_action.created).length,
      nav_actions_without_explicit_user_request: navOnInfoQuestions,
      prompts_with_detected_problem: problems,
    },
    traces,
  };

  const outputDir = path.join(process.cwd(), "scripts", "output");
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outputDir, `copilot-decision-trace-${stamp}.json`);
  const mdPath = path.join(outputDir, `copilot-decision-trace-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(finalSummary, null, 2), "utf8");

  const lines: string[] = [];
  lines.push("# Travkin Copilot Decision Trace Report");
  lines.push("");
  lines.push(`Generated at: ${finalSummary.generated_at}`);
  lines.push(`Company: ${companyName}`);
  lines.push(`Actor role: ${actor.role}`);
  lines.push("");
  lines.push("## Global Conclusion");
  lines.push(`- OpenAI decision power: ${finalSummary.conclusion.openai_decision_power}`);
  lines.push(`- Router vs model: ${finalSummary.conclusion.router_vs_model}`);
  lines.push(`- Context behavior: ${finalSummary.conclusion.context_behavior}`);
  lines.push(`- Intelligence loss point: ${finalSummary.conclusion.intelligence_loss_point}`);
  lines.push("- Architecture change targets:");
  finalSummary.conclusion.architecture_change_targets.forEach((item) => lines.push(`  - ${item}`));
  lines.push("");
  lines.push("## Prompt Traces");

  traces.forEach((trace, index) => {
    lines.push("");
    lines.push(`### ${index + 1}. ${trace.question}`);
    lines.push(`- MODEL USED: configured=${trace.model_used.configured_model || "null"}, actual=${trace.model_used.actual_model || "null"}`);
    lines.push(`- OPENAI CALLED: ${trace.openai_called ? "yes" : "no"} (${trace.llm_status})`);
    lines.push(`- INTENT SELECTED BY: ${trace.intent_selected_by}`);
    lines.push(`- INTENT: ${trace.intent}`);
    lines.push(`- TOOL SELECTED BY: ${trace.tool_selected_by}`);
    lines.push(`- TOOLS: ${trace.tools_called.map((tool) => `${tool.tool}[rows=${tool.output_rows}, ok=${tool.ok}]`).join(", ") || "none"}`);
    lines.push(`- FINAL ANSWER WRITTEN BY: ${trace.final_answer_written_by}`);
    lines.push(`- NAVIGATION ACTION: ${trace.navigation_action.created ? "yes" : "no"} (explicit request: ${trace.navigation_action.requested_explicitly ? "yes" : "no"})`);
    if (trace.problem_found) lines.push(`- PROBLEM FOUND: ${trace.problem_found}`);
    if (trace.root_cause) lines.push(`- ROOT CAUSE: ${trace.root_cause}`);
    lines.push(`- FINAL ANSWER: ${trace.final_answer.replace(/\n+/g, " | ")}`);
  });

  await fs.writeFile(mdPath, lines.join("\n"), "utf8");

  console.log(`Saved JSON report: ${jsonPath}`);
  console.log(`Saved Markdown report: ${mdPath}`);
  console.log(
    JSON.stringify(
      {
        prompts: traces.length,
        openaiCalled: openaiCalls,
        toolsOnly,
        navActionsWithoutExplicitRequest: navOnInfoQuestions,
        detectedProblems: problems,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("trace-copilot-decision-flow failed:", error);
  process.exit(1);
});
