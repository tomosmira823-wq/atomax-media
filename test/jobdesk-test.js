// node test/jobdesk-test.js — the job desk without the app: register found and read, QS 006 numbers, deliverables, RFIs, CRS, master list round trip, agent context.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const biz = require('../src/business'), checker = require('../src/checker'), library = require('../src/library'), desk = require('../src/jobdesk'), DN = require('../src/docnumber');
const { writeXlsx } = require('../src/o365main');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-'));
const store = biz.makeStore(path.join(tmp, 'biz.json')), data = () => store.load();
const projects = require('../src/projects'); projects.init(tmp, () => ({}));
const BIZ = { data, store, log: (e) => biz.audit(data(), e), outputDirFor: (id, k) => { const j = data().jobs.find(x => x.id === id); return j && j.folder ? projects.outputDir(j.folder, k) : null; }, contextFor: () => '', projects };
library.init(tmp, [], 'std');
desk.init({ userDir: tmp, BIZ, library });
let ok = 0; const t = (name, fn) => { fn(); ok++; console.log('ok', name); };

// a job folder with an existing register
const folder = path.join(tmp, 'X11481 Malt'); fs.mkdirSync(path.join(folder, 'Documents'), { recursive: true });
fs.writeFileSync(path.join(folder, 'Documents', 'X11481 Project Document Register.xlsx'), writeXlsx([{ name: 'Register', columns: [{ header: 'Doc No' }, { header: 'Title' }, { header: 'Rev' }, { header: 'Status' }], rows: [
  ['X11481-02-MLT-06-71-0001', 'BCD Malt RIO1', 'P05', 'Live'], ['X11481-02-MLT-06-71-0002', 'BCD Malt RIO2', 'P05', 'Live'], ['X11481-02-MLT-06-23-0001', 'Cable schedule', 'P08', 'Live'], ['X11481-02-MLT-06-71-0003', 'BCD old MCC', 'P02', 'Cancelled']] }]));
const job = biz.saveJob(data(), { number: 'X11481', name: 'Malt', client: 'William Grant & Sons', folder }); store.save();

