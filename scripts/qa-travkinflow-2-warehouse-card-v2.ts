import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { warehousePositionCountLabel } from "../lib/warehouse/harvest-batch-selection";

const page = readFileSync(path.join(process.cwd(), "app/(dashboard)/warehouses/page.tsx"), "utf8");
const card = page.match(/const renderWarehouseCard = [\s\S]*?\n  };/)?.[0] || "";

assert.ok(card, "warehouse card renderer must remain discoverable");
assert.equal(warehousePositionCountLabel(0, 0), "0 позиций");
assert.equal(warehousePositionCountLabel(1, 1), "1 партия");
assert.equal(warehousePositionCountLabel(5, 4), "4 партии · 1 позиция материала");
assert.equal(warehousePositionCountLabel(5, 0), "5 позиций материалов");
assert.equal(warehousePositionCountLabel(22, 21), "21 партия · 1 позиция материала");
assert.equal(warehousePositionCountLabel(5, null), "5 позиций");
assert.equal(warehousePositionCountLabel(5, 6), "5 позиций");
assert.equal(warehousePositionCountLabel(5, 1.5), "5 позиций");

assert.doesNotMatch(card, /lastMovementAt|Движение:|Движений пока нет/);
assert.doesNotMatch(page, /Свободно|Движений пока нет/);
assert.doesNotMatch(card, /bg-gradient-to-br|shadow-\[/);
assert.match(card, /rounded-xl border bg-\[#141a23\]/);
assert.match(card, /"border-slate-800\/90"/);
assert.match(card, /motion-reduce:transition-none/);
assert.match(card, /motion-safe:animate-pulse/);
assert.match(card, /role=\{reorderable \? "listitem" : "button"\}/);
assert.match(card, /tabIndex=\{reorderable \? undefined : 0\}/);
assert.match(card, /!reorderable && \(event\.key === "Enter" \|\| event\.key === " "\)/);
assert.match(card, /Проверить остаток/);
assert.match(card, /Остаток превышает указанную вместимость/);
assert.match(card, /<StatusBadge status="empty">Архив<\/StatusBadge>/);
assert.match(page, /selectedSummary\.lastMovementAt/);

console.log("PASS TravkinFlow 2 warehouse card V2: flat surface, truthful counts/copy and preserved safety states (23 checks)");
