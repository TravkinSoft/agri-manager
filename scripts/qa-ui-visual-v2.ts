import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let checks = 0;

function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function changedPaths(): string[] {
  const tracked = git(["diff", "--name-only", "origin/master", "--"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return Array.from(new Set(`${tracked}\n${untracked}`.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)));
}

function isAllowedVisualPath(path: string): boolean {
  const exact = new Set([
    ".env.example",
    "app/globals.css",
    "app/(dashboard)/dashboard/page.tsx",
    "app/(dashboard)/weather-lab/page.tsx",
    "components/dashboard/harvest-dashboard.tsx",
    "components/ui/matte-surface.tsx",
    "components/ui/visual-system-scope.tsx",
    "components/weather/weather-lab.tsx",
    "lib/ui/visual-system.ts",
    "package.json",
    "scripts/qa-ui-visual-v2.ts",
  ]);
  return exact.has(path) || path.startsWith("components/dashboard/visual-v2-") || path.startsWith("components/weather/visual-v2-");
}

function addedSourceLines(): Array<{ path: string; line: string }> {
  const diff = git(["diff", "origin/master", "--unified=0", "--", "."]);
  const rows: Array<{ path: string; line: string }> = [];
  let path = "";
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      path = line.slice(6);
      continue;
    }
    if (path && line.startsWith("+") && !line.startsWith("+++")) rows.push({ path, line: line.slice(1) });
  }
  return rows;
}

function directColorLiterals(value: string): string[] {
  return value.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)?.map((color) => color.toLowerCase()) || [];
}

