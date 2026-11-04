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
