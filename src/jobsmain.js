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

function register({ ipcMain, HANDLERS, BIZ }) {
  const desk = require('./jobdesk');
  const call = (ch, args) => { const h = HANDLERS[ch]; if (!h) throw new Error('Not available: ' + ch); return h({ sender: null }, args); };
  const jobOf = (id) => { const j = BIZ.data().jobs.find(x => x.id === id); if (!j) throw new Error('No such job'); return j; };
  const delivOf = (id) => desk.load(id).deliv || {};
  const setDeliv = (id, no, patch) => { const d = desk.load(id); d.deliv = d.deliv || {}; d.deliv[no] = { ...(d.deliv[no] || {}), ...patch, at: new Date().toISOString() }; desk.saveRaw(id, d); return d.deliv[no]; };
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw new Error(String(e && e.message || e)); } };

  function overview(jobId) {
    const job = jobOf(jobId), V = desk.view(jobId), dl = delivOf(jobId);
    const rows = job.drawings.filter(d => !/cancel|superseded/i.test(d.status)).map(d => ({ ...d, ...kindOf(d), work: dl[d.no] || null }));
    return { job: { id: job.id, number: job.number, name: job.name, client: job.client, folder: job.folder, status: job.status }, desk: V, rows, needsMaster: rows.some(r => r.kind === 'bcd' || r.kind === 'schedule') };
  }

  // make one deliverable with the agent for its kind
  async function make({ jobId, no, answers = [], note = '', revision = null }) {
    const job = jobOf(jobId), d = job.drawings.find(x => x.no === no); if (!d) throw new Error('Not on the drawing list: ' + no);
    const k = kindOf(d); if (!k.agent) throw new Error(`No agent makes ${d.title} yet. Do this one by hand.`);
    const prev = delivOf(jobId)[no] || {};
    if (answers && answers.length) answers = [...(prev.answers || []).filter(p => !answers.some(a => a.q === p.q)), ...answers]; else answers = prev.answers || [];   // answers given once are kept for remakes and revisions
    setDeliv(jobId, no, { status: 'working', agent: k.agent, summary: `${k.agent} is on it`, answers });
    try {
      let r, files = [], pdfs = [];
      if (k.agent === 'Dex') {
        r = await call('dex:make', { jobId, drawingNumber: no, request: `${k.verb}: ${d.title} (drawing ${no}). Use the job's inputs, every item on them for this drawing and nothing else.${note ? ' ' + note : ''}`, answers, revision });
        if (r.questions) return setDeliv(jobId, no, { status: 'needs you', questions: r.questions, summary: 'Dex has questions' });
        files = (r.sheets && r.sheets.length ? r.sheets.map(s => s.path) : [r.path]).filter(Boolean); pdfs = r.pdfs || [];
      } else if (k.agent === 'Lex') {
        r = await call('o365:excel', { jobId, request: `${k.verb} ${d.title} for job ${job.number} (document ${no}) from the job's inputs and the approved master device list. House template from your skill.${note ? ' ' + note : ''}` });
        files = [r.path].filter(Boolean);
      } else {
        r = await call('o365:word', { jobId, request: `${k.verb} ${d.title} for job ${job.number} (document ${no}) from the job's inputs.${note ? ' ' + note : ''}` });
        files = [r.path].filter(Boolean);
      }
      return setDeliv(jobId, no, { status: r.incomplete ? 'needs you' : 'made', questions: null, files, pdfs, rev: r.revision || d.rev || '', summary: (r.incomplete ? 'CUT SHORT: ' : '') + (r.summary || 'Made'), notes: r.notes || [], warning: r.borderWarning || '' });
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
    const drawings = targets.flatMap(n => [...(dl[n].pdfs || []), ...(dl[n].pdfs && dl[n].pdfs.length ? [] : dl[n].files)]).filter(p => fs.existsSync(p));
    if (!drawings.length) throw new Error('No drawings made yet to check');
    const enc = (p) => ({ name: path.basename(p), base64: fs.readFileSync(p).toString('base64') });
    targets.forEach(n => setDeliv(jobId, n, { check: { status: 'working' } }));
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
  ipcMain.handle('jobs:make', wrap((a) => make(a)));
  ipcMain.handle('jobs:makeAll', wrap(async ({ jobId }) => { const o = overview(jobId), done = [], masterOk = o.desk.master && o.desk.master.status === 'approved'; for (const r of o.rows.filter(r => r.agent && (!r.work || ['failed'].includes(r.work.status)) && (masterOk || !['bcd', 'schedule'].includes(r.kind)))) { try { await make({ jobId, no: r.no }); done.push(r.no); } catch {} } return { done, overview: overview(jobId) }; }));
  ipcMain.handle('jobs:check', wrap((a) => check(a)));
  ipcMain.handle('jobs:revise', wrap(({ jobId, no, comments }) => make({ jobId, no, revision: { on: true, stage: 'comment', note: String(comments || '').slice(0, 2000) }, note: comments ? `Client comments to address: ${comments}` : '' })));
  ipcMain.handle('jobs:setStatus', wrap(({ jobId, no, status }) => setDeliv(jobId, no, { status })));
  ipcMain.handle('jobs:waiting', wrap(() => waiting()));
  return { overview, make, check, waiting, kindOf };
}
module.exports = { register, kindOf };