t('register found and read onto the drawing list', () => {
  const r = desk.checkRegister(job.id, checker);
  assert.ok(r.found && r.read === 4, JSON.stringify(r));
  const j = data().jobs[0]; assert.strictEqual(j.drawings.find(d => d.no.endsWith('0003')).status, 'Cancelled');
});
t('QS 006 numbering follows the register', () => {
  assert.strictEqual(DN.next(data().jobs[0], 'BCD').no, 'X11481-02-MLT-06-71-0004');
  assert.strictEqual(DN.next(data().jobs[0], 'SLD').no, 'X11481-02-MLT-06-70-0001');
  assert.strictEqual(DN.next({ number: 'X301026', drawings: [] }, 'BCD').no, '');
  assert.strictEqual(DN.jobNumber([], new Date(2026, 9, 30)), 'X301026');
  assert.strictEqual(DN.nextRev('P1', 'comment'), 'A01'); assert.strictEqual(DN.nextRev('A01'), 'A02'); assert.strictEqual(DN.nextRev('P05'), 'P06');
});
t('deliverables numbered, no duplicates', () => {
  const a = desk.addDeliverables(job.id, [{ type: 'BCD', title: 'BCD Malt RIO3', qty: 2 }, { type: 'cable schedule', title: 'Cable schedule' }]);
  assert.deepStrictEqual(a.map(x => x.no), ['X11481-02-MLT-06-71-0004', 'X11481-02-MLT-06-71-0005']);   // the cable schedule is already on the list
  assert.strictEqual(desk.addDeliverables(job.id, [{ type: 'BCD', title: 'BCD Malt RIO3', qty: 2 }]).length, 0);
});
t('inputs and RFIs', () => {
  desk.addInputs(job.id, { inputs: [{ name: 'Instrument index', rev: 'C' }], missing: ['IO list'], questions: ['Which panel feeds HOP06?'] });
  const v = desk.view(job.id); assert.strictEqual(v.rfis.length, 2); assert.strictEqual(v.rfis[0].no, 'RFI-001');
  desk.saveRfi(job.id, { no: 'RFI-002', status: 'Answered', answer: 'RIO2' });
  assert.ok(/RFI-002 Which panel feeds HOP06\? → RIO2/.test(desk.context(job.id, 'Dex')));
});
t('job rules in the folder and in every agent\'s context', () => {
  desk.setRules(job.id, '# Job rules\n- BCDs 0001/0002 govern over the MCC BCDs');
  assert.ok(fs.existsSync(path.join(folder, 'JOB RULES.md')));
  desk.addCorrection(job.id, { agentName: 'Dex', text: 'Use -JB not _JB', scope: 'job' });
  const c = desk.context(job.id, 'Lex'); assert.ok(/govern over/.test(c) && /\(Dex\) Use -JB/.test(c) && /QS 006/.test(c));
});
t('client profile matched by name and used for corrections', () => {
  desk.addCorrection(job.id, { text: 'Title block in grey', scope: 'client' });
  assert.ok(desk.clientProfile(data().jobs[0]).text.includes('Title block in grey'));
  assert.ok(/CLIENT PROFILE/.test(desk.context(job.id, 'Dex')));
});
t('comment response sheet', () => {
  const a = desk.addComments(job.id, [{ doc: 'X11481-02-MLT-06-71-0001', comment: 'C063 used twice', by: 'Steve' }]);
  assert.strictEqual(a[0].no, 'C-001'); desk.saveCrs(job.id, { no: 'C-001', response: 'Corrected to C065', status: 'Responded' });
  const p = desk.exportSheet(job.id, 'crs', writeXlsx); assert.ok(fs.existsSync(p));
});
t('master list: export, edit in Excel, approve, given to Dex', () => {
  const d = desk.load(job.id); d.master = { status: 'draft', devices: [{ tag: 'HOP01-LS01', jb: 'HOP01-JB1', panel: 'RIO1' }], cables: [{ no: 'RIO1/C001', from: 'RIO1', to: 'HOP01-JB1', cores: '10P', size: '0.5' }], gaps: [], read: ['x.pdf'] };
  fs.writeFileSync(path.join(tmp, 'jobdesk', job.id + '.json'), JSON.stringify(d));
  const p = desk.exportMaster(job.id, writeXlsx);
  const sheets = checker.readXlsx(fs.readFileSync(p)); const cab = sheets.find(s => s.sheet === 'Cables');
  cab.rows.push({ c: ['RIO1/C002', 'RIO1', 'E01-PX01', 'CY', '3C', '0.75', 'edited'] });
  fs.writeFileSync(path.join(tmp, 'edited.xlsx'), writeXlsx(sheets.map(s => ({ name: s.sheet, columns: (s.rows[0].c || []).map(h => ({ header: h })), rows: s.rows.slice(1).map(r => r.c) }))));
  const m = desk.importMaster(job.id, path.join(tmp, 'edited.xlsx'), checker); assert.strictEqual(m.cables.length, 2);
  assert.ok(/DRAFT, NOT YET APPROVED/.test(desk.context(job.id, 'Dex')));
  desk.approveMaster(job.id); assert.ok(/APPROVED by Tom/.test(desk.context(job.id, 'Dex')) && /RIO1\/C002/.test(desk.context(job.id, 'Dex')));
  assert.ok(!/MASTER DEVICE LIST/.test(desk.context(job.id, 'Eli')));
});
t('no register: say so, then make one', () => {
  const j2 = biz.saveJob(data(), { number: 'X301026', name: 'New', folder: path.join(tmp, 'empty') }); fs.mkdirSync(path.join(tmp, 'empty'));
  assert.strictEqual(desk.checkRegister(j2.id, checker).found, false);
  const p = desk.makeRegister(j2.id, writeXlsx); assert.ok(fs.existsSync(p) && /X301026 Drawing Register\.xlsx$/.test(p));
});
console.log(`\n${ok} passed`);
// borders: auto by client, set per job, National Grid needs its DXF
{
  const d = data(); const a = biz.saveJob(d, { number: 'X010126', name: 'Bustleholm', client: 'BGEN' }), n = biz.saveJob(d, { number: 'X020126', name: 'Feckenham', client: 'National Grid' }), o = biz.saveJob(d, { number: 'X030126', name: 'Other', client: 'Diageo' });
  assert.strictEqual(desk.borderFor(a).key, 'bgen'); assert.strictEqual(desk.borderFor(o).key, 'atomax');
  const ng = desk.borderFor(n); assert.strictEqual(ng.key, 'ng');
  desk.setBorder(a.id, 'atomax'); assert.strictEqual(desk.borderFor(a).key, 'atomax');
  const m = require('../src/dxfmaker'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-'));
  const r = m.make({ kind: 'sld', title: 'T', boards: [{ label: 'B', feeders: [{ chain: [{ symbol: 'mcb', label: 'Q1' }, { symbol: 'load', label: 'L' }] }] }] }, out, 'G', { border: 'bgen' });
  assert.ok(fs.readFileSync(r.path, 'utf8').includes('BGEN A3 BORDER') && r.files[0].page === 'A3', r.files[0].page);
  const p2 = biz.saveJob(d, { number: 'X040126', name: 'P', client: 'PBE Group' }); assert.strictEqual(desk.borderFor(p2).key, 'pbe'); desk.setBorder(p2.id, null, 'A1'); assert.strictEqual(desk.borderFor(p2).key, 'pbe-A1');
  const r2 = m.make({ kind: 'sld', title: 'T', revHistory: [{ rev: 'P01', what: 'ISSUED FOR COMMENT' }, { rev: 'P02', what: 'ISSUED FOR COMMENT' }], revision: 'P02', boards: [{ label: 'B', enclosure: 'SWITCHROOM', feeders: [{ chain: [{ symbol: 'mccb', label: 'Q1', state: 'open' }, { symbol: 'cable', label: 'EXISTING CABLE' }, { symbol: 'load', label: 'L', status: 'removal' }] }] }] }, out, 'N', { border: 'ng', fill: { site: 'IRONBRIDGE', ngInvestment: '100618-205464' } });
  const ngd = fs.readFileSync(r2.path, 'utf8'); assert.ok(ngd.includes('NG A2 BORDER') && (ngd.match(/NG A0 ISSUEBOX/g) || []).length >= 2 && ngd.includes('IRONBRIDGE') && ngd.includes('(OPEN)') && ngd.includes('NG Investment No. 100618-205464') && r2.files[0].page === 'A2', r2.files[0].page);
  const cols = (t) => [...t.matchAll(/\r?\n\s*62\r?\n\s*(\d+)/g)].map(x => x[1]);
  const fb = [{ label: 'B', feeders: [{ chain: [{ symbol: 'mccb', label: 'Q1', status: 'new' }, { symbol: 'load', label: 'L', status: 'removal' }] }] }];
  const ents = (p) => { const t = fs.readFileSync(p, 'utf8'); return t.slice(t.lastIndexOf('ENTITIES')); };   // the layer table has its own colours
  const green = (p) => cols(ents(p)).filter(c => c === '3').length;
  const plain = green(m.make({ kind: 'sld', title: 'SLD', boards: fb }, out, 'NP', { border: 'ng' }).path), phased = green(m.make({ kind: 'sld', title: 'SLD', phase: 1, boards: fb }, out, 'PH', { border: 'ng' }).path);
  assert.ok(phased > plain, `phase drawing coloured, plain one black (${plain} / ${phased})`);
  console.log('ok borders by job'); ok++;
}
console.log(`${ok} passed (with borders)`);
