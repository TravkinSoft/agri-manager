import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const header = read("components/layout/header.tsx");
const layout = read("components/layout/dashboard-layout.tsx");
const logo = read("components/layout/travkin-logo.tsx");
const sidebar = read("components/layout/sidebar.tsx");
const login = read("app/auth/login/page.tsx");
const platformLayout = read("components/layout/platform-layout.tsx");

const checks: Array<[string, () => void]> = [
  ["desktop company switcher has no duplicated trailing company name", () => {
    const switcher = header.slice(header.indexOf("{isGlobal ? ("), header.indexOf("{canUseUserSwitcher"));
    assert.match(switcher, /<Select value=\{selectedCompanyId\}/);
    assert.doesNotMatch(switcher, /\{activeCompanyName \?/);
  }],
  ["mobile header still exposes the active company context", () => {
    assert.match(header, /activeCompanyName \|\| \(isGlobal \? t\("platform_mode"\)/);
  }],
  ["impersonation state is a compact persistent header control", () => {
    assert.match(header, /\{isImpersonating \? \(/);
    assert.match(header, /handleSwitchUser\("__admin__"\)/);
    assert.match(header, /return_to_global_admin/);
    assert.match(header, /aria-label=\{`\$\{t\("impersonation_as"\)/);
  }],
  ["the heavy impersonation banner and duplicate stop flow are removed", () => {
    assert.doesNotMatch(layout, /bg-amber-900\/40/);
    assert.doesNotMatch(layout, /stopImpersonation|stoppingImpersonation/);
    assert.doesNotMatch(layout, /global-admin\/impersonation/);
  }],
  ["canonical DELETE impersonation flow remains in the header", () => {
    const switchUser = header.slice(header.indexOf("const handleSwitchUser"), header.indexOf("return (", header.indexOf("const handleSwitchUser")));
    assert.match(switchUser, /method: "DELETE"/);
    assert.match(switchUser, /await refreshProfile\(\)/);
    assert.match(switchUser, /router\.replace\("\/platform"\)/);
  }],
  ["logo tilt is opt-in and scoped to the sidebar mark", () => {
    assert.match(logo, /tiltMark = false/);
    assert.match(logo, /tiltMark && "-rotate-\[32deg\] scale-\[0\.9\] transform-gpu"/);
    assert.match(sidebar, /<TravkinLogo compact=\{isCollapsed\} tiltMark \/>/);
    assert.doesNotMatch(header, /<TravkinLogo[^>]*tiltMark/);
    assert.doesNotMatch(login, /<TravkinLogo[^>]*tiltMark/);
    assert.doesNotMatch(platformLayout, /<TravkinLogo[^>]*tiltMark/);
  }],
];

for (const [name, run] of checks) {
  run();
  console.log(`PASS ${name}`);
}

console.log(`TRAVKINFLOW 2 SHELL: ${checks.length}/${checks.length} PASS`);
