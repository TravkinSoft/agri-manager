import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const workspaces = read("components/weighbridge/universal-workspace-tabs.tsx");

const modesBlock = page.slice(page.indexOf("const WEIGHBRIDGE_MODES"), page.indexOf("const ticketStageLabel"));
assert.match(modesBlock, /description: string/);
assert.match(modesBlock, /steps: \[string, string, string\]/);
for (const label of ["Урожай с поля", "От контрагента", "Выдача в поле", "Перемещение", "Отгрузка", "Списание", "Примеси"]) {
  assert.match(modesBlock, new RegExp(label));
}

assert.match(page, /<header aria-label="Режим весовой"/);
assert.match(page, /activeWeighbridgeMode\.label/);
assert.match(page, /activeWeighbridgeMode\.description/);
assert.match(page, /aria-label="Этапы текущей операции"/);
assert.match(page, /activeWeighbridgeMode\.steps\.map/);
assert.match(page, /Сменить операцию/);
assert.doesNotMatch(page, /role="tablist"\s+aria-label="Режим весовой"/);

assert.match(workspaces, /role="tablist" aria-label="Открытые задачи Весовой"/);
assert.match(workspaces, /role="tab"/);
assert.match(workspaces, /aria-selected=\{selected\}/);
assert.match(workspaces, /tabIndex=\{selected \? 0 : -1\}/);
assert.match(workspaces, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/);
assert.match(workspaces, /scrollIntoView/);
assert.match(workspaces, /prefers-reduced-motion: reduce/);
assert.match(page, /role="tabpanel"/);
assert.match(page, /aria-labelledby=\{`weighbridge-workspace-tab-/);
assert.match(workspaces, /overflow-x-auto overflow-y-hidden/);
assert.match(workspaces, /min-w-\[11rem\]/);
assert.match(workspaces, /motion-reduce:transition-none/);
assert.doesNotMatch(workspaces, /grid-cols-2|md:grid-cols-3|xl:grid-cols-6/);

assert.match(page, /const terminalPanelClass = "rounded-xl border-0/);
assert.doesNotMatch(page, /CardHeader className="border-b border-slate-800\/80 px-4 py-3"/);
assert.match(page, /Других открытых талонов нет/);

console.log("TRAVKINFLOW 2 WEIGHBRIDGE INTERFACE: 32/32 PASS");
