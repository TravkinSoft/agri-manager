import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/(dashboard)/weighbridge/page.tsx"), "utf8");
const closeStart = source.indexOf("  const closeTicket = async () => {");
const closeEnd = source.indexOf("\n  const handleVoid = async () => {", closeStart);
assert.ok(closeStart >= 0 && closeEnd > closeStart, "closeTicket handler must exist");
const close = source.slice(closeStart, closeEnd);

assert.match(source, /type TicketClosePhase = "idle" \| "closing" \| "reconciling" \| "retry"/);
assert.match(close, /finalizeTicketIdempotencyRef\.current\?\.ticketId === closingTicket\.id/);
assert.match(close, /finalizeTicketIdempotencyRef\.current = \{ ticketId: closingTicket\.id, key: currentFinalizeKey \}/);
assert.match(close, /idempotency_key: currentFinalizeKey/);
assert.match(close, /phase: "closing"/);
assert.match(close, /phase: "reconciling"/);
assert.match(close, /phase: "retry"/);
assert.match(close, /getTicketDetails\(closingTicket\.id, profile\.id\)/);
assert.match(close, /if \(isCanonicallyClosed\(canonicalTicket\)\)/);
assert.match(close, /setTickets\(\(current\) => \[canonicalTicket, \.\.\.current\.filter/);
assert.match(close, /Карточка восстановлена\. Повтор использует тот же ключ/);
assert.match(close, /Ответ неоднозначен\. Проверяем фактический статус без повторной записи/);

const catchStart = close.indexOf("    } catch (e: any) {");
const finallyStart = close.indexOf("    } finally {", catchStart);
assert.ok(catchStart >= 0 && finallyStart > catchStart, "closeTicket catch/finally must exist");
const catchBlock = close.slice(catchStart, finallyStart);
assert.doesNotMatch(catchBlock, /finalizeTicket\(/, "ambiguous failures must reconcile before an explicit retry");
assert.doesNotMatch(catchBlock, /setTickets\([^\n]*filter/, "ambiguous failures must not remove the canonical ticket locally");

assert.match(source, /open=\{Boolean\(activeTicket\) && !ticketClosePending\}/);
assert.match(source, /onOpenChange=\{\(open\) => \{[\s\S]{0,100}if \(!open && !ticketCloseLocked\)/);
assert.match(source, /role="status"[\s\S]{0,160}aria-live="polite"/);
assert.match(source, /Повторить закрытие безопасно/);
assert.match(source, /disabled: finalizing \|\| ticketClosePending \|\| ticketCloseRetry/);
assert.match(source, /finalizeTicketIdempotencyRef\.current = null;[\s\S]{0,180}commitTicketCloseState\(EMPTY_TICKET_CLOSE_STATE\)/);
assert.match(source, /Изменить данные перед новой попыткой/);
assert.match(source, /Других открытых талонов нет/);
assert.match(source, /const ticketCloseLocked = ticketCloseState\.phase !== "idle"/);
assert.match(source, /const ticketRowDisabled = isPending \|\| ticketCloseLocked/);
assert.match(source, /disabled=\{ticketRowDisabled\}/);
assert.match(source, /ticketCloseStateRef\.current\.phase !== "idle"/);
assert.match(source, /const commitTicketCloseState = \(next: TicketCloseState\)[\s\S]{0,140}ticketCloseStateRef\.current = next[\s\S]{0,80}setTicketCloseState\(next\)/);
assert.match(source, /disabled=\{loading \|\| submitting \|\| ticketCloseLocked\}/);
assert.match(source, /handleVoid = async \(\) => \{[\s\S]{0,240}ticketCloseStateRef\.current\.phase !== "idle"/);
assert.match(source, /handleAdminCleanup = async[\s\S]{0,260}ticketCloseStateRef\.current\.phase !== "idle"/);
assert.match(source, /DropdownMenuItem disabled=\{ticketCloseLocked\} onSelect=\{openActiveTicketEditor\}/);
assert.match(source, /notificationDeepLinkHandledRef\.current = false;[\s\S]{0,100}return/);

console.log("TRAVKINFLOW 2 WEIGHBRIDGE CLOSE STATE: 33/33 PASS");
