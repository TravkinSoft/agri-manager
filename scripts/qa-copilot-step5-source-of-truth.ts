import fs from "node:fs/promises";
import path from "node:path";
import { getServiceClient } from "../lib/supabase/service";
import { getAssistantPlatformSettings } from "../lib/assistant/settings-store";
import { runAssistantEngine } from "../lib/assistant/engine/query";
import type { ServerActorContext } from "../lib/auth/server-session";
import { normalizeRoleKey, parseCanonicalRole } from "../lib/auth/role-contract";

type TestCase = {
  id: number;
  prompt: string;
  page?: string;
  route?: string;
  expectedTools?: string[];
  forbiddenTools?: string[];
  expectNoTools?: boolean;
  expectedAnswerIncludes?: string[];
};

type TestRun = {
  id: number;
  prompt: string;
  expectedTools: string[];
  forbiddenTools: string[];
  tools: string[];
  missingTools: string[];
  forbiddenToolsUsed: string[];
  toolsOk: boolean;
  answerIncludesOk: boolean;
  expectedAnswerIncludes: string[];
  intent: string;
  answerSource: string;
  grounded: boolean;
  answerPreview: string;
  durationMs: number;
  toolDurationsMs: Array<{ tool: string; durationMs: number }>;
};

const DEFAULT_PAGE = "dashboard";
const DEFAULT_ROUTE = "/dashboard";
const DEFAULT_SEASON = "2026";

