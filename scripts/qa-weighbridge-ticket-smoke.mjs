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

const ADMIN_USER = { email: "Aimbeks@gmail.com", password: "Qqqq1111" };
const WEIGHMAN_USER = { email: "victorkaretnikov@mail.ru", password: "Qqqq1111!" };

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

async function getMyProfile(token, authUserId) {
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
    throw new Error(`Failed to read profile for auth user ${authUserId}`);
  }
  return body[0];
}

function getBuildIdFromHtml(html) {
  const marker = '"buildId":"';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  const end = html.indexOf('"', from);
  if (end < 0) return null;
  return html.slice(from, end);
}

async function run() {
  const adminAuth = await signIn(ADMIN_USER.email, ADMIN_USER.password);
  const weighmanAuth = await signIn(WEIGHMAN_USER.email, WEIGHMAN_USER.password);

  const adminProfile = await getMyProfile(adminAuth.access_token, adminAuth.user?.id);
  const weighmanProfile = await getMyProfile(weighmanAuth.access_token, weighmanAuth.user?.id);

  const companyId = adminProfile.company_id;
  const bootstrap = await fetchWithToken(
    weighmanAuth.access_token,
    `${APP_BASE_URL}/api/weighbridge/bootstrap?companyId=${encodeURIComponent(companyId)}`
  );

  const ticketList = await fetchWithToken(
    weighmanAuth.access_token,
    `${APP_BASE_URL}/api/weighbridge/tickets?companyId=${encodeURIComponent(companyId)}&limit=50`
  );

  const html = await fetch(`${APP_BASE_URL}`, { method: "GET" }).then((r) => r.text());
  const buildId = getBuildIdFromHtml(html);

  const report = {
    ok: true,
    app_base_url: APP_BASE_URL,
    build_id: buildId,
    company_id: companyId,
    roles: {
      admin: { email: adminProfile.email, role: adminProfile.role, status: adminProfile.status },
      weighman: { email: weighmanProfile.email, role: weighmanProfile.role, status: weighmanProfile.status },
    },
    checks: {
      weighbridge_bootstrap: {
        status: bootstrap.status,
        ok: bootstrap.ok,
      },
      weighbridge_tickets_list: {
        status: ticketList.status,
        ok: ticketList.ok,
        tickets_count: Array.isArray(ticketList.body?.tickets) ? ticketList.body.tickets.length : null,
      },
    },
  };

  const outDir = path.resolve("scripts/output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `qa-weighbridge-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(JSON.stringify({ ok: true, output_path: outPath, build_id: buildId }, null, 2));
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
