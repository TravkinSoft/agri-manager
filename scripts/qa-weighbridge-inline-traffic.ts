import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// This integration contract catches the original regression: the board existed
// and passed API tests, but its mount was removed from the working page.
const path = "app/(dashboard)/weighbridge/page.tsx";
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const elements: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
function attribute(node: (typeof elements)[number], name: string) {
  return node.attributes.properties.find((attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText(source) === name);
}
function one(predicate: (node: (typeof elements)[number]) => boolean, label: string) {
  const matches = elements.filter(predicate);
  assert.equal(matches.length, 1, `${label} must be mounted exactly once`);
  return matches[0];
}
const form = one(node => attribute(node, "id")?.initializer?.getText(source) === '"weighbridge-workspace-panel"', "working form");
const board = one(node => node.tagName.getText(source) === "ReadOnlyTrafficBoard", "inline PTC");
const history = one(node => node.tagName.getText(source) === "TicketHistoryPanel", "ticket history");
const statistics = one(node => node.tagName.getText(source) === "details" && attribute(node, "open")?.initializer?.getText(source) === "{statisticsOpen}", "statistics");
assert.ok(form.pos < board.pos && board.pos < history.pos && history.pos < statistics.pos, "form -> PTC -> history -> optional statistics");
console.log("PASS working page mounts form -> read-only PTC -> history -> statistics");
assert.equal(attribute(board, "enabled")?.initializer?.getText(source), "{coreDataReady && !operatorGateBlocked}");
assert.deepEqual(board.attributes.properties.map(attr => ts.isJsxAttribute(attr) ? attr.name.getText(source) : "spread"), ["enabled"]);
console.log("PASS PTC waits for the existing operator/form gate and receives no mutable form state");

const boardPath = "components/weighbridge/read-only-traffic-board.tsx";
const boardSource = ts.createSourceFile(boardPath, readFileSync(boardPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let cards = 0;
function visitBoard(node: ts.Node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText(boardSource);
    assert.ok(!["button", "Button", "a", "Link", "input", "select", "form"].includes(tag), `PTC has an interactive element: ${tag}`);
    for (const attr of node.attributes.properties) {
      if (ts.isJsxAttribute(attr)) assert.ok(!/^on[A-Z]/.test(attr.name.getText(boardSource)), "PTC has an interactive handler");
    }
    if (tag === "article") cards++;
  }
  ts.forEachChild(node, visitBoard);
}
visitBoard(boardSource);
assert.equal(cards, 1);
console.log("PASS PTC vehicle cards are articles with no controls or action handlers");
