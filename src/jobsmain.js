// The Jobs screen: one place per job. Each deliverable on the job's drawing list is made by the right agent, checked by Cal,
// issued, and revised when comments come back. "Waiting on you" gathers everything across jobs that needs Tom.
'use strict';
const fs = require('fs');
const path = require('path');

// which agent makes a deliverable, from its QS 006 type code (or its title)
function kindOf(d) {
  const t = (String(d.no).match(/-(\d{2})-\d{4}(?:\b|_)/) || [])[1] || '';
  const s = (d.title || '') + ' ' + t;
  if (t === '71' || /\bbcd\b|block cable/i.test(s)) return { agent: 'Dex', kind: 'bcd', verb: 'Draw the BCD' };
  if (t === '70' || /single line|\bsld\b/i.test(s)) return { agent: 'Dex', kind: 'sld', verb: 'Draw the SLD' };
  if (t === '74' || /earthing/i.test(s)) return { agent: 'Dex', kind: 'earthing', verb: 'Draw the earthing drawing' };
  if (/\b(survey|site visit|point cloud|laser scan|3d model|modelling|inspection|attendance|witness|package)\b/i.test(s)) return { agent: '', kind: 'manual', verb: '' };   // site work and models: nobody in the office makes those
  if (t === '23' || /\b(schedules?|registers?|lists?)\b/i.test(s)) return { agent: 'Lex', kind: 'schedule', verb: 'Make the' };   // whole words: a "registered point cloud" is not a register
  if (['00', '03', '05', '08', '09', '15', '20', '21', '22'].includes(t) || /report|spec|calc|method|rams|itp|query/i.test(s)) return { agent: 'Wren', kind: 'document', verb: 'Write the' };
  return { agent: '', kind: 'manual', verb: '' };   // termination / interconnection / layouts: not made by an agent yet
}

