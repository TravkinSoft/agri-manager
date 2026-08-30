import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const page = read("app/(dashboard)/weighbridge/page.tsx");
const processingWorkspace = read("components/weighbridge/processing-workspace.tsx");
const dialog = read("components/ui/dialog.tsx");
const service = read("lib/services/weighbridge.ts");
const auth = read("app/api/weighbridge/_auth.ts");
const shifts = read("app/api/weighbridge/shifts/route.ts");
const tickets = read("app/api/weighbridge/tickets/route.ts");
const ticketPatch = read("app/api/weighbridge/tickets/[id]/route.ts");
const finalize = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const correction = read("app/api/weighbridge/tickets/[id]/correction/route.ts");
const voidRoute = read("app/api/weighbridge/tickets/[id]/void/route.ts");
const migration = read("supabase/migrations/20260818190000_weighbridge_pin_gate_shift_lifecycle_v1.sql");

const operatorDialog = page.slice(page.indexOf("open={operatorDialogVisible}"), page.indexOf("open={shiftDialogOpen}"));
const businessLoadEffect = page.slice(
  page.indexOf("if (authLoading || !profile?.company_id) return;", page.indexOf("void verifyOperatorSession(controller.signal)")),
  page.indexOf("// Business data starts only after the canonical operator session unlocks.")
);
const sessionStateSql = migration.slice(
  migration.indexOf("create or replace function public.weighbridge_operator_session_state_v1"),
  migration.indexOf("create or replace function public.open_or_unlock_weighbridge_shift_v1")
);

