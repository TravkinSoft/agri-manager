#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://agri-manager-eight.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bhsemlvmkikpntabctml.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in environment.");
  process.exit(1);
}

const ADMIN_USER = {
  email: process.env.QA_ADMIN_EMAIL || "Aimbeks@gmail.com",
  password: process.env.QA_ADMIN_PASSWORD || "Qqqq1111",
};

const OPERATOR_USER = {
  email: process.env.QA_WAREHOUSE_EMAIL || "roni._@mail.ru",
  password: process.env.QA_WAREHOUSE_PASSWORD || "Qqqq1111!",
};

const QA_WAREHOUSE_PREFIX = "QA_TEST_2026";

const REQUIRED_WAREHOUSE_TYPES = {
  seed: "seed",
  fertilizer: "fertilizer",
  pesticide: "pesticide",
};

const PRODUCT_PICKERS = [
  {
    key: "seed",
    type: "seed",
    quantity: 2500,
    preferredNames: [
      "QA_TEST_2026 Картофель семенной Гала Элита",
      "QA_TEST_2026 РљР°СЂС‚РѕС„РµР»СЊ СЃРµРјРµРЅРЅРѕР№ Р“Р°Р»Р° Р­Р»РёС‚Р°",
      "Seed Potato - Russet Burbank",
      "Картофель",
    ],
    allowCreate: true,
    createName: "QA_TEST_2026 Картофель семенной Гала Элита",
    createUnit: "kg",
  },
  {
    key: "fertilizer",
    type: "fertilizer",
    quantity: 1800,
    preferredNames: ["NPK 16-16-16", "MAP 12-52", "DAP 18-46", "Ammonium Nitrate"],
    allowCreate: false,
  },
  {
    key: "pesticide",
    type: "pesticide",
    quantity: 320,
    preferredNames: ["Actara", "Amistar Extra", "Ridomil Gold", "Roundup"],
    allowCreate: false,
  },
];

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
  if (!response.ok) {
    throw new Error(`Auth failed for ${email}: ${payload?.msg || payload?.error_description || response.status}`);
  }
  return payload;
}

async function getProfile(token, authUserId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,email,role,company_id,status&id=eq.${encodeURIComponent(authUserId)}&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    }
  );
  const body = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(body) || body.length === 0) {
    throw new Error("Failed to read profile");
  }
  return body[0];
}

