import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import colors from "tailwindcss/colors";
import ts from "typescript";
import config from "../tailwind.config";

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
type Rgb = [number, number, number];
let passed = 0;
function check(name: string, test: () => void) {
  test(); passed += 1; console.log(`PASS ${name}`);
}
function source(file: string) {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function nodes<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node) => { if (guard(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root); return found;
}
function attr(node: Opening, name: string) {
  return node.attributes.properties.find((item): item is ts.JsxAttribute =>
    ts.isJsxAttribute(item) && item.name.getText() === name)?.initializer;
}
function textAttr(node: Opening, name: string) {
  const value = attr(node, name); return value && ts.isStringLiteral(value) ? value.text : null;
}
function expression(node: Opening, name: string) {
  const value = attr(node, name); return value && ts.isJsxExpression(value) ? value.expression?.getText() : null;
}
function opening(root: ts.SourceFile, name: string, value: string) {
  const found = nodes(root, (node): node is Opening => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    .filter((node) => textAttr(node, name) === value);
  assert.equal(found.length, 1, `one ACTIVE JSX control ${name}=${value}`); return found[0];
}
const hex = (value: string): Rgb => value.replace("#", "").match(/../gu)!.map((v) => parseInt(v, 16)) as Rgb;
const blend = (front: Rgb, back: Rgb, alpha: number): Rgb => front.map((v, i) => v * alpha + back[i] * (1 - alpha)) as Rgb;
function luminance(value: Rgb) {
  return value.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(front: Rgb, back: Rgb) {
  const values = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const globals = readFileSync("app/globals.css", "utf8");
function hslVariable(name: string): Rgb {
  const match = globals.match(new RegExp(`--${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`));
  assert.ok(match, `theme HSL ${name}`);
  const h = Number(match[1]) / 60, s = Number(match[2]) / 100, l = Number(match[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
  const sectors = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  return sectors[Math.floor(h) % 6].map((v) => (v + m) * 255) as Rgb;
}

async function main() {
  const notification = source("components/notifications/notification-center.tsx");
  const health = source("components/operations/system-health-badge.tsx");
  const map = source("components/fields-map/fields-map-page.tsx");
  const bell = opening(notification, "aria-label", "Уведомления");
  const badge = opening(health, "title", "Состояние системы");
  const filter = opening(map, "aria-label", "Фильтр культуры");
  const search = opening(map, "placeholder", "Найти поле...");
  const bellClass = textAttr(bell, "className")!;
  const badgeExpression = expression(badge, "className")!;
  const badgeClass = (error: string, warningCount: number, collapsed = false): string => vm.runInNewContext(
    badgeExpression, { error, payload: { warningCount }, collapsed, cn: (...args: string[]) => args.join(" ") });
  const classes = [bellClass, badgeClass("", 0), badgeClass("", 3), textAttr(filter, "className")!, textAttr(search, "className")!];
  const generated = await postcss([tailwindcss({ ...config, content: [{ raw: classes.join(" "), extension: "html" }] })])
    .process("@tailwind utilities;", { from: undefined });
  const colorRules: Array<{ selector: string; color: string }> = [];
  generated.root.walkRules((rule) => { rule.walkDecls("color", (decl) => { colorRules.push({ selector: rule.selector, color: decl.value }); }); });
  function shellColor(shell: string, suffix: string): Rgb {
    const rule = colorRules.find((item) => item.selector.startsWith(`.${shell} `) && item.selector.endsWith(suffix));
    assert.ok(rule, `Tailwind emitted scoped ${shell} ${suffix}`);
    assert.ok(/^rgb\(/u.test(rule.color), "compiled shell color is concrete RGB");
    return rule.color.match(/[\d.]+/gu)!.slice(0, 3).map(Number) as Rgb;
  }
  const espressoMatch = globals.match(/--manor-espresso:\s*(#[0-9a-f]{6})/iu);
  assert.ok(espressoMatch); const espresso = hex(espressoMatch[1]);
  const shellBackgrounds = [espresso, blend(hex("#b98939"), espresso, 0.08)];
  const bellInk = shellColor("tf-manor-topbar", "text-\\[\\#F8F0E2\\]");
  const warningInk = shellColor("tf-manor-sidebar", "text-amber-200");
  const successInk = shellColor("tf-manor-sidebar", "text-emerald-200");
  const lightWarningMatch = globals.match(/\]\) :is\(\.text-amber-800, \.text-amber-700\) \{\s*color:\s*(#[0-9a-f]{6})/iu);
  assert.ok(lightWarningMatch, "estate light-surface warning override");
  const lightWarningInk = hex(lightWarningMatch[1]);
  check("bell scoped palette compiles and exceeds 4.5:1 across espresso gradient", () => {
    for (const bg of shellBackgrounds) assert.ok(contrast(bellInk, bg) >= 4.5);
    assert.ok(bellClass.includes("text-foreground hover:bg-muted hover:text-foreground"), "light-surface base retained");
    assert.ok(bellClass.includes("[.tf-manor-topbar_&]:hover:bg-[#F8F0E2]/10"));
    assert.ok(bellClass.includes("[.tf-manor-topbar_&]:hover:text-white"));
  });
  check("both status meanings retain high contrast in sidebar and light contexts", () => {
    for (const bg of shellBackgrounds) {
      assert.ok(contrast(warningInk, blend(hex(colors.amber[500]), bg, 0.1)) >= 4.5);
      assert.ok(contrast(successInk, blend(hex(colors.emerald[500]), bg, 0.1)) >= 4.5);
    }
    const paper = hslVariable("background");
    assert.ok(contrast(lightWarningInk, blend(hex(colors.amber[500]), paper, 0.1)) >= 4.5);
    assert.ok(contrast(hex(colors.emerald[800]), blend(hex(colors.emerald[500]), paper, 0.1)) >= 4.5);
  });
  check("health status branches and collapsed state retain their original semantics", () => {
    assert.ok(badgeClass("", 0).includes("text-emerald-800 [.tf-manor-sidebar_&]:text-emerald-200"));
    assert.ok(badgeClass("", 3).includes("text-amber-800 [.tf-manor-sidebar_&]:text-amber-200"));
    assert.equal(badgeClass("offline", 0), badgeClass("", 3));
    assert.ok(badgeClass("", 0, true).includes("justify-center"));
    assert.ok(badgeClass("", 0).includes("gap-2"));
  });
  check("active map inputs use semantic light background and readable placeholder", () => {
    for (const control of [filter, search]) {
      const value = textAttr(control, "className")!;
      assert.ok(value.split(" ").includes("bg-background")); assert.ok(!value.includes("bg-black"));
    }
    assert.ok(contrast(hslVariable("muted-foreground"), hslVariable("background")) >= 4.5);
    assert.ok(contrast(hslVariable("foreground"), hslVariable("background")) >= 4.5);
  });
  check("map search and filter state guards and handlers remain wired", () => {
    assert.equal(expression(search, "disabled"), "Boolean(boundaryEdit)");
    assert.equal(expression(search, "value"), "fieldSearch");
    assert.ok(expression(search, "onChange")?.includes("setFieldSearch(event.target.value)"));
    assert.ok(expression(search, "onKeyDown")?.includes("runFieldSearch()"));
    const select = filter.parent.parent;
    assert.ok(ts.isJsxElement(select));
    assert.equal(expression(select.openingElement, "disabled"), "Boolean(boundaryEdit)");
    assert.equal(expression(select.openingElement, "onValueChange"), "setSelectedCrop");
  });
  check("notification bell and unread badge stay attached to the same popover", () => {
    assert.equal(textAttr(bell, "variant"), "ghost"); assert.equal(textAttr(bell, "title"), "Уведомления");
    const body = bell.parent.getText();
    assert.ok(body.includes("<Bell") && body.includes("unreadCount > 0") && body.includes('unreadCount > 99 ? "99+" : unreadCount'));
    const popovers = nodes(notification, ts.isJsxOpeningElement).filter((node) => node.tagName.getText() === "Popover");
    assert.equal(popovers.length, 1); assert.equal(expression(popovers[0], "open"), "open");
    assert.equal(expression(popovers[0], "onOpenChange"), "setOpen");
  });
  console.log(JSON.stringify({ result: "PASS", checks: passed, contrast: {
    bell: contrast(bellInk, espresso).toFixed(2),
    warning: contrast(warningInk, blend(hex(colors.amber[500]), espresso, 0.1)).toFixed(2),
    healthy: contrast(successInk, blend(hex(colors.emerald[500]), espresso, 0.1)).toFixed(2),
    mapPlaceholder: contrast(hslVariable("muted-foreground"), hslVariable("background")).toFixed(2),
  }, browser: "Separate immutable-deployment visual check required" }));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
