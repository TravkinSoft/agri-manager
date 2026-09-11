import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
let checks = 0;

function check(label, assertion) {
  assertion();
  checks += 1;
  process.stdout.write(`PASS ${label}\n`);
}

function luminance(hex) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const globals = read("app/globals.css");
const rootLayout = read("app/layout.tsx");
const dashboardLayout = read("components/layout/dashboard-layout.tsx");
const header = read("components/layout/header.tsx");
const sidebar = read("components/layout/sidebar.tsx");
const mobileNav = read("components/layout/mobile-bottom-nav.tsx");
const assistantLauncher = read("components/assistant/assistant-launcher.tsx");
const assistantPanel = read("components/assistant/assistant-panel.tsx");
const trafficOperator = read("app/traffic-operator/page.tsx");
const pageHeader = read("components/layout/page-header.tsx");
const platformLayout = read("components/layout/platform-layout.tsx");
const logo = read("components/layout/travkin-logo.tsx");
const glass = read("components/ui/glass.tsx");
const tailwind = read("tailwind.config.ts");
const manifest = JSON.parse(read("public/manifest.webmanifest"));

check("deterministic estate-register root theme with legacy component aliases", () => {
  assert.match(rootLayout, /<html lang="ru" data-theme="estate-register">/);
  assert.match(rootLayout, /tf-manor/);
  assert.doesNotMatch(rootLayout, /ThemeProvider|suppressHydrationWarning/);
});

check("global PWA chrome follows the approved muted paper and charcoal", () => {
  assert.match(rootLayout, /themeColor: '#292c26'/);
  assert.equal(manifest.background_color, "#d2cfc5");
  assert.equal(manifest.theme_color, "#292c26");
});

check("semantic palette and legacy aliases are complete", () => {
  for (const token of [
    "--background:",
    "--foreground:",
    "--card:",
    "--popover:",
    "--primary:",
    "--secondary:",
    "--muted:",
    "--accent:",
    "--destructive:",
    "--border:",
    "--input:",
    "--ring:",
    "--manor-ivory:",
    "--manor-paper:",
    "--manor-espresso:",
    "--manor-olive:",
    "--manor-brass:",
    "--travkin-bg:",
    "--travkin-card:",
  ]) {
    assert.ok(globals.includes(token), `missing ${token}`);
  }
  assert.match(globals, /color-scheme: light/);
});

check("core text and actions meet WCAG AA contrast", () => {
  const token = (name) => {
    const match = globals.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(match, `real CSS token ${name}`);
    return match[1];
  };
  for (const background of ["manor-ivory", "manor-paper", "manor-paper-raised"]) {
    assert.ok(contrast(token("manor-walnut"), token(background)) >= 4.5);
    assert.ok(contrast(token("manor-text-muted"), token(background)) >= 4.5);
  }
  assert.ok(contrast(token("estate-shell-text"), token("manor-espresso")) >= 4.5);
  assert.ok(contrast(token("estate-shell-muted"), token("manor-espresso-soft")) >= 4.5);
  assert.match(globals, /--input: 72 5% 43%/);
  assert.ok(contrast("#717368", token("manor-paper")) >= 3, "input boundary is visible on muted paper");
  assert.doesNotMatch(globals, /\.assistant-surface \.border\s*,/, "generic border override must not erase semantic status borders");
});

check("shell surfaces use stable manor classes", () => {
  assert.match(dashboardLayout, /travkin-shell tf-manor-shell/);
  assert.match(dashboardLayout, /tf-manor-workspace/);
  assert.match(header, /tf-manor-topbar/);
  assert.match(sidebar, /tf-manor-sidebar/);
  assert.match(mobileNav, /tf-manor-topbar/);
  assert.match(platformLayout, /tf-manor-shell/);
});

