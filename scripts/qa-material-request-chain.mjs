#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

function loadEnvFromDotEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) return;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key] != null) return;
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^"(.*)"$/, "$1");
    process.env[key] = value;
  });
}

loadEnvFromDotEnv();

const APP_BASE_URL = process.env.APP_BASE_URL || "https://agri-manager-eight.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bhsemlvmkikpntabctml.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in environment.");
  process.exit(1);
}

const USERS = {
  agronomist: { email: "zss010@mail.ru", password: "Qqqq1111!" },
  warehouse: { email: "roni._@mail.ru", password: "Qqqq1111!" },
  specialist: { email: "travkin-94@list.ru", password: "Qqqq1111!" },
};

const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

async function signIn(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token || !payload?.user?.id) {
    throw new Error(`Auth failed for ${email}: ${payload?.msg || payload?.error_description || response.status}`);
  }
  return payload;
}

async function restSelect(token, table, select = "*", filters = []) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", select);
  for (const [key, value] of filters) url.searchParams.set(key, value);

  const response = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(`rest select ${table} failed: ${JSON.stringify(payload)}`);
  }
  return Array.isArray(payload) ? payload : [];
}

async function appApi(token, pathName, init = {}) {
  const response = await fetch(`${APP_BASE_URL}${pathName}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function getProfile(token, authUserId) {
  const rows = await restSelect(token, "profiles", "id,email,role,company_id,status", [
    ["id", `eq.${authUserId}`],
    ["limit", "1"],
  ]);
  if (!rows[0]?.id) throw new Error("Profile not found");
  return rows[0];
}

async function getRequestById(token, companyId, requestId) {
  const res = await appApi(
    token,
    `/api/material-requests?companyId=${encodeURIComponent(companyId)}`,
    { method: "GET" }
  );
  if (!res.ok) throw new Error(`material-requests fetch failed: ${JSON.stringify(res.body)}`);
  const request = (res.body.requests || []).find((row) => String(row.id) === String(requestId));
  if (!request) throw new Error(`Request ${requestId} not found in API payload`);
  return request;
}

async function getStockBalance(token, companyId, warehouseId, productId) {
  const rows = await restSelect(
    token,
    "v_stock_balance_canonical",
    "quantity",
    [
      ["company_id", `eq.${companyId}`],
      ["warehouse_id", `eq.${warehouseId}`],
      ["product_id", `eq.${productId}`],
      ["limit", "5000"],
    ]
  );
  return rows.reduce((sum, row) => sum + toNum(row.quantity), 0);
}

async function getTxSummary(token, companyId, requestId) {
  const rows = await restSelect(
    token,
    "inventory_transactions",
    "id,status,transaction_type,movement_type,quantity,warehouse_issue_request_item_id,created_at",
    [
      ["company_id", `eq.${companyId}`],
      ["warehouse_issue_request_id", `eq.${requestId}`],
      ["limit", "5000"],
    ]
  );

  const summary = rows.reduce(
    (acc, row) => {
      const status = String(row.status || "");
      if (status === "draft") acc.draft += 1;
      if (status === "confirmed") acc.confirmed += 1;
      if (String(row.transaction_type || "") === "in" && String(row.movement_type || "") === "adjustment") {
        acc.returns += 1;
      }
      return acc;
    },
    { total: rows.length, draft: 0, confirmed: 0, returns: 0 }
  );

  return { rows, summary };
}

async function run() {
  const tag = `QA_TEST_2026_REQ_${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const auth = {};
  const profile = {};
  for (const [key, creds] of Object.entries(USERS)) {
    auth[key] = await signIn(creds.email, creds.password);
    profile[key] = await getProfile(auth[key].access_token, auth[key].user.id);
  }

  const companyId = String(profile.agronomist.company_id || "");
  if (!companyId || String(profile.warehouse.company_id || "") !== companyId || String(profile.specialist.company_id || "") !== companyId) {
    throw new Error("Users are not in the same company scope");
  }

  const stockRows = await restSelect(
    auth.agronomist.access_token,
    "v_stock_balance_identity",
    "warehouse_id,product_id,quantity",
    [
      ["company_id", `eq.${companyId}`],
      ["quantity", "gt.0"],
      ["limit", "5000"],
    ]
  );
  const bestStock = stockRows.sort((a, b) => toNum(b.quantity) - toNum(a.quantity))[0];
  if (!bestStock?.warehouse_id || !bestStock?.product_id) {
    throw new Error("No positive stock identity found for request test");
  }
  const sourceWarehouseId = String(bestStock.warehouse_id);
  const productId = String(bestStock.product_id);

  const products = await restSelect(auth.agronomist.access_token, "products", "id,name", [
    ["company_id", `eq.${companyId}`],
    ["id", `eq.${productId}`],
    ["limit", "1"],
  ]);
  if (!products[0]?.id) throw new Error("Product not found in catalog");
  const productName = String(products[0].name || productId);

  const structures = await restSelect(
    auth.agronomist.access_token,
    "crop_structure",
    "id,field_id,crop_id,variety_id,reproduction_id,season_id,archived",
    [
      ["company_id", `eq.${companyId}`],
      ["archived", "eq.false"],
      ["limit", "5000"],
    ]
  );
  const fallbackFieldRows = await restSelect(auth.agronomist.access_token, "fields", "id,area,name", [
    ["company_id", `eq.${companyId}`],
    ["archived", "eq.false"],
    ["limit", "1"],
  ]);

  const selectedStructure = structures[0] || null;
  const selectedFieldId = String(selectedStructure?.field_id || fallbackFieldRows[0]?.id || "");
  if (!selectedFieldId) throw new Error("No field found for operation creation");

  const operationCreate = await appApi(auth.agronomist.access_token, "/api/operations", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      field_id: selectedFieldId,
      crop_structure_id: selectedStructure?.id || null,
      crop_id: selectedStructure?.crop_id || null,
      operation_category_slug: "seeding_planting",
      operation_type_slug: "potato_planting",
      operation_type: "QA_TEST_2026_material_request_flow",
      planned_area_ha: 10,
      date: new Date().toISOString().slice(0, 10),
      responsible_user_id: profile.specialist.id,
      notes: `${tag} operation created via structured materials`,
      materials: [
        {
          material_type: "seed",
          product_id: productId,
          planned_rate: 1,
          unit: "kg",
        },
      ],
    }),
  });
  if (!operationCreate.ok || !operationCreate.body?.operation?.id) {
    throw new Error(`Operation creation failed: ${JSON.stringify(operationCreate.body)}`);
  }

  const operationId = String(operationCreate.body.operation.id);
  const requestMeta = operationCreate.body.material_request || {};
  if (!requestMeta.created || !requestMeta.request_id) {
    throw new Error(`Material request was not auto-created: ${JSON.stringify(requestMeta)}`);
  }
  const requestId = String(requestMeta.request_id);

  let request = await getRequestById(auth.agronomist.access_token, companyId, requestId);

  const txBeforeReady = await getTxSummary(auth.agronomist.access_token, companyId, requestId);
  const stockBeforeReady = await getStockBalance(auth.agronomist.access_token, companyId, sourceWarehouseId, productId);

  const setPreparing = await appApi(auth.warehouse.access_token, "/api/material-requests", {
    method: "PATCH",
    body: JSON.stringify({
      companyId,
      requestId,
      action: "preparing",
      sourceWarehouseId,
    }),
  });
  if (!setPreparing.ok) throw new Error(`Set preparing failed: ${JSON.stringify(setPreparing.body)}`);

  const setReady = await appApi(auth.warehouse.access_token, "/api/material-requests", {
    method: "PATCH",
    body: JSON.stringify({
      companyId,
      requestId,
      action: "ready",
      sourceWarehouseId,
    }),
  });
  if (!setReady.ok) throw new Error(`Set ready failed: ${JSON.stringify(setReady.body)}`);

  request = await getRequestById(auth.agronomist.access_token, companyId, requestId);
  const txAfterReady = await getTxSummary(auth.agronomist.access_token, companyId, requestId);
  const stockAfterReady = await getStockBalance(auth.agronomist.access_token, companyId, sourceWarehouseId, productId);

  const startBeforeConfirm = await appApi(
    auth.specialist.access_token,
    `/api/operations/${encodeURIComponent(operationId)}/start`,
    {
      method: "POST",
      body: JSON.stringify({ companyId }),
    }
  );

  const item = request.items?.[0];
  if (!item?.id) throw new Error("Request item is missing");
  const plannedQty = toNum(item.planned_quantity ?? item.required_quantity);
  if (!(plannedQty > 0)) throw new Error("Planned quantity is not positive");

  const partialQty = Number(Math.max(0.01, plannedQty / 2).toFixed(2));
  const issuePartial = await appApi(
    auth.warehouse.access_token,
    `/api/material-requests/${encodeURIComponent(requestId)}/issue`,
    {
      method: "POST",
      body: JSON.stringify({
        companyId,
        sourceWarehouseId,
        items: [{ itemId: item.id, issuedQuantity: partialQty }],
      }),
    }
  );
  if (!issuePartial.ok) throw new Error(`Partial issue failed: ${JSON.stringify(issuePartial.body)}`);

  request = await getRequestById(auth.agronomist.access_token, companyId, requestId);
  const issuedAfterPartial = toNum(request.items?.[0]?.issued_quantity);
  const remainingAfterPartial = Number(Math.max(plannedQty - issuedAfterPartial, 0).toFixed(4));

  if (remainingAfterPartial > 0) {
    const issueRest = await appApi(
      auth.warehouse.access_token,
      `/api/material-requests/${encodeURIComponent(requestId)}/issue`,
      {
        method: "POST",
        body: JSON.stringify({
          companyId,
          sourceWarehouseId,
          items: [{ itemId: item.id, issuedQuantity: remainingAfterPartial }],
        }),
      }
    );
    if (!issueRest.ok) throw new Error(`Final issue failed: ${JSON.stringify(issueRest.body)}`);
  }

  request = await getRequestById(auth.agronomist.access_token, companyId, requestId);
  const statusAfterFullIssue = String(request.status || "unknown");
  const txAfterIssue = await getTxSummary(auth.agronomist.access_token, companyId, requestId);
  const stockAfterIssue = await getStockBalance(auth.agronomist.access_token, companyId, sourceWarehouseId, productId);

  const confirmBySpecialist = await appApi(
    auth.specialist.access_token,
    `/api/material-requests/${encodeURIComponent(requestId)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify({ companyId }),
    }
  );
  if (!confirmBySpecialist.ok) {
    throw new Error(`Specialist confirm failed: ${JSON.stringify(confirmBySpecialist.body)}`);
  }

  request = await getRequestById(auth.agronomist.access_token, companyId, requestId);
  const txAfterConfirm = await getTxSummary(auth.agronomist.access_token, companyId, requestId);
  const stockAfterConfirm = await getStockBalance(auth.agronomist.access_token, companyId, sourceWarehouseId, productId);

  const startAfterConfirm = await appApi(
    auth.specialist.access_token,
    `/api/operations/${encodeURIComponent(operationId)}/start`,
    {
      method: "POST",
      body: JSON.stringify({ companyId }),
    }
  );

  const issuedForReturn = toNum(request.items?.[0]?.issued_quantity);
  const returnQty = Number(Math.max(0.01, issuedForReturn * 0.25).toFixed(2));
  const doReturn = await appApi(
    auth.specialist.access_token,
    `/api/material-requests/${encodeURIComponent(requestId)}/return`,
    {
      method: "POST",
      body: JSON.stringify({
        companyId,
        items: [{ itemId: item.id, returnedQuantity: returnQty }],
      }),
    }
  );
  if (!doReturn.ok) throw new Error(`Return failed: ${JSON.stringify(doReturn.body)}`);

  request = await getRequestById(auth.agronomist.access_token, companyId, requestId);
  const txAfterReturn = await getTxSummary(auth.agronomist.access_token, companyId, requestId);
  const requestItemAfterReturn = request.items?.find((x) => String(x.id) === String(item.id)) || null;

  const report = {
    ok: true,
    tag,
    app_base_url: APP_BASE_URL,
    company_id: companyId,
    operation_id: operationId,
    request_id: requestId,
    selected_stock_identity: {
      warehouse_id: sourceWarehouseId,
      product_id: productId,
      product_name: productName,
      stock_qty: toNum(bestStock.quantity),
    },
    status_chain: {
      created: "active",
      after_preparing: String(setPreparing.body?.request?.status || "unknown"),
      after_ready: String(setReady.body?.request?.status || "unknown"),
      after_partial_issue: String(issuePartial.body?.result?.status || "unknown"),
      after_full_issue: statusAfterFullIssue,
      after_specialist_confirm: String(confirmBySpecialist.body?.result?.status || request.status || "unknown"),
    },
    rule_checks: {
      ready_does_not_create_movements: txBeforeReady.summary.total === txAfterReady.summary.total,
      ready_does_not_deduct_stock: Number(stockBeforeReady.toFixed(4)) === Number(stockAfterReady.toFixed(4)),
      issue_creates_draft_only_before_confirm:
        txAfterIssue.summary.draft > 0 &&
        txAfterIssue.summary.confirmed === 0 &&
        Number(stockAfterIssue.toFixed(4)) === Number(stockBeforeReady.toFixed(4)),
      confirm_finalizes_and_deducts:
        txAfterConfirm.summary.confirmed > 0 &&
        txAfterConfirm.summary.draft === 0 &&
        stockAfterConfirm < stockBeforeReady,
      start_blocked_before_confirm: startBeforeConfirm.status === 409,
      start_allowed_after_confirm: startAfterConfirm.ok === true,
      return_updates_item_counters:
        toNum(requestItemAfterReturn?.returned_quantity) > 0 &&
        toNum(requestItemAfterReturn?.consumed_quantity) >= 0,
      return_creates_inventory_adjustment: txAfterReturn.summary.returns > 0,
    },
    request_item_after_return: requestItemAfterReturn,
    transactions: {
      before_ready: txBeforeReady.summary,
      after_ready: txAfterReady.summary,
      after_issue: txAfterIssue.summary,
      after_confirm: txAfterConfirm.summary,
      after_return: txAfterReturn.summary,
    },
    stock_balances: {
      before_ready: stockBeforeReady,
      after_ready: stockAfterReady,
      after_issue: stockAfterIssue,
      after_confirm: stockAfterConfirm,
    },
    start_checks: {
      before_confirm_status: startBeforeConfirm.status,
      before_confirm_ok: startBeforeConfirm.ok,
      before_confirm_body: startBeforeConfirm.body,
      after_confirm_status: startAfterConfirm.status,
      after_confirm_ok: startAfterConfirm.ok,
      after_confirm_body: startAfterConfirm.body,
    },
  };

  const outDir = path.resolve("scripts/output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `qa-material-request-chain-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: outPath,
        operation_id: operationId,
        request_id: requestId,
        final_status: request.status,
        return_qty: returnQty,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
