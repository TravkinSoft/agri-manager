import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, any>;

const marker = `TZ251 temporary QA data ${new Date().toISOString()}`;
const baseUrl = String(process.env.TZ251_BASE_URL || "http://localhost:30251").replace(/\/$/, "");
const supabaseUrl = String(process.env.TZ251_SUPABASE_URL || "");
const supabaseAnonKey = String(process.env.TZ251_SUPABASE_ANON_KEY || "");
const email = String(process.env.TZ251_QA_EMAIL || "");
const password = String(process.env.TZ251_QA_PASSWORD || "");
const step = (name: string) => console.error(`[tz251-e2e] ${name}`);

async function timed<T>(task: () => Promise<T>) {
  const startedAt = performance.now();
  const value = await task();
  return { value, durationMs: Math.round(performance.now() - startedAt) };
}

function required(value: string, name: string) {
  if (!value) throw new Error(`${name} is required`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function api(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${path} -> ${response.status}: ${payload?.error || JSON.stringify(payload)}`);
  }
  return payload as JsonRecord;
}

async function countRows(client: SupabaseClient<any>, table: string) {
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) throw error;
  return Number(count || 0);
}

async function main() {
  step("start");
  required(supabaseUrl, "TZ251_SUPABASE_URL");
  required(supabaseAnonKey, "TZ251_SUPABASE_ANON_KEY");
  required(email, "TZ251_QA_EMAIL");
  required(password, "TZ251_QA_PASSWORD");

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !authData.session?.access_token || !authData.user?.id) {
    throw authError || new Error("QA sign-in failed");
  }
  const token = authData.session.access_token;
  const actorId = authData.user.id;
  step("authenticated");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,company_id,role,status")
    .eq("id", actorId)
    .single();
  if (profileError) throw profileError;
  assert(profile?.role === "weighman", `Expected weighman QA role, received ${profile?.role || "none"}`);
  assert(profile?.status === "active", "QA weighman profile is not active");
  const companyId = String(profile.company_id || "");
  required(companyId, "QA company_id");

  const initialLoad = await timed(() => Promise.all([
    supabase
      .from("crop_structure")
      .select("id,field_id,season_id,crop_id,variety_id,reproduction_id,area,land_use_type")
      .eq("company_id", companyId)
      .eq("archived", false)
      .not("crop_id", "is", null)
      .is("variety_id", null)
      .is("reproduction_id", null)
      .order("created_at", { ascending: true })
      .limit(10),
    supabase
      .from("warehouses")
      .select("id,name,warehouse_type")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("is_archived", false)
      .in("warehouse_type", ["grain", "temporary_storage", "tok", "elevator"])
      .order("name")
      .limit(5),
    supabase
      .from("reference_vehicles")
      .select("id,name,custom_name,plate_number")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("is_active", true)
      .limit(5),
    supabase
      .from("reference_specialists")
      .select("id,full_name,name_ru,personnel_type")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("status", "active")
      .in("personnel_type", ["driver", "machine_operator", "combine_operator", "worker", "responsible"])
      .order("full_name")
      .limit(10),
  ]));
  const [allocationsResult, warehousesResult, vehiclesResult, driversResult] = initialLoad.value;
  for (const result of [allocationsResult, warehousesResult, vehiclesResult, driversResult]) {
    if (result.error) throw result.error;
  }
  const allocation = allocationsResult.data?.[0];
  const warehouse = warehousesResult.data?.[0];
  const vehicle = vehiclesResult.data?.[0];
  const driver = driversResult.data?.find((row: any) => row.personnel_type === "driver") || driversResult.data?.[0];
  assert(allocation?.id && allocation?.field_id && allocation?.crop_id && allocation?.season_id, "No incomplete harvest allocation available in QA");
  assert(warehouse?.id, "No harvest destination is available in QA");
  assert(vehicle?.id, "No active vehicle is available in QA");
  assert(driver?.id, "No active driver is available in QA");
  assert(Number(allocation.area || 0) > 0, "QA allocation must have a positive whole area for yield fallback proof");
  step("resources-loaded");

  const trackedTables = ["tickets", "ticket_lines", "ticket_weighings", "inventory_batches", "stock_ledger_entries", "products"];
  const before = Object.fromEntries(await Promise.all(trackedTables.map(async (table) => [table, await countRows(supabase, table)])));
  step("before-counts-ready");
  const idempotencyKey = randomUUID();
  const grossKg = 16_240;
  const tareKg = 6_240;
  const moisturePercent = 14.6;
  const payload = {
    companyId,
    ticket: {
      company_id: companyId,
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
      quantity: grossKg,
      uom: "kg",
      warehouse_to_id: warehouse.id,
      variety_id: null,
      reproduction_id: null,
      notes: marker,
    }],
    weighings: [],
  };

  const grossSave = await timed(() => api("/api/weighbridge/tickets", token, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    }));
  const created = grossSave.value;
  const ticketId = String(created.ticket?.id || "");
  assert(ticketId === idempotencyKey, "Ticket did not preserve idempotency key as its id");
  assert(Number(created.ticket?.gross_weight_kg) === grossKg, "Gross snapshot was not saved");
  step("gross-created");
  const replayCreate = await api("/api/weighbridge/tickets", token, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  assert(replayCreate.idempotent_replay === true, "Repeated gross request was not idempotent");
  step("gross-replay-verified");

  const { data: grossEvents, error: grossEventsError } = await supabase
    .from("ticket_weighings")
    .select("id,weighing_no,measured_weight_kg,measured_at,device_source,operator_user_id")
    .eq("ticket_id", ticketId)
    .order("weighing_no");
  if (grossEventsError) throw grossEventsError;
  assert(grossEvents?.length === 1 && Number(grossEvents[0].weighing_no) === 1, "Gross event was duplicated or missing");
  assert(Number(grossEvents[0].measured_weight_kg) === grossKg, "Gross event value mismatch");
  assert(grossEvents[0].device_source === "manual" && grossEvents[0].operator_user_id === actorId, "Gross event provenance mismatch");
  assert(Number.isFinite(Date.parse(String(grossEvents[0].measured_at || ""))), "Gross event timestamp is missing");
  const ticketList = await api("/api/weighbridge/tickets", token);
  assert((ticketList.tickets || []).some((row: any) => row.id === ticketId), "Ticket did not survive canonical refetch");
  step("refresh-verified");

  const tarePatch = { companyId, tare_weight_kg: tareKg, moisture_percent: moisturePercent, status: "ready_to_close", notes: marker };
  const tareSave = await timed(() => api(`/api/weighbridge/tickets/${ticketId}`, token, { method: "PATCH", body: JSON.stringify(tarePatch) }));
  await api(`/api/weighbridge/tickets/${ticketId}`, token, { method: "PATCH", body: JSON.stringify(tarePatch) });
  step("tare-replay-verified");
  const { data: allEvents, error: eventsError } = await supabase
    .from("ticket_weighings")
    .select("id,weighing_no,measured_weight_kg,measured_at,device_source,operator_user_id")
    .eq("ticket_id", ticketId)
    .order("weighing_no");
  if (eventsError) throw eventsError;
  assert(allEvents?.length === 2, `Expected two weighing events, received ${allEvents?.length || 0}`);
  assert(Number(allEvents[1].weighing_no) === 2 && Number(allEvents[1].measured_weight_kg) === tareKg, "Tare event mismatch");
  assert(allEvents[1].device_source === "manual" && allEvents[1].operator_user_id === actorId, "Tare event provenance mismatch");
  assert(Number.isFinite(Date.parse(String(allEvents[1].measured_at || ""))), "Tare event timestamp is missing");

  const finalizeSave = await timed(() => api(`/api/weighbridge/tickets/${ticketId}/finalize`, token, { method: "POST", body: JSON.stringify({ companyId }) }));
  const finalized = finalizeSave.value;
  assert(finalized.ticket?.status === "finalized", "Harvest ticket was not finalized");
  const replayFinalize = await api(`/api/weighbridge/tickets/${ticketId}/finalize`, token, { method: "POST", body: JSON.stringify({ companyId }) });
  assert(replayFinalize.idempotent_replay === true, "Repeated finalize was not idempotent");
  step("finalize-replay-verified");

  const [ticketResult, linesResult, batchesResult, ledgerResult, bootstrap, yieldContext] = await Promise.all([
    supabase.from("tickets").select("id,status,gross_weight_kg,tare_weight_kg,net_weight_kg,requires_review,review_reason,field_id,season_id,crop_structure_allocation_id").eq("id", ticketId).single(),
    supabase.from("ticket_lines").select("id,product_id,crop_id,variety_id,reproduction_id,moisture_percent,quantity,warehouse_to_id").eq("ticket_id", ticketId),
    supabase.from("inventory_batches").select("id,product_id,crop_id,variety_id,reproduction_id,source_field_id,source_ticket_id,moisture_percent,current_weight_kg,warehouse_id").eq("source_ticket_id", ticketId),
    supabase.from("stock_ledger_entries").select("id,ticket_id,product_id,warehouse_id,quantity,direction,inventory_batch_id,crop_id,variety_id,reproduction_id").eq("ticket_id", ticketId),
    api("/api/weighbridge/bootstrap", token),
    api(`/api/weighbridge/harvest-context?fieldId=${encodeURIComponent(allocation.field_id)}&allocationId=${encodeURIComponent(allocation.id)}`, token),
  ]);
  for (const result of [ticketResult, linesResult, batchesResult, ledgerResult]) {
    if (result.error) throw result.error;
  }
  const ticket = ticketResult.data;
  const lines = linesResult.data || [];
  const batches = batchesResult.data || [];
  const ledger = ledgerResult.data || [];
  assert(ticket?.status === "finalized", "Final ticket state mismatch");
  assert(Number(ticket.gross_weight_kg) === grossKg && Number(ticket.tare_weight_kg) === tareKg && Number(ticket.net_weight_kg) === grossKg - tareKg, "Ticket weight snapshots mismatch");
  assert(ticket.requires_review === true, "Incomplete identity was not marked for review");
  assert(String(ticket.review_reason || "").includes("missing_variety") && String(ticket.review_reason || "").includes("missing_reproduction"), "Incomplete identity review reasons mismatch");
  assert(lines.length === 1 && Number(lines[0].moisture_percent) === moisturePercent, "Canonical ticket moisture mismatch");
  assert(lines[0].variety_id == null && lines[0].reproduction_id == null, "Missing identity was replaced with guessed values");
  assert(batches.length === 1 && Number(batches[0].moisture_percent) === moisturePercent, "Batch moisture was not synchronized");
  assert(batches[0].source_field_id === allocation.field_id && batches[0].warehouse_id === warehouse.id, "Harvest batch origin/destination mismatch");
  assert(ledger.length === 1 && Number(ledger[0].quantity) === grossKg - tareKg, "Harvest ledger entry mismatch or duplicate");
  assert(Number(bootstrap.harvestSummary?.today?.netKg || 0) >= grossKg - tareKg, "Today harvest summary did not include the finalized trip");
  assert(Number(bootstrap.harvestSummary?.byField?.[allocation.field_id]?.cumulative?.netKg || 0) >= grossKg - tareKg, "Field harvest summary did not include the finalized trip");
  if (Number(yieldContext.harvestedAreaHa || 0) <= 0) {
    assert(yieldContext.yieldTPerHa == null, "Yield was calculated from whole crop-structure area without harvested area");
  }
  step("postconditions-verified");

  const after = Object.fromEntries(await Promise.all(trackedTables.map(async (table) => [table, await countRows(supabase, table)])));
  console.log(JSON.stringify({
    status: "PASS",
    baseUrl,
    marker,
    companyId,
    ticketId,
    productId: lines[0].product_id,
    lineIds: lines.map((row: any) => row.id),
    weighingIds: allEvents.map((row: any) => row.id),
    batchIds: batches.map((row: any) => row.id),
    ledgerIds: ledger.map((row: any) => row.id),
    allocationId: allocation.id,
    fieldId: allocation.field_id,
    cropId: allocation.crop_id,
    destinationWarehouseId: warehouse.id,
    vehicleId: vehicle.id,
    driverId: driver.id,
    reviewReason: ticket.review_reason,
    before,
    after,
    checks: {
      createIdempotent: true,
      finalizeIdempotent: true,
      refreshPersistence: true,
      twoWeighingEvents: true,
      weightSnapshots: true,
      incompleteIdentityHonest: true,
      moistureCanonical: true,
      batchMoisture: true,
      ledgerSingle: true,
      summaries: true,
      weighingTimestamps: true,
      yieldWithoutHarvestedArea: Number(yieldContext.harvestedAreaHa || 0) <= 0
        ? yieldContext.yieldTPerHa == null
        : true,
    },
    yieldSafety: {
      cropStructureAreaHa: Number(allocation.area || 0),
      harvestedAreaHa: Number(yieldContext.harvestedAreaHa || 0),
      yieldTPerHa: yieldContext.yieldTPerHa ?? null,
    },
    performance: {
      initialLoadMs: initialLoad.durationMs,
      grossSaveMs: grossSave.durationMs,
      tareSaveMs: tareSave.durationMs,
      finalizeMs: finalizeSave.durationMs,
    },
  }, null, 2));
  await supabase.auth.signOut();
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
