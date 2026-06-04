import fs from "node:fs/promises";
import path from "node:path";
import { getServiceClient } from "../lib/supabase/service";
import { getAssistantPlatformSettings } from "../lib/assistant/settings-store";
import { runAssistantEngine } from "../lib/assistant/engine/query";
import type { ServerActorContext } from "../lib/auth/server-session";
import { normalizeRoleKey, parseCanonicalRole } from "../lib/auth/role-contract";
import type { AssistantSessionState } from "../lib/assistant/engine/types";

type ScenarioStep = {
  id: string;
  prompt: string;
  page?: string;
  route?: string;
  expectedAnyTool?: string[];
  expectedAllTools?: string[];
  expectNoForbiddenMarkers?: boolean;
  expectNavigation?: boolean;
  expectConsistencyFail?: boolean;
};

type Scenario = {
  id: string;
  title: string;
  carryMemory: boolean;
  steps: ScenarioStep[];
};

type StepRun = {
  scenarioId: string;
  stepId: string;
  prompt: string;
  intent: string;
  decisionSource: string;
  answerSource: string;
  grounded: boolean;
  tools: string[];
  navigationCount: number;
  consistencyCheck: string;
  forbiddenMarkers: string[];
  missingAllTools: string[];
  matchedAnyTool: boolean;
  passed: boolean;
  answerPreview: string;
  durationMs: number;
};

const DEFAULT_PAGE = "dashboard";
const DEFAULT_ROUTE = "/dashboard";
const DEFAULT_SEASON = "2026";
const FORBIDDEN_MARKERS = ["QA_TEST", "QACODEX", "TEST", "TEMP", "DEMO", "ARCHIVED", "INACTIVE"];

