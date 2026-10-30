// The job desk end to end: an email about an existing job, the job admin it files (register check, numbered deliverables, RFIs),
// QS 006 numbers once the area code is set, the master list built and approved, and Dex drawing the BCD from it (missing cable added), then a revision. AMO_SCENARIO=desk
(async () => {
  const out = { steps: [], errors: [] }; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { out.steps.push({ name, ok: true, info: await fn() }); } catch (e) { out.steps.push({ name, ok: false, err: String(e) }); out.errors.push(name + ': ' + e); } };
  const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch {} await wait(200); } throw new Error('timeout'); };
  await wait(1500); document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const api = window.office; let job, email, V;
  await step('job exists', async () => { const v = await api.biz.jobSave({ job: { number: 'X22001', name: 'Test site', client: 'Sam Client Ltd', folder: '__AMO_DIR__' } }); job = v.jobs.find(j => j.number === 'X22001'); return job.folder; });
  await step('Eli matches the email to the existing job, no second set-up task', async () => {
    email = await api.mail.read({ text: 'From Sam: please draw the SLD and the BCD for job X22001 Test site.' });
    if (email.jobId !== job.id) throw new Error('not matched: ' + email.jobId);
    if (email.asks.some(a => a.agent === 'eli')) throw new Error('set-up task still there');
    return email.deliverables.length + ' deliverables';
  });
  await step('starting a task files the job admin', async () => {
    const i = email.asks.findIndex(a => a.agent === 'none');
    const r = await api.mail.start({ id: email.id, ask: i, jobId: job.id });
    if (r.desk.register.found) throw new Error('register should not be found');
    if ((r.desk.deliverables || []).length !== 2) throw new Error('deliverables ' + JSON.stringify(r.desk));
    return r.desk;
  });
  await step('area code gives QS 006 numbers', async () => { V = await api.desk.numbering({ jobId: job.id, area: 'TST', disc: '05' }); const nos = V.drawings.map(d => d.no); if (!nos.includes('X22001-TST-05-70-0001') || !nos.includes('X22001-TST-05-71-0001')) throw new Error(nos.join(',')); return nos; });
  await step('board shows the job desk', async () => { window.__goRoom('board'); await window.__boardUI.show(); window.__boardUI.selectJob(job.id); await until(() => document.querySelectorAll('#bdDesk details.jd').length === 7); return document.querySelector('#bdDesk').textContent.includes('2 open RFIs'); });
  await step('master list built and approved', async () => { V = await api.desk.buildMaster({ jobId: job.id }); if (V.master.devices !== 4) throw new Error(JSON.stringify(V.master)); V = await api.desk.approveMaster({ jobId: job.id }); return V.master.status; });
  let first;
  await step('Dex draws the BCD from the approved master list', async () => {
    first = await api.dexMake({ jobId: job.id, request: 'Draw the BCD for RIO1' });
    if (first.drawingNumber !== 'X22001-TST-05-71-0001') throw new Error('number ' + first.drawingNumber);
    if (!first.masterCheck || !first.masterCheck.added.includes('HOP01-JB1/C003')) throw new Error(JSON.stringify(first.masterCheck));
    return first.path;
  });
  await step('optional revision', async () => { const r = await api.dexMake({ jobId: job.id, request: 'Draw the BCD for RIO1', revision: { on: true, stage: 'comment' } }); if (r.revision !== 'A1' || !r.previousFound) throw new Error(r.revision + ' ' + r.previousFound); return r.diff; });
  await step('hands-off run: BCD, schedule, check', async () => { const f = await api.flow.run({ jobId: job.id }); const bad = f.steps.filter(s => s.status === 'failed'); if (bad.length) throw new Error(JSON.stringify(bad)); return f.steps.map(s => s.name + ': ' + s.status + ' ' + (s.summary || '')); });
  await step('PDF made beside the DXF', async () => { const r = await api.dexMake({ jobId: job.id, request: 'Draw the BCD for RIO1' }); if (!r.pdfs || !r.pdfs.length) throw new Error('no pdf'); return r.pdfs; });
  return out;
})();
