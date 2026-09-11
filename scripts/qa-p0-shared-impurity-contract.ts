import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type Artifact = { path: string; text: string };

async function load(path: string): Promise<Artifact> {
  return { path, text: await readFile(join(process.cwd(), path), "utf8") };
}

async function findMigration(): Promise<Artifact> {
  const directory = join(process.cwd(), "supabase", "migrations");
  const matches: Artifact[] = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".sql")) continue;
    const path = join("supabase", "migrations", name);
    const artifact = await load(path);
    if (
      artifact.text.includes("P0 shared impurity pool V1")
      && artifact.text.includes("create_weighbridge_shared_impurity_pool_ticket_v1")
      && artifact.text.includes("finalize_weighbridge_shared_impurity_pool_ticket_v1")
    ) {
      matches.push(artifact);
    }
  }
  assert.equal(matches.length, 1, "exactly one shared-impurity migration must exist");
  return matches[0]!;
}

function tableColumns(sql: string, table: string) {
  const match = sql.match(new RegExp(
    `create\\s+table\\s+public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  ));
  assert.ok(match, `missing CREATE TABLE public.${table}`);
  const ignored = new Set(["constraint", "primary", "foreign", "unique", "check", "exclude"]);
  return new Set(
    match[1]!
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/,$/, ""))
      .map((line) => line.match(/^([a-z_][a-z0-9_]*)\s+/i)?.[1]?.toLowerCase() || "")
      .filter((name) => name && !ignored.has(name)),
  );
}

function selectedColumns(source: string, table: string) {
  const matches = Array.from(source.matchAll(new RegExp(
    `\\.from\\("${table}"\\)\\s*\\.select\\("([^"]+)"\\)`,
    "g",
  )));
  assert.ok(matches.length > 0, `helper must query ${table}`);
  return new Set(matches.flatMap((match) => match[1]!.split(",").map((name) => name.trim())));
}

