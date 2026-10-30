// node test/bcd-test.js — BCD layouts never have cables that overlap or cross, big JBs and many sheets included.
'use strict';
const assert = require('assert'), m = require('../src/dxfmaker');
for (const n of [1, 3, 7, 10, 15, 30]) {
  const cables = [{ no: 'RIO1/C001', from: 'RIO1', to: 'JB1' }, { no: 'RIO1/C002', from: 'RIO1', to: 'JB1' }];
  for (let i = 0; i < n; i++) cables.push({ no: 'JB1/C1' + i, from: 'JB1', to: 'DEV' + i });
  for (let i = 0; i < 4; i++) cables.push({ no: 'RIO1/C2' + i, from: 'RIO1', to: 'PX' + i });
  cables.push({ no: 'RIO1/C017', from: 'RIO1', to: 'X03-MCC' });
  const sheets = m.layoutBcd({ kind: 'bcd', nodes: [{ tag: 'RIO1', type: 'rio' }, { tag: 'JB1', type: 'jb' }, { tag: 'X03-MCC', type: 'mcc' }], cables });
  for (const s of sheets) assert.deepStrictEqual(m.cableClashes(s.prims), [], `${n} devices`);
  assert.strictEqual(new Set(sheets.flatMap(s => s.cables)).size, cables.length, 'every cable drawn once');
}
assert.ok(m.cableClashes([{ t: 'pline', layer: 'BCD-CABLE', pts: [[0, 0], [10, 0], [10, -10]] }, { t: 'line', layer: 'BCD-CABLE', x1: 5, y1: 5, x2: 5, y2: -5 }]).length === 1);
console.log('bcd ok: no overlapping or crossing cables');
