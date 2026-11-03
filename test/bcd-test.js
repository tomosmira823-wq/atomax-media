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
// the Atomax panel BCD (going down): the whole site on ONE sheet when it fits A0 (Tom: as simple as it can be), every cable once, no crossings
{
  const fs = require('fs'), path = require('path');
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-bcd.json'), 'utf8'));
  const sheets = m.layoutBcd(spec, { border: 'atomax' });
  assert.strictEqual(sheets.length, 1, 'one sheet'); assert.strictEqual(new Set(sheets[0].cables).size, sheets[0].cables.length, 'each cable drawn once');
  const onSheets = new Set(sheets.flatMap(s => s.cables));
  for (const c of spec.cables) assert.ok(onSheets.has(c.no), 'cable on a sheet: ' + c.no);
  for (const s of sheets) assert.deepStrictEqual(m.cableClashes(s.prims), [], 'panel sheet clashes');
  console.log(`panel bcd ok: ${sheets.length} sheets, all ${spec.cables.length} cables, no crossings`);
  // the client's asks: type and length on every cable, an area box per location, by-others items outside the scope box
  const texts = sheets.flatMap(s => m.flatPrims(s.prims)).filter(p => p.t === 'text').map(p => String(p.text));
  assert.ok(texts.includes('XLPE/SWA/LSZH EMC - 55m'), 'C-012 type and length');
  for (const c of spec.cables) assert.ok(texts.some(t => t.endsWith(' - ' + c.length + 'm') || t === c.length + 'm'), 'length on ' + c.no);
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
    assert.strictEqual(tx.filter(t => /^2PR 1\.0mm²$/.test(t)).length, 2, 'pairs as 2PR'); assert.ok(!tx.some(t => /^\d+P /.test(t)), 'no 2P');
    assert.deepStrictEqual(m.clientNotes({ notes: ['OS - OVERALL SCREENED. P - PAIR.'] }).notes, ['OS - OVERALL SCREENED. PR - PAIR.']); }
  // an abbreviations note: one per line under a heading, never split at its dash
  assert.deepStrictEqual(m.noteLines('VSD - VARIABLE SPEED DRIVE. LIS - LOCAL ISOLATOR SWITCH. PR - PAIR.', 70), ['ABBREVIATIONS:', 'VSD - VARIABLE SPEED DRIVE', 'LIS - LOCAL ISOLATOR SWITCH', 'PR - PAIR']);
  assert.deepStrictEqual(m.noteLines('ALL CABLES ARE COPPER.', 70), ['ALL CABLES ARE COPPER.']);
  // the key only lists abbreviations written on the drawing (Tom: VSD was in the key but nowhere on X021126)
  { const used = new Set(['LIS', 'P01', '2PR', 'DOL']);
    assert.deepStrictEqual(m.noteLines('VSD - VARIABLE SPEED DRIVE. DOL - DIRECT ON LINE. LIS - LOCAL ISOLATOR SWITCH. PR - PAIR.', 70, used), ['ABBREVIATIONS:', 'DOL - DIRECT ON LINE', 'LIS - LOCAL ISOLATOR SWITCH', 'PR - PAIR']);
    assert.deepStrictEqual(m.noteLines('VSD - VARIABLE SPEED DRIVE. MCB - MINIATURE CIRCUIT BREAKER.', 70, used), []); }
  // Dex's comma list of abbreviations (X021126 run 3) laid out one per line, only what is on the drawing
  assert.deepStrictEqual(m.noteLines('ABBREVIATIONS: PR - PAIR, C - CORE, VSD - VARIABLE SPEED DRIVE, XLPE - CROSS-LINKED POLYETHYLENE.', 70, new Set(['2PR', '4C', 'XLPE'])), ['ABBREVIATIONS:', 'PR - PAIR', 'C - CORE', 'XLPE - CROSS-LINKED POLYETHYLENE']);
  // a long type (with voltage) splits over two lines so the drops stay short
  { const sp = JSON.parse(JSON.stringify(spec)); sp.cables.forEach(c => { if (/EMC/.test(c.type)) c.type = 'XLPE/SWA/LSZH EMC SCREENED 600/1000V'; });
    const tx = m.layoutBcd(sp, { border: 'atomax' }).flatMap(s => s.prims).filter(p => p.t === 'text').map(p => p.text);
    assert.ok(tx.includes('XLPE/SWA/LSZH EMC SCREENED') && tx.includes('600/1000V - 55m'), 'long type split'); }
  // Tom's third X021126 run (types with voltages, Dex's long descriptions, 14 notes): every sheet on A1, nothing reported
  { const one = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-bcd-run3.json'), 'utf8')), o = m.layoutBcd(one, { border: 'atomax' });
    assert.strictEqual(o.length, 1, 'run 3 on one sheet'); assert.deepStrictEqual(one._warnings || [], [], 'run 3 one sheet no warnings');
    const ot = o[0].prims.filter(p => p.t === 'mtext').map(p => p.text.replace(/\n/g, ' '));
    assert.ok(ot.some(t => /TO FT-01 OUTLET FLOW METER/.test(t) && /SHOWN UNDER MCC-01/.test(t)), 'cross-branch cable ends at a label naming where the item is shown');
    assert.ok(!o[0].prims.some(p => p.t === 'circle' && p.layer === 'BCD-BLOCK' && Math.abs(p.r - 12.5) < 1e-6 && o[0].prims.some(q => q.t === 'mtext' && q.text === 'MCC-01' && Math.hypot(q.x - p.x, q.y - p.y) < 1)), 'MCC-01 is a board, not a motor');
    // with spec.layout "per-panel" (a job too big for A0) it splits one sheet per panel
    const sp = { ...JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-bcd-run3.json'), 'utf8')), layout: 'per-panel' }, sh = m.layoutBcd(sp, { border: 'atomax' });
    assert.ok(sh.length === 3 && sh.every(s => s.page !== 'A0'), 'per panel: 3 sheets, none on A0');
    // a cable on two sheets is labelled in full once; the other sheet says SEE SHEET n (check report 062)
    const see = sh.map(s => s.prims.filter(p => p.t === 'text' && p.rot && /^SEE SHEET \d$/.test(p.text)).map(p => p.text));
    assert.deepStrictEqual(see, [['SEE SHEET 3'], ['SEE SHEET 1', 'SEE SHEET 1', 'SEE SHEET 3'], ['SEE SHEET 1']], 'one full label per cable');
    // units written normally (check report 108)
    const all = sh.flatMap(s => s.prims).filter(p => p.t === 'text' || p.t === 'mtext').map(p => p.text).join(' ');
    assert.ok(!/\d(KV|KVA|KW|MM²)\b/.test(all) && /1000kVA/.test(all) && /mm²/.test(all), 'kV / kVA / mm² written normally'); assert.deepStrictEqual(sp._warnings || [], [], 'run 3 no warnings');
    const title = sh[0].prims.filter(p => p.t === 'text').map(p => p.text); assert.ok(title.includes('MSB-01 MAIN LV SWITCHBOARD'), 'short panel name in the title'); }
  console.log('panel bcd one sheet ok, per-panel split ok');
  // check report X021126: no TQ pointers in labels, our workbook reading never a note (117, 118, 120)
  assert.strictEqual(m.cleanLabel('VSD 90kW\nRATING TBC (SEE TQ)'), 'VSD 90kW\nRATING TBC');
  assert.deepStrictEqual(m.clientNotes({ notes: ['CABLE SCHEDULE NOTES R39 TO R41 ARE TRUNCATED IN THE WORKBOOK.', 'DNO/ICP DETAILS AWAITED (RFI-001 / RFI-005).', 'HOLD: UPS-01 OUTPUT MCB POLES NOT GIVEN.'] }).notes, ['HOLD: UPS-01 OUTPUT MCB POLES NOT GIVEN.']);
  console.log('panel bcd client asks ok: lengths, areas, scope, client notes');
}
