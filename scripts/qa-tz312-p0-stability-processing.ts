import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isOpenProcessingWorkItem,
  processingWorkState,
  selectPrimaryProcessingItems,
} from "../lib/weighbridge/processing-work-state";
import type { BatchTransformationRow } from "../lib/services/processing";

const read = (path: string) => readFileSync(path, "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const processingUi = read("components/weighbridge/processing-workspace.tsx");
const processingRoute = read("app/api/processing/transformations/route.ts");
const weighbridgeAuth = read("app/api/weighbridge/_auth.ts");
const workspaceTabs = read("components/weighbridge/universal-workspace-tabs.tsx");
const processingInputReuseMigration = read(
  "supabase/migrations/20260830072000_tz312_processing_input_warehouse_context_v1.sql",
);

let passed = 0;
const check = (name: string, test: () => void) => {
  test();
  passed += 1;
  console.log(`PASS ${name}`);
};

const item = (overrides: Partial<BatchTransformationRow>): BatchTransformationRow => ({
  id: "transformation-1",
  company_id: "company-1",
  transformation_type: "cleaning",
  status: "draft",
  processing_node_id: null,
  node_warehouse_id: "warehouse-1",
  node_place_type: "CLEANER",
  processing_node_name: "ЗАВ-40",
  source_ticket_id: null,
  started_at: null,
  completed_at: null,
  created_at: "2026-08-30T00:00:00.000Z",
  note: null,
  input_label: "Пшеница · Айна · РС1",
  input_weight_kg: 0,
  source_warehouse_name: null,
  outputs: [],
  processing_state: "in_processing",
  input_total_kg: 0,
  main_output_kg: 0,
  byproduct_kg: 0,
  stock_waste_kg: 0,
  approved_process_loss_kg: 0,
  moisture_loss_kg: 0,
  balance_delta_kg: 0,
  unallocated_kg: 0,
  ...overrides,
});

check("movement does not load unrelated secondary catalogs", () => {
  const declaration = page.match(/const needsSecondaryCatalogs = \[[\s\S]*?\.includes\(form\.operationType\);/)?.[0] || "";
  assert.match(declaration, /supplier_receipt/);
  assert.match(declaration, /issue_to_field/);
  assert.match(declaration, /shipment_outbound/);
  assert.doesNotMatch(declaration, /transfer_between_warehouses/);
});

check("secondary catalogs wait for workspace hydration and core data", () => {
  assert.match(page, /if \(!workspaceReady \|\| !coreDataReady\) return;/);
  assert.match(page, /disabled=\{!workspaceReady\}/);
  assert.match(page, /if \(!workspaceReady\) return false;/);
});

check("secondary catalog request survives fast mode changes", () => {
  assert.doesNotMatch(page, /loadSecondaryCatalogs\(controller\.signal\)/);
  assert.doesNotMatch(page, /return \(\) => controller\.abort\(\);[\s\S]*Secondary catalogs are intentionally lazy/);
  assert.match(page, /secondaryCatalogGenerationRef/);
  assert.match(page, /secondaryCatalogError/);
  assert.match(page, /activeSecondaryCatalogError = needsSecondaryCatalogs \? secondaryCatalogError : ""/);
});

check("processing cards wait for the core bootstrap", () => {
  assert.match(page, /enabled=\{coreDataReady && \(!canUseOperatorSession \|\| operatorState\.unlocked\)\}/);
});

check("zero-mass placeholder is empty, never reconciliation", () => {
  assert.equal(processingWorkState(item({ processing_state: "processing_pending_outputs" })), "empty");
  assert.equal(isOpenProcessingWorkItem(item({ processing_state: "processing_pending_outputs" })), false);
});

check("real incoming mass is active automatically", () => {
  assert.equal(processingWorkState(item({ input_total_kg: 8_500, input_weight_kg: 8_500, balance_delta_kg: 8_500, unallocated_kg: 8_500 })), "active");
  assert.equal(processingWorkState(item({ input_total_kg: 0.001, input_weight_kg: 0.001, balance_delta_kg: 0.001, unallocated_kg: 0.001 })), "active");
});

check("only a real unresolved residual is reconciliation", () => {
  assert.equal(processingWorkState(item({
    processing_state: "processing_pending_outputs",
    input_total_kg: 100_000,
    input_weight_kg: 100_000,
    main_output_kg: 97_800,
    balance_delta_kg: 2_200,
    unallocated_kg: 2_200,
  })), "reconciliation");
});

check("fully allocated pending cycle remains available for hard close", () => {
  const balanced = item({
    processing_state: "processing_pending_outputs",
    input_total_kg: 100_000,
    input_weight_kg: 100_000,
    main_output_kg: 100_000,
    balance_delta_kg: 0,
    unallocated_kg: 0,
  });
  assert.equal(processingWorkState(balanced), "ready");
  assert.equal(isOpenProcessingWorkItem(balanced), true);
});

check("negative over-allocation remains visible for reconciliation", () => {
  assert.equal(processingWorkState(item({
    processing_state: "processing_pending_outputs",
    input_total_kg: 5_000,
    input_weight_kg: 5_000,
    main_output_kg: 19_000,
    approved_process_loss_kg: 1_000,
    balance_delta_kg: -15_000,
  })), "reconciliation");
});

check("missing canonical input cannot become ready through display fallback", () => {
  assert.equal(processingWorkState(item({
    processing_state: "processing_pending_outputs",
    input_total_kg: 0,
    input_weight_kg: 5_000,
    balance_delta_kg: 0,
  })), "reconciliation");
});

check("drying cannot become ready without the moisture required by hard close", () => {
  const baseDrying = {
    transformation_type: "drying",
    processing_state: "processing_pending_outputs" as const,
    input_total_kg: 10_000,
    input_weight_kg: 10_000,
    main_output_kg: 10_000,
    balance_delta_kg: 0,
  };
  assert.equal(processingWorkState(item(baseDrying)), "reconciliation");
  assert.equal(processingWorkState(item({ ...baseDrying, input_moisture_percent: 20, output_moisture_percent: 100 })), "reconciliation");
  assert.equal(processingWorkState(item({ ...baseDrying, input_moisture_percent: 20, output_moisture_percent: 20 })), "ready");
});

check("weightman has no processing lifecycle menu", () => {
  assert.match(processingUi, /canOperateLifecycle = \["global_admin", "company_admin"\]/);
  assert.match(processingUi, /showActions = canOperateLifecycle \|\| \(pending && canManageBalance\)/);
  assert.match(processingUi, /Партия обработана/);
  assert.match(processingUi, /Возобновить приём/);
});

check("signed balance and drying moisture follow the canonical backend formula", () => {
  assert.match(processingRoute, /balance_delta_kg: balanceDeltaKg/);
  assert.match(processingRoute, /\.toFixed\(3\)/);
  assert.match(processingRoute, /const unallocatedKg = Math\.max\(balanceDeltaKg, 0\)/);
  assert.match(processingRoute, /const dryMatterKg = inputTotalKg \* \(1 - inputMoisture\.percent \/ 100\)/);
});

check("attached input ticket does not return to the waiting queue", () => {
  assert.match(processingRoute, /inputs\.map\(\(row: any\) => String\(row\.source_ticket_id/);
  assert.match(processingRoute, /loadWaitingTickets\(supabase, companyId, usedTicketIds\)/);
});

check("ticket finalize invalidates processing cards without a page reload", () => {
  assert.match(page, /const notifyWeighbridgeDataChanged = \(\) =>/);
  assert.match(page, /window\.dispatchEvent\(new Event\("travkin:weighbridge-data-changed"\)\)/);
  assert.ok((page.match(/notifyWeighbridgeDataChanged\(\)/g) || []).length >= 2);
  assert.match(page, /let lastMainOutputMarkError: any = null/);
  assert.match(page, /performProcessingAction\(linkedProcessingId[\s\S]*catch \(error: any\)[\s\S]*finally \{[\s\S]*notifyWeighbridgeDataChanged\(\)/);
  assert.match(page, /Талон закрыт, последний рейс не отмечен/);
  assert.match(page, /setActiveTicket\(null\)/);
  assert.match(processingUi, /if \(loadInFlight\.current\) \{[\s\S]*loadPending\.current = true/);
  assert.match(processingUi, /\} while \(loadPending\.current\)/);
});

check("one processing object exposes only its newest active product as the primary card", () => {
  const olderPending = item({
    id: "old-cycle",
    processing_state: "processing_pending_outputs",
    started_at: "2026-08-29T10:00:00.000Z",
    input_total_kg: 8_500,
    balance_delta_kg: 8_500,
  });
  const currentActive = item({
    id: "current-cycle",
    processing_state: "in_processing",
    started_at: "2026-08-30T10:00:00.000Z",
    input_total_kg: 1_000,
    balance_delta_kg: 1_000,
  });
  const otherObject = item({
    id: "other-object-cycle",
    node_warehouse_id: "warehouse-2",
    started_at: "2026-08-28T10:00:00.000Z",
    input_total_kg: 2_000,
    balance_delta_kg: 2_000,
  });
  const selected = selectPrimaryProcessingItems([olderPending, currentActive, otherObject]);
  assert.deepEqual(selected.primaryItems.map((row) => row.id), ["current-cycle", "other-object-cycle"]);
  assert.deepEqual(selected.previousItems.map((row) => row.id), ["old-cycle"]);
  assert.match(processingUi, /previousCountByWarehouse/);
  assert.match(processingUi, /Предыдущих обработок/);
  assert.match(processingUi, /Действия предыдущей обработки/);
  assert.match(processingUi, /pending && canManageBalance/);
  assert.match(processingUi, /\[\.\.\.previousItems, \.\.\.completedItems\.slice\(0, 10\)\]/);
  assert.doesNotMatch(processingUi, /historyItems\.slice\(0, 10\)/);
});

check("processing input reuses the warehouse lot context across legacy node metadata", () => {
  assert.match(processingInputReuseMigration, /uq_batch_transformations_open_lot_pass_v1/);
  assert.match(
    processingInputReuseMigration,
    /create unique index if not exists uq_batch_transformations_open_lot_pass_v1/,
  );
  const lockFunction = processingInputReuseMigration.match(
    /create or replace function public\.tz297_processing_context_lock_key_v1[\s\S]*?\$\$;/,
  )?.[0] || "";
  assert.doesNotMatch(lockFunction, /coalesce\(p_season_id/);
  assert.doesNotMatch(lockFunction, /coalesce\(p_processing_node_id/);
  assert.doesNotMatch(lockFunction, /coalesce\(p_transformation_type/);
  assert.match(lockFunction, /coalesce\(p_node_warehouse_id/);

  const candidateQuery = processingInputReuseMigration.match(
    /for v_candidate in[\s\S]*?for update/,
  )?.[0] || "";
  assert.match(candidateQuery, /t\.processing_method = v_method/);
  assert.doesNotMatch(candidateQuery, /t\.transformation_type = v_transformation_type/);
  assert.doesNotMatch(candidateQuery, /t\.season_id is not distinct/);
  assert.doesNotMatch(candidateQuery, /processing_node_id is not distinct/);
  assert.match(candidateQuery, /t\.shadow_mode/);
  assert.match(candidateQuery, /t\.status = 'draft'/);
  assert.match(
    processingInputReuseMigration,
    /v_candidate\.season_id is distinct from v_lot\.season_id[\s\S]*PROCESSING_INPUT_CONTEXT_INVALID/,
  );
  assert.match(weighbridgeAuth, /PROCESSING_INPUT_CONTEXT_INVALID/);

  const passQuery = processingInputReuseMigration.match(
    /select coalesce\(max\(t\.pass_no\), 0\) \+ 1 into v_pass[\s\S]*?source_physical_state[\s\S]*?;/,
  )?.[0] || "";
  assert.match(passQuery, /t\.processing_method = v_method/);
  assert.doesNotMatch(passQuery, /processing_node_id is not distinct/);
});

check("workspace tabs are inert before hydration", () => {
  assert.match(page, /<UniversalWorkspaceTabs[\s\S]*disabled=\{!workspaceReady\}/);
  assert.match(workspaceTabs, /disabled=\{disabled\}/);
});

check("empty processing places render neutral state", () => {
  assert.match(processingUi, /data-processing-state="empty"/);
  assert.match(processingUi, /Нет активной партии/);
  assert.match(processingUi, /Свободно/);
});

check("open tickets remain above processing cards", () => {
  assert.ok(page.indexOf("Открытые талоны") < page.indexOf("<ProcessingWorkspace"));
});

check("ambiguous cycles and output role stay explicit", () => {
  assert.match(page, /От какой обработки\? \*/);
  assert.match(page, /Что вывозим\?"} \*/);
  assert.match(page, /Лёгкая фракция \/ прочие складские отходы/);
  assert.match(page, /талон \$\{item\.ticket_no\}/);
  assert.match(page, /Цикл \{index \+ 1\}/);
});

console.log(`TZ312 P0 stability and processing cards PASS: ${passed}/21`);
