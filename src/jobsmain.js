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
  if (t === '23' || /schedule|register|list/i.test(s)) return { agent: 'Lex', kind: 'schedule', verb: 'Make the' };
  if (['00', '03', '05', '08', '09', '15', '20', '21', '22'].includes(t) || /report|spec|calc|method|rams|itp|query/i.test(s)) return { agent: 'Wren', kind: 'document', verb: 'Write the' };
  return { agent: '', kind: 'manual', verb: '' };   // termination / interconnection / layouts: not made by an agent yet
}

const QS = /X\d{4,6}(?:-[A-Z0-9]{2,4}){2,5}-\d{4}/i;   // the drawing number however the job writes it
const realNo = (d) => /^TBC-/i.test(d.no) ? ((String(d.title).match(QS) || [])[0] || '') : d.no;
const cleanTitle = (d) => String(d.title).replace(QS, '').replace(/\(\s*\)/g, '').replace(/\s+P\d{1,2}\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
const AGENT_ID = { Dex: 'dex', Lex: 'excel', Wren: 'word' };

function register({ ipcMain, HANDLERS, BIZ }) {
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
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw new Error(String(e && e.message || e)); } };

  function overview(jobId) {
    { // a TBC number on the list with the real drawing number written in its title: the list gets the real number
      const job = jobOf(jobId); let changed = false; const dd = desk.load(jobId);
      for (const d of job.drawings) { const real = realNo(d); if (/^TBC-/i.test(d.no) && real && !job.drawings.some(x => x !== d && x.no.toUpperCase() === real.toUpperCase())) { if (dd.deliv && dd.deliv[d.no]) { dd.deliv[real] = dd.deliv[d.no]; delete dd.deliv[d.no]; } d.no = real; d.title = cleanTitle(d) || d.title; changed = true; } }
      if (changed) { desk.saveRaw(jobId, dd); require('./business').saveJob(BIZ.data(), job, 'Office'); BIZ.store.save(); }
    }
    try { desk.tidyRows(jobId); } catch {}   // one row per drawing (a TBC row and the register's numbered row of the same kind are the same drawing)
    const job = jobOf(jobId), V = desk.view(jobId), dl = delivOf(jobId);
    const rows = job.drawings.filter(d => !/cancel|superseded/i.test(d.status)).map(d => ({ ...d, ...kindOf(d), num: realNo(d) || d.no, ctitle: cleanTitle(d) || d.title, work: dl[d.no] || null }));
    return { job: { id: job.id, number: job.number, name: job.name, client: job.client, folder: job.folder, status: job.status }, desk: V, rows, needsMaster: rows.some(r => r.kind === 'bcd' || r.kind === 'schedule') };
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
    setDeliv(jobId, no, { status: 'working', run: RUN, agent: k.agent, summary: `${k.agent} is on it`, answers, people });
    try {
      let r, files = [], pdfs = [];
      if (k.agent === 'Dex') {
        const P = plan({ jobId, no }); r = await call('dex:make', { jobId, drawingNumber: P.number, request: (asked || P.request) + (note ? ' ' + note : ''), answers, revision, skills, drawn: people.drawn || '', checked: people.checked || '', approved: people.approved || '' });
        // a TBC row that Dex numbered when he made it (from the register / the job's QS 006 numbering): the row takes that number now
        if (/^TBC-/i.test(no) && QS.test(String(r.drawingNumber || '')) && desk.renameRow(jobId, no, r.drawingNumber)) no = r.drawingNumber;
        if (r.questions) return setDeliv(jobId, no, { status: 'needs you', questions: r.questions, summary: 'Dex has questions' });
        files = (r.sheets && r.sheets.length ? r.sheets.map(s => s.path) : [r.path]).filter(Boolean); pdfs = r.pdfs || [];
      } else if (k.agent === 'Lex') {
        r = await call('o365:excel', { jobId, request: (asked || plan({ jobId, no }).request) + (note ? ' ' + note : ''), skills });
        files = [r.path].filter(Boolean);
      } else {
        r = await call('o365:word', { jobId, request: (asked || plan({ jobId, no }).request) + (note ? ' ' + note : ''), skills });
        files = [r.path].filter(Boolean);
      }
      return setDeliv(jobId, no, { status: r.incomplete ? 'needs you' : 'made', questions: null, check: null, files, pdfs, rev: r.revision || d.rev || '', archived: r.archived || 0, summary: (r.incomplete ? 'CUT SHORT: ' : '') + (r.summary || 'Made') + (r.fromSchedule && r.fromSchedule.length ? ` · ${r.fromSchedule.length} value(s) matched to the schedule` : '') + (r.queries && r.queries.length ? ` · ${r.queries.length} question(s) to the RFI register` : '') + (r.warnings && r.warnings.length ? ' · LAYOUT: ' + r.warnings.join('; ') : ''), notes: r.notes || [], warning: r.borderWarning || '' });
    } catch (e) { setDeliv(jobId, no, { status: 'failed', summary: String(e.message || e).slice(0, 300) }); throw e; }
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
    targets.forEach(n => setDeliv(jobId, n, { check: { status: 'working', run: RUN } }));
    const r = await call('check:run', { agent: { id: 'cal' }, schedule: enc(schedule), drawings: drawings.map(enc), jobId, note: 'Check both ways and say exactly what was covered.' });
    const findings = r.findings || [], dir = r.markups && r.markups.dir || '';
    for (const n of targets) { const mine = findings.filter(f => JSON.stringify(f).includes(n)); setDeliv(jobId, n, { check: { status: findings.length ? 'needs you' : 'passed', headline: r.headline || '', count: mine.length || findings.length, markups: dir } }); }
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

  ipcMain.handle('jobs:overview', wrap(({ jobId }) => overview(jobId)));
  ipcMain.handle('jobs:plan', wrap((a) => plan(a)));
  ipcMain.handle('jobs:make', wrap((a) => make(a)));
  ipcMain.handle('jobs:makeAll', wrap(async ({ jobId }) => { const o = overview(jobId), done = [], masterOk = o.desk.master && o.desk.master.status === 'approved'; for (const r of o.rows.filter(r => r.agent && (!r.work || ['failed'].includes(r.work.status)) && (masterOk || !['bcd', 'schedule'].includes(r.kind)))) { try { await make({ jobId, no: r.no }); done.push(r.no); } catch {} } return { done, overview: overview(jobId) }; }));
  ipcMain.handle('jobs:check', wrap((a) => check(a)));
  ipcMain.handle('jobs:revise', wrap(({ jobId, no, comments }) => make({ jobId, no, revision: { on: true, stage: '', note: String(comments || '').slice(0, 2000) }, note: comments ? `Client comments to address: ${comments}` : '' })));
  // the revision asked for: typed in the box (e.g. C01), or said in the note ("move to C01"), else the next one at the same stage
  const askedRev = (to, note) => { const t = String(to || '').trim().toUpperCase().replace(/^([A-Z])(\d)$/, '$10$2'); if (/^[PACX]\d{2}$/.test(t)) return t; const m = String(note || '').match(/\b(?:moved?\s+(?:up\s+)?to|go(?:ing)?\s+to|up\s+to|rev(?:ision)?|issue[d]?\s+(?:as|at))\s*([PACX])\s?0?(\d{1,2})\b/i); return m ? m[1].toUpperCase() + m[2].padStart(2, '0') : ''; };
  ipcMain.handle('jobs:revision', wrap(async ({ jobId, no, note = '', to = '', people }) => {
    const desk = require('./jobdesk'), V = desk.load(jobId), open = (V.crs || []).filter(c => c.doc === no && !/responded|closed/i.test(c.status || ''));
    const said = String(note || '').trim(), rev = askedRev(to, said);
    const r = await make({ jobId, no, people, revision: { on: true, to: rev, stage: '', note: said.slice(0, 2000) }, note: said ? `Changes for this revision: ${said}` : 'New revision: no other changes asked for.' });
    if (r && r.status === 'made') for (const c of open) { try { desk.saveCrs(jobId, { no: c.no, status: 'Responded', response: `Revised in ${r.rev}` }); } catch {} }
    return r;
  }));
  ipcMain.handle('jobs:setStatus', wrap(({ jobId, no, status }) => setDeliv(jobId, no, { status })));
  ipcMain.handle('jobs:waiting', wrap(() => waiting()));
  return { overview, make, check, waiting, kindOf };
}
module.exports = { register, kindOf };
