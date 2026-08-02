import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  buildGlbdComponentSearchEntries,
  dedupeByCanonicalComponent,
  findExactGlbdAliasConflict,
  glbdComponentMatchesSearch,
  localizeGlbdClaimScope,
  normalizeGlbdSearchText,
  toGlbdComponentSourceDisplay,
  type GlbdComponentRow,
} from "../lib/glbd/component-discovery";

const components: GlbdComponentRow[] = [
  {
    id: "component-lambda",
    legacy_active_ingredient_id: "legacy-lambda",
    canonical_name: "Lambda-cyhalothrin",
    name_ru: "Лямбда-цигалотрин",
    name_en: "Lambda-cyhalothrin",
    component_type: "active_ingredient",
    is_active: true,
    archived_at: null,
  },
  {
    id: "component-propiconazole",
    legacy_active_ingredient_id: "legacy-propiconazole",
    canonical_name: "propiconazole",
    name_ru: "Пропиконазол",
    name_en: "propiconazole",
    component_type: "active_ingredient",
    is_active: true,
    archived_at: null,
  },
];

const aliases = [
  {
    component_id: "component-lambda",
    alias_text: "лямбда цигалотрин",
    normalized_text: "лямбдацигалотрин",
    language: "ru",
  },
  {
    component_id: "component-propiconazole",
    alias_text: "Пропиконазол",
    normalized_text: "пропиконазол",
    language: "ru",
  },
];

const index = buildGlbdComponentSearchEntries(components, aliases);

assert.equal(glbdComponentMatchesSearch(index[0], "Lambda-cyhalothrin"), true, "canonical search");
assert.equal(glbdComponentMatchesSearch(index[0], "Лямбда-цигалотрин"), true, "RU search");
assert.equal(glbdComponentMatchesSearch(index[0], "lambda-cyhalothrin"), true, "EN search");
assert.equal(glbdComponentMatchesSearch(index[0], "лямбда цигалотрин"), true, "alias search");
assert.equal(glbdComponentMatchesSearch(index[1], "ПРОПИКОНАЗОЛ"), true, "case normalization");
assert.equal(
  normalizeGlbdSearchText("Лямбда — цигалотрин"),
  normalizeGlbdSearchText("лямбда-цигалотрин"),
  "hyphen normalization"
);

const deduped = dedupeByCanonicalComponent([
  { id: "legacy-lambda", glbd_component_id: "component-lambda" },
  { id: "legacy-lambda-copy", glbd_component_id: "component-lambda" },
]);
assert.equal(deduped.length, 1, "canonical component dedupe");
assert.equal(
  index.filter((component) => glbdComponentMatchesSearch(component, "Пропиконазол"))[0]?.id,
  "component-propiconazole",
  "alias resolves to canonical component id"
);

const conflictIndex = buildGlbdComponentSearchEntries(
  [...components, { ...components[1], id: "component-conflict" }],
  [...aliases, { component_id: "component-conflict", alias_text: "Пропиконазол", normalized_text: "пропиконазол" }]
);
assert.equal(findExactGlbdAliasConflict(conflictIndex, "пропиконазол").length, 2, "alias conflict is explicit");

const source = toGlbdComponentSourceDisplay({
  id: "source-1",
  component_id: "component-propiconazole",
  source_type: "official_label",
  source_title: "Official label",
  source_url: "https://example.com/label.pdf",
  claim_scope: "component_name; concentration; role_in_product",
  checked_at: "2026-07-12T00:00:00.000Z",
});
assert.ok(source, "verified source remains visible");
assert.equal(source?.typeLabel, "Официальная этикетка", "source type localized");
assert.deepEqual(
  source?.claimLabels,
  ["Подтверждает название", "Подтверждает концентрацию", "Подтверждает роль в составе"],
  "claim scope localized"
);
assert.equal(source?.url, "https://example.com/label.pdf", "safe source link retained");
assert.equal(
  toGlbdComponentSourceDisplay({
    id: "source-blocked",
    component_id: "component-propiconazole",
    source_type: "needs_source",
    source_title: "Blocked",
    claim_scope: "component_name",
  }),
  null,
  "needs_source rows never become visible"
);
assert.deepEqual(
  localizeGlbdClaimScope(
    "Current RU identity; current EN identity when present; preliminary component classification only. Does not confirm product concentration or chemical form."
  ),
  ["Подтверждает название", "Подтверждает тип компонента"],
  "negative concentration statement is not presented as proof"
);

const fullSet = buildGlbdComponentSearchEntries(
  Array.from({ length: 425 }, (_, indexNumber) => ({
    id: `component-${indexNumber}`,
    canonical_name: `Component ${indexNumber}`,
    name_ru: `Компонент ${indexNumber}`,
    is_active: indexNumber < 415,
    archived_at: indexNumber < 415 ? null : "2026-07-12T00:00:00.000Z",
  })),
  []
);
const startedAt = performance.now();
const matches = fullSet.filter((component) => glbdComponentMatchesSearch(component, "Компонент 424"));
const elapsedMs = performance.now() - startedAt;
assert.equal(matches.length, 1, "full 425 component search");
assert.ok(elapsedMs < 100, `search should stay lightweight, received ${elapsedMs.toFixed(2)} ms`);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      checks: 16,
      component_fixture_rows: fullSet.length,
      search_elapsed_ms: Number(elapsedMs.toFixed(2)),
    },
    null,
    2
  )
);
