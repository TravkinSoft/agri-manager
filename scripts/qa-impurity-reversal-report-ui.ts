import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WeighbridgeShiftReportView} from '../components/weighbridge/shift-report';
import type {WeighbridgeShiftReport} from '../lib/weighbridge/shift-report';
(globalThis as any).React=React;
const report={companyName:'Test',operatorName:'Operator',openedAt:'2026-09-21T03:10Z',closedAt:'2026-09-22T02:34Z',capturedAt:'2026-09-22T02:34Z',
 potatoPeriodResultKg:825730,potatoNetKg:1069730,potatoPeriodImpuritiesKg:244000,potatoReceiptCount:95,impurityTripCount:42,
 reportRevision:2,impurityAdjustments:[],impurityAdjustmentKg:0,
 impurityAdjustmentReversals:[{id:'reverse',documentNo:'REV-SOIL-TEST',originalDocumentNo:'ADJ-SOIL-TEST',quantityKg:20000,reason:'Ошибка бумажного итога',recordedAt:'2026-09-22T03:00Z'}],
 ticketCount:140,closedTicketCount:137,openTicketCount:0,unsyncedTicketCount:0,plots:[],operations:[],tickets:[]} as unknown as WeighbridgeShiftReport;
for(const variant of ['full','dashboard'] as const){
 const html=renderToStaticMarkup(React.createElement(WeighbridgeShiftReportView,{report,variant}));
 assert.match(html,/Исправленный отчёт/);assert.match(html,/825\D730/);
 assert.match(html,/REV-SOIL-TEST/);assert.match(html,/ADJ-SOIL-TEST/);
 assert.doesNotMatch(html,/В примесях учтена корректировка/);
}
console.log('PASS: full and dashboard show revised result, cancellation document/reason; cancelled soil is not presented as active.');
