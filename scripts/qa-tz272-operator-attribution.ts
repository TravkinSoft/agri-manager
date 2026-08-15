import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ticketOperatorFacts, UNRECORDED_OPERATOR } from "../lib/weighbridge/ticket-operator";
import type { WeighbridgeTicket } from "../lib/types/weighbridge";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const paper = read("components/weighbridge/weighbridge-ticket-paper.tsx");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const listRoute = read("app/api/weighbridge/tickets/route.ts");
const detailRoute = read("app/api/weighbridge/tickets/[id]/route.ts");
const pdfRoute = read("app/api/weighbridge/tickets/[id]/pdf/route.ts");
const assistantContext = read("app/api/assistant/context/route.ts");
const bootstrap = read("app/api/weighbridge/bootstrap/route.ts");
const assistantShell = read("components/assistant/assistant-shell-provider.tsx");
const assistantChat = read("components/assistant/assistant-chat-pane.tsx");

let checks = 0;
const check = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
};

const ticket = (values: Partial<WeighbridgeTicket>): WeighbridgeTicket => ({
  id: "ticket", company_id: "company", ticket_no: "WB-TEST", ticket_type: "weighbridge",
  op_type: "harvest_incoming", status: "finalized", direction: "incoming",
  source_kind: "field", destination_kind: "warehouse", created_at: "2026-08-15T00:00:00Z",
  updated_at: "2026-08-15T00:00:00Z", weigh_method: "double_weighing", is_finalized: true, is_voided: false,
  ...values,
});

check("same explicit person is rendered once as weighman", () => {
  assert.deepEqual(ticketOperatorFacts(ticket({
    opened_by_person_name: "Потоцкая Людмила Андреевна",
    finalized_by_person_name: "Потоцкая Людмила Андреевна",
  })), [{ label: "Весовщик", value: "Потоцкая Людмила Андреевна" }]);
});
check("different people are rendered separately", () => {
  assert.deepEqual(ticketOperatorFacts(ticket({ opened_by_person_name: "Оператор 1", finalized_by_person_name: "Оператор 2" })), [
    { label: "Открыл", value: "Оператор 1" },
    { label: "Завершил", value: "Оператор 2" },
  ]);
});
check("missing attribution is never guessed from auth", () => {
  assert.deepEqual(ticketOperatorFacts(ticket({ created_by_name_snapshot: "Global Admin" })), [
    { label: "Весовщик", value: UNRECORDED_OPERATOR },
  ]);
});
check("paper uses only canonical operator facts", () => {
  assert.match(paper, /ticketOperatorFacts\(ticket\)/);
  assert.doesNotMatch(paper, /created_by_name_snapshot/);
});
check("weighbridge page cannot inject current auth profile as operator", () => {
  assert.doesNotMatch(page, /operator:\s*ticket\.created_by_name_snapshot/);
});
check("list and detail APIs enrich person attribution", () => {
  assert.match(listRoute, /enrichTicketOperatorAttribution/);
  assert.match(detailRoute, /enrichTicketOperatorAttribution/);
});
check("technical auth audit is restricted to global admin", () => {
  assert.match(listRoute, /includeTechnicalAudit:\s*actor\.role === "global_admin"/);
  assert.match(detailRoute, /includeTechnicalAudit:\s*actor\.role === "global_admin"/);
});
check("PDF uses the same canonical operator facts", () => {
  assert.match(pdfRoute, /ticketOperatorFacts\(attributedTicket/);
  assert.doesNotMatch(pdfRoute, /Cashier \/ Operator/);
});
check("missing production season columns are not queried", () => {
  assert.doesNotMatch(assistantContext, /is_active|season_year/);
  assert.match(assistantContext, /\.eq\("archived", false\)/);
});
check("critical bootstrap skips season history by default", () => {
  assert.match(bootstrap, /includeSummary/);
  assert.match(bootstrap, /Promise\.resolve\(\{ data: \[\], error: null \}/);
});
check("secondary catalogs do not block the form", () => {
  assert.match(page, /setLoading\(false\);[\s\S]{0,120}void Promise\.all/);
});
check("history remains limited and separate", () => {
  assert.match(listRoute, /\.limit\(20\)/);
  assert.match(listRoute, /\.limit\(100\)/);
});
check("assistant panel open state is not restored on bootstrap", () => {
  assert.doesNotMatch(assistantShell, /typeof parsed\.isOpen === "boolean"/);
});
check("assistant history waits for an explicitly opened panel", () => {
  assert.match(assistantChat, /if \(!isOpen\) return;/);
  assert.match(assistantChat, /limit=120/);
});
check("weighbridge routes suppress the assistant for every auth profile", () => {
  assert.match(assistantShell, /pathname === "\/weighbridge"/);
  assert.match(assistantShell, /pathname\.startsWith\("\/weighbridge\/"\)/);
  assert.match(assistantShell, /canUseAssistantShell\(profile\?\.role\) && !assistantSuppressedForRoute/);
});

console.log(`TZ272 ${checks}/${checks} PASS`);
