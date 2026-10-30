// The hands-off run: once Tom approves a job's master device list, the office does the rest on its own and only the results come back.
//   1. Dex draws a BCD for each panel / RIO on the master list (DXF + PDF, house border, QS 006 numbers)
//   2. Lex makes the cable schedule from the master list (house template from his Excel skill, datasheets from the File Room)
//   3. Cal checks the BCDs against the schedule, both ways, with markups and his coverage statement
// Each step's result is kept on the job desk and put on the project board. A step that needs Tom (Dex has questions, no cables) stops there and says so.
'use strict';
const fs = require('fs');
const path = require('path');

function register({ ipcMain, HANDLERS, BIZ }) {
  const desk = require('./jobdesk');
  const call = (ch, args) => { const h = HANDLERS[ch]; if (!h) throw new Error('Not available: ' + ch); return h({ sender: null }, args); };
  const running = new Set();
  const setFlow = (jobId, flow) => { const d = desk.load(jobId); d.flow = flow; desk.saveRaw(jobId, d); };
  const board = (jobId, title, agentName, note) => { try { const biz = require('./business'), d = BIZ.data(); biz.saveTask(d, { jobId, title, agentName, status: 'done', note }, agentName || 'Office'); BIZ.store.save(); } catch {} };

  async function run(jobId) {
    if (running.has(jobId)) throw new Error('The hands-off run is already going for this job');
    const m = desk.masterOf(jobId); if (!m || m.status !== 'approved') throw new Error('Approve the master device list first');
    const job = BIZ.data().jobs.find(j => j.id === jobId); if (!job) throw new Error('No such job');
    running.add(jobId);
    const flow = { startedAt: new Date().toISOString(), status: 'running', steps: [] };
    const step = (name) => { const s = { name, status: 'running', at: new Date().toISOString() }; flow.steps.push(s); setFlow(jobId, flow); return s; };
    const done = (s, status, result) => { Object.assign(s, { status, ...result, endedAt: new Date().toISOString() }); setFlow(jobId, flow); };
    BIZ.log({ who: 'Office', action: 'Started the hands-off run', jobId, detail: `${m.devices.length} devices · ${m.cables.length} cables` });
    try {
      // 1. BCDs, one per panel / RIO / MCC on the master list
      const panels = [...new Set(m.devices.filter(d => /panel|rio|mcc|plc/i.test(d.type || '')).map(d => d.tag))].filter(Boolean);
      const drawn = [];
      for (const p of (panels.length ? panels : [''])) {
        const s = step(`Dex draws the BCD${p ? ' for ' + p : ''}`);
        try {
          const r = await call('dex:make', { jobId, request: `Draw the BCD${p ? ' for ' + p : ''} from the approved master device list: every cable and device on it for this panel, nothing else.` });
          if (r.questions) { done(s, 'needs you', { summary: 'Dex has questions: ' + r.questions.join(' / '), questions: r.questions }); continue; }
          (r.sheets && r.sheets.length ? r.sheets : [{ path: r.path, pdf: '' }]).forEach(x => drawn.push(x.path));
          done(s, 'done', { summary: `${r.drawingNumber || ''} ${r.sheets && r.sheets.length > 1 ? r.sheets.length + ' sheets' : ''}${r.masterCheck && r.masterCheck.added.length ? ' · added ' + r.masterCheck.added.length + ' missed cable(s)' : ''}`.trim(), files: [...(r.sheets || []).map(x => x.path), ...(r.pdfs || [])] });
          board(jobId, `BCD${p ? ' ' + p : ''} drawn`, 'Dex', path.basename(r.path));
        } catch (e) { done(s, 'failed', { summary: String(e.message || e).slice(0, 300) }); }
      }
      // 2. the cable schedule
      let schedule = '';
      { const s = step('Lex makes the cable schedule');
        try {
          const r = await call('o365:excel', { jobId, request: `Make the cable schedule for job ${job.number} from the approved master device list: one row per cable, house cable schedule template from your skill, outside diameter, weight and gland size from the cable datasheets.` });
          schedule = r.path; done(s, r.incomplete ? 'needs you' : 'done', { summary: (r.incomplete ? 'CUT SHORT: ' : '') + (r.summary || ''), files: [r.path] });
          board(jobId, 'Cable schedule made', 'Lex', path.basename(r.path));
        } catch (e) { done(s, 'failed', { summary: String(e.message || e).slice(0, 300) }); } }
      // 3. Cal checks the BCDs against the schedule
      { const s = step('Cal checks the BCDs against the schedule');
        if (!schedule || !drawn.length) done(s, 'skipped', { summary: !schedule ? 'No schedule to check against.' : 'No BCDs were drawn.' });
        else try {
          const enc = (p) => ({ name: path.basename(p), base64: fs.readFileSync(p).toString('base64') });
          const r = await call('check:run', { agent: { id: 'cal' }, schedule: enc(schedule), drawings: drawn.map(enc), jobId, note: 'Hands-off run: BCDs drawn by Dex from the approved master device list, schedule made by Lex from the same list. Check both ways and say what was covered.' });
          const n = (r.findings || []).length;
          done(s, n ? 'needs you' : 'done', { summary: `${r.headline || 'Checked'} · ${n} to look at`, files: r.markups && r.markups.dir ? [r.markups.dir] : [] });
          board(jobId, 'BCDs checked against the schedule', 'Cal', `${n} to look at`);
        } catch (e) { done(s, 'failed', { summary: String(e.message || e).slice(0, 300) }); } }
      flow.status = flow.steps.some(x => x.status === 'failed') ? 'failed' : flow.steps.some(x => x.status === 'needs you') ? 'needs you' : 'done';
    } finally {
      flow.endedAt = new Date().toISOString(); setFlow(jobId, flow); running.delete(jobId);
      BIZ.log({ who: 'Office', action: 'Finished the hands-off run', jobId, detail: flow.steps.map(s => `${s.name}: ${s.status}`).join(' · ') });
    }
    return flow;
  }
  ipcMain.handle('flow:run', async (_e, { jobId }) => { try { return await run(jobId); } catch (e) { throw new Error(String(e.message || e)); } });
  ipcMain.handle('flow:get', (_e, { jobId }) => desk.load(jobId).flow || null);
  ipcMain.handle('flow:auto', (_e, { jobId, on }) => { const d = desk.load(jobId); d.autoFlow = !!on; desk.saveRaw(jobId, d); return d.autoFlow; });
  // approving the master list starts the run when the job is set to run automatically (in the background; the desk shows progress)
  return { run, onApproved: (jobId) => { if (desk.load(jobId).autoFlow) run(jobId).catch(() => {}); } };
}
module.exports = { register };
