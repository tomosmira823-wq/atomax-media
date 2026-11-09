// The revision pipeline, one test per thing that went wrong on 9 Nov 2026, then (when FIVE_FORDS points at the job) a run on the real
// Five Fords P02 sheets compared with the P03s that were checked by hand and sent. node test/pipeline-test.js
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const D = require('../src/dxffix'), R = require('../src/revup'), V = require('../src/verify'), dxm = require('../src/dxfmaker');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok ', name); };

// sourceFor, lifted from jobsmain the way it runs there
const { sourceFor } = require('../src/jobsmain');
const F = (rel) => ({ rel, name: rel.split('/').pop(), mtime: 0 });
t('-72-0001 is not -72-00012 (the wrong drawing was being picked)', () => {
  const files = ['DXF/X130726-0000-06-72-00012 P02.dxf', 'DXF/X130726-0000-06-72-00013 P02.dxf'].map(F);
  assert.strictEqual(sourceFor({ no: 'X130726-0000-06-72-0001' }, files).dxf, '');
  assert.ok(/00012 P02/.test(sourceFor({ no: 'X130726-0000-06-72-00012' }, files).dxf));
  assert.ok(/0001 P03/.test(sourceFor({ no: 'X130726-0000-06-72-0001' }, [...files, F('ISSUE 8/X130726-0000-06-72-0001 P03.dxf')]).dxf));
});
t('a tag never matches inside an MTEXT formatting code', () => {
  assert.strictEqual(('{\\C1;SPEN}'.match(D.tokenRe('C1')) || []).length, 0);
  assert.strictEqual(('\\H2.5;TEXT'.match(D.tokenRe('H2')) || []).length, 0);
  assert.strictEqual(('{\\LCEFN FARM DCWW FEEDER 1}'.match(D.tokenRe('CEFN FARM DCWW FEEDER 1')) || []).length, 1);
  assert.strictEqual(('CABLE C1'.match(D.tokenRe('C1')) || []).length, 1);
});
t('the encoding repair undoes only the doubled sequence (° and ± survive)', () => {
  const b = Buffer.from('1\r\n2.5mm\xC3\x82\xC2\xB2 90\xB0 \xB1\r\n', 'latin1'), r = R.repairBoxes(b);
  assert.strictEqual(r.buf.toString('latin1'), '1\r\n2.5mm\xC2\xB2 90\xB0 \xB1\r\n');
});
const box = (revs, extra = []) => { const prims = []; revs.forEach(([rev, date], i) => { const x = i * 160; prims.push({ t: 'text', x: x + 14, y: 54, text: 'ISSUE', h: 3, layer: 'TB' }, { t: 'mtext', x: x + 61, y: 56, text: rev, h: 5, layer: 'TB' }, { t: 'text', x: x + 14, y: 43, text: 'DRAWN', h: 3, layer: 'TB' }, { t: 'mtext', x: x + 61, y: 44, text: 'TM', h: 2.5, layer: 'TB' }, { t: 'mtext', x: x + 115, y: 21, text: date, h: 2.5, layer: 'TB' }, { t: 'line', x1: x + 11, y1: 15, x2: x + 171, y2: 15, layer: 'TB' }, { t: 'line', x1: x + 11, y1: 61, x2: x + 171, y2: 61, layer: 'TB' }, { t: 'line', x1: x + 11, y1: 15, x2: x + 11, y2: 61, layer: 'TB' }, { t: 'line', x1: x + 171, y1: 15, x2: x + 171, y2: 61, layer: 'TB' }); }); prims.push({ t: 'text', x: 1141, y: 19, text: revs[revs.length - 1][0], h: 5, layer: 'TB' }, { t: 'line', x1: 0, y1: 200, x2: 900, y2: 200, layer: 'SLD' }, ...extra); return dxm.writeDxf(prims, { x0: 0, y0: 0, x1: 1200, y1: 400 }); };
t('the plot copy marks hatches non-associative and changes nothing else (logo faces filled green, 9 Nov)', () => {
  const fs = require('fs'), os = require('os'), path = require('path'); const P = require('../src/plot.js');
  const src = ['0', 'SECTION', '2', 'ENTITIES', '0', 'HATCH', '5', '29D6', '8', '0', '2', 'SOLID', '70', '1', '71', '1', '0', 'LINE', '5', 'AB', '71', '1', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n');
  const f = path.join(os.tmpdir(), 'amo-hatch-test.dxf'); fs.writeFileSync(f, src, 'latin1');
  const r = P.plotCopy(f), out = fs.readFileSync(r.path, 'latin1'); fs.unlinkSync(r.path); fs.unlinkSync(f);
  assert.strictEqual(r.hatches, 1); assert.strictEqual(out, src.replace('71\r\n1\r\n0\r\nLINE', '71\r\n0\r\n0\r\nLINE'));
});
t('the new issue box meets the title block and leaves the sheet centre mark alone (double line + second mark, Five Fords P03 9 Nov)', () => {
  const src = box([['P01', '30/09/2026'], ['P02', '21/10/2026']], [{ t: 'line', x1: 11, y1: 61, x2: 493, y2: 61, layer: 'TB' }, { t: 'line', x1: 300, y1: 5, x2: 300, y2: 15, layer: 'FRAME' }]);
  const r = R.revUp(src, {});
  const P = D.parseDxf(r.buf).pairs, L = []; for (let i = 0; i < P.length; i++) if (P[i].code === 0 && P[i].val === 'LINE') { const g = {}; for (let j = i + 1; j < P.length && P[j].code !== 0; j++) g[P[j].code] = +P[j].val; L.push(g); }
  assert.strictEqual(L.filter(g => g[10] === g[11] && g[20] === 5 && g[21] === 15).length, 1, 'the centre mark was copied');
  assert.ok(!L.some(g => g[10] === 460 && g[11] === 460), 'the centre mark was copied one pitch along');
  assert.ok(L.some(g => g[10] === 493 && g[11] === 493 && g[20] === 15 && g[21] === 61), 'the new box does not reach the title block');
  assert.ok(!L.some(g => g[10] === 491 && g[11] === 491), 'a right edge was left one pitch along, short of the title block');
  assert.strictEqual(r.changes.stretched, 2);
  const tight = box([['P01', '30/09/2026'], ['P02', '21/10/2026']], [{ t: 'line', x1: 11, y1: 61, x2: 480, y2: 61, layer: 'TB' }]);
  assert.throws(() => R.revUp(tight, {}), /no room/);
});
t('a sheet at P01 (one issue box) can be revved', () => {
  const r = R.revUp(box([['P01', '25/04/2026']]), {}); assert.strictEqual(r.to, 'P02'); assert.strictEqual(Math.round(r.pitch), 160);
  const T = D.parseDxf(r.buf).ents.filter(e => e.section === 'ENTITIES').map(e => [e.plain, Math.round(e.x)]); assert.ok(T.some(([p, x]) => p === 'P02' && x === 221) && T.some(([p, x]) => p === 'P02' && x === 1141), JSON.stringify(T));
});
t('the new box date is written like the sheet writes dates', () => { const r = R.revUp(box([['P01', '25/04/2026'], ['P02', '21/10/2026']]), {}); assert.ok(D.parseDxf(r.buf).ents.some(e => /^\d\d\/\d\d\/\d{4}$/.test(e.plain) && Math.round(e.x) === 435)); });
const sheet = box([['P01', '25/04/2026'], ['P02', '21/10/2026']], [{ t: 'text', x: 100, y: 210, text: 'LT1', h: 2.5, layer: 'SLD' }, { t: 'text', x: 300, y: 210, text: 'FEEDER 1', h: 2.5, layer: 'SLD' }]);
const run = (fixes, asked, opts = {}) => { const ed = D.applyFixes(sheet, fixes), out = R.revUp(ed.buf, {}); return V.revision({ src: sheet, edited: ed.buf, out: out.buf, fixes, results: ed.results, asked, next: 'P03', ...opts }); };
t('the check passes the edits that were asked for', () => { const v = run([{ action: 'replace_text', before: 'LT1', after: 'CT1' }], 'LT1 should be CT1'); assert.ok(v.ok, v.fail.join(' | ')); });
t('the check fails an edit nobody asked for (wrong drawing, invented text)', () => { const v = run([{ action: 'replace_text', before: 'FEEDER 1', after: 'CUSTOMER NO 2' }], 'LT1 should be CT1'); assert.ok(!v.ok && /CUSTOMER NO 2/.test(v.fail.join()), v.fail.join(' | ')); });
t('the check lets a typo-sized correction through (I for 1, RECIEVE)', () => { const v = run([{ action: 'replace_text', before: 'LT1', after: 'LTI' }], 'the letter I has been used instead of the number 1'); assert.ok(v.ok, v.fail.join(' | ')); });
t('"all text black" is checked, inline colours and true colours included', () => {
  const red = Buffer.from(sheet.toString('latin1').replace(/(\n *8\r?\nSLD)/g, '$1\r\n 62\r\n1\r\n420\r\n16711680'), 'latin1');   // every SLD-layer item red, with a true colour too
  const ed = D.applyFixes(red, [{ action: 'set_colour', ref: 'all', colour: 'black' }]); { const dx = D.parseDxf(ed.buf), e = dx.ents.find(x => x.plain === 'LT1'); assert.ok(!dx.pairs.slice(e.at, e.end).some(p => p.code === 420), 'the text item lost its true colour'); }
  const out = R.revUp(ed.buf, {}); const v = V.revision({ src: red, edited: ed.buf, out: out.buf, fixes: [{ action: 'set_colour' }], results: ed.results, asked: 'all text black', next: 'P03', wantBlack: true }); assert.ok(v.ok, v.fail.join(' | '));
  const v2 = V.revision({ src: red, edited: red, out: R.revUp(red, {}).buf, asked: 'all text black', next: 'P03', wantBlack: true }); assert.ok(!v2.ok && /not black/.test(v2.fail.join()), 'and a sheet left red fails');
});
t('the PDF check reads the page size and page count', () => {
  const f = path.join(require('os').tmpdir(), 'amo-pdf-test.pdf'); const mm = (v) => (v * 72 / 25.4).toFixed(2);
  fs.writeFileSync(f, `%PDF-1.4\n3 0 obj<</Type /Page /MediaBox [0 0 ${mm(420)} ${mm(297)}]>>endobj\n` + ' '.repeat(1100)); assert.ok(V.pdf(f, { w: 420, h: 297 }).ok);
  assert.ok(!V.pdf(f, { w: 841, h: 594 }).ok, 'an A3 page for an A1 sheet fails');
});

{ const E = require('../src/elichat'); const job = { id: 'j', folder: '', drawings: [{ no: 'X130726-0000-06-72-0011', title: 'a' }, { no: 'X130726-0000-06-71-0011', title: 'b' }, { no: 'X130726-0000-06-72-0008', title: 'c' }] };
  const deskMod = { load: () => ({ crs: [] }), saveRaw() {} }, biz = { saveJob() {} }, BIZ = { data: () => ({}), store: { save() {} } };
  E.apply([{ do: 'rename', no: '0011', title: 'X' }, { do: 'rename', no: '0008', title: 'Y' }], { job, deskMod, biz, BIZ }).then(done => {
    assert.ok(/fits 2 drawings/.test(done[0]) && job.drawings[0].title === 'a' && job.drawings[1].title === 'b', done[0]);
    assert.ok(/renamed X130726-0000-06-72-0008/.test(done[1]) && job.drawings[2].title === 'Y', done[1]); console.log('ok  Eli: an ambiguous short number is refused, an unambiguous one works'); }).catch(e => { console.log('FAIL Eli', e.message); process.exitCode = 1; }); }
// a comment on -72-00012 P02 from an email lands on -72-00012, not -72-0001
t('an emailed comment on -00012 P02 is not filed on -0001', () => { const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'intake.js'), 'utf8'); assert.ok(/the whole number, not the start of a longer one/.test(src)); const no = 'X130726-0000-06-72-0001', up = 'X130726-0000-06-72-00012 P02'; assert.ok(!new RegExp('(^|[^0-9])' + no + '(?![0-9])').test(up)); });
// the real job, when it is there: the edits from Wyn's email on the P02s, checked, and compared with what was sent on 9 Nov
const FF = process.env.FIVE_FORDS;
if (FF && fs.existsSync(FF)) {
  const W = path.join(FF, '7. Electrical', 'DXF'), I = path.join(FF, '9. Document Control', '9.2 Transmittals', 'ISSUE 8');
  const asks = {
    '0008': ['Looks like the letter I has been used instead of the number 1 for ferruling. all in black. Change CEFN FARM DCWW FEEDER 1 to CEFN ROAD SOLAR - CUSTOMER NO 1 FDR', [{ action: 'replace_text', before: 'KIT', after: 'K1T' }, { action: 'replace_text', before: 'K3IT', after: 'K31T' }, { action: 'replace_text', before: 'CEFN FARM DCWW FEEDER 1', after: 'CEFN ROAD SOLAR - CUSTOMER NO 1 FDR' }, { action: 'set_colour', ref: 'all', colour: 'black' }]],
    '00012': ['LT1 & LT2 should be CT1 & CT2', [{ action: 'replace_text', before: 'LT1', after: 'CT1' }, { action: 'replace_text', before: 'LT2', after: 'CT2' }, { action: 'set_colour', ref: 'all', colour: 'black' }]],
  };
  for (const [no, [asked, fixes]] of Object.entries(asks)) t(`Five Fords -${no}: the email's edits on the P02 pass the check and match what was sent`, () => {
    const s0 = fs.readFileSync(path.join(W, `X130726-0000-06-72-${no} P02.dxf`)), ed = D.applyFixes(s0, fixes), out = R.revUp(ed.buf, { drawn: 'DM', checked: 'TM' });
    const v = V.revision({ src: s0, edited: ed.buf, out: out.buf, fixes, results: ed.results, asked, next: 'P03', wantBlack: true }); assert.ok(v.ok, v.fail.join(' | '));
    const sent = path.join(I, `X130726-0000-06-72-${no} P03.dxf`); if (!fs.existsSync(sent)) return;
    const words = (b) => new Set(D.parseDxf(b).ents.filter(e => e.section !== 'BLOCKS').map(e => e.plain.toUpperCase()).filter(x => /CUSTOMER NO|K1T|K31T|CT[12]$|KIT|K3IT|LT[12]$/.test(x)));
    const a = words(out.buf), b = words(fs.readFileSync(sent)); for (const w of b) assert.ok(a.has(w), `the sent P03 has "${w}" and this run does not`);
  });
}
console.log(`pipeline ok ${n}`);