const QS = /X\d{4,6}(?:-[A-Z0-9]{2,4}){2,5}-\d{4}/i;   // the drawing number however the job writes it
// the files in the job folder that ARE a drawing on the list: by the client's number (X11475-BGN-ZZ-XX-DR-E-7153), our number (32_BG_0006)
// or, failing those, the title; never Archive / Superseded copies. The latest revision in the file name wins. Tells the tab what can be
// revved now (a DXF) and what needs exporting from AutoCAD first (DWG only)
function jobFiles(jobId) { try { const p = require('./projects').load(jobId); return (p && p.files || []).map(f => ({ rel: f.rel.replace(/\\/g, '/'), name: f.rel.split(/[\\/]/).pop(), mtime: f.mtime || 0 })).filter(f => !/(^|\/)(archive|superseded|markups?|old|fixed)(\/|$)/i.test(f.rel)); } catch { return []; } }
const revInName = (n) => { const m = String(n).match(/[\s_-]([PCAX]\d{2})(?=[\s_.)-]|$)/i); return m ? m[1].toUpperCase() : ''; };
function sourceFor(d, files) {
  const keys = [d.no, d.alt].filter(Boolean).map(k => String(k).toUpperCase().replace(/[^A-Z0-9]+/g, ''));
  const norm = (n) => String(n).toUpperCase().replace(/\.[A-Z0-9]+$/, '').replace(/[^A-Z0-9]+/g, '');
  let mine = files.filter(f => { const n = norm(f.name); return keys.some(k => k.length >= 6 && n.includes(k)); });
  // by title only when the file carries no drawing number of its own (a file numbered for another drawing is that drawing's)
  const numbered = (n) => /X\d{5,6}(?:-[A-Z0-9]{1,4}){1,6}-\d{3,4}|\b\d{2}_[A-Z]{2}_\d{4}\b/i.test(n);
  if (!mine.length && d.title) { const words = String(d.title).toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 2 && !/^(THE|AND|FOR|NEW|DIAGRAM|DRAWING|LAYOUT|PROPOSED)$/.test(w)); if (words.length >= 2) mine = files.filter(f => /\.(dxf|dwg|pdf)$/i.test(f.name) && !numbered(f.name) && words.every(w => f.name.toUpperCase().includes(w))); }
  const pick = (ext) => mine.filter(f => new RegExp('\\.' + ext + '$', 'i').test(f.name)).sort((a, b) => (revInName(b.name) > revInName(a.name) ? 1 : revInName(b.name) < revInName(a.name) ? -1 : 0) || b.mtime - a.mtime)[0];
  const dxf = pick('dxf'), dwg = pick('dwg'), pdf = pick('pdf');
  return { dxf: dxf ? dxf.rel : '', dwg: dwg ? dwg.rel : '', pdf: pdf ? pdf.rel : '', fileRev: revInName((dxf || dwg || pdf || {}).name || '') };
}
// the group a row sits in on the Deliverables tab: a numbered drawing (QS 006 disciplines 70-79 are drawings, 23 a schedule) or by its words
const groupOf = (d) => { const t = (String(d.no).match(/-(\d{2})-\d{4}(?:\b|_)/) || [])[1] || ''; if (/^7\d$/.test(t)) return 'drawing'; if (t === '23') return 'schedule'; return require('./jobdesk').kindTag(d.type || '', d.title).group; };
const realNo = (d) => /^TBC-/i.test(d.no) ? ((String(d.title).match(QS) || [])[0] || '') : d.no;
const cleanTitle = (d) => String(d.title).replace(QS, '').replace(/\(\s*\)/g, '').replace(/\s+P\d{1,2}\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
const AGENT_ID = { Dex: 'dex', Lex: 'excel', Wren: 'word' };

function register({ ipcMain, HANDLERS, BIZ, claudeFull }) {
  const desk = require('./jobdesk');
  const call = (ch, args) => { const h = HANDLERS[ch]; if (!h) throw new Error('Not available: ' + ch); return h({ sender: null }, args); };
  const jobOf = (id) => { const j = BIZ.data().jobs.find(x => x.id === id); if (!j) throw new Error('No such job'); return j; };
  // a make or check left 'working' by an earlier run of the app (closed or updated mid-job) is stopped, so it can be made again
  const RUN = 'r' + Date.now().toString(36);
  const delivOf = (id) => { const d = desk.load(id), dl = d.deliv || {}; let fixed = false;
    for (const w of Object.values(dl)) {
      if (w.status === 'working' && w.run !== RUN) { w.status = 'failed'; w.summary = 'Stopped because the app closed or updated while this was being made. Press Make again.'; fixed = true; }
      if (w.check && w.check.status === 'working' && w.check.run !== RUN) { w.check = null; fixed = true; }
    }
    if (fixed) desk.saveRaw(id, d); return dl; };
  const setDeliv = (id, no, patch) => { const d = desk.load(id); d.deliv = d.deliv || {}; d.deliv[no] = { ...(d.deliv[no] || {}), ...patch, at: new Date().toISOString() }; desk.saveRaw(id, d); return d.deliv[no]; };
  const runs = require('./runs');
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw new Error(runs.plain(e)); } };

  function overview(jobId) {
    { // a TBC number on the list with the real drawing number written in its title: the list gets the real number
      const job = jobOf(jobId); let changed = false; const dd = desk.load(jobId);
      for (const d of job.drawings) { const real = realNo(d); if (/^TBC-/i.test(d.no) && real && !job.drawings.some(x => x !== d && x.no.toUpperCase() === real.toUpperCase())) { if (dd.deliv && dd.deliv[d.no]) { dd.deliv[real] = dd.deliv[d.no]; delete dd.deliv[d.no]; } d.no = real; d.title = cleanTitle(d) || d.title; changed = true; } }
      if (changed) { desk.saveRaw(jobId, dd); require('./business').saveJob(BIZ.data(), job, 'Office'); BIZ.store.save(); }
    }
    // the job's drawing register is read when the job opens: never checked, checked by an older version (the master transmittal was not a
    // register before 1.34.19), or the register file changed since. Cheap when nothing changed (one stat).
    try { const dd = desk.load(jobId), j0 = jobOf(jobId); if (j0.folder && fs.existsSync(j0.folder)) { const chk = Date.parse(dd.registerChecked || '') || 0; let stale = !chk || chk < Date.parse('2026-11-05T13:20:00Z'); if (!stale && dd.registerFile) { try { stale = fs.statSync(dd.registerFile).mtimeMs > chk; } catch { stale = true; } } if (!stale && !dd.registerFile && Date.now() - chk > 10 * 60e3) stale = true; if (stale) desk.checkRegister(jobId, require('./checker')); } } catch {}
    try { desk.tidyRows(jobId); } catch {}   // one row per drawing (a TBC row and the register's numbered row of the same kind are the same drawing)
    const job = jobOf(jobId), V = desk.view(jobId), dl = delivOf(jobId);
    const files = jobFiles(jobId), anyIssued = job.drawings.some(x => x.rev);   // a job with issued drawings: a numbered row with no rev and no file is a reserved number, not work to do
    const rows = job.drawings.filter(d => !/cancel|superseded/i.test(d.status)).map(d => { const src = sourceFor(d, files), k = kindOf(d); const reserved = !d.rev && !src.dxf && !src.dwg && !src.pdf && !dl[d.no] && !/^TBC-/i.test(d.no) && anyIssued; return { ...d, ...k, group: reserved ? 'reserved' : (d.group || groupOf(d)), num: realNo(d) || d.no, ctitle: cleanTitle(d) || d.title, work: dl[d.no] || null, src, canRev: !reserved && !!(k.agent === 'Dex' || src.dxf) }; });   // reserved: a number in the register never issued and with no file: listed, not counted
    const DR = require('./docreq'), ng = DR.ngJob(rows), needNg = ng ? DR.needsRequest(rows).map(r => r.no) : [];
    return { job: { id: job.id, number: job.number, name: job.name, client: job.client, folder: job.folder, status: job.status }, desk: V, rows, needsMaster: rows.some(r => r.kind === 'bcd' || r.kind === 'schedule'), ngJob: ng, needNg };
  }

  // make one deliverable with the agent for its kind
  // what the agent will be asked, and what it will read: shown on the row before it starts
  function plan({ jobId, no }) {
    const job = jobOf(jobId), d = job.drawings.find(x => x.no === no); if (!d) throw new Error('Not on the drawing list: ' + no);
    const k = kindOf(d), num = realNo(d), title = cleanTitle(d);
    const request = k.agent === 'Dex' ? `${k.verb}: ${title}${num ? ` (drawing ${num})` : ''}. Use the job's inputs, every item on them for this drawing and nothing else.`
      : k.agent === 'Lex' ? `${k.verb} ${title} for job ${job.number}${num ? ` (document ${num})` : ''} from the job's inputs and the approved master device list. House template from your skill.`
      : `${k.verb} ${title} for job ${job.number}${num ? ` (document ${num})` : ''} from the job's inputs.`;
    const want = k.kind === 'bcd' ? 'cable schedule instrument index io list bcd' : k.kind === 'sld' ? 'single line sld load schedule cable schedule protection' : k.kind === 'earthing' ? 'earthing cable schedule' : k.kind === 'schedule' ? 'cable schedule instrument index io list' : title;
    const inputs = job.folder ? BIZ.projects.relevantFiles(job.id, title + ' ' + want, { exts: ['.pdf', '.xlsx', '.xlsm', '.csv'], max: 6 }).map(p => path.basename(p)) : [];
    // drawn / checked / approved: this drawing's from last time, else the last ones used on the job
    const dl = delivOf(jobId), people = (dl[no] || {}).people || Object.values(dl).map(x => x.people).filter(Boolean).pop() || null;
    const rev = (dl[no] || {}).files ? ((dl[no] || {}).rev || 'P01') : '';
    return { agent: k.agent, agentId: AGENT_ID[k.agent] || '', kind: k.kind, number: num, title, request, inputs, folder: job.folder || '', people, rev, nextRev: rev ? require('./docnumber').nextRev(rev) : 'P01' };
  }
  async function make({ jobId, no, answers = [], note = '', revision = null, request: asked = '', skills, people }) {
    const job = jobOf(jobId), d = job.drawings.find(x => x.no === no); if (!d) throw new Error('Not on the drawing list: ' + no);
    const k = kindOf(d); if (!k.agent) throw new Error(`No agent makes ${d.title} yet. Do this one by hand.`);
    const prev = delivOf(jobId)[no] || {};
    if (answers && answers.length) answers = [...(prev.answers || []).filter(p => !answers.some(a => a.q === p.q)), ...answers]; else answers = prev.answers || [];   // answers given once are kept for remakes and revisions
    people = people || prev.people || {};   // drawn / checked / approved, kept for remakes and revisions
    // open items from Cal's check (and any other open comment) on a remake at the same revision: fixed in this make, then marked done
    let calOpen = [];
    if (!revision) { try { calOpen = (desk.load(jobId).crs || []).filter(c => c.doc === no && !/responded|closed/i.test(c.status || '')); } catch {} if (calOpen.length) note = [note, 'Fix these check findings and comments (keep everything else as it was): ' + calOpen.map(c => c.comment).join(' | ')].filter(Boolean).join(' '); }
    const R = runs.start({ kind: `${k.kind}:${revision ? 'revision' : 'make'}`, who: k.agent, jobId, no });
    setDeliv(jobId, no, { status: 'working', run: RUN, runId: R.id, agent: k.agent, summary: `${k.agent} is on it`, answers, people });
    try {
      let r, files = [], pdfs = [];
      if (k.agent === 'Dex') {
        const P = plan({ jobId, no }); r = await call('dex:make', { run: R.id, jobId, kind: P.kind, drawingNumber: P.number, request: (asked || P.request) + (note ? ' ' + note : ''), answers, revision, skills, drawn: people.drawn || '', checked: people.checked || '', approved: people.approved || '' });
        // a TBC row that Dex numbered when he made it (from the register / the job's QS 006 numbering): the row takes that number now
        if (/^TBC-/i.test(no) && QS.test(String(r.drawingNumber || '')) && desk.renameRow(jobId, no, r.drawingNumber)) no = r.drawingNumber;
        if (r.questions) { runs.finish(R.id, { ok: true }); return setDeliv(jobId, no, { status: 'needs you', questions: r.questions, summary: 'Dex has questions' }); }
        files = (r.sheets && r.sheets.length ? r.sheets.map(s => s.path) : [r.path]).filter(Boolean); pdfs = r.pdfs || [];
      } else if (k.agent === 'Lex') {
        runs.stage(R.id, 'Lex is building the workbook', 20); r = await call('o365:excel', { run: R.id, jobId, request: (asked || plan({ jobId, no }).request) + (note ? ' ' + note : ''), skills });
        files = [r.path].filter(Boolean);
      } else {
        runs.stage(R.id, 'writing the document', 20); r = await call('o365:word', { run: R.id, jobId, request: (asked || plan({ jobId, no }).request) + (note ? ' ' + note : ''), skills });
        files = [r.path].filter(Boolean);
      }
      if (calOpen.length && !r.incomplete && !r.questions) for (const c of calOpen) { try { desk.saveCrs(jobId, { no: c.no, status: 'Responded', response: `Fixed in ${r.revision || d.rev || 'the remake'}` }); } catch {} }
      runs.finish(R.id, { ok: true });
      return setDeliv(jobId, no, { status: r.incomplete ? 'needs you' : 'made', questions: null, check: null, files, pdfs, given: { file: r.givenFile || '', request: r.request || '', skills: r.skills || [], read: r.read || [], fromSchedule: r.fromSchedule || [], queries: r.queries || [], warnings: r.warnings || [], at: new Date().toISOString() }, rev: r.revision || d.rev || '', archived: r.archived || 0, summary: (r.incomplete ? 'CUT SHORT: ' : '') + (r.summary || 'Made') + (r.fromSchedule && r.fromSchedule.length ? ` · ${r.fromSchedule.length} value(s) matched to the schedule` : '') + (r.queries && r.queries.length ? ` · ${r.queries.length} question(s) to the RFI register` : '') + (r.warnings && r.warnings.length ? ' · LAYOUT: ' + r.warnings.join('; ') : ''), notes: r.notes || [], warning: r.borderWarning || '' });
    } catch (e) { const stopped = runs.aborted(R.id); runs.finish(R.id, { ok: false, error: runs.plain(e) }); setDeliv(jobId, no, { status: stopped ? 'stopped' : 'failed', summary: stopped ? 'Stopped. Nothing was changed; press Make to start again.' : runs.plain(e) }); throw e; }
  }

  // Cal checks the made drawings against the job's schedule (made by Lex, else the schedule in the job folder)
  async function check({ jobId, nos }) {
    const job = jobOf(jobId), dl = delivOf(jobId);
    const sched = job.drawings.filter(d => kindOf(d).kind === 'schedule').map(d => dl[d.no]).find(w => w && w.files && w.files[0] && fs.existsSync(w.files[0]));
    let schedule = sched && sched.files[0];
    if (!schedule) schedule = (BIZ.projects.relevantFiles(job.id, 'cable schedule', { exts: ['.xlsx', '.xlsm', '.pdf'], max: 1 }) || [])[0];
    if (!schedule) throw new Error('No cable schedule to check against: make the schedule first or put it in the job folder');
    const targets = (nos && nos.length ? nos : Object.keys(dl)).filter(n => dl[n] && dl[n].files && kindOf(job.drawings.find(d => d.no === n) || { no: n }).agent === 'Dex');
    // the DXF Dex made, not its PDF: every word exact and each cable's ends traced from the lines (a PDF of an A0 sheet is too small to read)
    const drawings = targets.flatMap(n => { const dx = (dl[n].files || []).filter(p => /\.dxf$/i.test(p) && fs.existsSync(p)); return dx.length ? dx : [...(dl[n].pdfs || []), ...(dl[n].files || [])]; }).filter(p => fs.existsSync(p));
    if (!drawings.length) throw new Error('No drawings made yet to check');
    const enc = (p) => ({ name: path.basename(p), path: p, base64: fs.readFileSync(p).toString('base64') });
    const R = runs.start({ kind: 'check', who: 'Cal', jobId, no: targets.join(',') }); runs.stage(R.id, 'Cal is reading the schedule and the drawings', 10);
    targets.forEach(n => setDeliv(jobId, n, { check: { status: 'working', run: RUN } }));
    let r; try { r = await call('check:run', { run: R.id, agent: { id: 'cal' }, schedule: enc(schedule), drawings: drawings.map(enc), jobId, note: 'Check both ways and say exactly what was covered.' });
    } catch (e) { runs.finish(R.id, { ok: false, error: runs.plain(e) }); targets.forEach(n => setDeliv(jobId, n, { check: null })); throw e; }
    runs.finish(R.id, { ok: true });
    const findings = r.findings || [], dir = r.markups && r.markups.dir || '';
    for (const n of targets) { const mine = findings.filter(f => JSON.stringify(f).includes(n)); setDeliv(jobId, n, { check: { status: findings.length ? 'needs you' : 'passed', headline: r.headline || '', count: mine.length || findings.length, markups: dir } });
      // Cal's findings go on the Comments tab against the drawing, like a client's, so Make again / Revision pick them up and Tom can close the ones he disagrees with
      try { const V = desk.load(jobId), have = new Set((V.crs || []).filter(c => c.doc === n && c.by === 'Cal').map(c => c.comment));
        const items = (mine.length ? mine : findings).map(f => String(f.text || '') + (f.confirm ? ` [CONFIRM${f.reason ? ': ' + f.reason : ''}]` : '')).filter(t => t && !have.has(t));
        if (items.length) desk.addComments(jobId, items.map(t => ({ doc: n, comment: t, by: 'Cal', agent: 'dex' })), 'Cal check'); } catch {} }
    return { headline: r.headline || '', findings: findings.length, markups: dir, schedule: path.basename(schedule) };
  }

  // everything across the jobs that needs Tom
  function waiting() {
    const out = [];
    for (const job of BIZ.data().jobs.filter(j => j.status !== 'Closed')) {
      let V; try { V = desk.view(job.id); } catch { continue; }
      const tag = { jobId: job.id, job: `${job.number} ${job.name || ''}`.trim() };
      if (V.master && V.master.status !== 'approved') out.push({ ...tag, kind: 'master', text: `Master device list to check and approve (${V.master.devices} devices, ${V.master.cables} cables)` });
      for (const [no, w] of Object.entries(delivOf(job.id))) {
        if (w.status === 'needs you' && w.questions) out.push({ ...tag, kind: 'questions', no, text: `${w.agent} has questions on ${no}` });
        else if (w.status === 'failed') out.push({ ...tag, kind: 'failed', no, text: `${no} failed: ${w.summary}` });
        if (w.check && w.check.status === 'needs you') out.push({ ...tag, kind: 'check', no, text: `Cal found ${w.check.count} thing(s) to look at on ${no}` });
      }
      const openR = (V.rfis || []).filter(r => !/answered|closed/i.test(r.status || '')); if (openR.length) out.push({ ...tag, kind: 'rfi', text: `${openR.length} RFI(s) waiting on answers` });
      const openC = (V.crs || []).filter(c => !/responded|closed/i.test(c.status || '')); if (openC.length) out.push({ ...tag, kind: 'comments', text: `${openC.length} client comment(s) to respond to` });
      if (!job.folder) out.push({ ...tag, kind: 'folder', text: 'No project folder linked' });
    }
    return out;
  }

  // a marked-up drawing (red pen, a client's PDF comments, a scan) dropped on the drawing's row: the markups read into the Comments tab
  async function readMarkup({ jobId, no, file }) {
    const job = jobOf(jobId); if (!file || !fs.existsSync(file)) throw new Error('That file is not there any more');
    const ext = path.extname(file).toLowerCase(), kind = ext === '.pdf' ? 'pdf' : ['.png', '.jpg', '.jpeg'].includes(ext) ? 'image' : '';
    if (!kind) throw new Error('Drop a PDF or a picture of the marked-up drawing');
    const buf = fs.readFileSync(file); if (buf.length > 24 * 1024 * 1024) throw new Error('That file is too big to read (over 24 MB). Save a smaller PDF.');
    const checker = require('./checker'), R = runs.start({ kind: 'markup-read', who: 'Cal', jobId, no }); runs.stage(R.id, 'Cal is reading the red pen', 20);
    const system = `You read a MARKED-UP engineering drawing: a PDF or picture of drawing ${no} with hand or digital markups on it (red pen, clouds, comment boxes, sticky notes, crossings-out, arrows with text). List every markup as a separate comment, in the words written, with the page it is on and who signed it if a name or initials are written. Markups only: do not describe the drawing itself, do not invent corrections, do not tidy the wording. A crossed-out item is "delete X". An arrow from a value to a new value is "X: change A to B". Reply with JSON only, no fences:
{ "comments": [ { "page": 1, "comment": "as written", "by": "initials or name if written, else empty" } ], "unreadable": "anything that could not be read, or empty" }`;
    let r; try { r = await claudeFull({ system, who: 'cal', skills: false, maxTokens: 6000, messages: [{ role: 'user', content: [checker.contentBlock(kind, path.basename(file), buf), { type: 'text', text: `Drawing ${no} for job ${job.number}. List the markups.` }] }], run: R.id }); } catch (e) { runs.finish(R.id, { ok: false, error: runs.plain(e) }); throw e; }
    let out = { comments: [] }; try { out = JSON.parse(String(r.text).slice(String(r.text).indexOf('{'), String(r.text).lastIndexOf('}') + 1)); } catch { runs.finish(R.id, { ok: false, error: 'reply not readable' }); throw new Error('The reply was cut off before it finished. Press the button again; it usually goes through second time.'); }
    const list = (out.comments || []).filter(c => c && c.comment).map(c => ({ doc: no, comment: String(c.comment).trim(), by: String(c.by || '').trim() || 'Markup', agent: 'dex', page: c.page }));
    const have = new Set((desk.load(jobId).crs || []).filter(c => c.doc === no).map(c => c.comment.toLowerCase()));
    const fresh = list.filter(c => !have.has(c.comment.toLowerCase()));
    const added = fresh.length ? desk.addComments(jobId, fresh, 'Markup: ' + path.basename(file)) : [];
    runs.finish(R.id, { ok: true });
    BIZ.log({ who: 'Cal', action: 'Read a markup', jobId, detail: `${path.basename(file)} on ${no}: ${added.length} comment(s)` });
    return { added: added.length, skipped: list.length - fresh.length, unreadable: out.unreadable || '' };
  }
  ipcMain.handle('jobs:readMarkup', wrap((a) => readMarkup(a)));
  ipcMain.handle('jobs:overview', wrap(({ jobId }) => overview(jobId)));
  // talk to Eli about the job: he sees the register, RFIs, comments, scope and folder; he changes things only when told to
  ipcMain.handle('eli:chat', wrap(async ({ jobId, text = '', skills }) => {
    const job = jobOf(jobId), t = String(text || '').trim(); if (!t) throw new Error('Say something to Eli');
    const E = require('./elichat'), biz = require('./business');
    const d0 = desk.load(jobId); d0.chat = [...(d0.chat || []), { role: 'tom', text: t, at: new Date().toISOString() }].slice(-200); desk.saveRaw(jobId, d0);
    try { if (job.folder && fs.existsSync(job.folder)) BIZ.projects.gather(job.id, job.folder, { checker: require('./checker') }); } catch {}   // the folder as it is now, not as it was: Eli never answers from a stale file list
    const ov = overview(jobId), files = jobFiles(jobId).map(f => f.rel);
    let nextIssue = null; try { if (job.folder) { const oi = desk.load(jobId).openIssue; nextIssue = oi && oi.path && fs.existsSync(oi.path) ? { n: oi.n, previous: { n: oi.n - 1 }, open: true } : BIZ.projects.nextIssueDir(job.folder); } } catch {}
    const ctx = E.context({ job, overview: ov, desk: desk.load(jobId), files, history: d0.chat.slice(0, -1), nextIssue, needNg: ov.needNg });
    const R = runs.start({ kind: 'chat', who: 'Eli', jobId, no: 'CHAT' }); let r;   // Eli shows as working while he thinks
    try { r = await claudeFull({ system: E.SYSTEM, who: 'email', skills, maxTokens: 4000, messages: [{ role: 'user', content: [{ type: 'text', text: `${ctx}\n\nTOM SAYS NOW: ${t}` }] }], run: R.id }); runs.finish(R.id); } catch (e) { runs.finish(R.id, { ok: false, error: String(e && e.message || e) }); throw e; }
    let out; try { out = require('./dxfmaker').parseReply(r.text); } catch { out = { reply: String(r.text || '').trim(), actions: [] }; }
    const reply = String(out.reply || '').trim() || '(Eli said nothing)';
    const doers = { revUp: (a) => revUp({ jobId, no: a.no, to: a.to || '', status: a.status || '', people: a.people || null }), make: (a) => make({ jobId, no: a.no, people: a.people || {}, note: a.note || '' }), rows: () => overview(jobId).rows, docRequest: (a) => docRequest({ jobId, submittedBy: a.submittedBy || '', nos: a.nos || null }), plot: (a) => plotIssue({ jobId, files: a.files || null }) };
    const done = await E.apply(Array.isArray(out.actions) ? out.actions : [], { job, desk: desk.load(jobId), deskMod: desk, biz, BIZ, overview: ov, doers });
    try { desk.tidyRows(jobId); } catch {}
    try { if (done.some(x => /RFI|closed/i.test(x))) await desk.writeRfiRegister(jobId, { templateDir: BIZ.projects.templateDir() }); } catch {}
    const d1 = desk.load(jobId); d1.chat = [...(d1.chat || []), { role: 'eli', text: reply, done, at: new Date().toISOString() }].slice(-200); desk.saveRaw(jobId, d1);
    if (done.length) BIZ.log({ who: 'Eli', action: 'Changed the job as Tom asked in the chat', jobId, detail: done.join(' · ') });
    return { reply, done, chat: d1.chat };
  }));
  ipcMain.handle('eli:chatLog', wrap(({ jobId }) => ({ chat: desk.load(jobId).chat || [] })));
  ipcMain.handle('jobs:plan', wrap((a) => plan(a)));
  ipcMain.handle('jobs:make', wrap((a) => make(a)));
  ipcMain.handle('jobs:makeAll', wrap(async ({ jobId }) => { const o = overview(jobId), done = [], masterOk = o.desk.master && o.desk.master.status === 'approved'; for (const r of o.rows.filter(r => r.agent && (!r.work || ['failed'].includes(r.work.status)) && (masterOk || !['bcd', 'schedule'].includes(r.kind)))) { try { await make({ jobId, no: r.no }); done.push(r.no); } catch {} } return { done, overview: overview(jobId) }; }));
  ipcMain.handle('jobs:check', wrap((a) => check(a)));
  ipcMain.handle('jobs:revise', wrap(({ jobId, no, comments }) => make({ jobId, no, revision: { on: true, stage: '', note: String(comments || '').slice(0, 2000) }, note: comments ? `Client comments to address: ${comments}` : '' })));
  // the revision asked for: typed in the box (e.g. C01), or said in the note ("move to C01"), else the next one at the same stage
  const askedRev = (to, note) => { const t = String(to || '').trim().toUpperCase().replace(/^([A-Z])(\d)$/, '$10$2'); if (/^[PACX]\d{2}$/.test(t)) return t; const m = String(note || '').match(/\b(?:moved?\s+(?:up\s+)?to|go(?:ing)?\s+to|up\s+to|rev(?:ision)?|issue[d]?\s+(?:as|at))\s*([PACX])\s?0?(\d{1,2})\b/i); return m ? m[1].toUpperCase() + m[2].padStart(2, '0') : ''; };
  ipcMain.handle('jobs:revision', wrap(async ({ jobId, no, note = '', to = '', people, desc = '' }) => {
    const desk = require('./jobdesk'), V = desk.load(jobId), open = (V.crs || []).filter(c => (c.doc === no || c.doc === '*') && !/responded|closed/i.test(c.status || ''));   // '*': a change asked for on every drawing
    const said = String(note || '').trim(), rev = askedRev(to, said);
    const r = await make({ jobId, no, people, revision: { on: true, to: rev, stage: '', note: said.slice(0, 2000), desc: String(desc || '').trim() }, note: said ? `Changes for this revision: ${said}` : 'New revision: no other changes asked for.' });
    if (r && r.status === 'made') for (const c of open) { if (c.doc === '*') continue; /* asked for on every drawing: stays open until Tom closes it */ try { desk.saveCrs(jobId, { no: c.no, status: 'Responded', response: `Revised in ${r.rev}` }); } catch {} }
    return r;
  }));
  // Rev up: the next revision of a drawing that exists as a DXF in the job folder, title block only. The revision text is changed (P03 ->
  // P04), the issue status text if asked (ISSUED FOR COMMENT), the file saved as <row number>_<rev>.dxf in the drawings folder with the old
  // revision archived. The drawing's content is not touched; the comments stay open for Tom or Dex to do by hand.
  // the issue folder being built: remembered on the job desk from the first rev up until the issue goes out
  function openIssueDir(jobId) {
    const job = jobOf(jobId), d = desk.load(jobId);
    if (d.openIssue && d.openIssue.path && fs.existsSync(d.openIssue.path)) return d.openIssue.path;
    // an issue folder made by hand that has not gone out yet (DXFs but no PDFs: issued copies always carry their PDFs) is the open one
    const all = BIZ.projects.issueDirs(job.folder), last = all[all.length - 1];
    if (last) { let pdfs = 0, any = 0; try { for (const n of fs.readdirSync(last.path)) { any++; if (/\.pdf$/i.test(n)) pdfs++; } } catch {}
      let transmitted = false; try { transmitted = fs.readdirSync(path.dirname(last.path)).some(n => !fs.statSync(path.join(path.dirname(last.path), n)).isDirectory() && /transmittal|\bTR-?\d/i.test(n) && new RegExp('(issue|tr)[ _-]*0?' + last.n + '\\b', 'i').test(n)); } catch {}   // "Document Transmittal ISSUE 12.pdf", "TR-12.pdf": that issue went out
      if (any && !pdfs && !transmitted) { d.openIssue = { n: last.n, path: last.path, openedAt: new Date().toISOString(), found: true }; desk.saveRaw(jobId, d); return last.path; } }
    const nx = BIZ.projects.nextIssueDir(job.folder); d.openIssue = { n: nx.n, path: nx.path, openedAt: new Date().toISOString() }; desk.saveRaw(jobId, d);
    BIZ.log({ who: 'Dex', action: `Opened ISSUE ${nx.n} for the next issue`, jobId, detail: nx.path });
    return nx.path;
  }
  async function revUp({ jobId, no, to = '', status = '', people = null }) {
    const job = jobOf(jobId), d = job.drawings.find(x => x.no === no); if (!d) throw new Error('No such row');
    const src = sourceFor(d, jobFiles(jobId)); if (!src.dxf) throw new Error(`${no} has no DXF in the job folder${src.dwg ? ` (only ${src.dwg.split('/').pop()}): save it as DXF from AutoCAD next to the DWG` : ''}.`);
    const dxffix = require('./dxffix'), full = path.join(job.folder, src.dxf), buf = fs.readFileSync(full), cur = d.rev || src.fileRev || '';

    const want = askedRev(to, '') || '';
    const pp = people || {}; let r;
    // a new issue box beside the last one (P04 next to P01 P02 P03: date, initials, status), the title block ISSUE field to the new rev
    try { r = require('./revup').revUp(buf, { to: want, status, drawn: pp.drawn || '', checked: pp.checked || '', approved: pp.approved || '' }); }
    catch (e) { throw new Error(`${no}: ${src.dxf.split('/').pop()} could not be revved up (${String(e.message || e)}). Rev it by hand this time.`); }
    if (r.from !== cur && cur && !/^P0?1$/i.test(cur)) BIZ.log({ who: 'Dex', action: `Note: the register says ${no} is at ${cur} but the sheet reads ${r.from}; revved from the sheet`, jobId });
    const next = r.to;
    // the new revision goes in the issue being built: the next ISSUE n folder under 013 Transmittals & Drawing Register (ISSUE 12 on file ->
    // ISSUE 13), opened by the first rev up and used by every one after it until Tom presses Issue. The working set and the earlier issue
    // folders are never written to or moved: a rev up is a new file in the new issue folder, nothing else
    const outDir = openIssueDir(jobId); fs.mkdirSync(outDir, { recursive: true });
    const base = `${no}_${next}`; let archived = 0;
    for (const n of fs.readdirSync(outDir)) if (new RegExp('^' + no.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ _-]P\\d\\d\\.dxf$', 'i').test(n) && n !== base + '.dxf') { try { const a = path.join(outDir, 'Superseded'); fs.mkdirSync(a, { recursive: true }); fs.renameSync(path.join(outDir, n), path.join(a, n)); archived++; } catch {} }   // only an earlier rev-up of the same drawing in this same issue folder moves aside
    const outPath = path.join(outDir, base + '.dxf'); fs.writeFileSync(outPath, r.buf);
    const pdfs = [];   // no PDF: the app cannot plot a DXF it did not draw; the PDF comes from AutoCAD when the sheet is issued
    d.rev = next; require('./business').saveJob(BIZ.data(), job, 'Dex'); BIZ.store.save();
    const w = setDeliv(jobId, no, { status: 'made', rev: next, files: [outPath], pdfs, archived, by: 'Dex', summary: `Rev up ${r.from} -> ${next}: new issue box (${[r.changes.date ? 'dated today' : '', r.changes.status ? status.toUpperCase() : '', r.changes.people ? 'initials' : ''].filter(Boolean).join(', ') || 'copied from ' + r.from}); drawing content unchanged`, source: src.dxf });
    BIZ.log({ who: 'Dex', action: `Revved up ${no} ${r.from} -> ${next} (new issue box, title block)`, jobId, detail: path.basename(outPath) });
    try { BIZ.projects.gather(job.id, job.folder, { checker: require('./checker') }); } catch {}   // the folder is read again so the new file is the row's source from now on
    return w;
  }
  ipcMain.handle('jobs:revUp', wrap((a) => revUp(a)));
  async function docRequest({ jobId, submittedBy = '', nos = null }) {
    const job = jobOf(jobId), ov = overview(jobId), DR = require('./docreq');
    if (!job.folder || !fs.existsSync(job.folder)) throw new Error('This job has no folder to put the request in.');
    let rows = DR.needsRequest(ov.rows); if (Array.isArray(nos) && nos.length) rows = rows.filter(r => nos.some(n => r.no.toUpperCase() === String(n).toUpperCase() || (r.alt && r.alt.toUpperCase() === String(n).toUpperCase())));
    if (!rows.length) throw new Error('Every deliverable on this job already has its NG number; nothing to request.');
    const dir = BIZ.outputDirFor(jobId, 'transmittals') || path.join(job.folder, '013 Transmittals & Drawing Register'); fs.mkdirSync(dir, { recursive: true });
    // the site name the way the earlier request forms spell it ("Document Request - Bustleholme 7.xlsx"), else the first word of the job name
    let site = ''; try { for (const f of fs.readdirSync(dir)) { const m = f.match(/^Document Request - (.+?) \d+\.(xlsx|pdf)$/i); if (m) site = m[1]; } } catch {}
    if (!site) site = (job.name || job.number).replace(/^\d{1,3}\s*-?\s*/, '').replace(/\b(lvac|dcaar|&|and|diesel|replacement|generator|design|stage \d+)\b/gi, '').replace(/[^A-Za-z ]+/g, ' ').trim().split(/\s+/)[0] || job.number;
    site = site.charAt(0).toUpperCase() + site.slice(1).toLowerCase();
    const file = DR.nextFormPath(dir, site);
    const projNo = (job.number.match(/^X\d{5,6}/i) || [])[0] || ov.rows.map(r => (String(r.no).match(/^X\d{5,6}(?=-)/i) || [])[0]).find(Boolean) || job.number;   // the client's project number: ours when it is one, else the one the NG numbers carry (X11475)
    const buf = await DR.fill(DR.templatePath(BIZ.projects.templateDir()), { projectTitle: job.name || '', projectNumber: projNo, submittedBy }, rows.map(r => ({ ...r, rev: r.rev || 'P01' })));
    fs.writeFileSync(file, buf);
    const d = desk.load(jobId); d.docRequests = [...(d.docRequests || []), { file, at: new Date().toISOString(), rows: rows.map(r => r.no) }]; desk.saveRaw(jobId, d);
    BIZ.log({ who: 'Eli', action: `Wrote a Document Request for ${rows.length} NG number${rows.length === 1 ? '' : 's'}`, jobId, detail: path.basename(file) + ' · ' + rows.map(r => r.no + ' ' + r.title).join(', ') });
    return { file, rows: rows.map(r => ({ no: r.no, title: r.title, category: DR.category(r) })) };
  }
  ipcMain.handle('jobs:docRequest', wrap((a) => docRequest(a)));
  // PDFs for the issue being built: AutoCAD's core console plots every DXF in the open issue folder that has no PDF yet (or the ones named)
  async function plotIssue({ jobId, files = null, run = '' }) {
    const job = jobOf(jobId), PL = require('./plot'), core = PL.coreConsole();
    if (!core) throw new Error('AutoCAD is not installed on this PC (no accoreconsole.exe under Program Files\\Autodesk), so the PDFs have to be plotted by hand.');
    const dir = openIssueDir(jobId);
    let list = (Array.isArray(files) && files.length ? files : fs.readdirSync(dir).filter(n => /\.dxf$/i.test(n)).map(n => path.join(dir, n))).filter(f => fs.existsSync(f));
    list = list.filter(f => !fs.existsSync(f.replace(/\.dxf$/i, '.pdf')) || (Array.isArray(files) && files.length));
    if (!list.length) return { dir, done: [], failed: [], note: 'every DXF in the issue folder already has its PDF' };
    const done = [], failed = []; let i = 0;
    for (const f of list) { i++; if (run) runs.stage(run, `AutoCAD ${core.year} is plotting ${path.basename(f)} (${i} of ${list.length})`, Math.round(5 + 90 * (i - 1) / list.length)); try { const r = await PL.plotOne(f, { console: core }); done.push({ dxf: f, pdf: r.pdf, layout: r.layout }); } catch (e) { failed.push({ dxf: f, error: String(e.message || e) }); } }
    BIZ.log({ who: 'Dex', action: `Plotted ${done.length} PDF${done.length === 1 ? '' : 's'} with AutoCAD ${core.year}${failed.length ? `, ${failed.length} failed` : ''}`, jobId, detail: [...done.map(d => path.basename(d.pdf)), ...failed.map(f => path.basename(f.dxf) + ': ' + f.error)].join(' · ') });
    try { BIZ.projects.gather(job.id, job.folder, { checker: require('./checker') }); } catch {}
    return { dir, done, failed, core: core.year };
  }
  ipcMain.handle('jobs:plot', wrap(async ({ jobId, files = null }) => {
    if (runs.live().some(r => r.jobId === jobId && r.no === 'PLOT')) throw new Error('Plotting is already running on this job.');
    const R = runs.start({ kind: 'plot', who: 'Dex', jobId, no: 'PLOT' });
    try { const r = await plotIssue({ jobId, files, run: R.id }); runs.finish(R.id, { ok: !r.failed.length, error: r.failed.length ? r.failed.map(f => f.error).join(' · ') : '' }); return r; } catch (e) { runs.finish(R.id, { ok: false, error: String(e && e.message || e) }); throw e; }
  }));
  ipcMain.handle('jobs:setStatus', wrap(({ jobId, no, status }) => setDeliv(jobId, no, { status })));
  ipcMain.handle('jobs:waiting', wrap(() => waiting()));
  return { overview, make, check, waiting, kindOf };
}
module.exports = { register, kindOf };
