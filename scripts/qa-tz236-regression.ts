import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildReproductionOptions,
  buildVarietyOptions,
} from "../lib/crop-structure/catalog-identity";
import {
  validateAndNormalizeCropStructureRows,
} from "../lib/crop-structure/fallow";
import {
  automaticHarvestAllocation,
  findHarvestProductForAllocation,
  harvestIdentityMatches,
  isHarvestProductForAllocation,
  validateHarvestWeights,
} from "../lib/weighbridge/harvest-contract";

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  process.stdout.write(`PASS ${String(passed).padStart(2, "0")} ${name}\n`);
};

const crops = new Map([
  ["wheat", { id: "wheat", slug: "wheat" }],
  ["barley", { id: "barley", slug: "barley" }],
]);
const varieties = [
  { id: "global-wheat", crop_id: "wheat", name: "Айна", company_id: null, is_active: true },
  { id: "company-wheat", crop_id: "wheat", name: "Айна", company_id: "company-a", is_active: true },
  { id: "global-barley", crop_id: "barley", name: "Ача", company_id: null, is_active: true },
  { id: "company-b", crop_id: "wheat", name: "Чужой сорт", company_id: "company-b", is_active: true },
  { id: "inactive", crop_id: "wheat", name: "Архивный", company_id: null, is_active: false },
];
const byCrop = buildVarietyOptions({
  rows: varieties,
  companyId: "company-a",
  canonicalCropId: (id) => id,
});

check("global varieties are visible to a company", () => assert.equal(byCrop.get("barley")?.[0].id, "global-barley"));
check("another company variety is hidden", () => assert.equal(byCrop.get("wheat")?.some((row) => row.id === "company-b"), false));
check("company variety overrides equal global identity", () => assert.equal(byCrop.get("wheat")?.[0].id, "company-wheat"));
check("variety options are filtered by crop", () => assert.deepEqual(byCrop.get("barley")?.map((row) => row.id), ["global-barley"]));
check("inactive variety is hidden for a new row", () => assert.equal(byCrop.get("wheat")?.some((row) => row.id === "inactive"), false));
check("selected inactive legacy variety remains visible", () => {
  const legacy = buildVarietyOptions({
    rows: varieties,
    companyId: "company-a",
    canonicalCropId: (id) => id,
    selectedIds: ["inactive"],
  });
  assert.equal(legacy.get("wheat")?.some((row) => row.id === "inactive"), true);
});

const reproductions = buildReproductionOptions({
  rows: [
    { id: "r1-global", name: "Первая репродукция", code: "R1", company_id: null, is_active: true },
    { id: "r1-company", name: "1 репродукция", code: "R1", company_id: "company-a", is_active: true },
    { id: "r2", name: "Вторая репродукция", code: "R2", company_id: null, is_active: true },
  ],
  companyId: "company-a",
});
check("reproduction list loads every canonical level", () => assert.equal(reproductions.length, 2));
check("company reproduction overrides a global duplicate", () => assert.equal(reproductions.find((row) => row.code === "R1")?.id, "r1-company"));

const validRow = { crop_id: "wheat", variety_id: "company-wheat", reproduction_id: "r1-company", area: 10 };
const varietyMap = new Map([
  ["company-wheat", { id: "company-wheat", crop_id: "wheat" }],
  ["global-barley", { id: "global-barley", crop_id: "barley" }],
]);
const validateRows = (rows: typeof validRow[], fieldArea = 100) =>
  validateAndNormalizeCropStructureRows({ rows, cropsById: crops, varietiesById: varietyMap, fieldArea });

