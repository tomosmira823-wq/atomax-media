// Main-process side of the business layer: IPC handlers, the issue-pack scan, document drafting, approvals that do real work, and the routine scheduler.
'use strict';
const fs = require('fs');
const path = require('path');
const { Packer } = require('docx');
const biz = require('./business');
const { buildAtomaxDoc } = require('./docgen/atomax-doc-builder');
const LOGO = path.join(__dirname, 'docgen', 'atomax-logo.png');

function register({ ipcMain, dialog, shell, Notification, getWin, userDir, claudeFull, checker }) {
  const store = biz.makeStore(path.join(userDir(), 'business.json'));
  const data = () => { const d = store.load(); return d; };
  const send = (ch, p) => { try { const w = getWin(); w && w.webContents.send(ch, p); } catch {} };
  const progress = (p) => send('biz:progress', p);
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  const bizDir = (...p) => { const d = path.join(userDir(), 'business', ...p); fs.mkdirSync(d, { recursive: true }); return d; };

  // other parts of the app (Cal, Dex) write to the audit trail through this
  const log = (e) => { try { const d = data(); biz.audit(d, e); store.save(); } catch (err) { console.error('audit failed', err); } };

  const view = () => {
    const d = data();
    return {
      jobs: d.jobs.map(j => ({ ...j, summary: biz.jobSummary(d, j) })),
      hours: d.hours.slice(0, 400), approvals: d.approvals.slice(0, 200), audit: d.audit.slice(0, 400), briefs: d.briefs.slice(0, 40), docs: d.docs.slice(0, 200),
      routines: d.routines, lastRuns: d.lastRuns, people: d.people
    };
  };
  const wrap = (fn) => async (_e, args) => { try { return await fn(args || {}); } catch (e) { throw new Error(String(e && e.message || e)); } };

  ipcMain.handle('biz:get', wrap(() => view()));
  ipcMain.handle('biz:jobs', wrap(() => data().jobs.map(j => ({ id: j.id, number: j.number, name: j.name, status: j.status }))));
  ipcMain.handle('biz:jobSave', wrap(({ job }) => { biz.saveJob(data(), job); store.save(); return view(); }));
  ipcMain.handle('biz:jobDelete', wrap(({ id }) => { biz.deleteJob(data(), id); store.save(); return view(); }));
  ipcMain.handle('biz:parseDrawings', wrap(({ text }) => biz.parseDrawingLines(text)));
  ipcMain.handle('biz:hoursAdd', wrap((h) => { biz.addHours(data(), h); store.save(); return view(); }));
  ipcMain.handle('biz:hoursRemove', wrap(({ id }) => { biz.removeHours(data(), id); store.save(); return view(); }));
  ipcMain.handle('biz:people', wrap(({ people }) => { data().people = [...new Set((people || []).map(s => String(s).trim()).filter(Boolean))]; store.save(); return view(); }));

  // ---- approvals: approving runs the thing that was waiting ----
  ipcMain.handle('biz:decide', wrap(async ({ id, decision, note }) => {
    const d = data(); const a = d.approvals.find(x => x.id === id); if (!a) throw new Error('That item is no longer in the queue.');
    let result = null;
    if (decision === 'approved') {
      if (a.kind === 'document') result = finishDocument(d, a);
      else if (a.kind === 'issue-pack') result = await finishIssuePack(d, a);
    } else if (decision === 'rejected' && a.kind === 'document' && a.payload.draftPath) { try { fs.unlinkSync(a.payload.draftPath); } catch {} }
    biz.decideApproval(d, id, decision, 'Tom', note || '');
    if (result) a.result = result;
    store.save();
    return { view: view(), result };
  }));

  function finishDocument(d, a) {
    const p = a.payload; const job = d.jobs.find(j => j.id === a.jobId);
    const dir = bizDir('documents', safe(job ? job.number : 'general'));
    const out = path.join(dir, path.basename(p.draftPath));
    fs.copyFileSync(p.draftPath, out); try { fs.unlinkSync(p.draftPath); } catch {}
    d.docs.unshift({ id: biz.audit(d, { action: 'Document made', jobId: a.jobId, who: 'Doc', detail: `${p.docNumber} ${p.revision} ${p.kindLabel}` }).id, jobId: a.jobId, docNumber: p.docNumber, revision: p.revision, kind: p.kind, kindLabel: p.kindLabel, description: p.description, date: new Date().toLocaleDateString('en-GB'), prepared: p.prepared, checked: p.checked, approved: p.approved, path: out });
    return { path: out };
  }

  async function finishIssuePack(d, a) {
    const p = a.payload; const job = d.jobs.find(j => j.id === a.jobId) || { number: 'JOB', name: '', client: '', drawings: [] };
    // re-check the folder at the moment of approval: it may have changed since the scan
    const names = fs.readdirSync(p.srcDir).filter(n => p.files.includes(n));
    const missing = p.files.filter(n => !names.includes(n)); if (missing.length) throw new Error('These files have gone from the folder since the check: ' + missing.join(', '));
    const stamp = new Date().toISOString().slice(0, 10);
    let out = path.join(p.srcDir, 'ISSUE_' + stamp); let i = 2; while (fs.existsSync(out)) out = path.join(p.srcDir, `ISSUE_${stamp}_${i++}`);
    fs.mkdirSync(out, { recursive: true });
    for (const n of names) fs.copyFileSync(path.join(p.srcDir, n), path.join(out, n));   // copies only: the originals stay where they are
    const rows = p.rows.map(r => ({ ...r }));
    const docNumber = p.docNumber || biz.nextDocNumber(d, job);
    const cfg = biz.transmittalConfig({ job, rows, revision: p.revision || 'P01', docNumber, to: p.to, purpose: p.purpose, prepared: p.prepared });
    cfg.logoPath = LOGO;
    const tpath = path.join(out, safe(`${docNumber}_Transmittal_${cfg.revision}.docx`));
    fs.writeFileSync(tpath, await Packer.toBuffer(buildAtomaxDoc(cfg)));
    d.docs.unshift({ id: 'd' + Date.now().toString(36), jobId: a.jobId, docNumber, revision: cfg.revision, kind: 'transmittal', kindLabel: 'Transmittal', description: p.purpose, date: new Date().toLocaleDateString('en-GB'), path: tpath });
    biz.audit(d, { who: 'Iris', action: 'Issued', jobId: a.jobId, detail: `${names.length} files copied to ${path.basename(out)} with transmittal ${docNumber}` });
    return { path: tpath, dir: out, count: names.length };
  }

  // ---- issue pack scan ----
  const TITLE_SYSTEM = `You read ONE engineering drawing PDF and report only what is printed on it. Look at the title block and revision table.
Return ONLY JSON: {"no":"drawing number exactly as printed","title":"drawing title as printed","rev":"the LATEST revision letter or code in the revision table / title block","dead":true|false,"deadWhy":"short, e.g. SUPERSEDED stamp, CANCELLED, hatched out, VOID"}
dead is true only if the sheet itself carries a cancelled / superseded / void / not-for-issue stamp or is hatched or struck through. If you cannot read a value use "". Never guess.`;
  const TRANSMITTAL_SYSTEM = `You read a drawing transmittal / drawing register. List every drawing line exactly as written. Return ONLY JSON: {"rows":[{"no":"drawing number","rev":"revision","title":"title"}]}. Ignore header and footer text. Never invent rows.`;

  ipcMain.handle('biz:pickFolder', wrap(async () => { if (process.env.AMO_PICK_DIR) return process.env.AMO_PICK_DIR; const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; }));
  ipcMain.handle('biz:pickFile', wrap(async ({ filters }) => { if (process.env.AMO_PICK_FILE) return process.env.AMO_PICK_FILE; const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: filters || [{ name: 'Transmittal', extensions: ['xlsx', 'xlsm', 'csv', 'pdf'] }] }); return r.canceled ? null : r.filePaths[0]; }));

  let scanning = false;
  ipcMain.handle('biz:issueScan', wrap(async ({ jobId, folder, transmittalPath, useClaude = true }) => {
    if (scanning) throw new Error('A scan is already running.');
    scanning = true;
    try {
      const d = data(); const job = d.jobs.find(j => j.id === jobId) || null;
      if (!folder || !fs.existsSync(folder)) throw new Error('Choose the folder that is going to be issued.');
      const ents = fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isFile());
      const files = ents.map(e => ({ name: e.name, size: fs.statSync(path.join(folder, e.name)).size }));
      progress({ message: `Found ${files.length} files`, pct: 5 });
      const pdfs = files.filter(f => /\.pdf$/i.test(f.name) && !/^~\$/.test(f.name));
      const reads = {};
      // colour scan: local, no Claude needed
      for (const f of pdfs) { try { reads[f.name] = { colour: biz.pdfColourScan(fs.readFileSync(path.join(folder, f.name))) }; } catch { reads[f.name] = { colour: null }; } }
      progress({ message: 'Colour scan done', pct: 20 });
      const notes = [];
      if (useClaude && pdfs.length) {
        let n = 0;
        const readOne = async (f) => {
          const buf = fs.readFileSync(path.join(folder, f.name));
          const why = checker.kindOf(f.name) === 'pdf' && buf.length > 24 * 1024 * 1024 ? 'over 24 MB' : '';
          if (why) { notes.push(f.name + ': not read (' + why + ')'); return; }
          try {
            const r = await claudeFull({ system: TITLE_SYSTEM, maxTokens: 800, messages: [{ role: 'user', content: [checker.contentBlock('pdf', f.name, buf), { type: 'text', text: 'Read the title block of this drawing (file: ' + f.name + ').' }] }] });
            const j = checker.parseJson(r.text).value || {};
            reads[f.name] = { ...(reads[f.name] || {}), read: true, no: String(j.no || ''), title: String(j.title || ''), rev: String(j.rev || ''), dead: !!j.dead, deadWhy: String(j.deadWhy || '') };
          } catch (e) { notes.push(f.name + ': could not be read (' + String(e.message || e).slice(0, 100) + ')'); }
          progress({ message: `Read ${++n} of ${pdfs.length} drawings`, pct: 20 + Math.round(n / pdfs.length * 60) });
        };
        let i = 0; await Promise.all(Array.from({ length: Math.min(3, pdfs.length) }, async () => { while (i < pdfs.length) await readOne(pdfs[i++]); }));
      }
      let transmittal = null;
      if (transmittalPath) {
        progress({ message: 'Reading the transmittal', pct: 85 });
        const kind = checker.kindOf(transmittalPath); const buf = fs.readFileSync(transmittalPath);
        try {
          let content;
          if (kind === 'pdf') content = [checker.contentBlock('pdf', transmittalPath, buf), { type: 'text', text: 'List every drawing line on this transmittal.' }];
          else if (kind === 'xlsx') content = [{ type: 'text', text: 'Transmittal spreadsheet:\n' + checker.sheetsAsText(checker.readXlsx(buf)) }];
          else if (kind === 'csv') content = [{ type: 'text', text: 'Transmittal:\n' + checker.sheetsAsText(checker.readCsv(buf.toString('utf8'))) }];
          else throw new Error('use PDF, .xlsx or .csv');
          const r = await claudeFull({ system: TRANSMITTAL_SYSTEM, maxTokens: 8000, messages: [{ role: 'user', content }] });
          transmittal = (checker.parseJson(r.text).value.rows || []).filter(x => x && x.no);
          if (!transmittal.length) notes.push('The transmittal had no drawing lines Dex could read.');
        } catch (e) { notes.push('Transmittal not checked: ' + String(e.message || e).slice(0, 120)); }
      }
      const report = biz.issueCheck({ job, files, transmittal, reads });
      report.notes = notes; report.folder = folder; report.jobId = jobId; report.transmittalName = transmittalPath ? path.basename(transmittalPath) : '';
      report.reads = reads;
      biz.audit(d, { who: 'Iris', action: 'Issue check', jobId, detail: `${report.fails} to fix, ${report.warns} to look at in ${path.basename(folder)}` }); store.save();
      progress({ message: 'Done', pct: 100 });
      return report;
    } finally { scanning = false; }
  }));

  ipcMain.handle('biz:issueQueue', wrap(({ report, jobId, to, purpose, prepared, revision }) => {
    const d = data(); const job = d.jobs.find(j => j.id === jobId);
    if (!report || !report.drawingFiles) throw new Error('Run the check first.');
    if (report.fails > 0) throw new Error(`There ${report.fails === 1 ? 'is 1 thing' : 'are ' + report.fails + ' things'} to fix first. Fix them in the folder and scan again.`);
    const files = report.drawingFiles.map(f => f.name);
    const reg = job ? job.drawings : [];
    const rows = report.drawingFiles.map(f => { const rd = (report.reads || {})[f.name] || {}; const rg = reg.find(x => x.no.toUpperCase() === f.no) || {}; return { no: f.no || rd.no || '', title: rg.title || rd.title || '', rev: f.rev || rd.rev || rg.rev || '', name: f.name }; });
    const a = biz.queueApproval(d, { agent: 'Iris', jobId, kind: 'issue-pack', title: `Issue ${files.length} file${files.length === 1 ? '' : 's'} from ${path.basename(report.folder)}${job ? ' (' + job.number + ')' : ''}`, detail: `Copies the files into an ISSUE_ folder beside them and writes the transmittal. ${report.warns} warning${report.warns === 1 ? '' : 's'} left.`, payload: { srcDir: report.folder, files, rows, to: to || '', purpose: purpose || 'Issued for review', prepared: prepared || '', revision: revision || 'P01', docNumber: '' } });
    store.save(); return view();
  }));

  // ---- documents ----
  ipcMain.handle('biz:docDraft', wrap(async ({ kind, jobId, details, prepared, checked, approved, revision, description, docNumber }) => {
    if (!biz.DOC_KINDS[kind]) throw new Error('Pick a document type.');
    if (!String(details || '').trim()) throw new Error('Give Doc something to write from: the scope, the facts, the dates.');
    const d = data(); const job = d.jobs.find(j => j.id === jobId) || null;
    if (!job) throw new Error('Pick the job this document is for.');
    const num = String(docNumber || '').trim() || biz.nextDocNumber(d, job);
    const history = d.docs.filter(x => x.docNumber === num).sort((a, b) => String(a.revision).localeCompare(String(b.revision))).map(x => ({ rev: x.revision, description: x.description, date: x.date, preparedBy: x.prepared, checkedBy: x.checked, approvedBy: x.approved }));
    let rev = String(revision || '').trim();
    if (!rev) { const last = history[history.length - 1]; const m = last && last.rev.match(/^([A-Z]*)(\d+)$/i); rev = m ? m[1].toUpperCase() + String(+m[2] + 1).padStart(m[2].length, '0') : 'P01'; }
    progress({ message: 'Doc is writing the ' + biz.DOC_KINDS[kind].label, pct: 30 });
    const ctx = `Job: ${job.number} ${job.name}\nClient: ${job.client}\nDrawings on this job:\n${job.drawings.map(x => `${x.no} ${x.title} rev ${x.rev}`).join('\n') || '(none listed)'}\n\nEngineer's details:\n${String(details).slice(0, 12000)}`;
    const r = await claudeFull({ system: biz.DOC_SYSTEM(kind), maxTokens: 12000, messages: [{ role: 'user', content: ctx }] });
    const drafted = checker.parseJson(r.text).value;
    if (!drafted || !Array.isArray(drafted.sections)) throw new Error('Claude did not return a document. Try again with a little more detail.');
    const cfg = biz.docConfig({ kind, job, docNumber: num, revision: rev, drafted, prepared, checked, approved, description: description || (history.length ? 'Revised' : 'Issued for review'), history });
    cfg.logoPath = LOGO;
    const buf = await Packer.toBuffer(buildAtomaxDoc(cfg));
    const draftPath = path.join(bizDir('drafts'), safe(`${num}_${biz.DOC_KINDS[kind].label}_${rev}.docx`));
    fs.writeFileSync(draftPath, buf);
    const a = biz.queueApproval(d, { agent: 'Doc', jobId, kind: 'document', title: `${biz.DOC_KINDS[kind].label} ${num} ${rev} for ${job.number}`, detail: 'Draft Atomax-format Word document. Read it, then approve to file it under the job.', payload: { draftPath, docNumber: num, revision: rev, kind, kindLabel: biz.DOC_KINDS[kind].label, description: description || 'Issued for review', prepared: prepared || '', checked: checked || '', approved: approved || '' } });
    store.save(); progress({ message: 'Done', pct: 100 });
    return { view: view(), approvalId: a.id, draftPath };
  }));
  ipcMain.handle('biz:docKinds', wrap(() => Object.entries(biz.DOC_KINDS).map(([k, v]) => ({ kind: k, label: v.label, title: v.title }))));

  // ---- briefs and routines ----
  const runRoutine = (kind, quiet) => {
    const d = data(); const b = biz.buildBrief(d, kind); d.briefs.unshift(b); if (d.briefs.length > 60) d.briefs.length = 60;
    d.lastRuns[kind] = biz.today(); biz.audit(d, { who: 'Office', action: kind === 'weekly' ? 'Weekly summary' : 'Morning brief', detail: `${b.flags.pending} waiting, ${b.flags.overdue} overdue, ${b.flags.overBudget} over budget` }); store.save();
    send('biz:brief', b);
    if (!quiet) try { new Notification({ title: b.title, body: biz.briefText(b).split('\n').slice(1, 6).join('\n') || 'Nothing on.' }).show(); } catch {}
    return b;
  };
  ipcMain.handle('biz:briefRun', wrap(({ kind }) => { runRoutine(kind === 'weekly' ? 'weekly' : 'morning', true); return view(); }));
  ipcMain.handle('biz:routinesSet', wrap(({ routines }) => { const d = data(); const m = routines.morning || {}, w = routines.weekly || {}; d.routines = { morning: { on: !!m.on, time: /^\d\d:\d\d$/.test(m.time) ? m.time : '08:00' }, weekly: { on: !!w.on, day: Math.min(6, Math.max(0, +w.day || 5)), time: /^\d\d:\d\d$/.test(w.time) ? w.time : '16:00' } }; store.save(); return view(); }));
  const tick = () => { try { for (const k of biz.routinesDue(data())) runRoutine(k, false); } catch (e) { console.error('routine failed', e); } };
  setInterval(tick, 60 * 1000); setTimeout(tick, 15 * 1000);

  return { log, store, data, view };
}

module.exports = { register };