async function apiRequest(token, pathName, init = {}) {
  const response = await fetch(`${APP_BASE_URL}${pathName}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body };
}

function pickWarehouseByType(warehouses, type) {
  return (
    warehouses.find(
      (row) =>
        String(row.name || "").includes(QA_WAREHOUSE_PREFIX) &&
        String(row.warehouse_type || "").toLowerCase() === String(type).toLowerCase()
    ) || null
  );
}

async function run() {
  const adminAuth = await signIn(ADMIN_USER.email, ADMIN_USER.password);
  const adminToken = adminAuth.access_token;
  const adminProfile = await getProfile(adminToken, adminAuth.user?.id);

  const operatorAuth = await signIn(OPERATOR_USER.email, OPERATOR_USER.password);
  const operatorToken = operatorAuth.access_token;
  const operatorProfile = await getProfile(operatorToken, operatorAuth.user?.id);

  if (adminProfile.company_id !== operatorProfile.company_id) {
    throw new Error("Admin and warehouse operator are from different companies");
  }
  const companyId = adminProfile.company_id;

  const warehousesRes = await apiRequest(
    operatorToken,
    `/api/warehouses?companyId=${encodeURIComponent(companyId)}&includeArchived=true`
  );
  if (!warehousesRes.ok || !Array.isArray(warehousesRes.body?.warehouses)) {
    throw new Error(`Failed to load warehouses: ${JSON.stringify(warehousesRes.body)}`);
  }
  const warehouses = warehousesRes.body.warehouses;

  const selectedWarehouses = {};
  for (const [key, type] of Object.entries(REQUIRED_WAREHOUSE_TYPES)) {
    const found = pickWarehouseByType(warehouses, type);
    if (!found) {
      throw new Error(`Required QA warehouse not found for type=${type}`);
    }
    selectedWarehouses[key] = found;
  }

  const productsRes = await apiRequest(
    adminToken,
    `/api/warehouses/products?companyId=${encodeURIComponent(companyId)}&includeArchived=true`
  );
  if (!productsRes.ok || !Array.isArray(productsRes.body?.products)) {
    throw new Error(`Failed to load products: ${JSON.stringify(productsRes.body)}`);
  }
  const products = productsRes.body.products;
  const productByName = new Map(products.map((row) => [String(row.name || "").trim(), row]));

  const createdProducts = [];
  const selectedProducts = {};
  for (const picker of PRODUCT_PICKERS) {
    let found = null;

    for (const name of picker.preferredNames) {
      const row = productByName.get(name);
      if (row && String(row.type || "").toLowerCase() === picker.type) {
        found = row;
        break;
      }
    }

    if (!found) {
      found = products.find((row) => String(row.type || "").toLowerCase() === picker.type) || null;
    }

    if (!found && picker.allowCreate) {
      const createRes = await apiRequest(adminToken, "/api/warehouses/products", {
        method: "POST",
        body: JSON.stringify({
          companyId,
          name: picker.createName,
          type: picker.type,
          unit: picker.createUnit,
          description: "QA_TEST_2026 inbound setup",
        }),
      });
      if (!createRes.ok || !createRes.body?.product?.id) {
        throw new Error(`Failed to create ${picker.key} product: ${JSON.stringify(createRes.body)}`);
      }
      found = createRes.body.product;
      createdProducts.push({ id: found.id, name: found.name, type: found.type });
    }

    if (!found) {
      throw new Error(`No product available for picker=${picker.key} type=${picker.type}`);
    }
    selectedProducts[picker.key] = found;
  }

  const createdTransactions = [];
  for (const picker of PRODUCT_PICKERS) {
    const warehouse = selectedWarehouses[picker.key];
    const product = selectedProducts[picker.key];
    const txRes = await apiRequest(operatorToken, "/api/warehouses/transactions", {
      method: "POST",
      body: JSON.stringify({
        companyId,
        movement_type: "receipt",
        transaction_type: "in",
        destination_warehouse_id: warehouse.id,
        product_id: product.id,
        quantity: picker.quantity,
        operation_datetime: new Date().toISOString(),
        status: "confirmed",
        notes: `QA_TEST_2026 ${picker.key}_receipt`,
      }),
    });

    if (!txRes.ok || !txRes.body?.transaction?.id) {
      throw new Error(`Failed to create ${picker.key} receipt: ${JSON.stringify(txRes.body)}`);
    }
    createdTransactions.push({
      key: picker.key,
      transaction_id: txRes.body.transaction.id,
      warehouse_id: warehouse.id,
      warehouse_name: warehouse.name,
      product_id: product.id,
      product_name: product.name,
      quantity: picker.quantity,
    });
  }

  const txListRes = await apiRequest(
    operatorToken,
    `/api/warehouses/transactions?companyId=${encodeURIComponent(companyId)}&limit=300`
  );
  const qaTransactions = Array.isArray(txListRes.body?.transactions)
    ? txListRes.body.transactions.filter((row) => String(row.notes || "").includes("QA_TEST_2026"))
    : [];

  const report = {
    ok: true,
    app_base_url: APP_BASE_URL,
    company_id: companyId,
    actor: {
      admin: { email: adminProfile.email, role: adminProfile.role, profile_id: adminProfile.id },
      operator: { email: operatorProfile.email, role: operatorProfile.role, profile_id: operatorProfile.id },
    },
    selected_warehouses: Object.fromEntries(
      Object.entries(selectedWarehouses).map(([k, v]) => [k, { id: v.id, name: v.name, warehouse_type: v.warehouse_type }])
    ),
    selected_products: Object.fromEntries(
      Object.entries(selectedProducts).map(([k, v]) => [k, { id: v.id, name: v.name, type: v.type }])
    ),
    created_products: createdProducts,
    created_transactions: createdTransactions,
    qa_transactions_visible: qaTransactions.length,
  };

  const outDir = path.resolve("scripts/output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `qa-seed-inbound-2026-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: outPath,
        created_products: createdProducts.length,
        created_transactions: createdTransactions.length,
        qa_transactions_visible: qaTransactions.length,
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
