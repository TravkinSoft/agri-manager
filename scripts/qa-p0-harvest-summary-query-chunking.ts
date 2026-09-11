import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const routeSource = readFileSync("app/api/weighbridge/harvest-batches/route.ts", "utf8");

function loadChunkHelper() {
  const helperStart = routeSource.indexOf("const ids =");
  const helperEnd = routeSource.indexOf("\nfunction impurityCategoryLabel", helperStart);
  assert.notEqual(helperStart, -1, "harvest batch ID normalizer must exist");
  assert.notEqual(helperEnd, -1, "chunk helper boundary must exist");

  const source = `${routeSource.slice(helperStart, helperEnd)}\nexport { loadInChunks };`;
  const loaded = { exports: {} as { loadInChunks?: <T>(values: string[], query: (chunk: string[]) => unknown) => Promise<T[]> } };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: loaded,
    exports: loaded.exports,
    setTimeout,
  });

  assert.equal(typeof loaded.exports.loadInChunks, "function");
  return loaded.exports.loadInChunks!;
}

function aggregateSummarySource() {
  const marker = "async function loadAggregateHarvestLotSummaries(";
  const start = routeSource.indexOf(marker);
  assert.notEqual(start, -1, "aggregate harvest summary loader must exist");
  const end = routeSource.indexOf("\nasync function ", start + marker.length);
  assert.notEqual(end, -1, "aggregate harvest summary loader boundary must exist");
  return routeSource.slice(start, end);
}

async function main() {
  const loadInChunks = loadChunkHelper();
  const input = Array.from({ length: 648 }, (_, index) => `batch-${String(index).padStart(4, "0")}`);
  const calls: Array<{ ids: string[]; from: number; to: number }> = [];

  const rows = await loadInChunks<{ id: string }>(
    [...input, input[0], ""],
    (chunk) => ({
      range: async (from: number, to: number) => {
        calls.push({ ids: [...chunk], from, to });
        return { data: chunk.map((id) => ({ id })), error: null };
      },
    }),
  );

  assert.equal(rows.length, 648, "all unique batch metadata rows must be preserved");
  assert.deepEqual(calls.map((call) => call.ids.length), [200, 200, 200, 48]);
  assert.ok(calls.every((call) => call.from === 0 && call.to === 999));
  assert.deepEqual(calls.flatMap((call) => call.ids), input);

  const aggregateSource = aggregateSummarySource();
  assert.match(
    aggregateSource,
    /loadInChunks<any>\(batchIds,\s*\(chunk\)\s*=>\s*supabase\s*\.from\("inventory_batches"\)[\s\S]*?\.in\("id", chunk\)\)/,
    "aggregate summaries must chunk inventory batch metadata IDs",
  );
  assert.doesNotMatch(
    aggregateSource,
    /\.from\("inventory_batches"\)[\s\S]*?\.in\("id", batchIds\)/,
    "aggregate summaries must not put every inventory batch ID into one PostgREST URL",
  );

  console.log("P0 harvest summary query chunking regression: PASS");
}

void main();
