import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessPath } from "../lib/auth/role-access";
import { canUseAssistantShell } from "../lib/assistant/shell";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let checks = 0;

function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
}

const nonGlobalRoles = [
  "company_admin",
  "agronomist",
  "director",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "specialist",
  "fuel_operator",
  "brigadier",
  "legal_operator",
] as const;

const dashboardLayout = read("components/layout/dashboard-layout.tsx");
const mobileNav = read("components/layout/mobile-bottom-nav.tsx");
const notificationCenter = read("components/notifications/notification-center.tsx");
const notificationsPage = read("app/(dashboard)/notifications/page.tsx");
const homePage = read("app/page.tsx");
const demoPage = read("app/demo/page.tsx");
const serverSession = read("lib/auth/server-session.ts");
const knowledgeRoute = read("app/api/assistant/knowledge/route.ts");
const settingsRoute = read("app/api/assistant/settings/route.ts");
const settingsStore = read("lib/assistant/settings-store.ts");
const settingsTypes = read("lib/assistant/settings-types.ts");
const settingsForm = read("components/assistant/assistant-platform-settings-form.tsx");

check("client shell is enabled only for global_admin", () => {
  assert.equal(canUseAssistantShell("global_admin"), true);
  for (const role of nonGlobalRoles) assert.equal(canUseAssistantShell(role), false, role);
  assert.equal(canUseAssistantShell(null), false);
});

check("shared server guard allows only global_admin", () => {
  const roleSet = serverSession.match(/const ASSISTANT_ALLOWED_ROLES[\s\S]*?\]\);/)?.[0] || "";
  assert.match(roleSet, /"global_admin"/);
  for (const role of nonGlobalRoles) assert.doesNotMatch(roleSet, new RegExp(`"${role}"`));
});

check("all operational assistant routes use the shared fail-closed guard", () => {
  for (const path of [
    "app/api/assistant/route.ts",
    "app/api/assistant/query/route.ts",
    "app/api/assistant/context/route.ts",
    "app/api/assistant/proactive/route.ts",
    "app/api/assistant/transcribe/route.ts",
    "app/api/assistant/memory/route.ts",
    "app/api/assistant/threads/route.ts",
    "app/api/assistant/threads/[threadId]/messages/route.ts",
    "app/api/operations/confirm-draft/route.ts",
  ]) {
    assert.match(read(path), /ensureAssistantRole\(actor\)/, path);
  }
});

check("knowledge and settings endpoints are global_admin only", () => {
  assert.match(knowledgeRoute, /if \(role !== "global_admin"\)/);
  assert.doesNotMatch(knowledgeRoute, /role !== "company_admin"/);
  assert.match(settingsRoute, /if \(role !== "global_admin"\)/);
});

check("desktop shell cannot render Copilot for non-global roles", () => {
  assert.match(dashboardLayout, /assistantEnabled = canUseAssistantShell\(profile\?\.role\)/);
  assert.match(dashboardLayout, /assistantEnabled \? <AssistantLauncher \/>/);
  assert.match(dashboardLayout, /assistantEnabled \? <AssistantPanel \/>/);
});

check("mobile navigation has no Copilot entry point", () => {
  assert.doesNotMatch(mobileNav, /COPILOT_ITEM|mobile-nav-copilot|canUseAssistantShell|kind: "copilot"/);
});

check("non-global notification views hide assistant events", () => {
  for (const source of [notificationCenter, notificationsPage]) {
    assert.match(source, /role[^\n]*!== "global_admin"[\s\S]*?\.neq\("category", "assistant"\)/);
  }
  assert.match(notificationCenter, /String\(role \|\| ""\) !== "global_admin"\) return/);
});

check("legacy specialist routes remain unreachable to non-global roles", () => {
  assert.equal(canAccessPath("global_admin", "/specialist"), true);
  for (const role of nonGlobalRoles) assert.equal(canAccessPath(role, "/specialist"), false, role);
});

check("public landing and demo expose no Copilot entry point", () => {
  assert.doesNotMatch(homePage, /Copilot|AI Copilot|Travkin Copilot/);
  assert.doesNotMatch(demoPage, /Copilot|AI Copilot|Travkin Copilot|id: "copilot"/);
});

check("platform settings persist the owner global_admin-only policy", () => {
  assert.match(settingsTypes, /allowedRoles:\s*\[\s*"global_admin",?\s*\]/);
  assert.match(settingsStore, /return \["global_admin"\]/);
  assert.match(settingsRoute, /return \["global_admin"\]/);
  assert.match(settingsForm, /Политика владельца: Travkin Copilot доступен только global_admin/);
  assert.doesNotMatch(settingsForm.match(/const ROLE_OPTIONS[\s\S]*?\] as const;/)?.[0] || "", /company_admin|agronomist|weighman/);
});

console.log(`COPILOT GLOBAL ADMIN ONLY PASS: ${checks}/${checks}`);
