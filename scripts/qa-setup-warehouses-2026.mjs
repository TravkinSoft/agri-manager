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
  email: "Aimbeks@gmail.com",
  password: "Qqqq1111",
};

const WAREHOUSE_SPECS = [
  { name: "QA_TEST_2026_Склад семян", warehouse_type: "seed", capacity_value: 5000, capacity_unit: "kg" },
  { name: "QA_TEST_2026_Склад удобрений", warehouse_type: "fertilizer", capacity_value: 8000, capacity_unit: "kg" },
  { name: "QA_TEST_2026_Склад СЗР", warehouse_type: "pesticide", capacity_value: 3000, capacity_unit: "kg" },
  { name: "QA_TEST_2026_Овощной склад", warehouse_type: "vegetable", capacity_value: 12000, capacity_unit: "kg" },
  { name: "QA_TEST_2026_Временный склад", warehouse_type: "temporary", capacity_value: 6000, capacity_unit: "kg" },
  { name: "QA_TEST_2026_Зерновой склад", warehouse_type: "grain", capacity_value: 15000, capacity_unit: "kg" },
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
    throw new Error(`Auth failed: ${payload?.msg || payload?.error_description || response.status}`);
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

async function run() {
  const auth = await signIn(ADMIN_USER.email, ADMIN_USER.password);
  const token = auth.access_token;
  const profile = await getProfile(token, auth.user?.id);
  const companyId = profile.company_id;

  const listRes = await apiRequest(token, `/api/warehouses?companyId=${encodeURIComponent(companyId)}&includeArchived=true`);
  if (!listRes.ok || !Array.isArray(listRes.body?.warehouses)) {
    throw new Error(`Failed to load warehouses: ${JSON.stringify(listRes.body)}`);
  }
  const existing = listRes.body.warehouses;
  const existingByName = new Map(existing.map((row) => [String(row.name || "").trim(), row]));

  const created = [];
  const reused = [];
  const failed = [];

  for (const spec of WAREHOUSE_SPECS) {
    const found = existingByName.get(spec.name);
    if (found) {
      reused.push({ id: found.id, name: found.name, archived: Boolean(found.archived || found.is_archived) });
      continue;
    }

    const createRes = await apiRequest(token, "/api/warehouses", {
      method: "POST",
      body: JSON.stringify({
        companyId,
        name: spec.name,
        warehouse_type: spec.warehouse_type,
        capacity_value: spec.capacity_value,
        capacity_unit: spec.capacity_unit,
        location: "QA_TEST_2026",
        description: "QA_TEST_2026 potato-cycle e2e setup",
      }),
    });

    if (!createRes.ok || !createRes.body?.warehouse?.id) {
      failed.push({ name: spec.name, status: createRes.status, error: createRes.body?.error || createRes.body });
      continue;
    }
    created.push({ id: createRes.body.warehouse.id, name: createRes.body.warehouse.name });
  }

  const allManaged = [...created, ...reused];
  const deleteChecks = [];
  for (const row of allManaged) {
    const checkRes = await apiRequest(
      token,
      `/api/warehouses/${encodeURIComponent(row.id)}/delete-check?companyId=${encodeURIComponent(companyId)}`
    );
    deleteChecks.push({
      id: row.id,
      name: row.name,
      status: checkRes.status,
      can_delete: checkRes.body?.can_delete ?? null,
      reasons: checkRes.body?.reasons ?? [],
    });
  }

  const report = {
    ok: failed.length === 0,
    app_base_url: APP_BASE_URL,
    company_id: companyId,
    actor: { email: profile.email, role: profile.role, profile_id: profile.id },
    totals: {
      requested: WAREHOUSE_SPECS.length,
      created: created.length,
      reused: reused.length,
      failed: failed.length,
    },
    created,
    reused,
    failed,
    delete_checks: deleteChecks,
  };

  const outDir = path.resolve("scripts/output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `qa-setup-warehouses-2026-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(JSON.stringify({ ok: report.ok, output_path: outPath, totals: report.totals }, null, 2));
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
