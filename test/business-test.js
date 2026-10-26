const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib'); const { Packer } = require('docx');
const b = require('../src/business'); const { buildAtomaxDoc } = require('../src/docgen/atomax-doc-builder');
(async () => {
  const data = b.emptyData();
  // jobs
  const job = b.saveJob(data, { number: 'X123456-10', name: 'Test substation', client: 'National Grid', budgetHours: 40, dueDate: b.today(new Date(Date.now() + 2 * 86400000)), drawings: b.parseDrawingLines('X123456-10-20-0042 | Loop diagram | P02\nX123456-10-20-0043\tCable block | P01\nX123456-10-30-0001 - SLD - C01\nnot a drawing line') });
  assert.strictEqual(job.drawings.length, 3); assert.deepStrictEqual(job.drawings.map(d => d.rev), ['P02', 'P01', 'C01']); assert.strictEqual(job.drawings[0].title, 'Loop diagram');
  assert.strictEqual(b.parseDrawingLines('X123456-10-20-0099 | Old loop | P01 | Cancelled')[0].status, 'Cancelled'); assert.strictEqual(b.parseDrawingLines('X123456-10-20-0099 | Old loop | P01 | Cancelled')[0].rev, 'P01');
  assert.throws(() => b.saveJob(data, { number: 'x123456-10' }), /already/); assert.throws(() => b.saveJob(data, { number: '' }), /job number/);
  // hours
  b.addHours(data, { jobId: job.id, hours: 8, who: 'Tom', note: 'loops' }); b.addHours(data, { jobId: job.id, hours: 20, who: 'Dave' }); b.addHours(data, { jobId: job.id, hours: 10, who: 'Dave' });
  assert.throws(() => b.addHours(data, { jobId: job.id, hours: 0 }), /Hours/); assert.throws(() => b.addHours(data, { jobId: 'nope', hours: 1 }), /job/);
  let s = b.jobSummary(data, job); assert.strictEqual(s.used, 38); assert.strictEqual(s.pct, 95); assert.ok(!s.over);
  b.addHours(data, { jobId: job.id, hours: 3, who: 'Tom' }); assert.ok(b.jobSummary(data, job).over);
  assert.deepStrictEqual(b.hoursByWho(data), { Tom: 11, Dave: 30 });
  // approvals
  const ap = b.queueApproval(data, { agent: 'Doc', jobId: job.id, kind: 'document', title: 'RAMS draft' });
  assert.strictEqual(b.buildBrief(data).flags.pending, 1);
  b.decideApproval(data, ap.id, 'approved'); assert.throws(() => b.decideApproval(data, ap.id, 'rejected'), /already/);
  assert.ok(data.audit.some(a => a.action === 'Approved'));
  // issue check
  const files = [{ name: 'X123456-10-20-0042_P02.pdf' }, { name: 'X123456-10-20-0043_P00.pdf' }, { name: 'X123456-10-30-0001_C01.pdf' }, { name: 'X123456-10-30-0001_C02.pdf' }, { name: '~$notes.docx' }, { name: 'X123456-10-99-0001_P01.pdf' }, { name: 'markup copy.pdf' }, { name: 'photo.jpg' }];
  const r = b.issueCheck({ job, files, transmittal: [{ no: 'X123456-10-20-0042', rev: 'P02' }, { no: 'X123456-10-20-0043', rev: 'P01' }, { no: 'X123456-10-30-0009', rev: 'A' }],
    reads: { 'X123456-10-20-0042_P02.pdf': { read: true, no: 'X123456-10-20-0042', rev: 'P01', colour: false }, 'X123456-10-20-0043_P00.pdf': { read: true, no: 'X123456-10-20-0043', rev: 'P00', dead: true, deadWhy: 'SUPERSEDED', colour: true } } });
  const has = (re) => r.findings.some(f => re.test(f.text) || re.test(f.file));
  assert.ok(has(/Working or temporary/)); assert.ok(has(/appears 2 times/)); assert.ok(has(/register says rev P01, folder has P00/)); assert.ok(has(/not on the job's drawing list/));
  assert.ok(has(/On the transmittal but not in the folder: X123456-10-30-0009/)); assert.ok(has(/not on the transmittal/)); assert.ok(has(/Title block says rev P01 but the file name says rev P02/));
  assert.ok(has(/marked SUPERSEDED/)); assert.ok(has(/Colour found/)); assert.ok(has(/not one that is normally issued/)); assert.ok(has(/markup, draft or old copy/));
  assert.ok(!r.ok && r.fails > 5 && r.coverage.length >= 5);
  // a clean folder passes
  const clean = b.issueCheck({ job, files: [{ name: 'X123456-10-20-0042_P02.pdf' }, { name: 'X123456-10-20-0043_P01.pdf' }, { name: 'X123456-10-30-0001_C01.pdf' }], transmittal: [{ no: 'X123456-10-20-0042', rev: 'P02' }, { no: 'X123456-10-20-0043', rev: 'P01' }, { no: 'X123456-10-30-0001', rev: 'C01' }] });
  assert.strictEqual(clean.fails, 0, JSON.stringify(clean.findings)); assert.ok(clean.coverage.some(c => /NOT read/.test(c)));
  assert.deepStrictEqual(b.parseName('X123456-10-20-0042 Rev B.pdf'), { no: 'X123456-10-20-0042', rev: 'B' });
  // colour scan
  const mk = async (c) => { const d = await PDFDocument.create(); const p = d.addPage([300, 200]); p.drawRectangle({ x: 10, y: 10, width: 100, height: 50, borderColor: c, borderWidth: 2 }); p.drawText('hello', { x: 20, y: 100, color: c }); return Buffer.from(await d.save({ useObjectStreams: false })); };
  assert.strictEqual(b.pdfColourScan(await mk(rgb(1, 0, 0))), true); assert.strictEqual(b.pdfColourScan(await mk(rgb(0, 0, 0))), false); assert.strictEqual(b.pdfColourScan(await mk(rgb(0.5, 0.5, 0.5))), false);
  assert.strictEqual(b.pdfColourScan(Buffer.from('not a pdf')), null);
  // brief + routines
  const br = b.buildBrief(data, 'weekly'); assert.ok(br.lines.some(l => l.h === 'Hours this week') && br.flags.overBudget === 1 && br.lines.some(l => l.t && /due in 2 days/.test(l.t)));
  data.routines.morning = { on: true, time: '08:00' };
  assert.deepStrictEqual(b.routinesDue(data, new Date('2026-10-26T09:00:00')), ['morning']); assert.deepStrictEqual(b.routinesDue(data, new Date('2026-10-26T07:00:00')), []);
  data.lastRuns.morning = '2026-10-26'; assert.deepStrictEqual(b.routinesDue(data, new Date('2026-10-26T09:00:00')), []);
  assert.deepStrictEqual(b.routinesDue(data, new Date('2026-10-31T09:00:00')), []);   // Saturday
  // documents
  assert.strictEqual(b.nextDocNumber(data, { id: 'z', number: 'X123456-10' }), 'X123456-10-0001');
  const cfg = b.docConfig({ kind: 'rams', job, docNumber: 'X123456-10-06-0001', drafted: { documentTitle: 'RAMS - Test', sections: [{ content: [{ type: 'heading1', text: 'Scope of Works' }, { type: 'paragraph', text: 'TBC' }, { type: 'dataTable', headers: ['Step', 'Activity'], rows: [['1', 'Isolate']] }] }] }, prepared: 'T. Mira', history: [{ rev: 'P00', description: 'First draft', date: '01/10/2026' }] });
  assert.deepStrictEqual(cfg.revisionHistory.map(x => x.rev), ['P00', 'P01']); assert.strictEqual(cfg.projectDetails[0].value, 'National Grid');
  cfg.logoPath = path.join(__dirname, '../src/docgen/atomax-logo.png');
  const buf = await Packer.toBuffer(buildAtomaxDoc(cfg)); assert.ok(buf.length > 5000);
  const t = b.transmittalConfig({ job, rows: [{ no: 'X1', title: 'T', rev: 'P01', name: 'a.pdf' }], docNumber: 'X123456-10-06-0002' }); t.logoPath = cfg.logoPath; assert.ok((await Packer.toBuffer(buildAtomaxDoc(t))).length > 5000);
  // store round trip
  const f = path.join(os.tmpdir(), 'biz-test-' + Date.now() + '.json'); const st = b.makeStore(f); const d2 = st.load(); d2.jobs.push({ id: 'q' }); st.save(); st.reset(); assert.strictEqual(st.load().jobs.length, 1); fs.unlinkSync(f);
  console.log('business ok');
})().catch(e => { console.error(e); process.exit(1); });
