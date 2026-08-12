import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const page = read("app/(dashboard)/warehouses/page.tsx");
const warehouseService = read("lib/services/warehouses.ts");
const requestService = read("lib/services/warehouse-requests.ts");
const weighbridgeService = read("lib/services/weighbridge.ts");
const balancesRoute = read("app/api/warehouses/balances/route.ts");
const transactionsRoute = read("app/api/warehouses/transactions/route.ts");
const receiptsRoute = read("app/api/warehouses/receipts/route.ts");
const requestsRoute = read("app/api/material-requests/route.ts");
const batchesRoute = read("app/api/weighbridge/harvest-batches/route.ts");

const checks: Array<[string, () => void]> = [
  ["initial load fetches the warehouse list independently", () => {
    const body = page.match(/const loadWarehouseList = async[\s\S]*?\n  };/)?.[0] || "";
    assert.match(body, /await getWarehouseSummaries\(/);
    assert.doesNotMatch(body, /getProducts|getInventoryBalances|getInventoryTransactions|getWarehouseReceipts|getWarehouseIssueRequests|listHarvestBatchSummaries|Promise\.all/);
  }],
  ["selected warehouse details are loaded separately", () => {
    const body = page.match(/const loadWarehouseDetails = async[\s\S]*?\n  };/)?.[0] || "";
    assert.match(page, /const loadWarehouseDetails = async/);
    assert.match(body, /getInventoryBalances\([^\n]+\{ warehouseId \}\)/);
    assert.match(body, /listHarvestBatchSummaries\([^\n]+\{ warehouseId, aggregateLots: true \}\)/);
    assert.doesNotMatch(body, /getProducts|getInventoryTransactions|getWarehouseReceipts|getWarehouseIssueRequests/);
  }],
  ["product catalog is lazy and tied to the receipt action", () => {
    const initialBody = page.match(/const loadWarehouseList = async[\s\S]*?\n  };/)?.[0] || "";
    const receiptBody = page.match(/const openReceiptDialog = async[\s\S]*?\n  };/)?.[0] || "";
    assert.doesNotMatch(initialBody, /getProducts/);
    assert.match(receiptBody, /getProducts\(/);
    assert.match(page, /productsLoading \? "Загрузка каталога\.\.\."/);
  }],
  ["warehouse cards render before secondary summaries", () => {
    assert.match(page, /positionCount: serverSummary\?\.position_count \|\| 0/);
    assert.match(page, /lastMovementAt: serverSummary\?\.last_movement_at \|\| null/);
    assert.match(page, /summaryLoaded \? <div[^>]*>\{positionCount\}<\/div>/);
  }],
  ["content search loads only balances and harvest batches on demand", () => {
    const body = page.match(/const loadSearchData = async[\s\S]*?\n  };/)?.[0] || "";
    assert.match(body, /getInventoryBalances/);
    assert.match(body, /listHarvestBatchSummaries/);
    assert.doesNotMatch(body, /getProducts|getInventoryTransactions|getWarehouseReceipts|getWarehouseIssueRequests/);
  }],
  ["realtime refreshes the list and only the selected details", () => {
    assert.match(page, /loadWarehouseList\(\{ foreground: false \}\)/);
    assert.match(page, /if \(selectedWarehouseId\)[\s\S]*loadWarehouseDetails\(selectedWarehouseId, \{ foreground: false \}\)/);
  }],
  ["client services send warehouseId filters", () => {
    assert.match(warehouseService, /params\.set\("warehouseId", options\.warehouseId\)/);
    assert.match(requestService, /params\.set\("warehouseId", options\.warehouseId\)/);
    assert.match(weighbridgeService, /query\.set\("warehouseId", options\.warehouseId\)/);
  }],
  ["balances filter ledger and reservations by warehouse", () => {
    assert.match(balancesRoute, /query = query\.eq\("warehouse_id", warehouseId\)/);
    assert.match(balancesRoute, /requestQuery = requestQuery\.eq\("source_warehouse_id", warehouseId\)/);
    assert.match(balancesRoute, /calculateStockMath\(row\.quantity, row\.reserved_quantity\)/);
  }],
  ["filtered balances avoid the full global product catalog", () => {
    assert.match(balancesRoute, /if \(!warehouseId \|\| referencedProductIds\.size > 0\)/);
    assert.match(balancesRoute, /id\.in\.\(\$\{ids\}\),master_product_id\.in\.\(\$\{ids\}\)/);
    assert.match(balancesRoute, /company_id\.eq\.\$\{companyId\},company_id\.is\.null/);
  }],
  ["movements are server-filtered and capped", () => {
    assert.match(transactionsRoute, /warehouseId/);
    assert.match(transactionsRoute, /query = query\.eq\("warehouse_id", warehouseId\)/);
    assert.match(transactionsRoute, /Math\.min\(Math\.max\(Math\.trunc\(limitRaw\), 1\), 2000\)/);
  }],
  ["receipts and requests are server-filtered", () => {
    assert.match(receiptsRoute, /ticketQuery = ticketQuery\.eq\("warehouse_to_id", warehouseId\)/);
    assert.match(requestsRoute, /query = query\.eq\("source_warehouse_id", warehouseId\)/);
  }],
  ["harvest batches use the canonical warehouse trace", () => {
    assert.match(batchesRoute, /origin_type,warehouse_id/);
    assert.match(batchesRoute, /batchQuery = batchQuery\.eq\("warehouse_id", warehouseId\)/);
  }],
  ["no loading bundle remains on initial warehouse list", () => {
    assert.doesNotMatch(page, /const \[warehouseRows, productRows, balanceRows, movementRows, receiptRows, requestRows, batchRows\]/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}/${checks.length}: ${name}`);
}

console.log(`TZ258 warehouse performance regression: ${passed}/${checks.length} PASS`);
