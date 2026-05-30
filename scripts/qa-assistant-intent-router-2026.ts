import fs from "node:fs/promises";
import path from "node:path";
import { getServiceClient } from "../lib/supabase/service";
import { getAssistantPlatformSettings } from "../lib/assistant/settings-store";
import { runAssistantEngine } from "../lib/assistant/engine/query";
import type { ServerActorContext } from "../lib/auth/server-session";
import { normalizeRoleKey, parseCanonicalRole } from "../lib/auth/role-contract";

type PromptCase = {
  id: number;
  prompt: string;
  page?: string;
  route?: string;
};

type PromptRunResult = {
  id: number;
  prompt: string;
  intent: string;
  mode: string;
  answerSource: string;
  grounded: boolean;
  toolCalls: Array<{
    tool: string;
    ok: boolean;
    rows: number;
    error: string | null;
  }>;
  rowsTotal: number;
  navigationActionsCount: number;
  answerPreview: string;
  durationMs: number;
  failed: boolean;
};

const DEFAULT_PAGE = "crop-structure";
const DEFAULT_ROUTE = "/crop-structure";
const DEFAULT_SEASON = "2026";

const TEST_MATRIX: PromptCase[] = [
  { id: 1, prompt: "Сколько посевных площадей?" },
  { id: 2, prompt: "Общая площадь полей?" },
  { id: 3, prompt: "Что по зерновым?" },
  { id: 4, prompt: "Сколько масличных?" },
  { id: 5, prompt: "Где Гала?" },
  { id: 6, prompt: "Картофель" },
  { id: 7, prompt: "Остатки картофеля" },
  { id: 8, prompt: "На складах есть картофель?" },
  { id: 9, prompt: "По овощному складу" },
  { id: 10, prompt: "Отрицательные остатки" },
  { id: 11, prompt: "Последние движения" },
  { id: 12, prompt: "Активные талоны", page: "weighbridge", route: "/weighbridge" },
  { id: 13, prompt: "Последние талоны", page: "weighbridge", route: "/weighbridge" },
  { id: 14, prompt: "Активные операции", page: "operations", route: "/operations" },
  { id: 15, prompt: "Что ждёт материалы?", page: "operations", route: "/operations" },
  { id: 16, prompt: "Сколько семян ушло?" },
  { id: 17, prompt: "Сколько диаммофоски?" },
  { id: 18, prompt: "Что такое фитофтора?" },
  { id: 19, prompt: "Что по картофелю и какие риски?" },
  { id: 20, prompt: "Открой весовую" },
];

function cleanText(value: unknown): string {
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
  const rawRole = cleanText(profile.role);
  const normalizedRoleKey = normalizeRoleKey(rawRole);
  const role =
    parseCanonicalRole(rawRole) ||
    parseCanonicalRole(normalizedRoleKey) ||
    parseCanonicalRole("global_admin") ||
    "global_admin";
  const profileId = cleanText(profile.id);
  const userId = cleanText(profile.user_id) || cleanText(profile.auth_user_id) || profileId;
  const companyId = cleanText(profile.company_id) || null;

  return {
    id: profileId,
    authUserId: userId,
    role,
    roleRawKey: normalizedRoleKey || rawRole,
    roleIsLegacyAlias: role !== normalizedRoleKey,
    companyId,
    homeCompanyId: companyId,
    contextCompanyId: companyId,
    status: cleanText(profile.status) || "active",
    email: cleanText(profile.email) || null,
    isImpersonating: false,
    impersonatedProfileId: null,
    impersonatedCompanyId: null,
    impersonatedByProfileId: null,
    impersonatedByAuthUserId: null,
  };
}

function pickActor(profiles: Array<Record<string, unknown>>): Record<string, unknown> {
  const normalized = profiles.filter((row) => cleanText(row.id));
  if (!normalized.length) {
    throw new Error("profiles table is empty: cannot run assistant matrix");
  }

  const byEmail = normalized.find((row) => cleanText(row.email).toLowerCase() === "aimbeks@gmail.com");
  if (byEmail) return byEmail;

  const activeGlobalAdmin = normalized.find(
    (row) => normalizeRoleKey(row.role) === "global_admin" && cleanText(row.status || "active").toLowerCase() === "active"
  );
  if (activeGlobalAdmin) return activeGlobalAdmin;

  const activeCompanyAdmin = normalized.find(
    (row) => normalizeRoleKey(row.role) === "company_admin" && cleanText(row.status || "active").toLowerCase() === "active"
  );
  if (activeCompanyAdmin) return activeCompanyAdmin;

  return normalized[0];
}

