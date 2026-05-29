import fs from "node:fs/promises";
import path from "node:path";
import { getServiceClient } from "@/lib/supabase/service";
import { getAssistantPlatformSettings } from "@/lib/assistant/settings-store";
import { runAssistantEngine } from "@/lib/assistant/engine/query";
import type { ServerActorContext } from "@/lib/auth/server-session";
import { normalizeRoleKey, parseCanonicalRole } from "@/lib/auth/role-contract";

type TestCase = {
  id: number;
  prompt: string;
  page?: string;
  route?: string;
  expectedIntent: string[];
  expectNavigation?: boolean;
};

type TestRun = {
  id: number;
  prompt: string;
  page: string;
  route: string;
  expectedIntent: string[];
  intent: string;
  intentOk: boolean;
  mode: string;
  grounded: boolean;
  source: string;
  toolCalls: Array<{ tool: string; ok: boolean; rows: number; error: string | null }>;
  rowsTotal: number;
  navigationActionsCount: number;
  navigationActionTypes: string[];
  navigationOk: boolean;
  answerPreview: string;
  durationMs: number;
};

const DEFAULT_PAGE = "dashboard";
const DEFAULT_ROUTE = "/dashboard";
const DEFAULT_SEASON = "2026";

const CASES: TestCase[] = [
  { id: 1, prompt: "Сколько складов?", expectedIntent: ["warehouse_count"] },
  { id: 2, prompt: "Покажи склады", expectedIntent: ["warehouse_count", "navigation_help"] },
  { id: 3, prompt: "Какие есть поля?", expectedIntent: ["fields_overview"] },
  { id: 4, prompt: "Сколько полей?", expectedIntent: ["fields_overview", "field_total_area"] },
  { id: 5, prompt: "Что на поле 28?", expectedIntent: ["fields_overview", "rotation_history"] },
  { id: 6, prompt: "Сколько картофеля?", page: "crop-structure", route: "/crop-structure", expectedIntent: ["crop_structure_area"] },
  { id: 7, prompt: "Сколько моркови?", page: "crop-structure", route: "/crop-structure", expectedIntent: ["crop_structure_area"] },
  { id: 8, prompt: "Какие активные талоны?", expectedIntent: ["weighbridge_tickets"] },
  { id: 9, prompt: "Сколько талонов сегодня?", expectedIntent: ["weighbridge_tickets"] },
  { id: 10, prompt: "Открой весовую", expectedIntent: ["navigation_help"], expectNavigation: true },
  { id: 11, prompt: "Открой поле 28", expectedIntent: ["navigation_help"], expectNavigation: true },
  { id: 12, prompt: "Открой овощной склад", expectedIntent: ["navigation_help"], expectNavigation: true },
];

function clean(value: unknown): string {
  return String(value ?? "").trim();
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
  const { data, error } = await supabase.from("companies").select("name").eq("id", companyId).limit(1).maybeSingle();
  if (error) return "Unknown Company";
  return clean(data?.name) || "Unknown Company";
}

async function main() {
  const supabase = getServiceClient();

  const profileRes = await supabase.from("profiles").select("*").limit(5000);
  if (profileRes.error || !Array.isArray(profileRes.data)) {
    throw new Error(`failed to read profiles: ${profileRes.error?.message || "unknown error"}`);
  }

  const actor = makeActor(pickActor(profileRes.data as Array<Record<string, unknown>>));
  if (!actor.companyId) throw new Error("selected actor has no company_id");

  const companyName = await resolveCompanyName(supabase, actor.companyId);
  const settings = await getAssistantPlatformSettings(supabase, actor.id);

  const runs: TestRun[] = [];
  for (const test of CASES) {
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

    const toolCalls = (result.toolCalls || []).map((tool) => ({
      tool: tool.tool,
      ok: !!tool.ok,
      rows: Number(tool.rows || 0),
      error: tool.error || null,
    }));
    const rowsTotal = toolCalls.reduce((sum, call) => sum + call.rows, 0);
    const navigationActions = result.navigationActions || [];
    const navigationActionTypes = navigationActions.map((action) => action.type);
    const intent = result.intent.name;
    const intentOk = test.expectedIntent.includes(intent);
    const navigationOk = test.expectNavigation ? navigationActions.length > 0 : true;

    runs.push({
      id: test.id,
      prompt: test.prompt,
      page: test.page || DEFAULT_PAGE,
      route: test.route || DEFAULT_ROUTE,
      expectedIntent: test.expectedIntent,
      intent,
      intentOk,
      mode: result.mode,
      grounded: result.grounded,
      source: result.answerSource,
      toolCalls,
      rowsTotal,
      navigationActionsCount: navigationActions.length,
      navigationActionTypes,
      navigationOk,
      answerPreview: clean(result.answer).slice(0, 320),
      durationMs: Date.now() - started,
    });
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
      prompts: runs.length,
      intentPassed: runs.filter((run) => run.intentOk).length,
      intentFailed: runs.filter((run) => !run.intentOk).length,
      navigationPassed: runs.filter((run) => run.navigationOk).length,
      navigationFailed: runs.filter((run) => !run.navigationOk).length,
      toolErrors: runs.reduce((sum, run) => sum + run.toolCalls.filter((tool) => !tool.ok).length, 0),
    },
    runs,
  };

  const outputDir = path.join(process.cwd(), "scripts", "output");
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `qa-assistant-copilot-full-check-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const outputPath = path.join(outputDir, fileName);
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Saved: ${outputPath}`);
  console.table(
    runs.map((run) => ({
      id: run.id,
      prompt: run.prompt.slice(0, 32),
      intent: run.intent,
      intentOk: run.intentOk ? "OK" : "FAIL",
      navActions: run.navigationActionsCount,
      navOk: run.navigationOk ? "OK" : "FAIL",
      rows: run.rowsTotal,
      source: run.source,
      ms: run.durationMs,
    }))
  );
  console.log("Totals:", summary.totals);
}

main().catch((error) => {
  console.error("qa-assistant-copilot-full-check failed:", error);
  process.exit(1);
});
