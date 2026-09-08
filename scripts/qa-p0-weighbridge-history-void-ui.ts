import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const adminActionRoute = read("app/api/weighbridge/tickets/[id]/admin-action/route.ts");

function between(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const historyVoidHandler = between(
  page,
  "const handleHistoryAdminVoid = async () => {",
  "const handleAdminCleanup = async"
);
const openTicketVoidHandler = between(
  page,
  "const handleVoid = async () => {",
  "const handleHistoryAdminVoid = async"
);
const historyPreviewActions = between(
  page,
  '{historyPreviewTicket.status === "finalized" && canAdminVoidHistoryTicket ? (',
  '{historyPreviewTicket.status === "finalized" && canCorrectTicket ? ('
);
const historyVoidOpener = between(
  page,
  "const openHistoryAdminVoidDialog = (ticket: WeighbridgeTicket) => {",
  "const from = activeTicket"
);
const historyVoidDialog = between(
  page,
  "<Dialog\n        open={Boolean(historyAdminVoidTarget)}",
  "<Dialog open={openTicketEditOpen}"
);
const historyVoidDialogDismiss = between(
  historyVoidDialog,
  "onOpenChange={(open) => {",
  ">\n        <DialogContent"
);
const cancelButton = between(
  historyVoidDialog,
  '<Button\n              type="button"\n              variant="outline"',
  "</Button>"
);

check("history void capability is exactly global_admin", () => {
  assert.match(page, /const canAdminVoidHistoryTicket = profile\?\.role === "global_admin";/);
  assert.match(historyVoidHandler, /profile\.role !== "global_admin"/);
});

check("history action is available only for a finalized preview", () => {
  assert.match(historyPreviewActions, /historyPreviewTicket\.status === "finalized"/);
  assert.match(historyPreviewActions, /canAdminVoidHistoryTicket/);
  assert.match(historyPreviewActions, /openHistoryAdminVoidDialog\(historyPreviewTicket\)/);
  assert.doesNotMatch(historyPreviewActions, /adminTicketAction|voidTicket|fetch\(/);
});

check("opening the dialog captures an immutable ticket identity snapshot", () => {
  assert.match(page, /type HistoryAdminVoidTarget = Readonly<\{/);
  assert.match(page, /id: string;[\s\S]*ticketNumber: string;[\s\S]*vehicleDisplay: string;[\s\S]*netWeightKg: number \| null;/);
  assert.match(historyVoidOpener, /Object\.freeze\(\{/);
  assert.match(historyVoidOpener, /id: String\(ticket\.id\)/);
  assert.match(historyVoidOpener, /ticketNumber: String\(ticket\.ticket_no/);
  assert.match(historyVoidOpener, /vehicleDisplay:/);
  assert.match(historyVoidOpener, /netWeightKg:/);
});

check("dialog identifies the exact frozen ticket before confirmation", () => {
  assert.match(historyVoidDialog, /historyAdminVoidTarget\.ticketNumber/);
  assert.match(historyVoidDialog, /historyAdminVoidTarget\.vehicleDisplay/);
  assert.match(historyVoidDialog, /formatWeightKg\(historyAdminVoidTarget\.netWeightKg\)/);
});

check("history void requires an explicit non-empty reason", () => {
  assert.match(historyVoidDialog, /Причина аннулирования/);
  assert.match(historyVoidDialog, /value=\{historyAdminVoidReason\}/);
  assert.match(historyVoidDialog, /disabled=\{historyAdminVoiding \|\| !historyAdminVoidReason\.trim\(\)\}/);
  assert.match(historyVoidHandler, /const reason = historyAdminVoidReason\.trim\(\)/);
  assert.match(historyVoidHandler, /if \(!reason\)/);
});

check("history finalization uses the canonical admin storno endpoint", () => {
  assert.match(historyVoidHandler, /const target = historyAdminVoidTarget/);
  assert.match(historyVoidHandler, /await adminTicketAction\(target\.id, profile\.id, "void", reason\)/);
  assert.doesNotMatch(historyVoidHandler, /historyPreviewTicket/);
  assert.doesNotMatch(historyVoidHandler, /voidTicket\(|fetch\(|\.from\(|\.update\(|\.delete\(/);
  assert.match(adminActionRoute, /allowedRoles: \["global_admin"\]/);
  assert.match(adminActionRoute, /void_finalized_weighbridge_ticket_for_session_v1/);
});

check("Cancel closes the reason dialog without a request", () => {
  assert.match(cancelButton, /setHistoryAdminVoidTarget\(null\)/);
  assert.match(cancelButton, /setHistoryAdminVoidReason\(""\)/);
  assert.doesNotMatch(cancelButton, /adminTicketAction|voidTicket|fetch\(|handleHistoryAdminVoid|refreshLiveData/);
});

check("close button overlay and Escape only dismiss local state", () => {
  assert.match(historyVoidDialogDismiss, /if \(!open\)/);
  assert.match(historyVoidDialogDismiss, /setHistoryAdminVoidTarget\(null\)/);
  assert.match(historyVoidDialogDismiss, /setHistoryAdminVoidReason\(""\)/);
  assert.doesNotMatch(historyVoidDialogDismiss, /adminTicketAction|voidTicket|fetch\(|handleHistoryAdminVoid|refreshLiveData/);
});

check("mobile dialog scrolls within the viewport and does not summon the iOS keyboard", () => {
  assert.match(historyVoidDialog, /max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(historyVoidDialog, /overflow-y-auto/);
  assert.doesNotMatch(historyVoidDialog, /autoFocus/);
});

check("success closes preview and refreshes canonical ticket and stock views", () => {
  const actionIndex = historyVoidHandler.indexOf("await adminTicketAction");
  const closeIndex = historyVoidHandler.indexOf("setHistoryPreviewTicket(null)");
  const refreshIndex = historyVoidHandler.indexOf("await refreshLiveData");
  assert.ok(actionIndex >= 0 && closeIndex > actionIndex && refreshIndex > closeIndex);
  assert.match(historyVoidHandler, /"tickets", "ticket_lines", "inventory_batches", "stock_ledger_entries"/);
});

check("existing open-ticket void flow remains on its original endpoint", () => {
  assert.match(openTicketVoidHandler, /await voidTicket\(activeTicket\.id, profile\.id, voidReason\.trim\(\)\)/);
  assert.doesNotMatch(openTicketVoidHandler, /adminTicketAction/);
});

console.log(`\n${passed} history void UI checks passed.`);