check("operator session starts locked and checking", () => {
  assert.match(page, /useState<"unknown" \| "checking" \| "ready" \| "error">\("checking"\)/);
  assert.match(page, /useState<WeighbridgeOperatorState>\(\{\s*shift:\s*null,\s*unlocked:\s*false/);
});
check("auth and session check render a non-modal skeleton", () => {
  const skeleton = page.slice(page.indexOf("if (authLoading || operatorGateChecking)"), page.indexOf("if (!canView)"));
  assert.match(skeleton, /data-testid="weighbridge-session-skeleton"/);
  assert.match(skeleton, /aria-busy="true"/);
  assert.doesNotMatch(skeleton, /role="dialog"|aria-modal|fixed inset-0/);
});
check("unknown session does not open the PIN dialog until checked", () => {
  assert.match(page, /\(operatorGateBlocked && !operatorGateChecking\)/);
  assert.doesNotMatch(operatorDialog, /operatorGateChecking|Проверяем действующую смену/);
});
check("workspace uses native inert", () => assert.match(page, /operatorGateBlocked \? \(\{ inert: "" \}/));
check("workspace pointer and focus surface is hidden", () => assert.match(page, /aria-hidden=\{operatorGateBlocked[\s\S]*?pointer-events-none[\s\S]*?blur-sm/));
check("background scroll is locked", () => assert.match(page, /document\.body\.style\.overflow = "hidden"/));
check("dialog close button can be hidden", () => assert.match(dialog, /hideCloseButton[\s\S]*?!hideCloseButton/));
check("PIN gate has no close button", () => assert.match(operatorDialog, /hideCloseButton=\{operatorGateBlocked\}/));
check("PIN gate rejects Escape", () => assert.match(operatorDialog, /onEscapeKeyDown[\s\S]*?event\.preventDefault/));
check("PIN gate rejects outside pointer", () => assert.match(operatorDialog, /onPointerDownOutside[\s\S]*?event\.preventDefault/));
check("PIN gate rejects outside interaction", () => assert.match(operatorDialog, /onInteractOutside[\s\S]*?event\.preventDefault/));
check("PIN gate has no cancel action", () => assert.doesNotMatch(operatorDialog, />Отмена</));
check("PIN gate offers explicit page exit", () => assert.match(operatorDialog, /href="\/dashboard"[\s\S]*?Выйти из Весовой/));
check("wrong PIN remains locked and clears PIN", () => assert.match(page, /wrongPin[\s\S]*?setOperatorPin\(""\)[\s\S]*?setOperatorError\(wrongPin \? "Неверный PIN"/));
check("network error remains fail closed", () => assert.match(page, /setOperatorSessionStatus\("error"\)[\s\S]*?Не удалось проверить PIN\. Повторите/));
check("stale GET is generation guarded", () => assert.match(page, /generation !== operatorRequestGenerationRef\.current/));
check("stale GET is aborted before PIN POST", () => assert.match(page, /const submitOperatorAction[\s\S]*?invalidateOperatorSessionRequest\(\)[\s\S]*?unlockWeighbridgeOperator/));
check("business load waits for canonical unlock", () => {
  assert.match(businessLoadEffect, /if \(canUseOperatorSession && !operatorState\.unlocked\) return;/);
  assert.match(businessLoadEffect, /load\(controller\.signal/);
  assert.match(businessLoadEffect, /refreshTickets/);
  assert.match(businessLoadEffect, /refreshBootstrap/);
});
check("processing transformations wait for canonical unlock", () => {
  assert.match(page, /<ProcessingWorkspace[\s\S]*?enabled=\{coreDataReady && \(!canUseOperatorSession \|\| operatorState\.unlocked\)\}/);
  assert.match(processingWorkspace, /if \(!enabled\) return;[\s\S]*?getProcessingTransformations/);
});
check("workspace cache does not persist operator session", () => {
  const payload = page.slice(page.indexOf("const payload = {"), page.indexOf("weighbridgePageCache.set", page.indexOf("const payload = {")));
  assert.doesNotMatch(payload, /operatorState/);
});
check("423 API responses relock the page immediately", () => {
  assert.match(service, /response\.status === 423[\s\S]*?travkin:weighbridge-session-expired/);
  assert.match(page, /addEventListener\("travkin:weighbridge-session-expired"/);
});
check("client timer relocks at canonical shift expiry", () => assert.match(page, /operatorState\.shift_expires_at[\s\S]*?setTimeout[\s\S]*?inactivity_24h/));
check("session cookie survives browser and computer restart", () => assert.match(read("app/api/weighbridge/operator-session/route.ts"), /maxAge:\s*30 \* 24 \* 60 \* 60/));
check("migration adds canonical last activity", () => assert.match(migration, /add column if not exists last_activity_at timestamptz/));
check("session GET does not extend shift activity", () => assert.doesNotMatch(sessionStateSql, /set last_activity_at = now\(\)/));
check("session GET closes inactive shift", () => assert.match(sessionStateSql, /last_activity_at \+ interval '24 hours'[\s\S]*?close_reason = 'inactivity_24h'/));
check("successful PIN starts the 24 hour window", () => assert.match(migration, /open_or_unlock_weighbridge_shift_v1[\s\S]*?last_activity_at = now\(\)/));
check("only explicit business activities may extend shift", () => assert.match(migration, /p_activity not in \('pin_unlock','ticket_create','gross','tare_finalize','ticket_correction','ticket_void','weighing_transfer'\)/));
check("ticket creation records activity", () => assert.match(tickets, /recordWeighbridgeOperatorActivity[\s\S]*?"ticket_create"/));
check("gross and tare record activity", () => {
  assert.match(ticketPatch, /patch\.tare_weight_kg !== undefined \? "tare_finalize" : "gross"/);
});
check("finalize records activity", () => assert.match(finalize, /recordWeighbridgeOperatorActivity[\s\S]*?"tare_finalize"/));
check("correction records activity", () => assert.match(correction, /recordWeighbridgeOperatorActivity[\s\S]*?"ticket_correction"/));
check("void records activity for operator session", () => {
  assert.match(voidRoute, /requireWeighbridgeOperatorSession/);
  assert.match(voidRoute, /recordWeighbridgeOperatorActivity[\s\S]*?"ticket_void"/);
});
check("manual close is allowed with open tickets", () => {
  assert.doesNotMatch(shifts, /if \(\(unresolvedCount \|\| 0\) > 0\)/);
  assert.doesNotMatch(operatorDialog, /shiftCounters\.activeTickets/);
});
check("manual close uses canonical reason", () => assert.match(shifts, /close_reason:\s*"manual"/));
check("operator access disable closes shift and revokes sessions", () => assert.match(migration, /close_weighbridge_shift_on_operator_access_disabled_v1[\s\S]*?close_reason = 'admin_revoked'[\s\S]*?status = 'revoked'/));
check("shift expiry revokes all operator sessions", () => assert.match(migration, /where shift_id = v_shift\.id and status = 'active'/));

assert.equal(passed, 37);
console.log(`P0 weighbridge PIN gate regression PASS: ${passed}/37`);