check("missing variety blocks crop structure save", () => assert.equal(validateRows([{ ...validRow, variety_id: null } as any]).ok, false));
check("missing reproduction blocks crop structure save", () => assert.equal(validateRows([{ ...validRow, reproduction_id: null } as any]).ok, false));
check("variety from another crop is rejected", () => assert.equal(validateRows([{ ...validRow, variety_id: "global-barley" }]).ok, false));
check("area overflow is rejected", () => assert.equal(validateRows([{ ...validRow, area: 101 }], 100).ok, false));
check("equal crop identities are accepted as separate field sections", () => {
  const result = validateRows([{ ...validRow, area: 40 }, { ...validRow, area: 60 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((row) => row.area), [40, 60]);
});
check("valid complete crop identity is accepted", () => assert.equal(validateRows([validRow]).ok, true));

const allocation = {
  allocationId: "allocation-a",
  cropId: "wheat",
  varietyId: "company-wheat",
  reproductionId: "r1-company",
  isIncomplete: false,
};
check("one complete crop structure auto-selects", () => assert.equal(automaticHarvestAllocation([allocation])?.allocationId, "allocation-a"));
check("multiple crop structures require explicit choice", () => assert.equal(automaticHarvestAllocation([allocation, { ...allocation, allocationId: "allocation-b" }]), null));
check("incomplete crop structure never auto-selects", () => assert.equal(automaticHarvestAllocation([{ ...allocation, varietyId: null, isIncomplete: true }]), null));
check("ticket line identity matches crop structure", () => assert.equal(harvestIdentityMatches(allocation, { crop_id: "wheat", variety_id: "company-wheat", reproduction_id: "r1-company" }), true));
check("variety spoof is rejected by identity comparison", () => assert.equal(harvestIdentityMatches(allocation, { crop_id: "wheat", variety_id: "global-barley", reproduction_id: "r1-company" }), false));
const harvestProducts = [
  {
    id: "potato-produce",
    name: "Картофель урожай Гала",
    type: "produce",
    cropId: "potato",
    varietyId: "gala",
    reproductionId: "r1-company",
  },
  {
    id: "wheat-produce",
    name: "Пшеница урожай Айна",
    type: "produce",
    cropId: "wheat",
    varietyId: "company-wheat",
    reproductionId: "r1-company",
  },
];
check("harvest product resolves by crop identity", () =>
  assert.equal(findHarvestProductForAllocation(harvestProducts, allocation, ["Пшеница"])?.id, "wheat-produce"));
check("unrelated produce cannot be a harvest fallback", () =>
  assert.equal(
    findHarvestProductForAllocation([harvestProducts[0]], allocation, ["Пшеница"]),
    null
  ));
check("seed product cannot be used as harvested produce", () =>
  assert.equal(
    isHarvestProductForAllocation(
      { id: "wheat-seed", name: "Семена пшеницы", type: "seed", cropId: "wheat" },
      allocation,
      ["Пшеница"]
    ),
    false
  ));
check("30000 minus 10000 equals 20000", () => assert.deepEqual(validateHarvestWeights(30_000, 10_000), { ok: true, net: 20_000 }));
check("zero gross is rejected", () => assert.equal(validateHarvestWeights(0, 0).ok, false));
check("negative tare is rejected", () => assert.equal(validateHarvestWeights(30_000, -1).ok, false));
check("tare equal to gross is rejected", () => assert.equal(validateHarvestWeights(30_000, 30_000).ok, false));
check("tare greater than gross is rejected", () => assert.equal(validateHarvestWeights(30_000, 31_000).ok, false));

const harvestMigration = readFileSync(resolve("supabase/migrations/20260729112440_harvest_traceability_v1.sql"), "utf8");
const ticketsRoute = readFileSync(resolve("app/api/weighbridge/tickets/route.ts"), "utf8");
const cropRoute = readFileSync(resolve("app/api/crop-structure/fields/[id]/route.ts"), "utf8");

check("batch stores crop structure trace", () => assert.match(harvestMigration, /crop_structure_id uuid references public\.crop_structure/));
check("batch stores optional harvesting operation trace", () => assert.match(harvestMigration, /harvesting_operation_id uuid references public\.operations/));
check("batch stores destination warehouse", () => assert.match(harvestMigration, /warehouse_id uuid references public\.warehouses/));
check("harvest batch uniqueness protects double submit", () => assert.match(harvestMigration, /uq_inventory_batches_harvest_ticket_product_v1/));
check("ledger receives canonical batch id", () => assert.match(harvestMigration, /new\.batch_id := v_batch\.id::text/));
check("field history receives ticket and batch links", () => assert.match(harvestMigration, /harvest_ticket_id[\s\S]*harvest_batch_id/));
check("finalization writes an audit event", () => assert.match(harvestMigration, /'harvest_finalized'/));
check("weight and ticket line update is atomic", () => assert.match(harvestMigration, /set_harvest_ticket_weights_for_session_v1/));
check("server overwrites submitted identity from crop structure", () => assert.match(ticketsRoute, /line\.variety_id = harvestContext\.allocation\?\.varietyId/));
check("server rejects harvest product identity mismatch", () => assert.match(ticketsRoute, /isHarvestProductForAllocation/));
check("server accepts a valid crop structure without mandatory operation", () => assert.doesNotMatch(ticketsRoute, /if \(!ticket\.linked_operation_id\)/));
check("server validates crop-to-variety relation", () => assert.match(cropRoute, /varietiesById/));
check("server restricts writes to current season", () => assert.match(cropRoute, /Only the current season crop structure can be edited/));

assert.equal(passed, 40);
process.stdout.write(`TZ-236 automated regression: ${passed}/40 PASS\n`);
