import { NextRequest, NextResponse } from "next/server";
import { asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { key: string; label: string; status: "pass" | "warning" | "unavailable"; value: number | string | null; detail?: string };
type Readiness = { key: string; label: string; status: "ready" | "missing" | "needs_review"; count: number; blocker: boolean };

const count = (value: number | null | undefined) => Number(value || 0);
const olderThanIso = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: ["global_admin", "company_admin"],
    });

    const [
      seasonsRes,
      fieldsRes,
      structureRes,
      cropsRes,
      varietiesRes,
      reproductionsRes,
      warehousesRes,
      peopleRes,
      vehiclesRes,
      machinesRes,
      counterpartiesRes,
      negativeStockRes,
      staleShiftsRes,
      oldTicketsRes,
      processingRes,
      ledgerRes,
      batchesRes,
      lotsRes,
      batchInputsRes,
      batchOutputsRes,
      ticketRefsRes,
      schemaWarehouseRes,
      schemaReconciliationRes,
    ] = await Promise.all([
      supabase.from("seasons").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("archived", false),
      supabase.from("fields").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("archived", false),
      supabase.from("crop_structure").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("archived", false),
      supabase.from("crops").select("id", { count: "exact", head: true }).eq("archived", false),
      supabase.from("varieties").select("id", { count: "exact", head: true }).eq("archived", false),
      supabase.from("seed_reproductions").select("id", { count: "exact", head: true }).eq("archived", false),
      supabase.from("warehouses").select("id,warehouse_type,place_type,archived").eq("company_id", companyId).eq("archived", false),
      supabase.from("company_people").select("id,role_type,status,deleted_at").eq("company_id", companyId),
      supabase.from("reference_vehicles").select("id,archived").eq("company_id", companyId).eq("archived", false),
      supabase.from("reference_machines").select("id,archived").eq("company_id", companyId).eq("archived", false),
      supabase.from("counterparties").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("archived", false),
      supabase.from("v_stock_balance_canonical").select("warehouse_id,product_id,quantity,uom", { count: "exact" }).eq("company_id", companyId).lt("quantity", 0).limit(100),
      supabase.from("weighbridge_shifts").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "open").lt("opened_at", olderThanIso(24)),
      supabase.from("tickets").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["draft", "active", "ready_to_close"]).lt("created_at", olderThanIso(24)),
      supabase.from("batch_transformations").select("id,status,processing_state,created_at,balance_snapshot").eq("company_id", companyId).neq("processing_state", "processing_closed").limit(1000),
      supabase.from("stock_ledger_entries").select("id,ticket_id,direction,warehouse_id,inventory_batch_id,is_storno").eq("company_id", companyId).limit(10000),
      supabase.from("inventory_batches").select("id,harvest_lot_id,created_at").eq("company_id", companyId).limit(5000),
      supabase.from("harvest_lots").select("id,created_at").eq("company_id", companyId).limit(5000),
      supabase.from("batch_transformation_inputs").select("batch_id").eq("company_id", companyId).limit(5000),
      supabase.from("batch_transformation_outputs").select("output_batch_id").eq("company_id", companyId).limit(5000),
      supabase.from("tickets").select("batch_id,lot_id").eq("company_id", companyId).limit(5000),
      supabase.from("warehouses").select("id,place_type").eq("company_id", companyId).limit(1),
      supabase.from("weighbridge_reconciliation_controls").select("id").eq("company_id", companyId).limit(1),
    ]);

    const sourceErrors = [
      seasonsRes, fieldsRes, structureRes, cropsRes, varietiesRes, reproductionsRes, warehousesRes,
      peopleRes, vehiclesRes, machinesRes, counterpartiesRes,
    ].map((result: any) => result.error?.message).filter(Boolean);
    const warehouses = warehousesRes.data || [];
    const people = (peopleRes.data || []).filter((row: any) => row.status === "active" && !row.deleted_at);
    const placeCount = (type: string) => warehouses.filter((row: any) => String(row.place_type || "WAREHOUSE") === type).length;
    const roleCount = (role: string) => people.filter((row: any) => String(row.role_type || "") === role).length;
    const fuelCount = warehouses.filter((row: any) => String(row.warehouse_type || "") === "fuel").length;
    const readiness: Readiness[] = [
      { key: "season", label: "Сезон", status: count(seasonsRes.count) ? "ready" : "missing", count: count(seasonsRes.count), blocker: true },
      { key: "fields", label: "Поля", status: count(fieldsRes.count) ? "ready" : "missing", count: count(fieldsRes.count), blocker: true },
      { key: "structure", label: "Структура посевов", status: count(structureRes.count) ? "ready" : "missing", count: count(structureRes.count), blocker: true },
      { key: "crops", label: "Культуры", status: count(cropsRes.count) ? "ready" : "missing", count: count(cropsRes.count), blocker: true },
      { key: "varieties", label: "Сорта", status: count(varietiesRes.count) ? "ready" : "needs_review", count: count(varietiesRes.count), blocker: false },
      { key: "reproductions", label: "Репродукции", status: count(reproductionsRes.count) ? "ready" : "needs_review", count: count(reproductionsRes.count), blocker: false },
      { key: "warehouses", label: "Склады", status: placeCount("WAREHOUSE") ? "ready" : "missing", count: placeCount("WAREHOUSE"), blocker: true },
      { key: "hangars", label: "Ангары", status: placeCount("WAREHOUSE") ? "ready" : "needs_review", count: placeCount("WAREHOUSE"), blocker: false },
      { key: "dryers", label: "Сушилки", status: placeCount("DRYER") ? "ready" : "needs_review", count: placeCount("DRYER"), blocker: false },
      { key: "cleaners", label: "Очистки", status: placeCount("CLEANER") ? "ready" : "needs_review", count: placeCount("CLEANER"), blocker: false },
      { key: "yards", label: "Площадки", status: placeCount("YARD") ? "ready" : "needs_review", count: placeCount("YARD"), blocker: false },
      { key: "weighmen", label: "Весовщики", status: roleCount("weighman") ? "ready" : "missing", count: roleCount("weighman"), blocker: true },
      { key: "drivers", label: "Водители", status: roleCount("driver") ? "ready" : "missing", count: roleCount("driver"), blocker: true },
      { key: "vehicles", label: "Транспорт", status: (vehiclesRes.data || []).length ? "ready" : "missing", count: (vehiclesRes.data || []).length, blocker: true },
      { key: "machines", label: "Техника", status: (machinesRes.data || []).length ? "ready" : "needs_review", count: (machinesRes.data || []).length, blocker: false },
      { key: "counterparties", label: "Контрагенты", status: count(counterpartiesRes.count) ? "ready" : "needs_review", count: count(counterpartiesRes.count), blocker: false },
      { key: "fuel", label: "ГСМ", status: fuelCount ? "ready" : "needs_review", count: fuelCount, blocker: false },
    ];

    const ledgerRows = ledgerRes.data || [];
    const duplicateKeys = new Map<string, number>();
    ledgerRows.filter((row: any) => !row.is_storno && row.ticket_id).forEach((row: any) => {
      const key = [row.ticket_id, row.direction, row.warehouse_id, row.inventory_batch_id].join("::");
      duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
    });
    const duplicateLedger = Array.from(duplicateKeys.values()).filter((value) => value > 1).length;
    const referencedBatchIds = new Set<string>([
      ...ledgerRows.map((row: any) => String(row.inventory_batch_id || "")),
      ...(batchInputsRes.data || []).map((row: any) => String(row.batch_id || "")),
      ...(batchOutputsRes.data || []).map((row: any) => String(row.output_batch_id || "")),
      ...(ticketRefsRes.data || []).map((row: any) => String(row.batch_id || "")),
    ].filter(Boolean));
    const oldBoundary = new Date(olderThanIso(24)).getTime();
    const orphanBatches = (batchesRes.data || []).filter((row: any) => (
      new Date(String(row.created_at || "")).getTime() < oldBoundary && !referencedBatchIds.has(String(row.id))
    )).length;
    const linkedLotIds = new Set<string>([
      ...(batchesRes.data || []).map((row: any) => String(row.harvest_lot_id || "")),
      ...(ticketRefsRes.data || []).map((row: any) => String(row.lot_id || "")),
    ].filter(Boolean));
    const orphanLots = (lotsRes.data || []).filter((row: any) => (
      new Date(String(row.created_at || "")).getTime() < oldBoundary && !linkedLotIds.has(String(row.id))
    )).length;
    const processingRows = processingRes.data || [];
    const processingPending = processingRows.filter((row: any) => new Date(String(row.created_at || "")).getTime() < oldBoundary).length;
    const processingAnomalies = processingRows.filter((row: any) => {
      const delta = Number(row.balance_snapshot?.balance_delta_kg ?? row.balance_snapshot?.difference_kg);
      return Number.isFinite(delta) && Math.abs(delta) > 0.001;
    }).length;

    const checks: Check[] = [
      { key: "domain", label: "Домен", status: request.nextUrl.host ? "pass" : "unavailable", value: request.nextUrl.host || null },
      { key: "deployment", label: "Deployment", status: process.env.VERCEL_URL ? "pass" : "unavailable", value: process.env.VERCEL_URL || "local" },
      { key: "sha", label: "Runtime SHA", status: process.env.VERCEL_GIT_COMMIT_SHA ? "pass" : "unavailable", value: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || null },
      { key: "five_xx", label: "5xx", status: "unavailable", value: null, detail: "Проверяется внешним health-check/observability, не угадывается из одного запроса." },
      { key: "db", label: "Supabase", status: sourceErrors.length ? "warning" : "pass", value: sourceErrors.length ? sourceErrors.length : "connected", detail: sourceErrors.join("; ") || undefined },
      { key: "schema", label: "Schema contract", status: schemaWarehouseRes.error || schemaReconciliationRes.error ? "warning" : "pass", value: schemaWarehouseRes.error || schemaReconciliationRes.error ? "drift" : "current", detail: [schemaWarehouseRes.error?.message, schemaReconciliationRes.error?.message].filter(Boolean).join("; ") || undefined },
      { key: "negative_stock", label: "Отрицательный остаток", status: count(negativeStockRes.count) ? "warning" : negativeStockRes.error ? "unavailable" : "pass", value: count(negativeStockRes.count), detail: negativeStockRes.error?.message },
      { key: "duplicate_ledger", label: "Дубли проводок", status: duplicateLedger ? "warning" : ledgerRes.error ? "unavailable" : "pass", value: duplicateLedger, detail: ledgerRes.error?.message },
      { key: "orphan_batches", label: "Партии без связи", status: orphanBatches ? "warning" : batchesRes.error ? "unavailable" : "pass", value: orphanBatches, detail: batchesRes.error?.message },
      { key: "orphan_lots", label: "Лоты без связи", status: orphanLots ? "warning" : lotsRes.error ? "unavailable" : "pass", value: orphanLots, detail: lotsRes.error?.message },
      { key: "stale_shifts", label: "Старые смены", status: count(staleShiftsRes.count) ? "warning" : staleShiftsRes.error ? "unavailable" : "pass", value: count(staleShiftsRes.count), detail: staleShiftsRes.error?.message },
      { key: "old_tickets", label: "Старые открытые талоны", status: count(oldTicketsRes.count) ? "warning" : oldTicketsRes.error ? "unavailable" : "pass", value: count(oldTicketsRes.count), detail: oldTicketsRes.error?.message },
      { key: "processing_pending", label: "Processing ожидает", status: processingPending ? "warning" : processingRes.error ? "unavailable" : "pass", value: processingPending, detail: processingRes.error?.message },
      { key: "processing_balance", label: "Баланс processing", status: processingAnomalies ? "warning" : processingRes.error ? "unavailable" : "pass", value: processingAnomalies, detail: processingRes.error?.message },
    ];

    const warningCount = checks.filter((check) => check.status === "warning").length;
    return NextResponse.json({
      status: warningCount ? "attention" : "healthy",
      warningCount,
      checks,
      readiness,
      readinessSummary: {
        ready: readiness.filter((item) => item.status === "ready").length,
        missing: readiness.filter((item) => item.status === "missing").length,
        needsReview: readiness.filter((item) => item.status === "needs_review").length,
        blockers: readiness.filter((item) => item.blocker && item.status === "missing").map((item) => item.label),
      },
      autoRepair: false,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Health check failed" }, { status: 500 });
  }
}
