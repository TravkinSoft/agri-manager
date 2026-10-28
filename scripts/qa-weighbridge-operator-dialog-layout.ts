import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const page = readFileSync(path.join(process.cwd(), "app/(dashboard)/weighbridge/page.tsx"), "utf8");
const operatorDialog = page.slice(
  page.indexOf("open={operatorDialogVisible}"),
  page.indexOf("open={shiftDialogOpen}"),
);

assert.match(operatorDialog, /w-\[calc\(100vw-1rem\)\][\s\S]*?max-w-\[calc\(100vw-1rem\)\][\s\S]*?overflow-x-hidden/);
assert.match(operatorDialog, /<DialogFooter className="grid grid-cols-1 gap-2 sm:grid sm:grid-cols-1 sm:space-x-0">/);
assert.match(operatorDialog, /w-full min-w-0 whitespace-normal text-center[\s\S]*?href="\/dashboard"[\s\S]*?Выйти из Весовой/);
assert.match(operatorDialog, /w-full min-w-0 whitespace-normal text-center[\s\S]*?Выбрать и открыть смену/);

console.log("Weighbridge operator dialog narrow-screen layout PASS: 4/4");