async function resolveCompanyName(
  supabase: ReturnType<typeof getServiceClient>,
  companyId: string | null
): Promise<string> {
  if (!companyId) return "Unknown Company";
  const { data, error } = await supabase.from("companies").select("name").eq("id", companyId).limit(1).maybeSingle();
  if (error) return "Unknown Company";
  return cleanText(data?.name) || "Unknown Company";
}

function looksFailed(result: PromptRunResult): boolean {
  if (result.intent === "clarification_required") return true;
  if (result.answerSource === "tool_error") return true;
  if (result.answerSource === "no_data" && result.rowsTotal <= 0) return true;
  return false;
}

async function main() {
  await loadEnvFromProjectFile();
  const supabase = getServiceClient();

  const profileRes = await supabase
    .from("profiles")
    .select("*")
    .limit(5000);

  if (profileRes.error || !Array.isArray(profileRes.data)) {
    throw new Error(`failed to read profiles: ${profileRes.error?.message || "unknown error"}`);
  }

  const selectedProfile = pickActor(profileRes.data as Array<Record<string, unknown>>);
  const actor = makeActor(selectedProfile);
  if (!actor.companyId) {
    throw new Error("selected actor has no company_id");
  }

  const companyName = await resolveCompanyName(supabase, actor.companyId);
  const settings = await getAssistantPlatformSettings(supabase, actor.id);
  const testSettings = {
    ...settings,
    enabled: true,
  };

  const runs: PromptRunResult[] = [];
  for (const item of TEST_MATRIX) {
    const started = Date.now();
    const result = await runAssistantEngine({
      supabase,
      actor,
      companyId: actor.companyId,
      settings: testSettings,
      input: {
        message: item.prompt,
        locale: "ru",
        runtimeContext: {
          currentPage: item.page || DEFAULT_PAGE,
          currentRoute: item.route || DEFAULT_ROUTE,
          season: null,
          companyId: actor.companyId,
          companyName,
          locale: "ru",
          entity: null,
          selectedRows: [],
          filters: {},
        },
        sessionState: {
          lastSeason: DEFAULT_SEASON,
        },
        chatHistory: [],
      },
    });

    const toolCalls = (result.toolCalls || []).map((tool) => ({
      tool: tool.tool,
      ok: !!tool.ok,
      rows: Number(tool.rows || 0),
      error: tool.error || null,
    }));
    const rowsTotal = toolCalls.reduce((sum, call) => sum + Number(call.rows || 0), 0);

    const row: PromptRunResult = {
      id: item.id,
      prompt: item.prompt,
      intent: result.intent.name,
      mode: result.mode,
      answerSource: result.answerSource,
      grounded: result.grounded,
      toolCalls,
      rowsTotal,
      navigationActionsCount: (result.navigationActions || []).length,
      answerPreview: cleanText(result.answer).slice(0, 280),
      durationMs: Date.now() - started,
      failed: false,
    };
    row.failed = looksFailed(row);
    runs.push(row);
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
    defaults: {
      season: DEFAULT_SEASON,
      allWarehousesWhenUnspecified: true,
    },
    totals: {
      prompts: runs.length,
      failed: runs.filter((x) => x.failed).length,
      succeeded: runs.filter((x) => !x.failed).length,
      clarificationRequired: runs.filter((x) => x.intent === "clarification_required").length,
      toolErrors: runs.filter((x) => x.answerSource === "tool_error").length,
      noData: runs.filter((x) => x.answerSource === "no_data").length,
      rowsTotal: runs.reduce((sum, x) => sum + x.rowsTotal, 0),
    },
    runs,
  };

  const outputDir = path.join(process.cwd(), "scripts", "output");
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `qa-assistant-intent-router-2026-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const outputPath = path.join(outputDir, fileName);
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Saved: ${outputPath}`);
  console.table(
    runs.map((r) => ({
      id: r.id,
      prompt: r.prompt.slice(0, 34),
      intent: r.intent,
      mode: r.mode,
      source: r.answerSource,
      rows: r.rowsTotal,
      failed: r.failed ? "YES" : "NO",
      ms: r.durationMs,
    }))
  );
  console.log("Totals:", summary.totals);
}

main().catch((error) => {
  console.error("qa-assistant-intent-router-2026 failed:", error);
  process.exit(1);
});