function parseHex(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  assert.equal(normalized.length, 6, `Expected six-digit hex, received ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number];
}

function relativeLuminance(value: string): number {
  const channels = parseHex(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const [bright, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

function main() {
  const css = read("app/globals.css");
  const envExample = read(".env.example");
  const flags = read("lib/ui/visual-system.ts");
  const scope = read("components/ui/visual-system-scope.tsx");
  const mobileNav = read("components/layout/mobile-bottom-nav.tsx");
  const dashboard = read("components/dashboard/harvest-dashboard.tsx");
  const weather = read("components/weather/weather-lab.tsx");
  const paths = changedPaths();
  const added = addedSourceLines();

  const tokens: Record<string, string> = {
    "--tf-canvas-base": "#0f1115",
    "--tf-canvas-raised": "#121722",
    "--tf-surface-work": "#151b26",
    "--tf-surface-work-raised": "#1b2230",
    "--tf-surface-input": "#0d131c",
    "--tf-text-primary": "#f4f6f8",
    "--tf-text-secondary": "#b7c0cc",
    "--tf-text-muted": "#8d98a8",
    "--tf-accent-primary": "#e0b100",
    "--tf-accent-bright": "#f4cf36",
  };

  check("semantic token source contains the approved values", () => {
    for (const [token, value] of Object.entries(tokens)) assert.match(css, new RegExp(`${token}:\\s*${value}`, "i"));
    assert.match(css, /--tf-glass-chrome:\s*rgba\(17,\s*22,\s*33,\s*0\.84\)/i);
    assert.match(css, /--tf-glass-overlay:\s*rgba\(18,\s*24,\s*36,\s*0\.92\)/i);
  });

  check("essential token contrast passes on the raised work surface", () => {
    const surface = tokens["--tf-surface-work-raised"];
    assert.ok(contrast(tokens["--tf-text-primary"], surface) >= 7);
    assert.ok(contrast(tokens["--tf-text-secondary"], surface) >= 7);
    assert.ok(contrast(tokens["--tf-text-muted"], surface) >= 4.5);
    assert.ok(contrast(tokens["--tf-accent-primary"], surface) >= 7);
  });

  check("visual V2 is default-off and unknown modes fall back to off", () => {
    assert.match(envExample, /^NEXT_PUBLIC_TRAVKIN_VISUAL_V2=off$/m);
    assert.match(flags, /value === "pilot" \|\| value === "on" \? value : "off"/);
    assert.match(flags, /visualSystemConfig\.mode === "off"/);
  });

  check("weighbridge stays hard-protected regardless of allowlist", () => {
    assert.match(flags, /PROTECTED_SCOPES[^\n]+\["weighbridge"\]/);
    assert.match(flags, /PROTECTED_SCOPES\.has\(scope\)/);
  });

  check("V2 styles are namespaced and legacy has no visual override", () => {
    const tfSelectorLines = css.split(/\r?\n/).filter((line) => line.includes(".tf-"));
    assert.ok(tfSelectorLines.length > 10);
    assert.ok(tfSelectorLines.every((line) => line.includes('[data-visual-system="v2"]')));
    assert.doesNotMatch(css, /data-visual-system="legacy"/);
  });

  check("reduced-effects, no-backdrop fallback, and forced-colors contracts exist", () => {
    assert.match(css, /@supports \(\(backdrop-filter: blur\(1px\)\)/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /prefers-reduced-transparency: reduce/);
    assert.match(css, /@media \(forced-colors: active\)/);
    assert.match(scope, /"data-effects": enabled \? effects : "reduced"/);
  });

  check("glass blur exists only in the two chrome primitives", () => {
    assert.doesNotMatch(dashboard, /backdrop-(?:blur|filter)|backdropFilter/);
    assert.doesNotMatch(weather, /backdrop-(?:blur|filter)|backdropFilter/);
    assert.match(css, /\.tf-glass-chrome/);
    assert.match(css, /\.tf-glass-overlay/);
    assert.doesNotMatch(css, /\.tf-(?:work|input)[^{]*\{[^}]*backdrop-filter/s);
  });

  check("changed files stay inside the visual allowlist and outside protected paths", () => {
    const denied = paths.filter((path) =>
      /^(?:app\/(?:\(dashboard\)\/|api\/)?weighbridge|components\/weighbridge|lib\/(?:services\/weighbridge|weighbridge)|supabase\/migrations|scripts\/qa-tz315|docs\/project-live\/task-reports\/TZ-315|app\/\(dashboard\)\/crop-structure|components\/crop-structure|lib\/crop-structure)/.test(path)
    );
    assert.deepEqual(denied, []);
    assert.deepEqual(paths.filter((path) => !isAllowedVisualPath(path)), []);
  });

  check("new visual source uses tokens instead of direct color literals", () => {
    const exempt = new Set(["app/globals.css", ".env.example", "scripts/qa-ui-visual-v2.ts"]);
    const baselineByPath = new Map<string, string>();
    const violations = added.filter(({ path, line }) => {
      if (exempt.has(path)) return false;
      const colors = directColorLiterals(line);
      if (!colors.length) return false;
      if (!baselineByPath.has(path)) {
        try { baselineByPath.set(path, git(["show", `origin/master:${path}`]).toLowerCase()); }
        catch { baselineByPath.set(path, ""); }
      }
      const baseline = baselineByPath.get(path) || "";
      return colors.some((color) => !baseline.includes(color));
    });
    assert.deepEqual(violations, []);
  });

  check("new visual source has no unsupported slash-alpha utilities", () => {
    const violations = added.filter(({ line }) => /\/(?:8|14|15|18|28|32|46|65|72|84|92)(?!\d)/.test(line));
    assert.deepEqual(violations, []);
  });

  check("weather-page dock is the explicit visual reference, not an ordinary route menu", () => {
    assert.match(scope, /reference\?: "weather-mobile-dock"/);
    assert.match(mobileNav, /const isWeatherLab = pathname === "\/weather-lab"/);
    assert.match(mobileNav, /!isWeatherLab \|\| item\.kind !== "copilot"/);
    assert.match(mobileNav, /rounded-\[22px\][^\n]+backdrop-blur-xl/);
    assert.match(mobileNav, /isActivePath\(pathname, item\.href\)/);
    if (weather.includes("<VisualSystemScope")) assert.match(weather, /reference="weather-mobile-dock"/);
    if (dashboard.includes("<VisualSystemScope")) assert.doesNotMatch(dashboard, /reference="weather-mobile-dock"/);
  });

  check("harness is read-only and has no data or network client imports", () => {
    const self = read("scripts/qa-ui-visual-v2.ts");
    const imports = self.split(/\r?\n/).filter((line) => line.startsWith("import ")).join("\n");
    assert.doesNotMatch(imports, /supabase|axios|createClient/i);
    assert.doesNotMatch(self, /\bfetch\s*\(/i);
    for (const mutationApi of ["write" + "FileSync", "append" + "FileSync", "rm" + "Sync", "unlink" + "Sync"]) {
      assert.equal(self.includes(mutationApi), false, `Forbidden mutation API: ${mutationApi}`);
    }
  });

  console.log(`UI visual V2 acceptance: ${checks}/${checks} PASS`);
}

main();
