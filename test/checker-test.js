// Offline test for src/checker.js: builds a small .xlsx by hand, fakes Claude, and checks the findings.
// Run: node test/checker-test.js
const zlib = require('zlib');
const assert = require('assert');
const { runCheck, readXlsx, normKey } = require('../src/checker');

// ---- minimal zip writer (stored, no compression) ----
function zip(entries) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, 'utf8'), nm = Buffer.from(name), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, nm);
    off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
function xlsx(rows) { // rows: array of arrays; a cell can be {v, strike}
  const col = (i) => String.fromCharCode(65 + i);
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((c, ci) => { const o = typeof c === 'object' ? c : { v: c }; return `<c r="${col(ci)}${ri + 1}" t="inlineStr" s="${o.strike ? 1 : 0}"><is><t>${String(o.v).replace(/&/g, '&amp;')}</t></is></c>`; }).join('') + '</row>').join('');
  return zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Cable Schedule" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/styles.xml': '<styleSheet><fonts count="2"><font><sz val="11"/></font><font><strike/></font></fonts><cellXfs count="2"><xf fontId="0"/><xf fontId="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheet}</sheetData></worksheet>`
  });
}

const schedule = xlsx([
  ['Cable No', 'From', 'To', 'Cable Type', 'Drawing'],
  ['C-101', 'JB-1', 'PLC/RIO1', '2C 1.5 SWA', 'DRG-001'],
  ['C-102', 'JB-2', 'PLC/RIO1', 'Instrument 1PR', 'DRG-001'],
  ['C-103', 'JB-3', 'PLC/RIO1', '2C 1.5 SWA', 'DRG-002'],
  [{ v: 'C-104', strike: true }, { v: 'JB-4', strike: true }, { v: 'MCC', strike: true }, { v: '3C 2.5 SWA', strike: true }, { v: 'DRG-002', strike: true }],
  ['C-106', 'JB-6', 'MCC', '2C 1.5 SWA', 'DRG-002'],
  ['C-107', 'JB-7', 'MCC', '2C 1.5 SWA', 'DRG-009']
]);

// ---- fake Claude ----
const DRAWINGS = {
  'DRG-001.pdf': { docType: 'loop', sheets: [{ page: 1, drawingNumber: 'DRG-001', status: 'live', cables: [{ tag: 'C_101', from: 'JB-1', to: 'PLC-RIO1', type: '2C 1.5mm SWA' }, { tag: 'C-102', from: 'JB-2', to: 'PLC/RIO1', type: 'Instrument 2PR' }, { tag: 'C-105', from: 'JB-5', to: 'PLC/RIO1', type: '' }], interfaceCables: ['LINK-1'], typos: [{ text: 'C-1O5', shouldBe: 'C-105', where: 'title block' }] }] },
  'DRG-002.pdf': { docType: 'loop', sheets: [{ page: 1, drawingNumber: 'DRG-002', status: 'live', cables: [{ tag: 'C-103', type: '2C 1.5 SWA' }, { tag: 'C-104' }] }] },
  'DRG-003.pdf': { docType: 'loop', sheets: [{ page: 1, drawingNumber: 'DRG-003', status: 'hatched', cables: [{ tag: 'C-999' }] }] }
};
const seen = { calls: 0, extracts: 0, noteSeen: false };
async function claude({ system, messages }) {
  seen.calls++;
  const text = JSON.stringify(messages);
  if (/map the columns/.test(system)) return { text: JSON.stringify({ sheets: [{ sheet: 'Cable Schedule', isSchedule: true, headerRow: 1, firstDataRow: 2, cols: { tag: 'A', from: 'B', to: 'C', type: 'D', drawing: 'E' } }] }), stop: 'end_turn' };
  if (/reading ONE source document/.test(system)) {
    seen.extracts++; if (/ENGINEER:/.test(system)) seen.noteSeen = true;
    const name = (text.match(/Document file name: ([^\\]+?)\\n/) || [])[1];
    if (name === 'DRG-004.pdf') throw new Error('Claude 400: too many pages');
    return { text: 'Here you go:\n' + JSON.stringify(DRAWINGS[name]), stop: 'end_turn' };
  }
  if (/judge possible mismatches/.test(system)) {
    const items = JSON.parse(messages[0].content[0].text);
    return { text: JSON.stringify({ verdicts: items.map(i => ({ id: i.id, real: !/1\.5mm/.test(i.drawing) && i.schedule !== i.drawing, confirm: false, reason: '' })) }), stop: 'end_turn' };
  }
  if (/left you a note/.test(system)) return { text: JSON.stringify({ answer: 'Noted: nothing extra beyond the standard checks.', extra: [] }), stop: 'end_turn' };
  throw new Error('unexpected prompt: ' + system.slice(0, 60));
}

(async () => {
  // reader
  const sh = readXlsx(schedule);
  assert.strictEqual(sh[0].rows.length, 7);
  assert.deepStrictEqual(sh[0].rows[4].st.slice(0, 2), [true, true], 'strike read from styles');
  assert.strictEqual(normKey('/RIO1/'), normKey('-RIO1')); assert.strictEqual(normKey('C_101'), normKey('C-101'));

  const file = (name) => ({ name, base64: Buffer.from('%PDF fake').toString('base64') });
  const progress = [];
  const r = await runCheck({
    schedule: { name: 'schedule.xlsx', base64: schedule.toString('base64') },
    drawings: [file('DRG-001.pdf'), file('DRG-002.pdf'), file('DRG-003.pdf'), file('DRG-004.pdf'), { name: 'plan.dwg', base64: 'AA==' }],
    note: 'Also check nothing odd about C-103', claude, progress: (p) => progress.push(p)
  });
  const texts = r.findings.map(f => `${f.group} | ${f.kind} | ${f.text}`);
  console.log(r.text);
  const has = (re) => assert.ok(texts.some(t => re.test(t)), 'expected finding: ' + re + '\n' + texts.join('\n'));
  const hasNot = (re) => assert.ok(!texts.some(t => re.test(t)), 'unexpected finding: ' + re + '\n' + texts.join('\n'));
  has(/DRG-001 \| add \| C-105/);                     // on drawing, not on schedule
  has(/DRG-001 \| differs \| C-102 type: BEFORE Instrument 1PR → AFTER Instrument 2PR/);
  has(/DRG-001 \| typo/);
  has(/DRG-002 \| struck \| C-104/);                  // struck on the schedule, still on the drawing
  has(/DRG-002 \| missing_on_dwg \| Schedule row 6 \(C-106\)/); // schedule says DRG-002, drawing does not show it
  has(/Schedule \| not_on_dwg \| Row 7: C-107/);      // schedule row on a drawing nobody supplied
  hasNot(/C-101/);                                    // C_101 vs C-101 and 2C 1.5mm SWA are formatting only
  hasNot(/C-999/);                                    // hatched sheet ignored
  assert.ok(r.coverage.some(c => /Drawings → schedule/.test(c)) && r.coverage.some(c => /Schedule → drawings/.test(c)));
  assert.ok(r.notChecked.some(n => /DRG-004/.test(n)) && r.notChecked.some(n => /plan\.dwg/.test(n)), 'unread files listed');
  assert.strictEqual(r.bothWays, false, 'must not claim both ways when files were unread');
  assert.ok(seen.noteSeen, 'note reached the extraction prompt');
  assert.ok(r.noteAnswer.startsWith('Noted'), 'note answered');
  assert.ok(progress.some(p => p.stage === 'drawings'));
  console.log('\nchecker-test: all passed (' + seen.calls + ' fake Claude calls)');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