const CASES: TestCase[] = [
  {
    id: 1,
    prompt: "Сколько всего полей?",
    expectedTools: ["get_field_land_bank_summary"],
    forbiddenTools: ["search_fields", "get_fields"],
  },
  {
    id: 2,
    prompt: "Сколько всего гектар у компании?",
    expectedTools: ["get_field_land_bank_summary"],
    forbiddenTools: ["search_fields", "get_fields"],
  },
  {
    id: 3,
    prompt: "Сколько всего гектар у компании и сколько картофеля?",
    expectedTools: ["get_field_land_bank_summary", "get_crop_structure_summary"],
    forbiddenTools: ["search_fields", "get_fields"],
  },
  {
    id: 4,
    prompt: "Что такое фитофтора?",
    expectNoTools: true,
  },
  {
    id: 5,
    prompt: "Как работает весовая?",
    expectNoTools: true,
  },
  {
    id: 6,
    prompt: "Как организовать выдачу термосов?",
    expectNoTools: true,
  },
  {
    id: 7,
    prompt: "Что такое репродукция семян?",
    expectNoTools: true,
  },
  {
    id: 8,
    prompt: "Что такое партия?",
    expectNoTools: true,
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

async function resolveLandBankExpectation(supabase: ReturnType<typeof getServiceClient>, companyId: string): Promise<{
  totalFields: number;
  totalAreaHa: number;
}> {
  const { data, error } = await supabase
    .from("fields")
    .select("id,area")
    .eq("company_id", companyId)
    .eq("archived", false)
    .limit(5000);
  if (error) throw new Error(`failed to read fields expectation: ${error.message}`);
  const rows = data || [];
  return {
    totalFields: rows.length,
    totalAreaHa: Number(rows.reduce((sum, row: any) => sum + Number(row.area || 0), 0).toFixed(3)),
  };
}

function percentile95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function answerIncludesExpected(answer: string, expected: string): boolean {
  if (/^\d+$/.test(expected)) {
    return answer.replace(/\D/g, "").includes(expected);
  }
  return answer.includes(expected);
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
  const landBank = await resolveLandBankExpectation(supabase, actor.companyId);
  const settings = await getAssistantPlatformSettings(supabase, actor.id);
  const expectedAreaText = String(Math.round(landBank.totalAreaHa));
  const expectedFieldText = String(landBank.totalFields);

  const runs: TestRun[] = [];
  const toolLatency: Record<string, number[]> = {};

  for (const test of CASES) {
    const expectedAnswerIncludes = [
      ...(test.expectedAnswerIncludes || []),
      ...(test.id === 1 ? [expectedFieldText] : []),
      ...(test.id === 2 || test.id === 3 ? [expectedAreaText] : []),
    ];
    const started = Date.now();
    const result = await runAssistantEngine({
      supabase,
      actor,
      companyId: actor.companyId,
      settings: { ...settings, enabled: true },
      input: {
        message: test.prompt,
        locale: "ru",
        runtimeContext: {
          currentPage: test.page || DEFAULT_PAGE,
          currentRoute: test.route || DEFAULT_ROUTE,
          currentModule: test.page || DEFAULT_PAGE,
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
        sessionState: {
          lastSeason: DEFAULT_SEASON,
        },
        chatHistory: [],
      },
    });

    const tools = (result.toolCalls || []).map((tool) => String(tool.tool));
    const expectedTools = test.expectNoTools ? [] : test.expectedTools || [];
    const forbiddenTools = test.forbiddenTools || [];
    const missingTools = expectedTools.filter((tool) => !tools.includes(tool));
    const forbiddenToolsUsed = forbiddenTools.filter((tool) => tools.includes(tool));
    const toolDurationsMs = (result.toolCalls || [])
      .filter((tool) => typeof tool.durationMs === "number")
      .map((tool) => ({ tool: tool.tool, durationMs: Number(tool.durationMs) }));

    toolDurationsMs.forEach((item) => {
      toolLatency[item.tool] ||= [];
      toolLatency[item.tool].push(item.durationMs);
    });

    const answer = clean(result.answer);
    const answerIncludesOk = expectedAnswerIncludes.every((part) => answerIncludesExpected(answer, part));
    const toolsOk = test.expectNoTools
      ? tools.length === 0
      : missingTools.length === 0 && forbiddenToolsUsed.length === 0;

    runs.push({
      id: test.id,
      prompt: test.prompt,
      expectedTools,
      forbiddenTools,
      tools,
      missingTools,
      forbiddenToolsUsed,
      toolsOk,
      answerIncludesOk,
      expectedAnswerIncludes,
      intent: result.intent.name,
      answerSource: result.answerSource,
      grounded: result.grounded,
      answerPreview: answer.slice(0, 320),
      durationMs: Date.now() - started,
      toolDurationsMs,
    });
  }

  const toolPerformance = Object.entries(toolLatency)
    .map(([tool, values]) => ({
      tool,
      count: values.length,
      avgMs: average(values),
      p95Ms: percentile95(values),
      maxMs: values.length ? Math.max(...values) : null,
    }))
    .sort((a, b) => a.tool.localeCompare(b.tool));

  const summary = {
    generatedAt: new Date().toISOString(),
    actor: {
      id: actor.id,
      email: actor.email,
      role: actor.role,
      companyId: actor.companyId,
      companyName,
    },
    expectations: {
      landBankSource: "fields where company_id=current and archived=false",
      totalFields: landBank.totalFields,
      totalAreaHa: landBank.totalAreaHa,
    },
    totals: {
      prompts: runs.length,
      passed: runs.filter((run) => run.toolsOk && run.answerIncludesOk).length,
      failed: runs.filter((run) => !run.toolsOk || !run.answerIncludesOk).length,
    },
    toolPerformance,
    runs,
  };

  const outputDir = path.join(process.cwd(), "scripts", "output");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `qa-copilot-step5-source-of-truth-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Saved: ${outputPath}`);
  console.table(
    runs.map((run) => ({
      id: run.id,
      prompt: run.prompt.slice(0, 42),
      intent: run.intent,
      tools: run.tools.join(", "),
      toolsOk: run.toolsOk ? "OK" : "FAIL",
      answerOk: run.answerIncludesOk ? "OK" : "FAIL",
      source: run.answerSource,
      ms: run.durationMs,
    }))
  );
  console.table(toolPerformance);

  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("qa-copilot-step5-source-of-truth failed:", error);
  process.exit(1);
});
