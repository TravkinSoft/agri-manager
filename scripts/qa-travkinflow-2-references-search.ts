import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { referenceMatchesSmartSearch, referenceSearchForms } from "../lib/references/smart-search";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const page = read("app/(dashboard)/references/page.tsx");

assert.match(page, /useDeferredValue\(machineYardSearch\)/, "machinery filtering must use the deferred query");
assert.match(page, /data-reference-category-nav/, "machinery category subnav contract is missing");
assert.match(page, /"all", "machines", "equipment", "vehicles"/, "category deep-link values changed");
assert.match(page, /requestedDomain[\s\S]*requestedTab[\s\S]*requestedCategory/, "deep-link parsing contract is missing");
assert.match(
  read("app/(dashboard)/machines/page.tsx"),
  /redirect\("\/references\?domain=machine-yard&tab=park"\)/,
  "legacy /machines deep link changed",
);
assert.match(
  read("app/(dashboard)/technique/page.tsx"),
  /redirect\("\/references\?domain=machine-yard&tab=park"\)/,
  "legacy /technique deep link changed",
);

assert.equal(referenceMatchesSmartSearch(["КамАЗ 826 АВ 15"], "kamaz"), true, "Cyrillic must match Latin");
assert.equal(referenceMatchesSmartSearch(["KAMAZ 826 AB 15"], "камаз"), true, "Latin must match Cyrillic");
assert.equal(referenceMatchesSmartSearch(["КамАЗ"], "rfvfp"), true, "wrong RU keyboard layout must match");
assert.equal(referenceMatchesSmartSearch(["T-309 BK"], "Т 309 ВК"), true, "plate lookalikes must match");
assert.equal(referenceMatchesSmartSearch(["VIN XTC541000M1234567"], "xtc 541000 m1234567"), true, "VIN fragments must match");
assert.equal(referenceMatchesSmartSearch(["Водитель Жандос Мухаметжанов"], "zhandos"), true, "driver transliteration must match");
assert.equal(referenceMatchesSmartSearch(["CLAAS", "AXION 930", "Трактор"], "claas traktor"), true, "multi-field query must match");
assert.equal(referenceMatchesSmartSearch(["CLAAS AXION"], "John Deere"), false, "unrelated query must not match");
assert.equal(referenceMatchesSmartSearch(["KAMA"], "камаз"), false, "plate folding must not create partial word matches");
assert.deepEqual(referenceSearchForms("  "), [], "blank query must not create search forms");

console.log("QA TravkinFlow 2 references search: PASS");
