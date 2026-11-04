// Oakmere (second dummy job): HV incomer + generator, JB with instruments, spares, five rooms. Guards the things that went wrong on it:
// the BCD must use the panel layout on ONE sheet with every cable drawn; the SLD must have two incomers and box every room.
const D = require('../src/dxfmaker.js'), fs = require('fs'), path = require('path'), assert = require('assert');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'oakmere.json'), 'utf8'));
const sld = F.sld, bcd = F.bcd;
D.fromSchedule(sld, F.sheets);
const L = D.layoutSld(sld, { border: 'atomax' });
assert.strictEqual(sld.boards[0].incomers.length, 2, 'transformer and generator are two incomers');
const texts = L.prims.filter(p => p.t === 'text' || p.t === 'mtext').map(p => String(p.text));
for (const room of ['HV COMPOUND', 'GENERATOR ENCLOSURE', 'INLET WORKS SWITCHROOM']) assert(texts.includes(room), 'SLD room boxed: ' + room);
assert.strictEqual(L.sheet, 'A1', 'SLD on A1');
const S = D.layoutBcd(bcd, { border: 'atomax' });
assert.strictEqual(S.length, 1, 'BCD on one sheet (panel layout, not the instrument one)');
assert.strictEqual(S[0].sheet, 'A0');
const drawn = new Set(S[0].cables || []); for (const c of bcd.cables) assert(drawn.has(c.no), 'BCD cable drawn: ' + c.no);
const bt = S[0].prims.filter(p => p.t === 'text' || p.t === 'mtext').map(p => String(p.text));
for (const room of ['HV COMPOUND', 'GENERATOR ENCLOSURE', 'INLET SCREEN HOUSE', 'GRIT PLANT', 'INLET CHANNEL']) assert(bt.some(t => t.includes(room)), 'BCD room boxed: ' + room);
assert(bt.some(t => /^TO MET/.test(t)), 'star point earth labelled TO MET');
console.log('oakmere ok: SLD 2 incomers, rooms boxed; BCD 1 sheet A0, all', bcd.cables.length, 'cables');
// P02 per the client's comments: a deleted spare way goes from both drawings (not put back from the schedule), a new motor fits, still one sheet
{
  const F2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'oakmere.json'), 'utf8')), note = 'Delete the 100A spare way C-009 on MSB-01. Keep the 250A spare. Add a second grit pump M-207 on new cable C-018.';
  const s2 = F2.sld, b2 = F2.bcd; s2.revisionNote = note; b2.revisionNote = note;
  b2.cables.push({ no: 'C-018', from: 'MCC-01', to: 'M-207', type: 'XLPE/SWA/LSZH 600/1000V', cores: '4C', size: '6', length: '128' }); b2.nodes.push({ tag: 'M-207', type: 'device', label: 'GRIT PUMP 2 5.5kW DOL', location: 'Grit Plant' });
  D.fromSchedule(s2, F2.sheets); D.fromSchedule(b2, F2.sheets);
  const sp = s2.boards[0].feeders.filter(f => f.chain.some(i => i.symbol === 'spare')); assert.strictEqual(sp.length, 1, 'one spare way left on the SLD'); assert(/250A/.test(sp[0].chain[1].label));
  const S2 = D.layoutBcd(b2, { border: 'atomax' }); assert.strictEqual(S2.length, 1, 'P02 BCD still one sheet'); assert(!S2[0].cables.includes('C-009') && S2[0].cables.includes('C-018'));
  console.log('oakmere P02 ok: spare way deleted on both, M-207 added, one sheet');
}
// SLD revision clouds: a changed item (transformer impedance), a changed breaker and a new feeder each get a cloud; unchanged ones none
{
  const F3 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'oakmere.json'), 'utf8')), old = JSON.parse(JSON.stringify(F3.sld)), nw = F3.sld;
  nw.boards[0].incomers[0].chain[2].label = 'TX-01\n800kVA 11/0.433kV\nDyn11\nZ 5%'; nw.boards[0].feeders[0].chain[0].label = '400A 3P MCCB';
  nw.boards[0].feeders[0].chain[2].board.feeders.push({ chain: [{ symbol: 'breaker', label: 'TBC' }, { symbol: 'dol', label: 'DOL STARTER' }, { symbol: 'cable', label: 'C-018\n4C 6mm²' }, { symbol: 'motor', label: 'M-207\nGRIT PUMP 2' }] });
  const d = D.sldDiff(old, nw); assert.deepStrictEqual(d.added, ['C-018']); assert.deepStrictEqual(d.changed.sort(), ['C-001', 'C-004']); assert.deepStrictEqual(d.removed, []);
  nw.revision = 'P02'; const L3 = D.layoutSld(nw, { border: 'atomax' }); const tri = L3.prims.filter(p => p.layer === 'SLD-REVISION' && p.t === 'mtext').length;
  assert.strictEqual(tri, 3, 'three revision triangles (TX-01, 400A MCCB, new C-018 feeder), got ' + tri);
  console.log('oakmere SLD clouds ok: 3 changes, 3 clouds');
}
// HOLD clouds: the cable still numbered TBC (to M-206) is clouded H on both drawings, with the hold note; numbered cables are not
{
  const F4 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'oakmere.json'), 'utf8'));
  const sld = F4.sld; D.fromSchedule(sld, F4.sheets); const L4 = D.layoutSld(sld, { border: 'atomax' });
  const sh = L4.prims.filter(p => p.layer === 'SLD-HOLD' && p.t === 'mtext').length;
  assert.strictEqual(sh, 1, 'one HOLD flag on the SLD (the TBC cable to M-206), got ' + sh);
  assert.ok(L4.prims.some(p => /ON HOLD PENDING|FLAGGED HOLD/.test(p.text || '')), 'hold note printed on the SLD');
  const S4 = D.layoutBcd(F4.bcd, { border: 'atomax' });
  const bh = S4.flatMap(s => s.prims).filter(p => p.layer === 'BCD-HOLD' && p.t === 'mtext').length;
  assert.strictEqual(bh, 1, 'one HOLD flag on the BCD, got ' + bh);
  assert.ok(S4[0].prims.some(p => /ON HOLD PENDING|FLAGGED HOLD/.test(p.text || '')), 'hold note printed on the BCD');
  console.log('oakmere HOLD ok: TBC cable clouded and flagged HOLD on SLD and BCD, note printed');
}
