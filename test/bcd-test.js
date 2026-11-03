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
  // the client's asks: type and length on every cable, an area box per location, by-others items outside the scope box
  const texts = sheets.flatMap(s => m.flatPrims(s.prims)).filter(p => p.t === 'text').map(p => String(p.text));
  assert.ok(texts.includes('XLPE/SWA/LSZH EMC - 55M'), 'C-012 type and length');
  for (const c of spec.cables) assert.ok(texts.some(t => t.endsWith(' - ' + c.length + 'M')), 'length on ' + c.no);
  for (const l of ['HV ROOM', 'TRANSFORMER COMPOUND', 'GENERATOR ENCLOSURE', 'LV SWITCHROOM', 'PUMP HALL', 'WET WELL', 'VALVE CHAMBER']) assert.ok(texts.includes(l), 'area named: ' + l);
  assert.deepStrictEqual(spec._warnings || [], [], 'no layout warnings');
  const s1 = m.flatPrims(sheets[0].prims), scope = m.primsBounds(s1.filter(p => p.layer === 'BCD-SCOPE'));
  const rmu = s1.find(p => p.t === 'mtext' && /RMU-01/.test(p.text)); assert.ok(rmu && rmu.y > scope.y1, 'RMU-01 outside the scope box');
  // notes: our working never reaches the client
  const cn = m.clientNotes({ notes: ['APPROVED X021126 MASTER DEVICE LIST (25 DEVICES, 32 CABLES).', 'TQ-03: CONFIRM GLAND SIZE', 'DRAWING NUMBER, REVISION AND DRAWN BY ARE TBC.', 'NO SEPARATE TAGS ARE GIVEN FOR THE ISOLATORS SO THEY ARE SHOWN ON THE MOTOR LINE.', 'ALL LV CABLES ARE COPPER.'] });
  assert.deepStrictEqual(cn.notes, ['ALL LV CABLES ARE COPPER.']); assert.strictEqual(cn.moved.length, 4);
  // pairs are written PR, never P (Tom, X021126 C-025), and the abbreviations note matches
  { const sp = JSON.parse(JSON.stringify(spec)); sp.cables.find(c => c.no === 'C-025').cores = '2P'; sp.cables.find(c => c.no === 'C-023').cores = '2 pair';
    const tx = m.layoutBcd(sp, { border: 'atomax' }).flatMap(s => s.prims).filter(p => p.t === 'text').map(p => p.text);
    assert.strictEqual(tx.filter(t => /^2PR 1\.0MM²$/.test(t)).length, 2, 'pairs as 2PR'); assert.ok(!tx.some(t => /^\d+P /.test(t)), 'no 2P');
    assert.deepStrictEqual(m.clientNotes({ notes: ['OS - OVERALL SCREENED. P - PAIR.'] }).notes, ['OS - OVERALL SCREENED. PR - PAIR.']); }
  console.log('panel bcd client asks ok: lengths, areas, scope, client notes');
}
