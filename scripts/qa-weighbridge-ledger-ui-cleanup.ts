import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const weighbridge = read("app/(dashboard)/weighbridge/page.tsx");
const workspaceTabs = read("components/weighbridge/universal-workspace-tabs.tsx");
const ledger = read("app/(dashboard)/ledger/page.tsx");

assert.doesNotMatch(weighbridge, /<header aria-label="Режим весовой"/);
assert.doesNotMatch(weighbridge, /Сменить операцию/);
assert.doesNotMatch(weighbridge, /aria-label="Операции весовой"/);
assert.match(weighbridge, /<UniversalWorkspaceTabs/);
assert.match(workspaceTabs, /aria-label="Добавить вкладку"/);

for (const label of [
  "Урожай с поля",
  "От контрагента",
  "Выдача в поле",
  "Перемещение",
  "Отгрузка",
  "Списание",
  "Примеси",
]) {
  assert.match(workspaceTabs, new RegExp(label));
}

assert.match(ledger, /row\.direction === "in" \? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"/);

console.log("WEIGHBRIDGE LEDGER UI CLEANUP: PASS");
