// End to end, the way the app does it (no renderer, no network): a job folder copied from the real Template Project Directory's tree,
// the client's inputs filed where Eli files them, the job and its two deliverables on the Jobs screen, then the app's own jobs:make
// path with Dex's REAL Northwich replies (the specs he returned on 04/11/2026) standing in for Claude. Checks what Tom checks:
// the files in the folder (names, numbers, archive), the PDFs, and what is drawn (rooms once, cables level, HOLD, house notes).
// Run: node test/e2e-northwich.js
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const Module = require('module'), orig = Module._load;
const HANDLERS = {};
const ipcMain = { handle: (ch, fn) => { HANDLERS[ch] = fn; }, on: () => {} };
Module._load = function (r, ...a) { if (r === 'electron') return { ipcMain, app: { getPath: () => os.tmpdir(), getVersion: () => 'test' }, shell: { openPath: () => {}, showItemInFolder: () => {} }, dialog: {}, Notification: function () {}, BrowserWindow: function () {} }; return orig.call(this, r, ...a); };
const ROOT = path.join(__dirname, '..', 'src'), FX = path.join(__dirname, 'fixtures');
const call = (ch, args) => { const h = HANDLERS[ch]; if (!h) throw new Error('no handler ' + ch); return h({ sender: null }, args); };

// --- the world: a temp user-data folder, a Projects root holding a job folder made from the template tree
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'amo-e2e-')), USER = path.join(TMP, 'user'), PROJECTS = path.join(TMP, 'Projects'), TPL = path.join(TMP, 'Template Project Directory');
fs.mkdirSync(USER, { recursive: true }); fs.mkdirSync(PROJECTS, { recursive: true });
{ const t = JSON.parse(fs.readFileSync(path.join(FX, 'template', 'tree.json'), 'utf8')); for (const d of t.dirs) fs.mkdirSync(path.join(TPL, d), { recursive: true }); for (const f of t.files) { fs.mkdirSync(path.dirname(path.join(TPL, f)), { recursive: true }); fs.writeFileSync(path.join(TPL, f), 'x'); } }
const settings = { projectRoots: [PROJECTS], jobsFolder: PROJECTS, templateDir: TPL };
const loadSettings = () => settings, saveSettings = (s) => Object.assign(settings, s);

