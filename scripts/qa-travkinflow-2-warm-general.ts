import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Release-specific audit: compare this presentation change with its reviewed base.
// Pass a different base explicitly for a later design-only patch.
const base = process.argv[2] || "41419c8";
const candidate = process.argv[3]; // Pin the visual tranche when later functional work is integrated.
const root = process.cwd();
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
const excluded = /^(?:app\/api\/|app\/traffic-operator\/|app\/\(dashboard\)\/(?:weighbridge|warehouses|traffic|fleet|processing)\/|components\/(?:weighbridge|warehouses|traffic|layout|ui)\/|components\/vehicles\/vehicle-driver-assignment\.tsx$)/;
const scope = { test: (file: string) => /^(?:app|components)\//.test(file) && !excluded.test(file) && !file.endsWith("/layout.tsx") && !file.includes("theme-provider") };
const files = git("diff", "--name-only", base, ...(candidate ? [candidate] : []), "--").trim().split(/\r?\n/).filter(file => scope.test(file) && file.endsWith(".tsx"));
assert.ok(files.length > 0, "the audit must inspect changed general UI components");

const colorToken = /^(?:(?:\[[^\]]+\]|[\w[\]=.-]+):)*(?:bg|text|border|divide|ring(?:-offset)?|outline|from|to|via)-(?:slate|gray|neutral|zinc|stone|white|black|yellow|amber|red|rose|emerald|green|teal|blue|sky|cyan|purple|indigo|violet|orange|background|foreground|card|muted|primary|secondary|accent|border|ring)(?:[-/\w.[\]]*)$/;
const literalColor = /^(?:(?:\[[^\]]+\]|[\w[\]=.-]+):)*(?:bg|text|border|ring(?:-offset)?|outline|from|to|via)-\[#[\da-fA-F]+\](?:\/[\d.]+)?$/;
const normalizeImportant = (token: string) => token.replace(/(^|:)!(?=(?:bg|text|border|divide|ring|outline|from|to|via)-)/g, "$1");
const presentationToken = (token: string) => colorToken.test(normalizeImportant(token)) || literalColor.test(normalizeImportant(token)) ||
  /^(?:shadow-(?:sm|\[[^\]]+\])|tf-manor-(?:heading|data)|tabular-nums|opacity-(?:70|90))$/.test(token);
const withoutPalette = (value: string) => value.split(/\s+/).filter(token => token && !presentationToken(token)).join(" ");
const literal = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
let paletteChanges = 0;

for (const file of files) {
  const beforeText = git("show", `${base}:${file}`).replace(/\r\n/g, "\n");
  const afterText = (candidate ? git("show", `${candidate}:${file}`) : readFileSync(path.join(root, file), "utf8")).replace(/\r\n/g, "\n");
  const before = ts.createSourceFile(file, beforeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const after = ts.createSourceFile(file, afterText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const compare = (left: ts.Node, right: ts.Node): void => {
    assert.equal(right.kind, left.kind, `${file}: AST node kind must not change`);
    if (literal(left) && literal(right)) {
      if (left.text !== right.text) {
        const themeColor = file === "app/traffic-operator/layout.tsx" &&
          ts.isPropertyAssignment(left.parent) && left.parent.name.getText(before) === "themeColor" &&
          left.text === "#0c1118" && right.text === "#f7f1e7";
        assert.ok(themeColor || withoutPalette(left.text) === withoutPalette(right.text),
          `${file}: non-palette string changed: ${JSON.stringify(left.text)} → ${JSON.stringify(right.text)}`);
        paletteChanges += 1;
      }
      return;
    }
    const oldChildren: ts.Node[] = [];
    const newChildren: ts.Node[] = [];
    ts.forEachChild(left, child => { oldChildren.push(child); });
    ts.forEachChild(right, child => { newChildren.push(child); });
    assert.equal(newChildren.length, oldChildren.length, `${file}: AST child count must not change`);
    if (!oldChildren.length) assert.equal(right.getText(after), left.getText(before), `${file}: non-presentation token must not change`);
    oldChildren.forEach((child, index) => compare(child, newChildren[index]));
  };
  compare(before, after);
  assert.doesNotMatch(afterText, /\bbg-(?:slate|gray|zinc|neutral)-(?:800|900|950)\b|\bbg-\[#(?:0c1118|0f172a|0f1218|101724|141a23)\]/,
    `${file}: operational panels must not retain a hard-coded dark canvas`);
  console.log(`PASS presentation-only AST ${file}`);
}


console.log(`WARM GENERAL: ${files.length} AST-equivalent components, ${paletteChanges} palette changes PASS`);