check("headings are opt-in serif and data remains sans", () => {
  assert.match(globals, /\.tf-manor-heading\s*\{/);
  assert.match(globals, /\.tf-manor-data\s*\{/);
  assert.match(pageHeader, /tf-manor-heading/);
  assert.match(logo, /font-display/);
  assert.match(tailwind, /display: \['var\(--font-manor-display\)'\]/);
  assert.match(tailwind, /data: \['var\(--font-manor-data\)'\]/);
});

check("shared glass primitives no longer force dark neutral surfaces", () => {
  assert.match(glass, /tf-manor-panel/);
  assert.match(glass, /bg-card/);
  assert.match(glass, /tf-manor-data/);
  assert.doesNotMatch(glass, /bg-\[#111827\]|text-\[#F8FAFC\]|border-white\/10/);
});

check("status tones remain distinct from decorative brass", () => {
  assert.match(glass, /success: "border-emerald/);
  assert.match(glass, /warning: "border-amber/);
  assert.match(glass, /danger: "border-red/);
  assert.match(glass, /accent: "border-border/);
});

check("portalled primitives resolve root semantic surfaces", () => {
  const portalContracts = {
    "components/ui/dialog.tsx": /bg-(?:card|background)/,
    "components/ui/select.tsx": /bg-popover/,
    "components/ui/dropdown-menu.tsx": /bg-popover/,
    "components/ui/popover.tsx": /bg-popover/,
    "components/ui/sheet.tsx": /bg-(?:card|background)/,
    "components/ui/drawer.tsx": /bg-background/,
    "components/ui/alert-dialog.tsx": /bg-(?:card|background)/,
    "components/ui/toast.tsx": /bg-(?:card|background)/,
  };
  for (const [file, pattern] of Object.entries(portalContracts)) {
    assert.match(read(file), pattern, file);
  }
});

check("legacy neutral shim is scoped and state colors are not globally overridden", () => {
  assert.ok(globals.includes(':is([data-theme="estate-register"], [data-theme="warm-manor"]) .travkin-shell .bg-white'));
  assert.doesNotMatch(globals, /\[data-theme="warm-manor"\]\s+\.travkin-shell\s+\*/);
  assert.doesNotMatch(globals, /\.travkin-shell .*\.(?:bg|text)-(?:red|amber|emerald|green|yellow|blue)-/);
});

check("motion and touch contracts are bounded", () => {
  assert.match(globals, /transition-duration: 160ms/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(globals, /\.tf-manor :where\(button, \[role="button"\], input, select, \[role="combobox"\]\)/);
  assert.match(globals, /min-height: 44px/);
  assert.match(mobileNav, /min-h-12/);
});

check("notched screens and short landscape retain the mobile shell", () => {
  assert.match(globals, /max-width: 1023px\) and \(max-height: 600px\) and \(orientation: landscape\)/);
  assert.match(globals, /\.tf-desktop-sidebar[\s\S]*display: none !important/);
  assert.match(globals, /\.tf-mobile-bottom-nav[\s\S]*display: block !important/);
  assert.match(header, /safe-area-inset-top/);
  assert.match(header, /safe-area-inset-left/);
  assert.match(dashboardLayout, /safe-area-inset-right/);
  assert.match(mobileNav, /safe-area-inset-left/);
  assert.match(assistantLauncher, /safe-area-inset-right/);
  assert.match(assistantPanel, /Закрыть Travkin Copilot/);
  assert.match(trafficOperator, /safe-area-inset-left/);
  assert.match(trafficOperator, /safe-area-inset-right/);
});

check("desktop nested routes retain active navigation state", () => {
  assert.match(sidebar, /pathname === item\.href \|\| pathname\.startsWith\(`\$\{item\.href\}\/`\)/);
});

check("shell behavior and role routing imports remain intact", () => {
  assert.match(dashboardLayout, /canAccessPath/);
  assert.match(dashboardLayout, /getDefaultPathForRole/);
  assert.match(dashboardLayout, /AssistantShellProvider/);
  assert.match(header, /setGlobalAdminCompanyContext/);
  assert.match(header, /handleSwitchUser/);
  assert.match(mobileNav, /canAccessPath/);
  assert.match(platformLayout, /profile\.role !== "global_admin"/);
});

process.stdout.write(`Warm Manor shell QA: ${checks}/${checks} PASS\n`);
