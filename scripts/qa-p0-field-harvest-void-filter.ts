import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fieldPage = readFileSync(
  resolve(process.cwd(), "app/(dashboard)/fields/[id]/page.tsx"),
  "utf8"
);

const harvestQuery = fieldPage.match(
  /\.from\("tickets"\)[\s\S]*?\.eq\("op_type", "harvest_incoming"\)[\s\S]*?\.limit\(500\)/
)?.[0];

assert.ok(harvestQuery, "Не найден запрос урожайных талонов в карточке поля");
assert.match(
  harvestQuery,
  /\.eq\("is_finalized", true\)[\s\S]*?\.eq\("is_voided", false\)/,
  "Карточка поля должна считать только финализированные неаннулированные талоны"
);

console.log(
  JSON.stringify(
    {
      suite: "P0 field harvest void filter",
      total: 1,
      passed: 1,
      failed: 0,
    },
    null,
    2
  )
);