const SCENARIOS: Scenario[] = [
  {
    id: "field-memory",
    title: "Step 2 field context memory",
    carryMemory: true,
    steps: [
      { id: "field-card", prompt: "Что на поле 28?", expectedAnyTool: ["get_field_card", "search_fields", "get_fields"], expectNoForbiddenMarkers: true },
      { id: "field-materials", prompt: "А материалы?", expectedAnyTool: ["get_field_materials"], expectNoForbiddenMarkers: true },
      { id: "field-operations", prompt: "А операции?", expectedAnyTool: ["get_field_timeline", "get_operations", "search_operations"], expectNoForbiddenMarkers: true },
      { id: "field-harvest", prompt: "А урожай?", expectedAnyTool: ["get_field_timeline", "get_field_card", "get_recent_tickets"], expectNoForbiddenMarkers: true },
    ],
  },
  {
    id: "warehouse-memory",
    title: "Step 2 warehouse context memory",
    carryMemory: true,
    steps: [
      { id: "warehouse-stock", prompt: "Остатки по овощному складу", expectedAnyTool: ["get_warehouse_stock", "get_warehouse_balances", "get_warehouse_summary"], expectNoForbiddenMarkers: true },
      { id: "warehouse-movements", prompt: "А последние движения?", expectedAnyTool: ["get_warehouse_movements"], expectNoForbiddenMarkers: true },
      { id: "warehouse-negative", prompt: "А отрицательные остатки?", expectedAnyTool: ["get_warehouse_balances", "get_warehouse_stock", "get_warehouse_summary"], expectNoForbiddenMarkers: true },
      { id: "warehouse-potato", prompt: "А картофель?", expectedAnyTool: ["get_warehouse_stock", "get_warehouse_balances", "get_warehouse_summary"], expectNoForbiddenMarkers: true },
    ],
  },
  {
    id: "crop-memory",
    title: "Step 2 crop context memory",
    carryMemory: true,
    steps: [
      { id: "potato", prompt: "Что по картофелю?", expectedAnyTool: ["get_crop_structure_summary", "get_crop_structure", "get_potato_material_report"], expectNoForbiddenMarkers: true },
      { id: "gala", prompt: "А Гала?", expectedAnyTool: ["get_crop_structure_summary", "get_crop_structure", "get_potato_material_report"], expectNoForbiddenMarkers: true },
      { id: "crop-harvest", prompt: "А урожай?", expectedAnyTool: ["get_field_timeline", "get_recent_tickets", "get_potato_material_report", "get_crop_structure_summary"], expectNoForbiddenMarkers: true },
      { id: "crop-stock", prompt: "А остатки?", expectedAnyTool: ["get_warehouse_stock", "get_warehouse_balances", "get_warehouse_summary", "get_potato_material_report"], expectNoForbiddenMarkers: true },
    ],
  },
  {
    id: "hygiene",
    title: "Step 3 production data hygiene",
    carryMemory: false,
    steps: [
      { id: "recent-tickets", prompt: "Последние 3 талона", expectedAnyTool: ["get_recent_tickets", "get_weighbridge_tickets"], expectNoForbiddenMarkers: true },
      { id: "active-tickets", prompt: "Активные талоны", expectedAnyTool: ["get_active_tickets"], expectNoForbiddenMarkers: true },
      { id: "warehouse-count", prompt: "Сколько складов?", expectedAnyTool: ["get_warehouse_count"], expectNoForbiddenMarkers: true },
      { id: "field-28", prompt: "Что на поле 28?", expectedAnyTool: ["get_field_card", "search_fields", "get_fields"], expectNoForbiddenMarkers: true },
      { id: "movements", prompt: "Последние движения", expectedAnyTool: ["get_warehouse_movements"], expectNoForbiddenMarkers: true },
      { id: "warehouse-stock", prompt: "Остатки по складу", expectedAnyTool: ["get_warehouse_stock", "get_warehouse_balances", "get_warehouse_summary"], expectNoForbiddenMarkers: true },
      { id: "potato", prompt: "Что по картофелю?", expectedAnyTool: ["get_crop_structure_summary", "get_crop_structure", "get_potato_material_report"], expectNoForbiddenMarkers: true },
    ],
  },
  {
    id: "consistency",
    title: "Step 6 source-of-truth and navigation validator",
    carryMemory: false,
    steps: [
      { id: "land-bank-total", prompt: "Сколько всего гектар?", expectedAllTools: ["get_field_land_bank_summary"], expectNoForbiddenMarkers: true },
      { id: "crop-plan-total", prompt: "Сколько посеяно?", expectedAnyTool: ["get_crop_structure_summary", "get_crop_structure"], expectNoForbiddenMarkers: true },
      { id: "potato-area", prompt: "Сколько картофеля?", expectedAnyTool: ["get_crop_structure_summary", "get_crop_structure", "get_potato_material_report"], expectNoForbiddenMarkers: true },
      { id: "open-weighbridge", prompt: "Открой весовую.", expectedAnyTool: ["navigate_to_page"], expectNavigation: true, expectNoForbiddenMarkers: true },
    ],
  },
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

async function resolveCompanyName(supabase: ReturnType<typeof getServiceClient>, companyId: string | null): Promise<string> {
  if (!companyId) return "Unknown Company";
  const { data } = await supabase.from("companies").select("name").eq("id", companyId).limit(1).maybeSingle();
  return clean(data?.name) || "Unknown Company";
}

function findForbiddenMarkers(answer: string): string[] {
  return FORBIDDEN_MARKERS.filter((marker) => answer.includes(marker));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function percentile95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
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

  const companyName = await resolveCompanyName(supabase, actor.companyId);
  const settings = await getAssistantPlatformSettings(supabase, actor.id);
  const runs: StepRun[] = [];
  const durations: number[] = [];

  for (const scenario of SCENARIOS) {
    let sessionState: Partial<AssistantSessionState> = { lastSeason: DEFAULT_SEASON };
    for (const step of scenario.steps) {
      if (!scenario.carryMemory) {
        sessionState = { lastSeason: DEFAULT_SEASON };
      }

      const started = Date.now();
      const result = await runAssistantEngine({
        supabase,
        actor,
        companyId: actor.companyId,
        settings: { ...settings, enabled: true },
        input: {
          message: step.prompt,
          locale: "ru",
          runtimeContext: {
            currentPage: step.page || DEFAULT_PAGE,
            currentRoute: step.route || DEFAULT_ROUTE,
            currentModule: step.page || DEFAULT_PAGE,
            season: null,
            defaultSeason: DEFAULT_SEASON,
            companyId: actor.companyId,
            companyName,
            locale: "ru",
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
          },
          sessionState,
          chatHistory: [],
        },
      });
      const durationMs = Date.now() - started;
      durations.push(durationMs);
      sessionState = result.sessionState;

      const tools = (result.toolCalls || []).map((tool) => String(tool.tool));
      const missingAllTools = (step.expectedAllTools || []).filter((tool) => !tools.includes(tool));
      const matchedAnyTool = step.expectedAnyTool?.length ? step.expectedAnyTool.some((tool) => tools.includes(tool)) : true;
      const forbiddenMarkers = step.expectNoForbiddenMarkers ? findForbiddenMarkers(clean(result.answer)) : [];
      const navigationCount = result.navigationActions.length;
      const navigationOk = step.expectNavigation ? navigationCount > 0 : true;
      const consistencyOk = step.expectConsistencyFail
        ? result.diagnostics.consistencyCheck === "fail"
        : result.diagnostics.consistencyCheck !== "fail";
      const passed =
        missingAllTools.length === 0 &&
        matchedAnyTool &&
        forbiddenMarkers.length === 0 &&
        navigationOk &&
        consistencyOk;

      runs.push({
        scenarioId: scenario.id,
        stepId: step.id,
        prompt: step.prompt,
        intent: result.intent.name,
        decisionSource: result.decisionSource || "unknown",
        answerSource: result.answerSource,
        grounded: result.grounded,
        tools,
        navigationCount,
        consistencyCheck: result.diagnostics.consistencyCheck,
        forbiddenMarkers,
        missingAllTools,
        matchedAnyTool,
        passed,
        answerPreview: clean(result.answer).slice(0, 420),
        durationMs,
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    actor: {
      id: actor.id,
      email: actor.email,
      role: actor.role,
      companyId: actor.companyId,
      companyName,
    },
    totals: {
      scenarios: SCENARIOS.length,
      prompts: runs.length,
      passed: runs.filter((run) => run.passed).length,
      failed: runs.filter((run) => !run.passed).length,
    },
    performance: {
      avgMs: average(durations),
      p95Ms: percentile95(durations),
      maxMs: durations.length ? Math.max(...durations) : null,
    },
    runs,
  };

  const outputDir = path.join(process.cwd(), "scripts", "output");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `qa-copilot-backlog-step2-step3-step6-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Saved: ${outputPath}`);
  console.table(
    runs.map((run) => ({
      scenario: run.scenarioId,
      step: run.stepId,
      intent: run.intent,
      tools: run.tools.join(", "),
      consistency: run.consistencyCheck,
      ok: run.passed ? "OK" : "FAIL",
      ms: run.durationMs,
    }))
  );
  console.log(`Avg response: ${summary.performance.avgMs}ms, p95: ${summary.performance.p95Ms}ms, max: ${summary.performance.maxMs}ms`);

  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("qa-copilot-backlog-step2-step3-step6 failed:", error);
  process.exit(1);
});
