import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WeighbridgeShiftReportView } from "../components/weighbridge/shift-report";
import { canCloseWeighbridgeReport, isWeighbridgeShiftReport, shiftReportKg, type WeighbridgeShiftReport } from "../lib/weighbridge/shift-report";
(globalThis as any).React = React;
const report = {
  version: "weighbridge_shift_snapshot_v1", reportVersion: 2, shiftId: "shift", reviewToken: "a".repeat(32),
  companyName: "Тест", operatorName: "Весовщик", openedAt: "2026-09-19T02:00:00Z", closedAt: null, capturedAt: "2026-09-19T20:00:00Z",
  ticketCount: 102, closedTicketCount: 102, voidedTicketCount: 0, replacedTicketCount: 0, openTicketCount: 0,
  unsyncedTicketCount: 0, manualCorrectionCount: 0, harvestReceiptCount: 75, potatoReceiptCount: 75, impurityTripCount: 27,
  potatoNetKg: 777070, potatoPeriodImpuritiesKg: 130380, potatoPeriodResultKg: 646690, potatoPeriodImpurityTripCount: 27, potatoCleanKg: 698627.344, impuritiesRemovedKg: 130380,
  periodAccountingBasis: "receipt_net_minus_period_removals_v1",
  operations: [{ op_type: "harvest_incoming", trips: 75, net_kg: 777070 }, { op_type: "weighbridge_impurities", trips: 27, net_kg: 130380 }],
  plots: [{field_id:"vine",crop_structure_allocation_id:"allocation",field_name:"виноград",crop_name:"Картофель",trips:75,net_kg:777070,clean_kg:698627.344}], tickets: [],
} satisfies WeighbridgeShiftReport;
assert(isWeighbridgeShiftReport(report));
assert(!isWeighbridgeShiftReport({ version: "weighbridge_shift_snapshot_v1" }));
assert(canCloseWeighbridgeReport(report));
assert(!canCloseWeighbridgeReport(null));
assert(!canCloseWeighbridgeReport({...report,openTicketCount:1}));
assert(!canCloseWeighbridgeReport({...report,unsyncedTicketCount:1}));
assert(!canCloseWeighbridgeReport({...report,potatoPeriodResultKg:null}));
assert(!canCloseWeighbridgeReport({...report,closedAt:report.capturedAt}));
const html = renderToStaticMarkup(React.createElement(WeighbridgeShiftReportView,{report})).replace(/\u00a0/g," ");
for (const value of ['777 070 кг','130 380 кг','646 690 кг','рейсов: 75','102','Рейсов вывоза: 27','По участкам, сортам и складам','Все талоны']) assert(html.includes(value),value);
assert.match(html,/data-report-design="large-summary"/);
assert(html.indexOf('646 690 кг') < html.indexOf('777 070 кг'),'selected design puts the shift result first');
assert(!html.includes('907 450'));
assert(!html.includes('698 627'));
assert.equal(shiftReportKg(null),'Не определено');
const page=readFileSync('app/(dashboard)/weighbridge/page.tsx','utf8');
const dialog=readFileSync('components/weighbridge/shift-close-dialog.tsx','utf8');
const route=readFileSync('app/api/weighbridge/shifts/route.ts','utf8');
assert(!page.includes('{shiftSummary.netKg}'));
assert(!page.includes('formatTonnes(shiftSummary.netKg)'));
assert(!page.includes('{shiftSummary.trips}'));
assert.match(dialog,/AbortController/);
assert.match(dialog,/SHIFT_PREVIEW_CHANGED/);
assert.match(dialog,/report\.shiftId !== shiftId/);
assert.match(route,/SHIFT_PREVIEW_REQUIRED/);
assert.match(route,/requireWeighbridgeOperatorSession/);
assert.match(route,/private, no-store/);
assert.match(route,/p_review_token: body\.reviewToken/);
console.log('PASS: shared report rendering, 646690/75/27/102 visible; no 907450 mixed total; missing/loading/stale/open/sync guards; authenticated no-store preview; confirmation token required.');