async function main() {
  const [
    migration,
    createRoute,
    finalizeRoute,
    correctionRoute,
    helper,
    types,
    page,
    picker,
    paper,
    service,
  ] = await Promise.all([
    findMigration(),
    load("app/api/weighbridge/tickets/route.ts"),
    load("app/api/weighbridge/tickets/[id]/finalize/route.ts"),
    load("app/api/weighbridge/tickets/[id]/correction/route.ts"),
    load("lib/server/weighbridge-shared-impurity.ts"),
    load("lib/types/weighbridge.ts"),
    load("app/(dashboard)/weighbridge/page.tsx"),
    load("components/weighbridge/impurity-source-picker.tsx"),
    load("components/weighbridge/weighbridge-ticket-paper.tsx"),
    load("lib/services/weighbridge.ts"),
  ]);

  let passed = 0;
  const check = (name: string, run: () => void) => {
    run();
    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
  };

  check("migration is additive and keeps legacy single-source RPC untouched", () => {
    assert.match(migration.text, /Existing one-lot impurity functions and their signatures are not replaced/);
    assert.doesNotMatch(
      migration.text,
      /create\s+or\s+replace\s+function\s+public\.finalize_weighbridge_impurity_ticket_for_session_v1/i,
    );
    assert.doesNotMatch(migration.text, /\b(?:drop\s+table|truncate)\b/i);
  });

  check("three new tables are RLS-protected, readable, and direct writes stay closed", () => {
    for (const table of [
      "weighbridge_shared_impurity_groups",
      "weighbridge_shared_impurity_members",
      "weighbridge_shared_impurity_source_batches",
    ]) {
      assert.match(migration.text, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
      assert.match(migration.text, new RegExp(`grant select on table public\\.${table}`, "i"));
      assert.match(migration.text, new RegExp(`revoke all privileges on table public\\.${table}`, "i"));
      assert.match(
        migration.text,
        new RegExp(`has_table_privilege\\([\\s\\S]{0,100}public\\.${table}[\\s\\S]{0,100}INSERT,UPDATE,DELETE`, "i"),
      );
    }
  });

  check("open shared sources join the canonical reservation and effective-availability contracts", () => {
    assert.match(migration.text, /create or replace view public\.v_weighbridge_open_ticket_reservations_v1/i);
    assert.match(migration.text, /union all[\s\S]*weighbridge_shared_impurity_source_batches/i);
    assert.match(migration.text, /pool\.state\s*=\s*'open'/i);
    assert.match(migration.text, /source\.state\s*=\s*'selected'/i);
    assert.match(migration.text, /source\.source_balance_snapshot_kg::numeric\(18,6\) as reserved_kg/i);
    assert.match(migration.text, /create or replace view public\.v_effective_stock_balance_identity_v1/i);
    assert.match(migration.text, /stock\.quantity[\s\S]*reservations\.reserved_kg[\s\S]*as effective_available_kg/i);
  });

  check("server enrichment never selects a column absent from the migration", () => {
    for (const table of [
      "weighbridge_shared_impurity_groups",
      "weighbridge_shared_impurity_members",
      "weighbridge_shared_impurity_source_batches",
    ]) {
      const available = tableColumns(migration.text, table);
      const selected = selectedColumns(helper.text, table);
      for (const column of Array.from(selected)) {
        assert.ok(available.has(column), `${table}.${column} is selected by server but absent from migration`);
      }
    }
  });

  check("create API requires two exact, unique crop-structure sources", () => {
    assert.match(createRoute.text, /sources\.length\s*<\s*2/);
    assert.match(createRoute.text, /harvest_lot_id/);
    assert.match(createRoute.text, /crop_structure_id/);
    assert.match(createRoute.text, /new Set\(sources\.map\(\(source\) => source\.crop_structure_id\)\)\.size !== sources\.length/);
    assert.match(createRoute.text, /Один и тот же участок нельзя выбрать дважды/);
  });

  check("shared create uses one atomic RPC with every required argument", () => {
    const start = createRoute.text.indexOf('"create_weighbridge_shared_impurity_pool_ticket_v1"');
    assert.ok(start > 0, "shared create RPC missing");
    const call = createRoute.text.slice(start, start + 900);
    for (const parameter of [
      "p_company_id",
      "p_source_warehouse_id",
      "p_sources",
      "p_vehicle_id",
      "p_driver_id",
      "p_gross_weight_kg",
      "p_impurity_type",
      "p_notes",
      "p_session_token",
      "p_idempotency_key",
    ]) {
      assert.match(call, new RegExp(`\\b${parameter}\\b`), `${parameter} missing from shared create RPC`);
    }
    assert.match(createRoute.text, /Для общего талона требуется ключ безопасного повтора/);
    assert.match(createRoute.text, /Общий талон не должен содержать одну главную партию/);
    assert.match(migration.text, /from public\.v_weighbridge_open_ticket_reservations_v1 reservation/i);
    assert.match(migration.text, /from public\.v_processing_active_allocations_v1 allocation/i);
    assert.match(migration.text, /SHARED_IMPURITY_SOURCE_ALREADY_COMMITTED/);
  });

  check("shared finalize is detected before and isolated from the legacy finalizer", () => {
    const sharedDetection = finalizeRoute.text.indexOf("loadSharedImpurityTicketIds");
    const sharedCall = finalizeRoute.text.indexOf('"finalize_weighbridge_shared_impurity_pool_ticket_v1"');
    const legacyCall = finalizeRoute.text.indexOf('"finalize_weighbridge_impurity_ticket_for_session_v1"');
    assert.ok(sharedDetection > 0 && sharedCall > sharedDetection, "shared finalize detection/call missing");
    assert.ok(legacyCall < 0 || sharedCall < legacyCall, "legacy finalizer can run before shared finalize");
    assert.match(finalizeRoute.text, /Для закрытия общего талона требуется ключ безопасного повтора/);
    assert.match(finalizeRoute.text, /p_tare_variance_confirmed/);
    assert.match(finalizeRoute.text, /p_idempotency_key/);
    assert.match(finalizeRoute.text, /SHARED_IMPURITY_SOURCE_\(\?:ALREADY_COMMITTED\|COMMITTED_OR_CHANGED\)/);
    assert.match(finalizeRoute.text, /shared_impurity_source_committed/);
  });

  check("shared-ticket correction start and finalize are rejected by DB and both HTTP paths", () => {
    assert.match(migration.text, /create or replace function private\.reject_shared_impurity_ticket_correction_v1\(\)/i);
    assert.match(migration.text, /before insert or update of correction_of_ticket_id, linked_request_id,[\s\S]*linked_processing_id, processing_output_role, status, is_finalized[\s\S]*on public\.tickets/i);
    assert.match(migration.text, /SHARED_IMPURITY_CORRECTION_REQUIRES_VOID_NEW/);
    const correctionGuard = correctionRoute.text.indexOf("if (sharedTicketIds.has(id)");
    const correctionRpc = correctionRoute.text.indexOf("const rpc = action === \"start\"");
    assert.ok(correctionGuard > 0 && correctionGuard < correctionRpc, "correction API guard must run before either RPC");
    assert.match(correctionRoute.text, /shared_impurity_correction_requires_void/);
    const finalizeGuard = finalizeRoute.text.indexOf("if (isSharedImpurityCorrection)");
    const finalizeRpc = finalizeRoute.text.indexOf("const finalizeRpc = isCorrectionFinalize");
    assert.ok(finalizeGuard > 0 && finalizeGuard < finalizeRpc, "finalize API guard must run before correction finalizer");
    assert.match(finalizeRoute.text, /shared_impurity_correction_requires_void/);
  });

  check("shared tickets remain isolated from request and processing linkage at DB level", () => {
    assert.match(migration.text, /create or replace function private\.assert_shared_impurity_group_ticket_linkage_v1\(\)/i);
    assert.match(migration.text, /SHARED_IMPURITY_TICKET_LINKAGE_FORBIDDEN/);
    for (const column of [
      "correction_of_ticket_id",
      "linked_request_id",
      "linked_processing_id",
      "processing_output_role",
    ]) {
      assert.match(migration.text, new RegExp(`v_ticket\\.${column} is not null`));
    }
    assert.match(migration.text, /create constraint trigger enforce_shared_impurity_ticket_lifecycle_v1/i);
    assert.match(migration.text, /deferrable initially deferred/i);
    assert.match(migration.text, /SHARED_IMPURITY_LIFECYCLE_MISMATCH/);
  });

  check("client service transports the unresolved source scope only when supplied", () => {
    assert.match(service.text, /impuritySourceScope\?: ImpuritySourceScopeInput/);
    assert.match(service.text, /\.\.\.\(impuritySourceScope \? \{ impurity_source_scope: impuritySourceScope \} : \{\}\)/);
  });

  check("UI preserves whole-party legacy mode and separates exact multi-source mode", () => {
    assert.match(page.text, /key: `legacy:\$\{batch\.id\}`/);
    assert.match(page.text, /label: `Вся партия/);
    assert.match(page.text, /supportsSharedSelection: false/);
    assert.match(page.text, /supportsSharedSelection: true/);
    assert.match(page.text, /Источник общей примеси · остаток показан по партии, не по участку/);
    assert.match(page.text, /hasIncompleteSharedImpuritySelection/);
    assert.match(page.text, /hasDuplicateImpurityCropStructureSources/);
    assert.match(page.text, /selectedImpuritySourceOptions\.length > 1/);
  });

  check("picker prevents mixing whole-party and exact-source modes and blocks one exact source", () => {
    assert.match(picker.text, /selectedContainsLegacyFallback/);
    assert.match(picker.text, /hasIncompleteSharedSelection/);
    assert.match(picker.text, /disabled=\{hasIncompleteSharedSelection\}/);
    assert.match(picker.text, /Для одного источника выберите партию целиком или добавьте второй участок/);
    assert.match(picker.text, /Точные участки выбираются только совместно, минимум два/);
  });

  check("open cards, journal, preview and paper expose unresolved shared provenance", () => {
    assert.match(page.text, /sharedImpuritySourceCount/);
    assert.ok((page.text.match(/Вес по участкам не распределён/g) || []).length >= 2);
    assert.match(paper.text, /ticket\.impurity_source_scope\?\.allocation_mode === "unresolved_total"/);
    assert.match(paper.text, /Общая примесь/);
    assert.match(paper.text, /Вес по участкам не распределён/);
    assert.match(paper.text, /source_total_kg/);
    assert.match(paper.text, /clean_total_kg/);
  });

  check("public type makes group totals/status visible while per-source facts remain nullable", () => {
    for (const field of [
      "source_count",
      "source_total_kg",
      "clean_total_kg",
      "state",
      "member_resolution_status",
      "clean_mass_kg",
      "clean_yield_t_ha",
      "clean_balance_status",
      "yield_status",
    ]) {
      assert.match(types.text, new RegExp(`\\b${field}\\?`), `${field} missing from ImpuritySourceScope`);
    }
    assert.match(helper.text, /clean_mass_kg: null/);
    assert.match(helper.text, /clean_yield_t_ha: null/);
    assert.match(helper.text, /identity_snapshot/);
    assert.match(migration.text, /identity_snapshot jsonb not null/);
    assert.match(migration.text, /'area_ha', cs\.area/);
  });

  console.log(`P0 SHARED IMPURITY CONTRACT ${passed}/${passed} PASS`);
  console.log(`Migration: ${migration.path}`);
}

main().catch((error) => {
  console.error("P0 SHARED IMPURITY CONTRACT FAIL");
  console.error(error);
  process.exitCode = 1;
});
