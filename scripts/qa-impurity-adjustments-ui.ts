import assert from 'node:assert/strict';
import { periodImpurityAdjustments, type ImpurityAdjustment } from '../lib/weighbridge/impurity-adjustments';
import { buildPotatoPeriodMovement } from '../lib/dashboard/harvest-summary';
const period={start:'2026-09-21T02:00:00Z',end:'2026-09-22T02:00:00Z'};
const row={id:'adjustment',shift_id:'shift',accounting_at:'2026-09-21T20:05:56Z',created_at:'2026-09-22T03:00:00Z',quantity_kg:20000,
  warehouse_id:'warehouse',field_id:'field',crop_structure_id:'plot',crop_id:'potato',variety_id:'gala',reproduction_id:'r1'} as ImpurityAdjustment;
assert.equal(periodImpurityAdjustments([row,row],period,{}).kg,20000);
for(const filters of [{fieldId:'other'},{warehouseId:'other'},{cropId:'other'},{varietyId:'other'},{reproductionId:'other'}]) assert.equal(periodImpurityAdjustments([row],period,filters).kg,0);
assert.equal(periodImpurityAdjustments([row],{start:period.end,end:'2026-09-23T02:00:00Z'},{}).kg,0);
assert.throws(()=>periodImpurityAdjustments([{...row,quantity_kg:NaN}],period,{}));
const receipt={id:'receipt',op_type:'harvest_incoming',status:'finalized',is_finalized:true,net_weight_kg:1069730,created_at:'2026-09-21T04:00Z',finalized_at:'2026-09-21T04:10Z',lines:[{crop_id:'potato',crop_name:'Картофель'}]} as any;
const removal={...receipt,id:'removal',op_type:'weighbridge_impurities',net_weight_kg:244000};
const result=buildPotatoPeriodMovement([receipt],[removal],period as any,{},[row]);
assert.equal(result.netAfterRemovalsKg,805730);assert.equal(result.removedImpuritiesKg,264000);
assert.equal(result.adjustmentKg,20000);assert.equal(result.adjustmentCount,1);
assert.equal(periodImpurityAdjustments([{...row,reversed_at:'2026-09-22T04:00Z'}],period,{}).kg,0);
const reversed=buildPotatoPeriodMovement([receipt],[removal],period as any,{},[{...row,reversed_at:'2026-09-22T04:00Z'}]);
assert.equal(reversed.netAfterRemovalsKg,825730);assert.equal(reversed.removedImpuritiesKg,244000);
console.log('PASS: dashboard uses accounting period, exact 805730 result, no duplication, precise filters, invalid masses rejected.');