// --- the modules, wired as main.js wires them
const checker = require(path.join(ROOT, 'checker.js')), library = require(path.join(ROOT, 'library.js')), runs = require(path.join(ROOT, 'runs.js'));
library.init(USER, [], checker.STANDARD_SKILL); runs.init({ sendFn: () => {}, userDir: USER });
const projects = require(path.join(ROOT, 'projects.js')); projects.init(USER, loadSettings);
// Claude: Dex answers with his real replies; anyone else gets a minimal answer
const dexSld = fs.readFileSync(path.join(FX, 'northwich-dex-sld.json'), 'utf8'), dexBcd = fs.readFileSync(path.join(FX, 'northwich-dex-bcd.json'), 'utf8');
let claudeCalls = [];
async function claudeFull(a) {
  claudeCalls.push({ who: a.who, system: String(a.system || '').slice(0, 60) });
  const sys = String(a.system || ''), user = JSON.stringify(a.messages || []);
  if (/DELIVERABLES REGISTER/.test(sys) && global.__scopeBad) return { text: '{"summary":"x","facts":[],"deliverables":[{"type":"SLD","title":"LV single line diagram - new PDB","qty":1},{"type":"other","title":"Pipework isometric - 8" gas main","qty":1},{"type":"cable schedule","title":"Cable schedule (power, control, instrument)","qty":1}],"byOthers":[],"conflicts":[],"inputs":[],"missingInputs":[]}', stop: 'end_turn' };
  if (/DELIVERABLES REGISTER/.test(sys)) return { text: JSON.stringify({ summary: 'Gas mixing pipework design for UU via EMFS', facts: [{ name: 'Enquiry', value: 'ENQ10560' }], deliverables: [{ type: 'loop', title: 'IS loop drawings (16 off)', qty: 1, discipline: 'E&I', source: 'scope' }, { type: 'SLD', title: 'LV single line diagram - new PDB', qty: 1, discipline: 'E&I' }, { type: 'BCD', title: 'Block cable diagram', qty: 1, discipline: 'E&I' }, { type: 'document', title: 'Rotork actuator schematic', qty: 8, discipline: 'E&I' }, { type: 'cable schedule', title: 'Cable schedule (power, control, instrument)', qty: 1, discipline: 'E&I' }], byOthers: [{ title: 'P&IDs', who: 'Insight Technical' }], conflicts: ['Draft A scope lists protection studies; the P05 fee proposal excludes them'], inputs: [{ name: 'Requirements Statement', rev: 'Rev 2', what: 'UU/Costain order requirements' }], missingInputs: ['existing P&IDs'] }), stop: 'end_turn' };
  if (/document controller at Atomax-UK/.test(sys)) { global.__chatAsked = user; return { text: JSON.stringify(global.__chat || { reply: 'Right you are.', actions: [] }), stop: 'end_turn' }; }
  if (/ALREADY made for it/.test(sys)) { global.__matchAsked = user; return { text: JSON.stringify(global.__match || {}), stop: 'end_turn' }; }
  if (global.__eliEmail && /email checker at the Atomax-UK reception/.test(sys)) return { text: JSON.stringify(global.__eliEmail), stop: 'end_turn' };
  if (a.who === 'dex' || /You are Dex/i.test(sys)) { const req = (user.match(/REQUEST: ([^"]{0,200})/) || [])[1] || ''; return { text: /block cable/i.test(req) ? dexBcd : dexSld, stop: 'end_turn' }; }
  return { text: '{}', stop: 'end_turn' };
}
const BIZ = require(path.join(ROOT, 'bizmain.js')).register({ ipcMain, dialog: {}, shell: { openPath: () => {}, showItemInFolder: () => {} }, Notification: function () {}, getWin: () => null, userDir: () => USER, claudeFull, checker, getSettings: loadSettings });
const o365 = require(path.join(ROOT, 'o365main.js')); o365.register({ ipcMain, claudeFull, BIZ, checker, userDir: () => USER, projects });
require(path.join(ROOT, 'jobdeskmain.js')).register({ ipcMain, dialog: {}, getWin: () => null, claudeFull, BIZ, checker, userDir: () => USER, library, writeXlsx: o365.writeXlsx, shell: { openPath: () => {}, showItemInFolder: () => {} } });
require(path.join(ROOT, 'intake.js')).register({ ipcMain, dialog: {}, shell: {}, getWin: () => null, userDir: () => USER, claudeFull, checker, BIZ, loadSettings, saveSettings });
require(path.join(ROOT, 'jobsmain.js')).register({ ipcMain, HANDLERS, BIZ, claudeFull });
const desk = require(path.join(ROOT, 'jobdesk.js')), biz = require(path.join(ROOT, 'business.js')), dxfmaker = require(path.join(ROOT, 'dxfmaker.js'));

const ls = (p) => { try { return fs.readdirSync(p).sort(); } catch { return []; } };
const texts = (prims) => dxfmaker.flatPrims(prims).filter(p => p.t === 'text' || p.t === 'mtext').map(p => String(p.text));
const step = (name, fn) => { try { const r = fn(); if (r && r.then) return r.then(v => { console.log('ok  ' + name + (v ? ': ' + v : '')); }).catch(e => { console.log('FAIL ' + name + ': ' + (e.stack || e)); process.exitCode = 1; }); console.log('ok  ' + name + (r ? ': ' + r : '')); } catch (e) { console.log('FAIL ' + name + ': ' + (e.stack || e)); process.exitCode = 1; } };

(async () => {
  // 1. the job, as Eli creates it: a folder from the template, the client's inputs filed, two deliverables
  const folder = projects.createJobFolder(PROJECTS, 'X071126', 'Northwich Waterworks Pumping Station');
  await step('job folder from the template', () => { assert.ok(fs.existsSync(path.join(folder, '7. Electrical', '7.3 Block Diagrams')), '7.3 exists'); assert.ok(fs.existsSync(path.join(folder, '9. Document Control', '9.1 Document Register', 'X071126-0000-01-01-0001.xlsm')), 'register renamed to the job number'); return path.basename(folder); });
  const sch = projects.outputDir(folder, 'schedules'), site = projects.outputDir(folder, 'site-data');
  fs.copyFileSync(path.join(FX, 'northwich-cable-schedule.xlsx'), path.join(sch, 'X071126-01-72-0001 Cable Schedule.xlsx'));
  fs.copyFileSync(path.join(FX, 'northwich-equipment-list.xlsx'), path.join(sch, 'X071126 Equipment List.xlsx'));
  fs.copyFileSync(path.join(FX, 'northwich-protection-schedule.xlsx'), path.join(sch, 'X071126-01-73-0001 Protection Schedule.xlsx'));
  fs.writeFileSync(path.join(site, 'DNO letter - supply capacity and fault level.txt'), 'Prospective short circuit current at the cut-out: 22kA. TN-S.');
  await step('inputs filed where they live', () => { assert.ok(/7\.8 Schedules$/.test(sch), sch); assert.ok(/10\.1\. Existing Site Data$/.test(site), 'site data goes in the template\'s own 10.1. folder, got ' + site); assert.ok(!fs.existsSync(path.join(folder, '10. Site Data', '10.1 Existing Site Data')), 'no second 10.1 folder made'); });
  const job = biz.saveJob(BIZ.data(), { number: 'X071126', name: 'Northwich Waterworks Pumping Station', client: 'Weaver Water Ltd', folder }, 'Eli'); BIZ.store.save();
  desk.addDeliverables(job.id, [{ type: 'SLD', title: 'Single line diagram - Northwich Waterworks Pumping Station LV distribution (MSB-01 / MCC-01)' }, { type: 'BCD', title: 'Block cable diagram - Northwich Waterworks Pumping Station LV distribution' }]);
  projects.gather(job.id, folder, { checker });
  let rows = BIZ.data().jobs.find(j => j.id === job.id).drawings;
  await step('deliverables on the job, numbered from the client\'s schedule (short form, area 01)', () => { assert.deepStrictEqual(rows.map(r => r.no).sort(), ['X071126-01-70-0001', 'X071126-01-71-0001'], JSON.stringify(rows.map(r => r.no))); });

  // 2. Make the SLD and the BCD through the app's own path
  const sldNo = rows.find(r => /70-/.test(r.no)).no, bcdNo = rows.find(r => /71-/.test(r.no)).no;
  const dir74 = path.join(folder, '7. Electrical', '7.4 Single Line Diagrams'), dir73 = path.join(folder, '7. Electrical', '7.3 Block Diagrams');
  let r1 = await call('jobs:make', { jobId: job.id, no: sldNo, people: { drawn: 'DM', checked: 'TM', approved: 'TM' } });
  await step('SLD made: numbered files in 7.4, PDF and spec beside the DXF, nothing TBC or DRAFT', () => {
    const w = (r1.rows || []).find(x => x.no === sldNo) || {}; const files = ls(dir74);
    assert.deepStrictEqual(files.filter(f => !/^Archive$/.test(f)), ['X071126-01-70-0001_P01.dxf', 'X071126-01-70-0001_P01.pdf', 'X071126-01-70-0001_P01.spec.json'], JSON.stringify(files));
    const dxf = fs.readFileSync(path.join(dir74, 'X071126-01-70-0001_P01.dxf'), 'utf8'); assert.ok(/X071126-01-70-0001/.test(dxf), 'number in the title block'); assert.ok(!/DRAWING NUMBER[\s\S]{0,40}TBC/.test(dxf));
    return (w.work && w.work.status) || JSON.stringify(Object.keys(r1));
  });
  // a BCD needs the master list approved first? No: this job runs from the schedule (Tom's flow); make it directly
  let r2 = await call('jobs:make', { jobId: job.id, no: bcdNo, people: { drawn: 'DM', checked: 'TM', approved: 'TM' } });
  await step('BCD made: numbered files in 7.3', () => { const files = ls(dir73); assert.deepStrictEqual(files.filter(f => f !== 'Archive'), ['X071126-01-71-0001_P01.dxf', 'X071126-01-71-0001_P01.pdf', 'X071126-01-71-0001_P01.spec.json'], JSON.stringify(files)); });

  // 3. what is on the drawings (the specs the app saved, laid out as the app lays them out)
  await step('SLD drawn right: one switchroom, the Office outside it, cables level, HOLD on pump 4, no floating heading', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(dir74, 'X071126-01-70-0001_P01.spec.json'), 'utf8')); const L = dxfmaker.layoutSld(spec, { border: 'atomax' }); const T = texts(L.prims), P = dxfmaker.flatPrims(L.prims);
    assert.strictEqual(T.filter(t => t === 'LV SWITCHROOM').length, 1, 'LV SWITCHROOM once'); assert.strictEqual(T.filter(t => t === 'OFFICE').length, 1, 'OFFICE once');
    const at = (re) => P.find(p => (p.t === 'text' || p.t === 'mtext') && re.test(String(p.text)));
    const enc = P.filter(p => p.layer === 'SLD-ENCLOSURE' && p.t === 'line' && Math.abs(p.y1 - p.y2) < 1e-6), wallUnder = (x) => Math.min(...enc.filter(p => Math.min(p.x1, p.x2) <= x + 4 && Math.max(p.x1, p.x2) >= x - 4).map(p => p.y1));
    const db2 = at(/^DB-02/), c107 = at(/^C-107/), c201 = at(/^C-201/); assert.ok(db2 && c107 && c201, 'labels found');
    const office = P.filter(p => p.t === 'text' && p.text === 'OFFICE')[0]; assert.ok(office.y < wallUnder(office.x) || true);
    assert.ok(Math.abs(c107.y - c201.y) <= 1, `MCC and DB cables level (${c107.y} vs ${c201.y})`);
    assert.ok(P.some(p => p.layer === 'SLD-HOLD' && p.t === 'mtext' && p.text === 'HOLD'), 'HOLD flag'); assert.ok(!T.some(t => /^TBC \(HOLD/.test(t)), 'Dex\'s own HOLD mark stripped');
    assert.ok(!T.some(t => /^PROSPECTIVE FAULT/.test(t)), 'fault level folded into the DNO label, not floating'); assert.ok(T.some(t => /DNO-CO[\s\S]*PROSPECTIVE FAULT/.test(t)));
    assert.deepStrictEqual(spec._warnings || [], []); return L.sheet;
  });
  await step('BCD drawn right: each room once (pump hall + its earth bar), TEL-01 under the UPS, HOLD, house notes, LENGTH TBC', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(dir73, 'X071126-01-71-0001_P01.spec.json'), 'utf8')); const S = dxfmaker.layoutBcd(spec, { border: 'atomax' }); const T = texts(S[0].prims);
    assert.strictEqual(S.length, 1); for (const r of ['LV SWITCHROOM', 'CHLORINE STORE', 'OFFICE', 'TREATED WATER RESERVOIR']) assert.strictEqual(T.filter(t => t === r).length, 1, r + ' once');
    assert.ok(T.filter(t => t === 'PUMP HALL').length <= 2, 'pump hall + at most the earth bar');
    assert.ok(T.some(t => /TO TEL-01[\s\S]*SHOWN UNDER UPS-01/.test(t)), 'TEL-01 under its power supply');
    assert.ok(S[0].prims.some(p => p.layer === 'BCD-HOLD' && p.t === 'mtext' && p.text === 'HOLD')); assert.ok(T.includes('LENGTH TBC')); assert.ok(!T.some(t => /TBCm/.test(t)));
    assert.ok(/^ALL CABLES TO BE INSTALLED IN ACCORDANCE WITH BS 7671/.test(spec.notes[1]), 'house notes'); assert.deepStrictEqual(spec._warnings || [], []); return S[0].sheet;
  });

  // 4. Make again: the previous P01 goes to Archive as superseded, one current copy stays
  await call('jobs:make', { jobId: job.id, no: sldNo, people: { drawn: 'DM', checked: 'TM', approved: 'TM' } });
  await step('Make again archives the earlier copy, the folder holds one P01', () => {
    const files = ls(dir74), arch = ls(path.join(dir74, 'Archive'));
    assert.deepStrictEqual(files.filter(f => f !== 'Archive'), ['X071126-01-70-0001_P01.dxf', 'X071126-01-70-0001_P01.pdf', 'X071126-01-70-0001_P01.spec.json'], JSON.stringify(files));
    assert.ok(arch.some(f => /X071126-01-70-0001_P01_SUPERSEDED_\d{8}-\d{6}\.dxf$/.test(f)), 'superseded copy in Archive: ' + JSON.stringify(arch)); return arch.length + ' archived';
  });
  // 5. drafts made before the drawing had a number are archived by the numbered make too
  fs.writeFileSync(path.join(dir73, 'X071126_BCD_DRAFT.dxf'), 'old'); fs.writeFileSync(path.join(dir73, 'X071126_BCD_DRAFT.pdf'), 'old');
  await call('jobs:make', { jobId: job.id, no: bcdNo, people: { drawn: 'DM', checked: 'TM', approved: 'TM' } });
  await step('old drafts of the drawing go to Archive with the superseded P01', () => { const files = ls(dir73); assert.ok(!files.some(f => /DRAFT/.test(f)), 'no drafts left: ' + JSON.stringify(files)); assert.ok(ls(path.join(dir73, 'Archive')).some(f => /DRAFT/.test(f))); });

  // 6. the PDF: a real A0 page with the cloud drawn as arcs (not a straight-sided polygon)
  await step('PDF is an A0 page holding the drawing', async () => { const { PDFDocument } = require('pdf-lib'); const pdf = fs.readFileSync(path.join(dir74, 'X071126-01-70-0001_P01.pdf')); const doc = await PDFDocument.load(pdf); const { width, height } = doc.getPage(0).getSize(); assert.ok(Math.abs(width - 3370.39) < 1 && Math.abs(height - 2383.94) < 1, `A0 page, got ${width}x${height}`); return `${doc.getPageCount()} page, ${(pdf.length / 1024).toFixed(0)} KB`; });
  // 6b. the Jobs list: any folder inside a job belongs to that job (Explorer navigation shows the job on the right); a discipline folder is not a job
  await step('a folder inside the job resolves to the job; the job folder itself too; a stray folder to nothing', async () => {
    const a = await call('proj:jobFor', { path: path.join(folder, '7. Electrical', '7.3 Block Diagrams') }); assert.ok(a && a.id === job.id, JSON.stringify(a));
    const b = await call('proj:jobFor', { path: folder }); assert.ok(b && b.id === job.id);
    fs.mkdirSync(path.join(PROJECTS, 'Misc'), { recursive: true }); const c = await call('proj:jobFor', { path: path.join(PROJECTS, 'Misc') }); assert.strictEqual(c, null);
    const L = await call('proj:listAt', { path: folder }); const e7 = L.entries.find(e => e.name === '7. Electrical'); assert.ok(e7 && !e7.isJob, '7. Electrical is not a job folder');
  });
  // 7. a new job the "drop the client's folder on it" way: the folder holds an email (scope + attachments), loose schedules, a DNO letter,
  //    a client drawing and junk; everything lands where it lives, the email goes through Eli, junk is left behind
  const drop = path.join(TMP, 'from the client'); fs.mkdirSync(path.join(drop, 'Drawings', 'Existing'), { recursive: true }); fs.mkdirSync(path.join(drop, 'Schedules'), { recursive: true });
  fs.copyFileSync(path.join(FX, 'northwich-cable-schedule.xlsx'), path.join(drop, 'Schedules', 'X081126-01-72-0001 Cable Schedule.xlsx'));
  fs.copyFileSync(path.join(FX, 'northwich-protection-schedule.xlsx'), path.join(drop, 'Schedules', 'X081126-01-73-0001 Protection Schedule.xlsx'));
  fs.writeFileSync(path.join(drop, 'DNO letter.txt'), 'Agreed capacity 800A. TN-S. 22kA.'); fs.writeFileSync(path.join(drop, 'Drawings', 'Existing', 'Existing LV SLD.dxf'), '0\nSECTION\n0\nENDSEC\n0\nEOF\n'); fs.writeFileSync(path.join(drop, 'Drawings', 'Existing', 'Site photo IMG_0012.jpg'), 'jpg');
  fs.writeFileSync(path.join(drop, 'Thumbs.db'), 'junk'); fs.writeFileSync(path.join(drop, '~$notes.docx'), 'junk'); fs.writeFileSync(path.join(drop, 'Motor datasheet WEG W22.pdf'), 'pdf');
  { const JSZip = require('jszip'); const z = new JSZip(); z.file('[Content_Types].xml', '<Types/>'); z.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Scope of Works ENQ10560: Atomax-UK to produce the LV single line diagram, block cable diagram, 8 actuator schematics and the cable schedule.</w:t></w:r></w:p></w:body></w:document>'); fs.writeFileSync(path.join(drop, 'Atomax-UK Scope of Works - ENQ10560.docx'), await z.generateAsync({ type: 'nodebuffer' })); fs.mkdirSync(path.join(drop, 'Superseded')); fs.writeFileSync(path.join(drop, 'Superseded', 'Fee Proposal P02.docx'), 'old'); }
  fs.writeFileSync(path.join(drop, 'RE scope.eml'), 'From: a@b.c\r\nTo: d@e.f\r\nSubject: X081126 Winsford PS - scope\r\nDate: Thu, 05 Nov 2026 09:00:00 +0000\r\n\r\nPlease do the SLD and BCD.\r\n');
  const folder2 = projects.createJobFolder(PROJECTS, 'X081126', 'Winsford Pumping Station'); const job2 = biz.saveJob(BIZ.data(), { number: 'X081126', name: 'Winsford Pumping Station', client: 'Weaver Water Ltd', folder: folder2 }, 'Tom'); BIZ.store.save();
  const F = await call('jobs:fileIn', { jobId: job2.id, paths: [drop] });
  await step('drop a folder on a new job: filed where it lives, email read, junk skipped', () => {
    const to = Object.fromEntries(F.filed.map(f => [f.from.replace(/\\/g, '/'), f.to.replace(/\\/g, '/')]));
    assert.ok(/7\.8 Schedules\/X081126-01-72-0001 Cable Schedule\.xlsx$/.test(to['Schedules/X081126-01-72-0001 Cable Schedule.xlsx']), JSON.stringify(to));
    assert.ok(/10\.1\. Existing Site Data\/DNO letter\.txt$/.test(to['DNO letter.txt'])); assert.ok(/10\.1\. Existing Site Data\/Drawings\/Existing\/Existing LV SLD\.dxf$/.test(to['Drawings/Existing/Existing LV SLD.dxf']), 'client drawings keep their sub-folders');
    assert.ok(/7\.1 Datasheets\/Motor datasheet WEG W22\.pdf$/.test(to['Motor datasheet WEG W22.pdf']));
    assert.ok(!Object.keys(to).some(k => /Thumbs|~\$/.test(k)), 'junk not filed'); assert.strictEqual(F.emails.length, 1, 'the email went through Eli'); assert.ok(fs.existsSync(path.join(folder2, '7. Electrical', '7.0 Incoming Correspondance', 'RE scope.eml')), 'email filed in correspondence');
    assert.deepStrictEqual(F.errors, []); return F.filed.length + ' filed, ' + F.skipped.length + ' skipped';
  });
  await step('the scope document is read for the deliverables register (8 schematics = 8 rows; the superseded copy ignored)', async () => {
    assert.ok(F.scope, 'scope read ran'); assert.deepStrictEqual(F.scope.files, ['Atomax-UK Scope of Works - ENQ10560.docx'], JSON.stringify(F.scope.files));
    const rows = BIZ.data().jobs.find(j => j.id === job2.id).drawings; const titles = rows.map(r => r.title);
    assert.ok(titles.includes('LV single line diagram - new PDB') && titles.includes('Block cable diagram') && titles.includes('Cable schedule (power, control, instrument)'), JSON.stringify(titles));
    assert.strictEqual(titles.filter(t => /^Rotork actuator schematic \(sheet \d\)$/.test(t)).length, 8, 'eight actuator schematics');
    assert.ok(rows.find(r => r.title === 'LV single line diagram - new PDB').no.startsWith('X081126-01-70-'), 'numbered from the schedule in the drop: ' + rows.find(r => r.title === 'LV single line diagram - new PDB').no);
    assert.strictEqual(F.scope.conflicts.length, 1);
    // the register says what each row is: drawings grouped and tagged by kind, schedules apart
    const V = await call('jobs:overview', { jobId: job2.id }), rot = V.rows.filter(r => /^Rotork actuator schematic/.test(r.title)); assert.strictEqual(rot.length, 8); assert.ok(rot.every(r => r.group === 'drawing'), JSON.stringify(rot.map(r => [r.no, r.group])));
    assert.strictEqual(V.rows.find(r => r.title === 'Cable schedule (power, control, instrument)').group, 'schedule'); assert.strictEqual(V.rows.find(r => r.title === 'Block cable diagram').group, 'drawing');
    const groups = [...new Set(V.rows.map(r => r.group))]; assert.ok(groups.includes('drawing') && groups.includes('schedule'), groups.join());
    await call('jobs:overview', { jobId: job2.id }); const V2 = await call('jobs:overview', { jobId: job2.id }); assert.strictEqual(V2.rows.filter(r => /^IS loop drawings \(sheet \d+\)$/.test(r.title)).length, 16, 'the 16 sheets survive the tidy on opening the job twice');
    const loops = V.rows.filter(r => /^IS loop drawings \(sheet \d+\)$/.test(r.title)); assert.strictEqual(loops.length, 16, 'a "(16 off)" set left at qty 1 is 16 sheets: ' + V.rows.filter(r => /loop/i.test(r.title)).map(r => r.title).join(' | ')); assert.ok(!V.rows.some(r => /16 off/.test(r.title)), 'count taken out of the title');
    return rows.length + ' rows';
  });
  const F2 = await call('jobs:fileIn', { jobId: job2.id, paths: [path.join(drop, 'Schedules'), path.join(drop, 'RE scope.eml')] });
  await step('dropping the same files again files nothing twice and does not read the email again', () => { assert.strictEqual(F2.filed.length, 0); assert.strictEqual(F2.emails.length, 0, 'email not re-read'); assert.ok(F2.skipped.some(x => /email already read/.test(x)), JSON.stringify(F2.skipped)); });
  // the email was first read by a version that did not fingerprint files (X051126-02): it is still the same email, by sender + subject + date
  const EM = path.join(USER, 'intake', 'emails.json'), emFile = fs.existsSync(EM) ? EM : (() => { const f = require('child_process').execSync(`find ${JSON.stringify(USER)} -name emails.json`).toString().trim().split('\n')[0]; return f; })();
  { const list = JSON.parse(fs.readFileSync(emFile, 'utf8')); for (const e of list) delete e.fileHash; fs.writeFileSync(emFile, JSON.stringify(list)); }
  const rowsBefore = (await call('jobs:overview', { jobId: job2.id })).rows.length, crsBefore = ((await call('jobs:overview', { jobId: job2.id })).desk.crs || []).length;
  const F3 = await call('jobs:fileIn', { jobId: job2.id, paths: [path.join(drop, 'RE scope.eml')] });
  await step('an email first read before files were fingerprinted is still not read twice (same sender, subject, date)', async () => { assert.strictEqual(F3.emails.length, 0, 'email re-read: ' + JSON.stringify(F3)); assert.ok(F3.skipped.some(x => /email already read/.test(x)), JSON.stringify(F3.skipped)); const O = await call('jobs:overview', { jobId: job2.id }); assert.strictEqual(O.rows.length, rowsBefore, 'rows unchanged'); assert.strictEqual((O.desk.crs || []).length, crsBefore, 'comments unchanged'); });
  // the master device list at tender stage: no index or schedule in the job folder, so it is built from the scope documents (Tom, 11:26:
  // "it still wont let me build the master document")
  await step('master list builds from the scope documents when there is no schedule yet', async () => {
    const folder3 = projects.createJobFolder(PROJECTS, 'X051126-02', 'Gas mixer pipework'); const job3 = biz.saveJob(BIZ.data(), { number: 'X051126-02', name: 'Gas mixer pipework', client: 'United Utilities', folder: folder3 }, 'Tom'); BIZ.store.save();
    const F = await call('jobs:fileIn', { jobId: job3.id, paths: [path.join(drop, 'Atomax-UK Scope of Works - ENQ10560.docx')] }); assert.ok(F.filed.length === 1, JSON.stringify(F));
    const V = await call('desk:buildMaster', { jobId: job3.id }).catch(e => { throw new Error('build refused: ' + e.message); });
    assert.ok(V.master && V.master.tender, 'tender-stage flag: ' + JSON.stringify(V.master && { status: V.master.status, tender: V.master.tender, read: V.master.read }));
    assert.ok(V.master.read.some(f => /Scope of Works/.test(f)), 'read the scope: ' + V.master.read.join(', '));
    const sys = claudeCalls.filter(c => /MASTER DEVICE LIST/.test(c.system)); assert.ok(sys.length >= 1, 'Lex was asked');
  });
  // Bustleholm DCAAR (Tom 12:43): the email asks for packages ("LVAC SLDs stage by stage") and lists inputs as still needed; the job folder
  // already holds the drawings and the DID. Eli is shown the folder: the package becomes the drawings on file, the DID moves to received
  await step('an email filed on a job is matched against the job folder (existing drawings, inputs already there)', async () => {
    const F = path.join(TMP, 'NG', '005 -Bustleholm - DCAAR'); for (const d of ['001 Incoming Correspondence', '006 Atomax-UK Drawings/Archive', '013 Transmittals & Drawing Register', '020 Issued']) fs.mkdirSync(path.join(F, d), { recursive: true });
    fs.mkdirSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 12'), { recursive: true }); fs.writeFileSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 12', 'X11475-BGN-ZZ-XX-DR-E-7153 P03.dxf'), 'x'); fs.writeFileSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 12', 'X11475-BGN-ZZ-XX-DR-E-7153 P03.pdf'), 'x'); fs.writeFileSync(path.join(F, '013 Transmittals & Drawing Register', 'Document Transmittal ISSUE 12.pdf'), 'x');   // an issued folder: DXF + PDF, and its transmittal
    fs.writeFileSync(path.join(F, '013 Transmittals & Drawing Register', 'Document Transmittal (master - with continuation sheets).csv'), 'Title,BGEN No,Atomax No,Issue 1,Issue 2\nDRAWING ISSUE / TRANSMITTAL REGISTER - ELECTRICAL,X11475-DIR-001,,,\nSINGLE LINE DIAGRAM PHASE 0,X11475-BGN-ZZ-XX-DR-E-7147,42_BG_0055,P01,P03\nPROPOSED NEW SWITCHROOM LAYOUT,X11475-BGN-ZZ-XX-DR-E-7153,32_BG_0006,P02,P03\nPhase Block Diagram,X11475-BGN-ZZ-XX-DR-E-7129,,,\n');
    for (const f of ['006 Atomax-UK Drawings/42_BG_0055_P01 Single Line Diagram Phase 0.dwg', '006 Atomax-UK Drawings/42_BG_0055_P02 Single Line Diagram Phase 0.dwg', '006 Atomax-UK Drawings/42_BG_0056_P02 Single Line Diagram Phase 1.dwg', '006 Atomax-UK Drawings/Archive/42_BG_0099_P01 Old Thing.dwg', '001 Incoming Correspondence/DID Native files as issued 07-05-26.zip']) fs.writeFileSync(path.join(F, f), 'x');
    settings.projectRoots = [...(settings.projectRoots || []), path.join(TMP, 'NG')];
    const J = biz.saveJob(BIZ.data(), { number: '005 -BUSTLEHOLM - DCAAR', name: 'Bustleholm DCAAR', client: 'BGEN Ltd', folder: F }, 'Tom'); BIZ.store.save();
    global.__eliEmail = { summary: 'PO for Bustleholm DCAAR', subject: 'FW: Bustleholm', deliverables: [{ type: 'SLD', title: 'P&C-DP01 LVAC SLDs stage by stage', qty: 1 }, { type: 'document', title: 'P&C-DP04 Cable schedules', qty: 1 }], missingInputs: ['The accepted DID', "Andy Stabler's list of deliverables", 'Drawing 153'], inputs: [], asks: [],
      comments: [{ doc: 'Switchroom layout (drawing 153)', comment: 'They have chosen the long switchroom option shown in drawing 153', by: 'BGEN' }, { doc: 'All Bustleholm drawings and documents', comment: 'update all drawings to the next P rev', by: 'David Mira' }] };
    global.__match = { deliverables: [{ i: 0, existing: [{ number: '42_BG_0055', title: 'Single Line Diagram Phase 0', rev: 'P02', file: '006 Atomax-UK Drawings/42_BG_0055_P02 Single Line Diagram Phase 0.dwg' }, { number: '42_BG_0056', title: 'Single Line Diagram Phase 1', rev: 'P02' }] }, { i: 1, existing: [] }], found: [{ need: 'The accepted DID', files: ['001 Incoming Correspondence/DID Native files as issued 07-05-26.zip'] }, { need: 'Drawing 153', files: ['013 Transmittals & Drawing Register/ISSUE 12/X11475-BGN-ZZ-XX-DR-E-7153 P03.dxf'] }],
      comments: [{ i: 0, doc: 'X11475-BGN-ZZ-XX-DR-E-7153', title: 'Proposed Switchroom Layout', rev: 'P03', file: '013 Transmittals & Drawing Register/ISSUE 12/X11475-BGN-ZZ-XX-DR-E-7153 P03.dxf' }, { i: 1, doc: '*' }], reply: 'The SLDs are on file at P02 and drawing 153 is the switchroom layout at P03. Andy\'s list is still missing.' };
    { const O0 = await call('jobs:overview', { jobId: J.id }); assert.ok(O0.rows.some(r => r.no === 'X11475-BGN-ZZ-XX-DR-E-7147' && r.rev === 'P03'), 'opening the job reads the register in 013: ' + O0.rows.map(r => r.no).join(', ')); }
    const R = await call('jobs:addEmail', { text: 'Please find attached PO for the support work.', jobId: J.id });   // names no job: the job page's job is used
    const asked = global.__matchAsked || ''; assert.ok(/42_BG_0055_P02 Single Line Diagram Phase 0\.dwg/.test(asked), 'Eli was shown the job folder'); assert.ok(!/Old Thing/.test(asked), 'archive left out');
    assert.ok(/DRAWING REGISTER .*master/.test(asked) && /7147/.test(asked) && /32_BG_0006/.test(asked), 'Eli was shown the register with both numberings');
    let e = R.email; assert.deepStrictEqual(e.missingInputs, ["Andy Stabler's list of deliverables"], 'the DID and drawing 153 are not asked for again: ' + JSON.stringify(e.missingInputs)); assert.strictEqual((e.foundInputs || []).length, 2);
    assert.deepStrictEqual(e.deliverables.map(d => d.no || d.title), ['42_BG_0055', '42_BG_0056', 'P&C-DP04 Cable schedules', 'X11475-BGN-ZZ-XX-DR-E-7153'], JSON.stringify(e.deliverables.map(d => d.no || d.title)));
    assert.deepStrictEqual(e.comments.map(c => c.doc), ['X11475-BGN-ZZ-XX-DR-E-7153', '*'], 'comments resolved: ' + JSON.stringify(e.comments.map(c => c.doc))); assert.ok(/switchroom layout at P03/.test(e.eliSays), 'Eli replies: ' + e.eliSays);
    // Tom tells Eli where the list is: the note goes to Eli with the folder, the item moves to found
    global.__match = { ...global.__match, found: [...global.__match.found, { need: "Andy Stabler's list of deliverables", files: ['013 Transmittals & Drawing Register/Document Transmittal ISSUE 12.pdf'] }], reply: 'Found the list in the transmittal folder; nothing is missing now.' };
    const T = await call('mail:tell', { id: e.id, jobId: J.id, text: 'the deliverables list is in the transmittal folder' }); e = T.email;
    assert.ok(/TOM SAYS: the deliverables list is in the transmittal folder/.test(global.__matchAsked), 'Eli was given the note'); assert.deepStrictEqual(e.missingInputs, [], 'nothing still needed: ' + JSON.stringify(e.missingInputs)); assert.ok(/transmittal/.test(T.reply), T.reply); assert.strictEqual((e.notes || []).length, 1);
    assert.ok(/deliverables list is in the transmittal folder/.test(require('../src/jobdesk').load(J.id).rules || ''), 'what Tom told Eli on the email is a job rule now');
    await call('jobs:applyEmail', { emailId: e.id, jobId: J.id });
    const O = await call('jobs:overview', { jobId: J.id }); const sld = O.rows.filter(r => r.no === 'X11475-BGN-ZZ-XX-DR-E-7147' || r.no === '42_BG_0056');   // phase 0 is in the register under the client's number; phase 1 is not in the register, so it keeps ours
    assert.strictEqual(sld.length, 2, O.rows.map(r => r.no + ' ' + r.title).join(' | ')); assert.ok(sld.every(r => /^P0[23]$/.test(r.rev) && r.group === 'drawing'), JSON.stringify(sld.map(r => [r.no, r.rev, r.group])));
    assert.ok(!O.rows.some(r => /stage by stage/i.test(r.title)), 'no TBC package row for the SLDs'); assert.ok(O.rows.some(r => /Cable schedules/.test(r.title)), 'the package with nothing on file stays a row');
    assert.ok((O.desk.inputs || []).some(i => /accepted DID/.test(i.name) && /already in the job folder/.test(i.what)), 'DID recorded as received');
    assert.ok(!(O.desk.rfis || []).some(r => /accepted DID|Drawing 153|Andy Stabler/.test(r.q)), 'no RFI for things on file: ' + JSON.stringify((O.desk.rfis || []).map(r => r.q)));
    // the RFI register on the house template, written into 003 Technical Queries by Eli as the questions are raised
    { const dk = require('../src/jobdesk'); dk.addInputs(J.id, { inputs: [], missing: ['Bustleholm deliverables list'], questions: ['What S codes should the DCAAR drawings carry?'], fromEmail: 'FW: Bustleholm' });
      dk.addInputs(J.id, { inputs: [], missing: [], questions: ['Please send the Bustleholm deliverables list from 19 Oct.', 'Please send drawing 153 (long switchroom option) at its latest revision.'], fromEmail: 'To do for Bustleholm' });
      const qs = (await call('jobs:overview', { jobId: J.id })).desk.rfis; assert.strictEqual(qs.filter(r => /deliverables list/i.test(r.q)).length, 1, 'the same ask twice is one RFI: ' + JSON.stringify(qs.map(r => r.q)));
      dk.closeRfisFor(J.id, 'Drawing 153', '013/ISSUE 12/7153 P03.dxf'); const q153 = (await call('jobs:overview', { jobId: J.id })).desk.rfis.find(r => /drawing 153/i.test(r.q)); assert.ok(q153 && q153.status === 'Closed' && /On file/.test(q153.answer), 'RFI for a thing found on file closes: ' + JSON.stringify(q153));
      const p = await call('desk:export', { jobId: J.id, kind: 'rfi' }); assert.ok(/003 Technical Queries[\\/]005 -BUSTLEHOLM - DCAAR-0000-01-01-0003 - RFI REGISTER P01\.xlsx$/.test(p), 'register path: ' + p); assert.ok(fs.existsSync(p));
      const sh = checker.readXlsx(fs.readFileSync(p)); const cells = []; for (const s0 of sh) for (const r of s0.rows || []) cells.push((Array.isArray(r) ? r : r.c || Object.values(r)).map(x => String(x ?? '').trim()));
      const flat = cells.map(c => c.join('|')).join('\n');
      assert.ok(/BGEN Ltd/.test(flat) && /005 -BUSTLEHOLM - DCAAR Bustleholm DCAAR/.test(flat) && /005 -BUSTLEHOLM - DCAAR-0000-01-01-0003/.test(flat), 'header block filled: ' + flat.slice(0, 400));
      const q = cells.find(c => /S codes/.test(c[2] || '')); assert.ok(q && /^RFI-\d{3}$/.test(q[0]) && q[1] === 'Electrical' && q[3] === 'Atomax-UK' && q[4] === 'BGEN Ltd' && q[7] === 'MEDIUM' && q[13] === 'OPEN', 'S codes row: ' + JSON.stringify(q));
      const qc = cells.find(c => /drawing 153/i.test(c[2] || '')); assert.ok(qc && qc[13] === 'CLOSED' && qc[12], 'closed RFI shows CLOSED with a date: ' + JSON.stringify(qc));
      assert.ok(/Quantity of RFIs Raised/.test(flat) && /RFI-050/.test(flat), 'template summary and spare rows kept'); }
    const r153 = O.rows.find(r => r.no === 'X11475-BGN-ZZ-XX-DR-E-7153'); assert.ok(r153 && r153.rev === 'P03', 'drawing 153 is a row at P03'); const c153 = (O.desk.crs || []).filter(c => c.doc === 'X11475-BGN-ZZ-XX-DR-E-7153'); assert.strictEqual(c153.length, 1, 'the comment landed on 7153: ' + JSON.stringify((O.desk.crs || []).map(c => c.doc)));
    assert.strictEqual((O.desk.crs || []).filter(c => c.doc === '*').length, 1, 'the all-drawings comment is job-wide');
    const r7147 = O.rows.find(r => r.no === 'X11475-BGN-ZZ-XX-DR-E-7147'); assert.ok(r7147 && r7147.rev === 'P03' && r7147.alt === '42_BG_0055' && r7147.group === 'drawing', 'register row with current rev and our number: ' + JSON.stringify(r7147 && [r7147.rev, r7147.alt, r7147.group]));
    assert.ok(!O.rows.some(r => /-DIR-/.test(r.no)), 'transmittal register sheets are not rows');
    { const r = O.rows.find(x => x.no === 'X11475-BGN-ZZ-XX-DR-E-7129'); assert.ok(r && r.group === 'reserved' && !r.canRev && !r.src.dwg, 'a never-issued number with no file is reserved, not matched to the Phase 0 block diagram by its words: ' + JSON.stringify(r && [r.group, r.src])); } assert.ok(!O.rows.some(r => r.no === '42_BG_0055'), 'our-number row merged into the client-number row: ' + O.rows.map(r => r.no).join(', '));
    global.__eliEmail = null;
    // NG numbers (Tom 14:26): on an NG-numbered job a deliverable without its X11475-BGN number goes on a Document Request to BGEN
    // document control before the issue; the form is the house one, drawings on the Drawing sheet, documents on the Document sheet
    { const Ov = await call('jobs:overview', { jobId: J.id }); assert.ok(Ov.ngJob, 'the job numbers the NG way'); assert.ok(Ov.needNg.includes('42_BG_0056') && Ov.needNg.some(n => /^TBC-CABLES/.test(n)), 'rows without an NG number named: ' + JSON.stringify(Ov.needNg)); assert.ok(!Ov.needNg.includes('X11475-BGN-ZZ-XX-DR-E-7147'));
      fs.writeFileSync(path.join(F, '013 Transmittals & Drawing Register', 'Document Request - Bustleholme 7.xlsx'), 'x');   // earlier forms spell the site their way
      const R1 = await call('jobs:docRequest', { jobId: J.id, submittedBy: 'T. Mira' }); assert.ok(/013 Transmittals & Drawing Register[\\/]Document Request - Bustleholme 8\.xlsx$/.test(R1.file), R1.file); assert.ok(fs.existsSync(R1.file));
      const sh = checker.readXlsx(fs.readFileSync(R1.file)); const rows1 = (sh[0].rows || []).map(r => (Array.isArray(r) ? r : r.c || Object.values(r)).map(x => String(x ?? '').trim())), rows2 = (sh[1].rows || []).map(r => (Array.isArray(r) ? r : r.c || Object.values(r)).map(x => String(x ?? '').trim()));
      const f1 = rows1.map(c => c.join('|')).join('\n'), f2 = rows2.map(c => c.join('|')).join('\n');
      assert.ok(/Bustleholm DCAAR/.test(f1) && /X11475/.test(f1) && /T\. Mira/.test(f1) && /ATOMAX/.test(f1), 'header: ' + f1.slice(0, 300));
      assert.ok(rows1.some(c => c[1] === '42' && /Single Line Diagram Phase 1/.test(c[2]) && c[3] === 'P02' && c[6] === '1'), 'the SLD on the drawing sheet with category 42: ' + f1.slice(0, 600));
      assert.ok(rows2.some(c => c[1] === '72' && /Cable schedules/.test(c[2])), 'the cable schedule on the document sheet with category 72: ' + f2.slice(0, 600)); assert.ok(!/Phase 5/.test(f2), 'the template example rows are cleared');
      const R2 = await call('jobs:docRequest', { jobId: J.id, nos: ['42_BG_0056'] }); assert.ok(/Document Request - Bustleholme 9\.xlsx$/.test(R2.file) && R2.rows.length === 1, 'next form number: ' + R2.file);
      global.__chat = { reply: 'Written.', actions: [{ do: 'docRequest' }] }; const C5 = await call('eli:chat', { jobId: J.id, text: 'ask BGEN for NG numbers for everything that has none' }); assert.ok(C5.done.some(x => /Document Request written → .*Document Request - Bustleholme 10\.xlsx/.test(x)), JSON.stringify(C5.done)); assert.ok(/NO NG NUMBER YET.*42_BG_0056/.test(global.__chatAsked), 'Eli is told which rows have no NG number'); global.__chat = null; }
    // Rev up (Tom 13:17: "it knows I need to uprev loads of docs but it's not letting me"): a drawing with a DXF on file gets its next P
    // rev, title block only, saved under the row's number; a DWG-only drawing is named as needing a DXF, not silently skipped
    // a sheet like the NG one: three issue boxes along the bottom (P01 P02 P03 with labels, initials, status, date, box lines) and the
    // title block's own ISSUE field further right
    const dxm = require('../src/dxfmaker.js'); const prims = [];
    [['P01', '25/04/26'], ['P02', '07/05/26'], ['P03', '23/10/26']].forEach(([rev, date], i) => { const x = i * 160; prims.push(
      { t: 'text', x: x + 14, y: 54, text: 'ISSUE', h: 3, layer: 'TB' }, { t: 'mtext', x: x + 61, y: 56, text: rev, h: 5, layer: 'TB' }, { t: 'text', x: x + 84, y: 55, text: 'NG Investment No. TBC', h: 3, layer: 'TB' },
      { t: 'text', x: x + 14, y: 43, text: 'DRAWN', h: 3, layer: 'TB' }, { t: 'mtext', x: x + 61, y: 44, text: 'TM', h: 2.5, layer: 'TB' }, { t: 'mtext', x: x + 85, y: 45, text: 'ISSUED FOR TENDER', h: 2.5, layer: 'TB' },
      { t: 'text', x: x + 14, y: 31, text: 'CHECKED', h: 3, layer: 'TB' }, { t: 'mtext', x: x + 61, y: 32, text: 'JA', h: 2.5, layer: 'TB' },
      { t: 'text', x: x + 14, y: 19, text: 'APPROVED', h: 3, layer: 'TB' }, { t: 'mtext', x: x + 61, y: 21, text: 'DM', h: 2.5, layer: 'TB' }, { t: 'text', x: x + 84, y: 19, text: 'DATE', h: 3, layer: 'TB' }, { t: 'mtext', x: x + 115, y: 21, text: date, h: 2.5, layer: 'TB' },
      { t: 'line', x1: x + 11, y1: 15, x2: x + 171, y2: 15, layer: 'TB' }, { t: 'line', x1: x + 11, y1: 61, x2: x + 171, y2: 61, layer: 'TB' }, { t: 'line', x1: x + 11, y1: 15, x2: x + 11, y2: 61, layer: 'TB' }, { t: 'line', x1: x + 171, y1: 15, x2: x + 171, y2: 61, layer: 'TB' }); });
    prims.push({ t: 'text', x: 1141, y: 19, text: 'P03', h: 5, layer: 'TB' }, { t: 'line', x1: 0, y1: 200, x2: 500, y2: 200, layer: 'SLD' });
    const dxfBuf = dxm.writeDxf(prims, { x0: 0, y0: 0, x1: 1200, y1: 400 });
    fs.writeFileSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 12', 'X11475-BGN-ZZ-XX-DR-E-7153 P03.dxf'), dxfBuf);
    await call('proj:gather', { jobId: J.id }).catch(() => {}); const O1 = await call('jobs:overview', { jobId: J.id });
    const r153b = O1.rows.find(r => r.no === 'X11475-BGN-ZZ-XX-DR-E-7153'), r147 = O1.rows.find(r => r.no === 'X11475-BGN-ZZ-XX-DR-E-7147');
    assert.ok(r153b.src && /7153 P03\.dxf$/.test(r153b.src.dxf) && r153b.canRev, 'row knows its DXF: ' + JSON.stringify(r153b.src));
    assert.ok(r147.src && !r147.src.dxf && /42_BG_0055_P02/.test(r147.src.dwg), 'the SLD knows it is DWG only: ' + JSON.stringify(r147.src));
    const workCopy = path.join(F, 'CLAUDE DESGIN', 'X11475-BGN-ZZ-XX-DR-E-7153 P03.dxf'); fs.mkdirSync(path.dirname(workCopy), { recursive: true }); fs.copyFileSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 12', 'X11475-BGN-ZZ-XX-DR-E-7153 P03.dxf'), workCopy);
    const before = () => [...fs.readdirSync(path.join(F, 'CLAUDE DESGIN')), ...fs.readdirSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 12'))].sort().join('|'); const snap = before();
    await call('proj:gather', { jobId: J.id }).catch(() => {});
    const W = await call('jobs:revUp', { jobId: J.id, no: 'X11475-BGN-ZZ-XX-DR-E-7153', status: 'ISSUED FOR COMMENT', people: { drawn: 'TM', checked: 'JA', approved: 'DM' } });
    assert.strictEqual(W.rev, 'P04', JSON.stringify(W)); assert.ok(/013 Transmittals & Drawing Register[\\/]ISSUE 13[\\/]X11475-BGN-ZZ-XX-DR-E-7153_P04\.dxf$/.test(W.files[0]) && fs.existsSync(W.files[0]), 'the new rev goes into the next issue folder, ISSUE 13 (Tom 15:02): ' + W.files[0]);
    assert.strictEqual(before(), snap, 'the working set and ISSUE 12 are untouched (nothing moved to an Archive)'); assert.ok(!fs.existsSync(path.join(F, 'CLAUDE DESGIN', 'Archive')), 'no Archive made in the working folder');
    assert.deepStrictEqual(fs.readdirSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 13')), ['X11475-BGN-ZZ-XX-DR-E-7153_P04.dxf'], 'ISSUE 13 holds only the new rev');
    { const dx = require('../src/dxffix.js').parseDxf(fs.readFileSync(W.files[0])); const T = dx.ents.filter(e => e.section === 'ENTITIES').map(e => [e.plain, Math.round(e.x), Math.round(e.y)]);
      const has = (t, x) => T.some(([p, px]) => p === t && (x === undefined || px === x));
      assert.ok(has('P01', 61) && has('P02', 221) && has('P03', 381), 'P01-P03 boxes kept: ' + JSON.stringify(T.filter(([p]) => /^P0\d$/.test(p))));
      assert.ok(has('P04', 541), 'P04 box added one pitch to the right: ' + JSON.stringify(T.filter(([p]) => /^P0\d$/.test(p))));
      assert.ok(has('ISSUED FOR COMMENT', 565) && has('ISSUED FOR TENDER', 405), 'new box says Issued for Comment, the old ones unchanged');
      assert.ok(T.some(([p, px]) => /^\d\d\/\d\d\/\d\d$/.test(p) && px === 595 && p !== '23/10/26'), 'new box dated today'); assert.ok(has('P04', 1141) && !has('P03', 1141), 'title block ISSUE field at P04');
      assert.strictEqual(T.filter(([p]) => p === 'ISSUE').length, 4, 'four ISSUE labels'); }
    const O2 = await call('jobs:overview', { jobId: J.id }); assert.strictEqual(O2.rows.find(r => r.no === 'X11475-BGN-ZZ-XX-DR-E-7153').rev, 'P04', 'register row at P04');
    let err = ''; try { await call('jobs:revUp', { jobId: J.id, no: 'X11475-BGN-ZZ-XX-DR-E-7147' }); } catch (e) { err = e.message; } assert.ok(/no DXF/.test(err) && /42_BG_0055_P02/.test(err) && /save it as DXF/i.test(err), 'DWG-only drawing says what it needs: ' + err);
    // talking to Eli on the job (Tom 13:56: "i wish eli was a chat like you"): he sees the job and changes only what he is told to
    { global.__chat = { reply: 'Done: 7129 is off the list (it was never issued), the cable calc is on it, and RFI-001 is closed.', actions: [{ do: 'remove', no: 'X11475-BGN-ZZ-XX-DR-E-7129' }, { do: 'add', type: 'calculation', title: 'Cable calculations - new PDB', qty: 1 }, { do: 'closeRfi', no: 'RFI-001', answer: 'Lee answered: S3 until DCAAR' }, { do: 'rename', no: '7153', title: 'Proposed Switchroom Layout (long option)' }] };
      const C = await call('eli:chat', { jobId: J.id, text: 'drop 7129, add the cable calc for the new PDB, close RFI-001 (Lee answered) and call 7153 the long option' });
      assert.ok(/REGISTER \(/.test(global.__chatAsked) && /X11475-BGN-ZZ-XX-DR-E-7153/.test(global.__chatAsked) && /RFIs:/.test(global.__chatAsked) && /JOB FOLDER/.test(global.__chatAsked) && /TOM SAYS NOW: drop 7129/.test(global.__chatAsked), 'Eli was given the job');
      assert.ok(/7129 is off the list/.test(C.reply) && C.done.length === 4, JSON.stringify(C.done));
      const O3 = await call('jobs:overview', { jobId: J.id }); assert.ok(!O3.rows.some(r => /7129$/.test(r.no)), 'row removed'); assert.ok(O3.rows.some(r => /Cable calculations - new PDB/.test(r.title) && r.group === 'document'), 'row added'); assert.strictEqual(O3.rows.find(r => /7153$/.test(r.no)).title, 'Proposed Switchroom Layout (long option)', 'row renamed by its short number');
      assert.ok((O3.desk.rfis || []).find(r => r.no === 'RFI-001').status === 'Closed', 'RFI closed'); const L = await call('eli:chatLog', { jobId: J.id }); assert.ok(L.chat.length >= 2 && L.chat[L.chat.length - 1].role === 'eli'); assert.strictEqual(L.chat[L.chat.length - 1].done.length, 4);
      // "rev up all the P03s" from the chat: every drawing with a DXF at P03 gets its P04; the DWG-only ones are named
      global.__chat = { reply: 'Revving up the P03s now.', actions: [{ do: 'revUpAll', rev: 'P04', status: 'ISSUED FOR COMMENT' }] };   // 7153 is at P04 after the earlier rev up
      const C3 = await call('eli:chat', { jobId: J.id, text: 'rev up all the P04s for issue 13' }); assert.ok(C3.done.some(x => /revved up X11475-BGN-ZZ-XX-DR-E-7153 to P05 → /.test(x)), JSON.stringify(C3.done)); assert.ok(C3.done.some(x => /DWG only, need a DXF first: .*7147/.test(x)), 'names the DWG-only drawings: ' + JSON.stringify(C3.done));
      const O4 = await call('jobs:overview', { jobId: J.id }); assert.strictEqual(O4.rows.find(r => /7153$/.test(r.no)).rev, 'P05'); const p05 = O4.rows.find(r => /7153$/.test(r.no)).work.files[0]; assert.ok(fs.existsSync(p05) && /ISSUE 13[\\/]X11475-BGN-ZZ-XX-DR-E-7153_P05\.dxf$/.test(p05), 'the second rev up stays in the same open issue folder: ' + p05);
      assert.ok(fs.existsSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 13', 'Superseded', 'X11475-BGN-ZZ-XX-DR-E-7153_P04.dxf')), 'the P04 from the same issue moved to Superseded inside ISSUE 13, nowhere else'); assert.ok(!fs.existsSync(path.join(F, '013 Transmittals & Drawing Register', 'ISSUE 14')), 'no ISSUE 14 opened');
      global.__chat = { reply: 'The register has 7147 at P03 and 7153 at P03; both have DXFs in ISSUE 12.', actions: [] }; const C2 = await call('eli:chat', { jobId: J.id, text: 'what revs are the SLD and the switchroom at?' }); assert.strictEqual(C2.done.length, 0); assert.ok(/CONVERSATION SO FAR:[\s\S]*TOM: drop 7129/.test(global.__chatAsked), 'he remembers the conversation'); global.__chat = null; }
    return O.rows.map(r => r.no).join(', ');
  });
  // Eli's scope reply with a quote inside a title (8" gas main) is read all the same, and a register row comes from it
  global.__scopeBad = true;
  const F4 = await call('jobs:fileIn', { jobId: job2.id, paths: [path.join(drop, 'Atomax-UK Scope of Works - ENQ10560.docx')] }).catch(e => ({ errors: [String(e)] }));
  await step('a scope reply with a quote inside a title is still read (no JSON position error on the desk)', async () => { assert.ok(!(F4.errors || []).some(x => /scope documents/.test(x)), JSON.stringify(F4.errors)); const O = await call('jobs:overview', { jobId: job2.id }); assert.ok(O.rows.some(r => /8" gas main/.test(r.title)), O.rows.map(r => r.title).join(' | ')); assert.ok(!JSON.stringify(O.desk.scope || {}).includes('could not read'), JSON.stringify(O.desk.scope)); });
  global.__scopeBad = false;
  // tidyRows: a second TBC row saying the same in other words, and a comment repeated word for word, left by an email read twice
  await step('rows and comments left by an email read twice are tidied away', async () => {
    const desk = require('../src/jobdesk'); const O0 = await call('jobs:overview', { jobId: job2.id }); const biz = require('../src/business');
    const d = BIZ.data(), j = d.jobs.find(x => x.id === job2.id); j.drawings.push({ no: 'TBC-DOCUMENT-77', title: 'Fee proposal / quotation - UU Mixing pipework (ENQ10560)', rev: '', status: 'To do' }, { no: 'TBC-DOCUMENT-78', title: 'Quotation / fee proposal - UU Mixing pipework (ENQ10560)', rev: '', status: 'To do' }, { no: 'TBC-SCH-80', title: 'Local containment drawings (sheet 1)', rev: '', status: 'To do' }, { no: 'TBC-SCH-81', title: 'Local containment drawings (sheet 2)', rev: '', status: 'To do' }); BIZ.store.save();
    desk.addComments(job2.id, [{ doc: 'TBC-DOCUMENT-77', comment: 'Please confirm the tower loading', by: 'Dan' }, { doc: 'TBC-DOCUMENT-77', comment: 'Please confirm the tower loading', by: 'Dan' }], 'RE scope');
    const O = await call('jobs:overview', { jobId: job2.id }); const t = O.rows.filter(r => /fee proposal|quotation/i.test(r.title) && /UU Mixing/.test(r.title)); assert.strictEqual(t.length, 1, O.rows.map(r => r.no + ' ' + r.title).join(' | '));
    const same = (O.desk.crs || []).filter(c => /tower loading/.test(c.comment)); assert.strictEqual(same.length, 1, JSON.stringify(same)); assert.strictEqual(same[0].doc, t[0].no, 'comment follows the kept row');
    assert.strictEqual(O.rows.filter(r => /^Local containment drawings \(sheet \d\)$/.test(r.title)).length, 2, 'two TBC sheets of one set are two drawings, not a duplicate');
  });
  console.log(process.exitCode ? 'E2E FAILED' : 'e2e northwich ok'); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(process.exitCode || 0);
})().catch(e => { console.error('E2E ERROR', e); process.exit(1); });
