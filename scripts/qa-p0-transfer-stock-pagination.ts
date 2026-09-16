import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SUPABASE_QUERY_CHUNK_SIZE,
  SUPABASE_QUERY_PAGE_SIZE,
  loadSupabaseInChunks,
  loadSupabasePages,
} from "../lib/server/supabase-query-pagination";

let passed = 0;
function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

async function main() {
  const sourceRows = Array.from({ length: 1_007 }, (_, index) => ({ id: `batch-${index}` }));
  const ranges: Array<[number, number]> = [];
  const paged = await loadSupabasePages<{ id: string }>(() => ({
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: sourceRows.slice(from, to + 1), error: null };
    },
  }));

  check("all rows beyond the Supabase 1,000-row cap are retained", () => {
    assert.equal(paged.error, null);
    assert.equal(paged.data?.length, 1_007);
    assert.deepEqual(ranges, [[0, 499], [500, 999], [1_000, 1_499]]);
  });

  const ids = Array.from({ length: 1_007 }, (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`);
  const chunks: string[][] = [];
  const chunked = await loadSupabaseInChunks<{ id: string }>([...ids, ids[0], ""], (chunk) => ({
    range: async (from: number, to: number) => {
      chunks.push([...chunk]);
      return { data: chunk.slice(from, to + 1).map((id) => ({ id })), error: null };
    },
  }));

  check("large UUID lists are split into safe request URLs without losing rows", () => {
    assert.equal(chunked.error, null);
    assert.equal(chunked.data?.length, 1_007);
    assert.ok(chunks.every((chunk) => chunk.length <= SUPABASE_QUERY_CHUNK_SIZE));
    assert.deepEqual(chunks.flat(), ids);
  });

  check("pagination and chunk limits stay below upstream caps", () => {
    assert.equal(SUPABASE_QUERY_PAGE_SIZE, 500);
    assert.equal(SUPABASE_QUERY_CHUNK_SIZE, 100);
  });

  const route = readFileSync("app/api/weighbridge/stock-identities/route.ts", "utf8");
  check("transfer stock route pages balances and chunks linked batch IDs", () => {
    assert.match(route, /loadSupabasePages<any>\(\(\) => supabase\s*\.from\("v_effective_stock_balance_identity_v1"\)/);
    assert.match(route, /loadSupabaseInChunks<any>\(lotIds,[\s\S]*?\.from\("harvest_lot_batches"\)/);
    assert.match(route, /loadSupabaseInChunks<any>\(linkedBatchIds,[\s\S]*?\.from\("inventory_batches"\)/);
    assert.doesNotMatch(route, /\.from\("inventory_batches"\)[\s\S]*?\.in\("id", linkedBatchIds\)/);
  });

  check("route exposes a safe error while logging the failed stage", () => {
    assert.match(route, /weighbridge_stock_identities_failed/);
    assert.match(route, /stock_identity_load_failed/);
    assert.doesNotMatch(route, /return NextResponse\.json\(\{ error: stockError\.message \}/);
  });

  const failed = await loadSupabasePages<{ id: string }>(() => ({
    range: async () => ({ data: null, error: { message: "boom" } }),
  }));
  check("query errors are returned without partial data", () => {
    assert.equal(failed.data, null);
    assert.equal(failed.error?.message, "boom");
  });

  assert.equal(passed, 6);
  console.log(`P0 transfer stock pagination regression PASS: ${passed}/6`);
}

void main();
