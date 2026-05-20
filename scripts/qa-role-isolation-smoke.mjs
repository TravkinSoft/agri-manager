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

const USERS = [
  { key: "global_admin", email: "Aimbeks@gmail.com", password: "Qqqq1111" },
  { key: "weighman", email: "victorkaretnikov@mail.ru", password: "Qqqq1111!" },
  { key: "specialist", email: "travkin-94@list.ru", password: "Qqqq1111!" },
  { key: "warehouse_operator", email: "roni._@mail.ru", password: "Qqqq1111!" },
  { key: "agronomist", email: "zss010@mail.ru", password: "Qqqq1111!" },
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

async function fetchWithToken(token, input, init = {}) {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, ok: response.ok, body: parsed };
}

async function getProfile(token) {
  const result = await fetchWithToken(
    token,
    `${SUPABASE_URL}/rest/v1/profiles?select=id,role,company_id,email&limit=1`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
      },
    }
  );
  if (!result.ok || !Array.isArray(result.body) || result.body.length === 0) {
    throw new Error(`Failed to load profile: ${JSON.stringify(result.body)}`);
  }
  return result.body[0];
}

function summarizeEndpoint(name, result) {
  return {
    endpoint: name,
    status: result.status,
    ok: result.ok,
    error: result.ok ? null : (typeof result.body === "object" ? result.body?.error || result.body : result.body),
  };
}

async function run() {
  const startedAt = new Date().toISOString();
  const userResults = [];
  let stemCompanyId = null;
  let nonStemCompanyId = null;

  for (const user of USERS) {
    const auth = await signIn(user.email, user.password);
    const token = auth.access_token;
    const profile = await getProfile(token);
    if (!stemCompanyId) {
      stemCompanyId = profile.company_id;
    } else if (profile.company_id !== stemCompanyId && !nonStemCompanyId) {
      nonStemCompanyId = profile.company_id;
    }

    const companyId = profile.company_id;
    const endpoints = {};

    endpoints.dashboard = summarizeEndpoint(
      "GET /api/weighbridge/bootstrap",
      await fetchWithToken(token, `${APP_BASE_URL}/api/weighbridge/bootstrap?companyId=${encodeURIComponent(companyId)}`)
    );
    endpoints.warehouses = summarizeEndpoint(
      "GET /api/warehouses",
      await fetchWithToken(token, `${APP_BASE_URL}/api/warehouses?companyId=${encodeURIComponent(companyId)}`)
    );
    endpoints.operationsReport = summarizeEndpoint(
      "GET /api/operations/reports/potato-material-consumption",
      await fetchWithToken(
        token,
        `${APP_BASE_URL}/api/operations/reports/potato-material-consumption?companyId=${encodeURIComponent(companyId)}&seasonYear=2026&limit=50`
      )
    );
    endpoints.landLegal = summarizeEndpoint(
      "GET /api/land-legal/bootstrap",
      await fetchWithToken(token, `${APP_BASE_URL}/api/land-legal/bootstrap?seasonYear=2026`)
    );

    userResults.push({
      user_key: user.key,
      email: user.email,
      role: profile.role,
      profile_id: profile.id,
      company_id: companyId,
      endpoints,
    });
  }

  if (stemCompanyId && nonStemCompanyId) {
    for (const row of userResults) {
      const auth = await signIn(row.email, USERS.find((u) => u.email === row.email)?.password || "");
      const token = auth.access_token;
      const crossTarget = row.company_id === stemCompanyId ? nonStemCompanyId : stemCompanyId;
      row.cross_company_probe = summarizeEndpoint(
        "GET /api/warehouses?companyId=<other>",
        await fetchWithToken(token, `${APP_BASE_URL}/api/warehouses?companyId=${encodeURIComponent(crossTarget)}`)
      );
    }
  }

  const result = {
    ok: true,
    app_base_url: APP_BASE_URL,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    company_scope: {
      stem_company_id: stemCompanyId,
      other_company_id: nonStemCompanyId,
    },
    users: userResults,
  };

  const outDir = path.resolve("scripts/output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `qa-role-isolation-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(JSON.stringify({ ok: true, output_path: outPath }, null, 2));
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
