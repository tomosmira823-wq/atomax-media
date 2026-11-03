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
// the Atomax panel BCD (one sheet per panel, going down): every cable on a sheet, no crossings
{
  const fs = require('fs'), path = require('path');
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-bcd.json'), 'utf8'));
  const sheets = m.layoutBcd(spec, { border: 'atomax' });
  assert.ok(sheets.length >= 2, 'one sheet per panel');
  const onSheets = new Set(sheets.flatMap(s => s.cables));
  for (const c of spec.cables) assert.ok(onSheets.has(c.no), 'cable on a sheet: ' + c.no);
  for (const s of sheets) assert.deepStrictEqual(m.cableClashes(s.prims), [], 'panel sheet clashes');
  console.log(`panel bcd ok: ${sheets.length} sheets, all ${spec.cables.length} cables, no crossings`);
}
