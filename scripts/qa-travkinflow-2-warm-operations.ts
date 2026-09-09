import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Release-specific audit: compare this presentation change with its reviewed base.
// Pass a different base explicitly for a later design-only patch.
const base = process.argv[2] || "31eab7e99cafeee03e9bbe8cb5ee6876801925cc";
const root = process.cwd();
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const scope = /^(?:app\/\(dashboard\)\/(?:weighbridge|warehouses|traffic|fleet|processing)\/|app\/traffic-operator\/|components\/(?:weighbridge|warehouses|traffic)\/|components\/vehicles\/vehicle-driver-assignment\.tsx$)/;
const files = git("diff", "--name-only", base, "--").trim().split(/\r?\n/).filter(file => scope.test(file) && file.endsWith(".tsx"));
assert.ok(files.length > 0, "the audit must inspect changed operational components");

const colorToken = /^(?:(?:[\w[\]=.-]+):)*(?:bg|text|border|divide|ring|outline|from|to|via)-(?:slate|gray|neutral|zinc|stone|white|black|yellow|amber|red|rose|emerald|green|teal|blue|sky|cyan|purple|indigo|background|foreground|card|muted|primary|secondary|accent|border|ring)(?:[-/\w.[\]]*)$/;
const literalColor = /^(?:(?:[\w[\]=.-]+):)*(?:bg|text|border|from|to|via)-\[#[\da-fA-F]+\](?:\/[\d.]+)?$/;
const presentationToken = (token: string) => colorToken.test(token) || literalColor.test(token) ||
  /^(?:shadow-(?:sm|\[[^\]]+\])|tf-manor-(?:heading|data)|tabular-nums|opacity-(?:70|90))$/.test(token);
const withoutPalette = (value: string) => value.split(/\s+/).filter(token => token && !presentationToken(token)).join(" ");
const literal = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
let paletteChanges = 0;

for (const file of files) {
  const beforeText = git("show", `${base}:${file}`).replace(/\r\n/g, "\n");
  const afterText = readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
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

const board = readFileSync(path.join(root, "components/traffic/traffic-board.tsx"), "utf8");
assert.match(board, /loaded: "border-emerald-400\/50 bg-emerald-50 text-emerald-800"/);
assert.match(board, /unloading: "border-amber-300\/55 bg-amber-50 text-amber-800"/);
assert.match(board, /border-rose-400\/55 bg-rose-50 text-rose-800/);
assert.match(board, /border-sky-400\/45 bg-sky-50 text-sky-800/);
assert.match(board, /swipeReady \? "bg-emerald-800" : "bg-emerald-700"/);
assert.match(board, /border-primary bg-primary text-primary-foreground/);
const page = readFileSync(path.join(root, "app/(dashboard)/weighbridge/page.tsx"), "utf8");
for (const mode of ["harvest_incoming", "supplier_receipt", "issue_to_field", "transfer_between_warehouses", "shipment_outbound", "disposal_writeoff", "impurity_removal"]) {
  assert.ok(page.includes(`type: "${mode}"`), `${mode} must remain available`);
}
assert.equal(readFileSync(path.join(root, "components/weighbridge/weighbridge-ticket-paper.tsx"), "utf8").replace(/\r\n/g, "\n"),
  git("show", `${base}:components/weighbridge/weighbridge-ticket-paper.tsx`).replace(/\r\n/g, "\n"), "paper ticket must remain byte-identical after line-ending normalization");
const manifest = JSON.parse(readFileSync(path.join(root, "public/traffic-operator.webmanifest"), "utf8"));
const oldManifest = JSON.parse(git("show", `${base}:public/traffic-operator.webmanifest`));
assert.equal(manifest.theme_color, "#f7f1e7");
assert.equal(manifest.background_color, "#f7f1e7");
assert.deepEqual({ ...manifest, theme_color: oldManifest.theme_color, background_color: oldManifest.background_color }, oldManifest,
  "PWA identity, start URL, scope and icons must stay unchanged");
console.log(`WARM OPERATIONS: ${files.length} AST-equivalent components, ${paletteChanges} palette/typography changes, 17 presentation guards PASS`);
