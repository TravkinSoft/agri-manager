import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, any>;

const QA_REF = "gsglkmudcwkdetqtocae";
const QA_COMPANY_ID = "8a0f2c0e-6638-4a31-99a8-cab4237d287d";
const QA_OPERATOR_PERSON_ID = "34048fa7-9fb8-46e7-a048-9c5f1da7f7c1";
const marker = `TZ271 temporary QA data ${new Date().toISOString()}`;
const rawBaseUrl = String(process.env.TZ271_BASE_URL || "").trim();
const supabaseUrl = String(process.env.TZ271_SUPABASE_URL || "").trim();
const supabaseAnonKey = String(process.env.TZ271_SUPABASE_ANON_KEY || "").trim();
const adminEmail = String(process.env.TZ271_QA_ADMIN_EMAIL || "").trim();
const password = String(process.env.TZ271_QA_PASSWORD || "");
const operatorPin = String(process.env.TZ271_QA_OPERATOR_PIN || "");

function required(value: string, name: string) {
  if (!value) throw new Error(`${name} is required`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cookiePair(value: string) {
  return value.split(";", 1)[0]?.trim() || "";
}

function collectCookies(response: Response, jar: Map<string, string>) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || (response.headers.get("set-cookie") ? [String(response.headers.get("set-cookie"))] : []);
  for (const value of values) {
    const pair = cookiePair(value);
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(jar: Map<string, string>) {
  return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function requestJson(
  baseUrl: string,
  jar: Map<string, string>,
  token: string,
  path: string,
  init: RequestInit = {}
) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
      ...(init.headers || {}),
    },
    redirect: "manual",
  });
  collectCookies(response, jar);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${response.status}: ${payload?.error || JSON.stringify(payload)}`);
  }
  return payload as JsonRecord;
}

async function signIn(email: string) {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token || !data.user?.id) throw error || new Error("QA sign-in failed");
  return { client, token: data.session.access_token, userId: data.user.id };
}

async function main() {
  for (const [value, name] of [
    [rawBaseUrl, "TZ271_BASE_URL"],
    [supabaseUrl, "TZ271_SUPABASE_URL"],
    [supabaseAnonKey, "TZ271_SUPABASE_ANON_KEY"],
    [adminEmail, "TZ271_QA_ADMIN_EMAIL"],
    [password, "TZ271_QA_PASSWORD"],
    [operatorPin, "TZ271_QA_OPERATOR_PIN"],
  ] as const) required(value, name);
  assert(/^\d{6}$/.test(operatorPin), "TZ271_QA_OPERATOR_PIN must contain exactly six digits");
  assert(new URL(supabaseUrl).hostname === `${QA_REF}.supabase.co`, "E2E must target exact QA Supabase");
  const sharedUrl = new URL(rawBaseUrl);
  assert(sharedUrl.hostname.endsWith(".vercel.app"), "E2E must target a Vercel Preview");
  const baseUrl = `${sharedUrl.protocol}//${sharedUrl.host}`;
  const jar = new Map<string, string>();
  const accessResponse = await fetch(sharedUrl, { redirect: "manual" });
  collectCookies(accessResponse, jar);

  const admin = await signIn(adminEmail);
  const { data: profile, error: profileError } = await admin.client
    .from("profiles")
    .select("id,company_id,role,status")
    .eq("id", admin.userId)
    .single();
  if (profileError) throw profileError;
  assert(profile?.role === "global_admin" && profile?.status === "active", "QA Global Admin profile mismatch");

  const pinState = await requestJson(
    baseUrl,
    jar,
    admin.token,
    `/api/references/company-people/${QA_OPERATOR_PERSON_ID}/weighbridge-access`,
    {
      method: "PUT",
      body: JSON.stringify({ action: "set_pin", companyId: QA_COMPANY_ID, pin: operatorPin }),
    }
  );
  assert(pinState.pin_configured === true && pinState.access_enabled === true, "Temporary QA PIN was not enabled");
  const unlocked = await requestJson(baseUrl, jar, admin.token, "/api/weighbridge/operator-session", {
    method: "POST",
    body: JSON.stringify({
      action: "unlock",
      companyId: QA_COMPANY_ID,
      personId: QA_OPERATOR_PERSON_ID,
      pin: operatorPin,
      note: marker,
    }),
  });
  assert(unlocked.unlocked === true && unlocked.operator?.id === QA_OPERATOR_PERSON_ID, "QA operator session was not unlocked");

  const [allocations, warehouses, vehicles, drivers] = await Promise.all([
    admin.client.from("crop_structure")
      .select("id,field_id,season_id,crop_id,variety_id,reproduction_id,area")
      .eq("company_id", QA_COMPANY_ID).eq("archived", false).not("crop_id", "is", null)
      .order("created_at", { ascending: true }).limit(20),
    admin.client.from("warehouses")
      .select("id,name,warehouse_type").eq("company_id", QA_COMPANY_ID)
      .eq("archived", false).eq("is_archived", false)
      .in("warehouse_type", ["grain", "temporary_storage", "tok", "elevator"]).limit(10),
    admin.client.from("reference_vehicles")
      .select("id,name,plate_number,status").eq("company_id", QA_COMPANY_ID)
      .eq("archived", false).eq("is_active", true).limit(10),
    admin.client.from("company_people")
      .select("id,full_name,role_type").eq("company_id", QA_COMPANY_ID)
      .eq("role_type", "driver").eq("status", "active").is("deleted_at", null).limit(10),
  ]);
  for (const result of [allocations, warehouses, vehicles, drivers]) if (result.error) throw result.error;
  const allocation = allocations.data?.find((row: any) => row.variety_id && row.reproduction_id) || allocations.data?.[0];
  const warehouse = warehouses.data?.[0];
  const vehicle = vehicles.data?.find((row: any) => row.status !== "busy") || vehicles.data?.[0];
  const driver = drivers.data?.[0];
  assert(allocation?.id && allocation.field_id && allocation.crop_id && allocation.season_id, "QA crop allocation is missing");
  assert(warehouse?.id && vehicle?.id && driver?.id, "QA destination, vehicle, or driver is missing");

  const ticketId = randomUUID();
  const grossKg = 28_000;
  const tareKg = 10_000;
  const netKg = 18_000;
  const moisturePercent = 13.8;
  const payload = {
    companyId: QA_COMPANY_ID,
    ticket: {
      id: ticketId,
      company_id: QA_COMPANY_ID,
      ticket_type: "harvest",
      op_type: "harvest_incoming",
      direction: "incoming",
      source_kind: "field",
      destination_kind: "warehouse",
      source_id: allocation.field_id,
      destination_id: warehouse.id,
      field_id: allocation.field_id,
      warehouse_to_id: warehouse.id,
      crop_structure_allocation_id: allocation.id,
      vehicle_id: vehicle.id,
      driver_id: driver.id,
      gross_weight_kg: grossKg,
      tare_weight_kg: null,
      weigh_method: "preset_tare",
      notes: marker,
    },
    lines: [{
      product_id: allocation.crop_id,
      crop_id: allocation.crop_id,
      variety_id: allocation.variety_id,
      reproduction_id: allocation.reproduction_id,
      quantity: grossKg,
      uom: "kg",
      warehouse_to_id: warehouse.id,
      notes: marker,
    }],
    weighings: [],
  };

  const grossStarted = performance.now();
  const created = await requestJson(baseUrl, jar, admin.token, "/api/weighbridge/tickets", {
    method: "POST",
    headers: { "Idempotency-Key": ticketId },
    body: JSON.stringify(payload),
  });
  const grossMs = Math.round(performance.now() - grossStarted);
  assert(created.ticket?.id === ticketId, "GROSS ticket id mismatch");
  const grossReplay = await requestJson(baseUrl, jar, admin.token, "/api/weighbridge/tickets", {
    method: "POST",
    headers: { "Idempotency-Key": ticketId },
    body: JSON.stringify(payload),
  });
  assert(grossReplay.idempotent_replay === true, "GROSS retry was not idempotent");

  await requestJson(baseUrl, jar, admin.token, `/api/weighbridge/tickets/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify({
      companyId: QA_COMPANY_ID,
      tare_weight_kg: tareKg,
      moisture_percent: moisturePercent,
      status: "ready_to_close",
      notes: marker,
    }),
  });
  const finalizeStarted = performance.now();
  const finalized = await requestJson(baseUrl, jar, admin.token, `/api/weighbridge/tickets/${ticketId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ companyId: QA_COMPANY_ID }),
  });
  const finalizeMs = Math.round(performance.now() - finalizeStarted);
  assert(finalized.ticket?.status === "finalized", "Ticket was not finalized");
  const finalizeReplay = await requestJson(baseUrl, jar, admin.token, `/api/weighbridge/tickets/${ticketId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ companyId: QA_COMPANY_ID }),
  });
  assert(finalizeReplay.idempotent_replay === true, "Finalize retry was not idempotent");

  const [ticketResult, linesResult, weighingsResult, batchesResult, ledgerResult, lotLinksResult, bootstrap] = await Promise.all([
    admin.client.from("tickets").select("id,status,is_finalized,gross_weight_kg,tare_weight_kg,net_weight_kg").eq("id", ticketId).single(),
    admin.client.from("ticket_lines").select("id,quantity,net_line_weight_kg,mass_kg,moisture_percent").eq("ticket_id", ticketId),
    admin.client.from("ticket_weighings").select("id,weighing_no,measured_weight_kg").eq("ticket_id", ticketId).order("weighing_no"),
    admin.client.from("inventory_batches").select("id,mass_kg,current_weight_kg,moisture_percent,warehouse_id").eq("source_ticket_id", ticketId),
    admin.client.from("stock_ledger_entries").select("id,quantity,mass_kg,delta_qty_signed,direction,warehouse_id,inventory_batch_id").eq("ticket_id", ticketId),
    admin.client.from("harvest_lot_batches").select("id,harvest_lot_id,inventory_batch_id,source_ticket_id").eq("source_ticket_id", ticketId),
    requestJson(baseUrl, jar, admin.token, `/api/weighbridge/bootstrap?companyId=${QA_COMPANY_ID}`),
  ]);
  for (const result of [ticketResult, linesResult, weighingsResult, batchesResult, ledgerResult, lotLinksResult]) if (result.error) throw result.error;
  const ticket = ticketResult.data;
  const lines = linesResult.data || [];
  const weighings = weighingsResult.data || [];
  const batches = batchesResult.data || [];
  const ledger = ledgerResult.data || [];
  const lotLinks = lotLinksResult.data || [];
  assert(ticket?.status === "finalized" && ticket.is_finalized === true, "Final ticket state mismatch");
  assert(Number(ticket.net_weight_kg) === netKg, "NET mismatch");
  assert(lines.length === 1, "Expected exactly one ticket line");
  assert(Number(lines[0].quantity) === netKg && Number(lines[0].net_line_weight_kg) === netKg && Number(lines[0].mass_kg) === netKg, "Ticket line mass contract mismatch");
  assert(Number(lines[0].moisture_percent) === moisturePercent, "Line moisture mismatch");
  assert(weighings.length === 2 && Number(weighings[0].measured_weight_kg) === grossKg && Number(weighings[1].measured_weight_kg) === tareKg, "Weighing events mismatch");
  assert(batches.length === 1 && Number(batches[0].mass_kg) === netKg, "Technical batch mismatch");
  assert(Number(batches[0].moisture_percent) === moisturePercent, "Batch moisture mismatch");
  assert(lotLinks.length === 1 && lotLinks[0].inventory_batch_id === batches[0].id, "Harvest lot link mismatch");
  assert(ledger.length === 1 && Number(ledger[0].delta_qty_signed) === netKg && Number(ledger[0].mass_kg) === netKg, "Ledger mismatch or duplicate");
  assert((bootstrap.tickets || []).some((row: any) => row.id === ticketId) || Number(bootstrap.harvestSummary?.today?.netKg || 0) >= netKg, "Dashboard/bootstrap did not observe finalized ticket");

  console.log(JSON.stringify({
    status: "PASS",
    target: "QA",
    ticketId,
    lineIds: lines.map((row: any) => row.id),
    weighingIds: weighings.map((row: any) => row.id),
    batchIds: batches.map((row: any) => row.id),
    ledgerIds: ledger.map((row: any) => row.id),
    lotLinkIds: lotLinks.map((row: any) => row.id),
    lotIds: lotLinks.map((row: any) => row.harvest_lot_id),
    warehouseId: warehouse.id,
    vehicleId: vehicle.id,
    grossKg,
    tareKg,
    netKg,
    moisturePercent,
    grossMs,
    finalizeMs,
    idempotentGross: true,
    idempotentFinalize: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
