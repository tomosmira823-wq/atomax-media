// The Jobs screen: home for engineering work. Left: the jobs. Right: "Waiting on you" across every job, or one job's flow:
// Deliverables (each made by its agent, checked by Cal) · Inputs & setup · Comments (revisions) · Issue.
import { renderJobDesk } from './jobdeskui.js';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const base = (p) => String(p || '').split(/[\\/]/).pop();

export function initJobsUI({ api, getAgents, openIssue, onWorkOn }) {
  const panel = $('#jobsPanel');
  let jobs = [], sel = '', tab = 'deliv', O = null, msg = '', busy = {}, poll = null;

  async function refresh() {
    const v = await api.biz.get(); jobs = v.jobs.filter(j => j.status !== 'Closed');
    if (sel && !jobs.some(j => j.id === sel)) sel = '';
    renderList();
    if (sel) { try { O = await api.jobs.overview({ jobId: sel }); } catch (e) { O = null; msg = clean(e); } renderJob(); } else renderHome();
  }
  function renderList() {
    $('#jbList').innerHTML = `<button class="jbnew" id="jbNew">+ New job</button><button class="jbj home ${!sel ? 'on' : ''}" data-j="">Waiting on you</button><div class="jblabel">Jobs</div>` + (jobs.map(j => `<button class="jbj ${j.id === sel ? 'on' : ''}" data-j="${j.id}"><b>${esc(j.number)}</b><span>${esc(j.name || '')}</span><i>${esc(j.client || 'No client')}</i></button>`).join('') || '<div class="bhint">No jobs yet.</div>')
;
    $('#jbList').querySelectorAll('[data-j]').forEach(b => b.onclick = () => { sel = b.dataset.j; tab = 'deliv'; msg = ''; refresh(); });
    $('#jbNew').onclick = newJob;
  }

  // ---------- home: everything that needs Tom ----------
  async function renderHome() {
    const m = $('#jbMain'); m.innerHTML = '<div class="bhint">Looking…</div>';
    let W = []; try { W = await api.jobs.waiting(); } catch (e) { m.innerHTML = `<div class="bhint">${esc(clean(e))}</div>`; return; }
    const icon = { master: '☑', questions: '?', failed: '!', check: '⚑', rfi: '✉', comments: '✎', folder: '📁' };
    m.innerHTML = `<div class="jbhead"><div><h2>Waiting on you</h2><div class="bsub">Everything across your jobs that needs you. Click one to go to it.</div></div></div>
      ${W.length ? `<div class="jbwait">${W.map((w, i) => `<button class="jbw k-${w.kind}" data-i="${i}"><span class="ic">${icon[w.kind] || '•'}</span><span><b>${esc(w.text)}</b><i>${esc(w.job)}</i></span></button>`).join('')}</div>` : `<div class="jbempty"><b>Nothing waiting on you.</b><span>${jobs.length ? 'Pick a job on the left to see its deliverables, or start a new one.' : 'Start with + New job on the left.'}</span></div>`}`;
    m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const w = W[+b.dataset.i]; sel = w.jobId; tab = { master: 'setup', rfi: 'setup', folder: 'setup', comments: 'comments' }[w.kind] || 'deliv'; refresh(); });
  }

  // ---------- one job ----------
  function renderJob() {
    const m = $('#jbMain'); if (!O) { m.innerHTML = `<div class="bhint">${esc(msg)}</div>`; return; }
    const j = O.job, V = O.desk, rows = O.rows;
    const openC = (V.crs || []).filter(c => !/responded|closed/i.test(c.status || '')).length;
    const tabs = [['deliv', `Deliverables <em>${rows.length}</em>`], ['setup', 'Inputs &amp; setup'], ['comments', `Comments${openC ? ` <em>${openC}</em>` : ''}`], ['issue', 'Issue']];
    m.innerHTML = `<div class="jbhead"><div><h2>${esc(j.number)} ${esc(j.name || '')}</h2><div class="bsub">${esc(j.client || 'No client')} · border: ${esc(V.borderUsed || '')}${j.folder ? ` · <a href="#" id="jbFolder">open folder</a>` : ' · <b class="warn">no folder linked</b>'}</div></div>
        <button class="jbbtn" id="jbWork">Work on this job</button></div>
      <div class="jbtabs">${tabs.map(([k, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${msg ? `<div class="jbmsg">${esc(msg)}</div>` : ''}
      <div id="jbTab"></div>`;
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; msg = ''; renderJob(); });
    if ($('#jbFolder')) $('#jbFolder').onclick = (e) => { e.preventDefault(); api.proj.open({ jobId: j.id }).catch(() => api.showItem(j.folder)); };
    $('#jbWork').onclick = async () => { await api.biz.setCurrent({ id: j.id }); if (onWorkOn) onWorkOn(j.id); $('#jbWork').textContent = '✓ Job in hand'; };
    ({ deliv: tabDeliv, setup: tabSetup, comments: tabComments, issue: tabIssue })[tab]();
    const working = rows.some(r => r.work && (r.work.status === 'working' || (r.work.check && r.work.check.status === 'working')));
    clearTimeout(poll); if (working && panel.classList.contains('open')) poll = setTimeout(refresh, 3000);
  }

  const chip = (w) => { if (!w) return '<span class="st st-todo">To do</span>'; const s = w.status; return `<span class="st st-${s.replace(/\s+/g, '')}">${{ working: 'Working…', made: 'Made', 'needs you': 'Needs you', failed: 'Failed', issued: 'Issued' }[s] || esc(s)}</span>`; };
  const files = (w) => w && w.files ? [...w.files, ...(w.pdfs || [])].map(p => `<button class="jbfile" data-open="${esc(p)}" title="${esc(p)}">${esc(base(p).replace(/^.*\./, '').toUpperCase())}</button>`).join('') : '';

  function tabDeliv() {
    const rows = O.rows, V = O.desk, el = $('#jbTab');
    const masterOk = !O.needsMaster || (V.master && V.master.status === 'approved');
    const made = rows.filter(r => r.work && r.work.files && r.agent === 'Dex').length;
    el.innerHTML = `${!rows.length ? `<div class="jbempty"><b>No deliverables on this job yet.</b><span>Check or make the drawing register in Inputs &amp; setup, or forward the client's email to Eli: he lists what the job needs.</span></div>` : ''}
      ${O.needsMaster && !masterOk ? `<div class="jbbanner">BCDs and schedules are made from the master device list. <button class="jbbtn" id="jbToMaster">${V.master ? 'Check and approve it' : 'Build it'}</button></div>` : ''}
      ${rows.length ? `<div class="jbbar"><button class="jbbtn primary" id="jbAll" ${rows.some(r => r.agent && !r.work && (masterOk || !['bcd', 'schedule'].includes(r.kind))) ? '' : 'disabled'}>Make everything not made yet</button><button class="jbbtn" id="jbCheck" ${made ? '' : 'disabled'}>Cal: check the drawings</button><span class="bsub">Each row: the agent makes it, Cal checks it, then it goes in the issue pack.</span></div>` : ''}
      <div class="jbrows">${rows.map(r => { const w = r.work;
        return `<div class="jbrow">
          <div class="c1"><b>${esc(r.no)}</b><span>${esc(r.title)}</span>${w && w.summary && w.status !== 'made' ? `<i>${esc(w.summary)}</i>` : ''}${w && w.warning ? `<i class="warn">${esc(w.warning)}</i>` : ''}</div>
          <div class="c2">${r.agent ? esc(r.agent) : '<span class="bsub">by hand</span>'}</div>
          <div class="c3">${chip(w)}${w && w.rev && w.files ? `<span class="st">${esc(w.rev)}</span>` : ''}${w && w.check ? `<span class="st st-${w.check.status === 'passed' ? 'made' : w.check.status === 'working' ? 'working' : 'needsyou'}">${w.check.status === 'passed' ? 'Checked ✓' : w.check.status === 'working' ? 'Checking…' : `Check: ${w.check.count} to look at`}</span>` : ''}</div>
          <div class="c4">${files(w)}${w && w.check && w.check.markups ? `<button class="jbfile" data-show="${esc(w.check.markups)}">MARKUPS</button>` : ''}</div>
          <div class="c5">${r.agent ? `<button class="jbbtn ${!w ? 'primary' : ''}" data-make="${esc(r.no)}" ${(w && w.status === 'working') || (!masterOk && (r.kind === 'bcd' || r.kind === 'schedule')) ? 'disabled' : ''}>${w && w.files ? 'Make again' : 'Make'}</button>` : ''}</div>
          ${w && w.questions ? `<div class="jbq"><b>${esc(r.agent)} asks:</b>${w.questions.map((q, i) => `<label class="plain">${esc(q)}</label><input data-ans="${i}" placeholder="Your answer">`).join('')}<button class="jbbtn primary" data-answer="${esc(r.no)}">Send answers</button></div>` : ''}
        </div>`; }).join('')}</div>`;
    if ($('#jbToMaster')) $('#jbToMaster').onclick = () => { tab = 'setup'; renderJob(); };
    if ($('#jbAll')) $('#jbAll').onclick = () => act(() => api.jobs.makeAll({ jobId: O.job.id }), 'Making the deliverables…');
    if ($('#jbCheck')) $('#jbCheck').onclick = () => act(async () => { const r = await api.jobs.check({ jobId: O.job.id }); msg = `Cal checked against ${r.schedule}: ${r.headline || ''} ${r.findings} to look at.`; }, 'Cal is checking…');
    el.querySelectorAll('[data-make]').forEach(b => b.onclick = () => act(() => api.jobs.make({ jobId: O.job.id, no: b.dataset.make }), `${b.dataset.make}: on it…`));
    el.querySelectorAll('[data-answer]').forEach(b => b.onclick = () => { const box = b.closest('.jbq'), qs = O.rows.find(r => r.no === b.dataset.answer).work.questions; const answers = qs.map((q, i) => ({ q, a: box.querySelector(`[data-ans="${i}"]`).value })); act(() => api.jobs.make({ jobId: O.job.id, no: b.dataset.answer, answers }), 'Sent. Working…'); });
    wireFiles(el);
  }
  function wireFiles(el) {
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => api.desk.open({ p: b.dataset.open }));
    el.querySelectorAll('[data-show]').forEach(b => b.onclick = () => api.desk.show({ p: b.dataset.show }));
  }
  // run a job action: show it is going, refresh the rows while the agents work, report errors on the page
  async function act(fn, note) {
    msg = note; renderJob(); const t = setTimeout(refresh, 1500);
    try { await fn(); if (msg === note) msg = ''; } catch (e) { msg = clean(e); }
    clearTimeout(t); await refresh();
  }

  async function tabSetup() {
    const el = $('#jbTab'); el.innerHTML = '<div id="jbFolderInfo" class="jbcard"></div><div id="jbDesk"></div>';
    const job = jobs.find(x => x.id === sel);
    try { const info = await api.proj.info({ jobId: sel }); $('#jbFolderInfo').innerHTML = info.folder ? `<b>Project folder</b><div class="bpath">${esc(info.folder)}</div><div class="bsub">${info.read ? `${info.read.files} files · ${info.read.extracts} read for context` : 'Not read yet'}</div><div class="jbbar"><button class="jbbtn" id="jbRead">Read folder again</button></div>` : `<b>No project folder linked</b><div class="bsub">The agents read the inputs from it and save their work into it.</div><div class="jbbar"><button class="jbbtn primary" id="jbPick">Choose the folder…</button></div>`;
      if ($('#jbRead')) $('#jbRead').onclick = async () => { $('#jbRead').textContent = 'Reading…'; await api.proj.gather({ jobId: sel }).catch(() => {}); tabSetup(); };
      if ($('#jbPick')) $('#jbPick').onclick = async () => { const f = await api.proj.pick(); if (f) { await api.proj.setFolder({ jobId: sel, folder: f }); refresh(); } };
    } catch {}
    await renderJobDesk(api, $('#jbDesk'), job, { getAgents });
  }

  function tabComments() {
    const V = O.desk, el = $('#jbTab'), docs = O.rows.map(r => r.no);
    const byDoc = {}; (V.crs || []).forEach(c => { (byDoc[c.doc || 'General'] = byDoc[c.doc || 'General'] || []).push(c); });
    el.innerHTML = `<div class="jbcard"><b>Log client comments</b><div class="jbbar"><select id="jcDoc">${docs.map(d => `<option>${esc(d)}</option>`).join('')}<option value="">General</option></select><input id="jcBy" placeholder="Who (e.g. Steve, NG)" style="max-width:200px"></div><textarea id="jcText" rows="3" placeholder="Paste the comment(s), one per line"></textarea><div class="jbbar"><button class="jbbtn primary" id="jcAdd">Add to the CRS</button></div></div>
      ${Object.keys(byDoc).length ? Object.entries(byDoc).map(([doc, cs]) => { const open = cs.filter(c => !/responded|closed/i.test(c.status || ''));
        return `<div class="jbcard"><div class="jbhead2"><b>${esc(doc)}</b>${O.rows.some(r => r.no === doc && r.agent === 'Dex') && open.length ? `<button class="jbbtn primary" data-revise="${esc(doc)}">Revise the drawing for these ${open.length}</button>` : ''}</div>
          ${cs.map(c => `<div class="jbc ${/responded|closed/i.test(c.status || '') ? 'done' : ''}"><span class="bsub">${esc(c.no)} · ${esc(c.by || '')}</span><div>${esc(c.comment)}</div>${c.response ? `<div class="resp">↳ ${esc(c.response)}</div>` : ''}</div>`).join('')}</div>`; }).join('') : '<div class="jbempty"><b>No client comments yet.</b><span>When comments come back, log them here (or forward the email to Eli). Each drawing can then be revised in one click: next revision, changes clouded.</span></div>'}`;
    $('#jcAdd').onclick = async () => { const lines = $('#jcText').value.split('\n').map(s => s.trim()).filter(Boolean); if (!lines.length) return; for (const l of lines) await api.desk.addComment({ jobId: sel, doc: $('#jcDoc').value, comment: l, by: $('#jcBy').value }); refresh(); };
    el.querySelectorAll('[data-revise]').forEach(b => b.onclick = () => { const doc = b.dataset.revise, cs = (byDoc[doc] || []).filter(c => !/responded|closed/i.test(c.status || '')); tab = 'deliv'; act(async () => { await api.jobs.revise({ jobId: sel, no: doc, comments: cs.map(c => `${c.no}: ${c.comment}`).join('\n') }); for (const c of cs) await api.desk.crs({ jobId: sel, row: { no: c.no, status: 'Responded', response: 'Revised on the next revision of ' + doc } }); }, `Revising ${doc}…`); });
  }

  function tabIssue() {
    const el = $('#jbTab'), ready = O.rows.filter(r => r.work && r.work.files);
    el.innerHTML = `<div class="jbcard"><b>Issue pack</b><div class="bsub">Made deliverables: ${ready.length} of ${O.rows.length}. Before issue: checked both ways, monochrome PDFs beside each DXF, revisions right, nothing struck off, transmittal matches the folder.</div>
      ${ready.map(r => `<div class="jbc"><b>${esc(r.no)}</b> ${esc(r.title)} <span class="bsub">${r.work.rev ? 'rev ' + esc(r.work.rev) : ''} ${r.work.check ? (r.work.check.status === 'passed' ? '· checked ✓' : '· check: ' + r.work.check.count + ' to look at') : '· not checked'}</span></div>`).join('')}
      <div class="jbbar"><button class="jbbtn primary" id="jbIssue" ${ready.length ? '' : 'disabled'}>Prepare the issue (transmittal, register, cover email)</button></div></div>`;
    $('#jbIssue').onclick = async () => { await api.biz.setCurrent({ id: sel }); if (openIssue) openIssue(sel); };
  }

  // ---------- new job ----------
  async function newJob() {
    let D = { nextNumber: '', saved: '', guess: '' }; try { D = await api.mail.defaults(); } catch {}
    let parent = D.saved || D.guess || '', link = '';
    const m = $('#jbMain');
    m.innerHTML = `<div class="jbhead"><div><h2>New job</h2><div class="bsub">The number is X + today's date unless you change it.</div></div></div>
      <div class="jbcard jbform"><label>Job number</label><input id="njNo" value="${esc(D.nextNumber || '')}"><label>Job name / site</label><input id="njName" placeholder="e.g. Eakring Training Centre"><label>Client</label><input id="njClient" placeholder="e.g. National Grid">
        <label>Project folder</label>
        <label class="plain"><input type="radio" name="njMode" value="create" checked> New folder from the Atomax template in <b id="njParent">${esc(parent || '(choose where your job folders live)')}</b> <button class="jbbtn" id="njParentPick" type="button">Change…</button></label>
        <label class="plain"><input type="radio" name="njMode" value="link"> A folder I already have <button class="jbbtn" id="njLinkPick" type="button">Choose…</button> <span id="njLink" class="bsub"></span></label>
        <label class="plain"><input type="radio" name="njMode" value="none"> No folder yet</label>
        <div class="jbbar"><button class="jbbtn primary" id="njSave">Create job</button><button class="jbbtn" id="njCancel">Cancel</button></div><div id="njMsg" class="bsub"></div></div>`;
    $('#njParentPick').onclick = async () => { const f = await api.mail.pickParent(); if (f) { parent = f; $('#njParent').textContent = f; } };
    $('#njLinkPick').onclick = async () => { const f = await api.biz.pickFolder(); if (f) { link = f; $('#njLink').textContent = f; m.querySelector('input[value="link"]').checked = true; } };
    $('#njCancel').onclick = () => refresh();
    $('#njSave').onclick = async () => { const mode = m.querySelector('input[name="njMode"]:checked').value; $('#njMsg').textContent = 'Creating…';
      try { const r = await api.mail.newJob({ number: $('#njNo').value, name: $('#njName').value, client: $('#njClient').value, mode, folder: mode === 'create' ? parent : link }); sel = r.id; tab = 'setup'; msg = r.folder ? 'Job created. Next: check the inputs are in the folder, then build the drawing register.' : 'Job created.'; refresh(); } catch (e) { $('#njMsg').textContent = clean(e); } };
  }

  $('#jbBack').onclick = () => hide();
  function hide() { panel.classList.remove('open'); clearTimeout(poll); document.body.classList.remove('jobs-open'); const b = $('#jobsBtn'); if (b) b.classList.remove('active'); const o = document.querySelector('#top .tabs button[data-tab="office"]'); if (o) o.classList.add('active'); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open') && !document.querySelector('.modal.open')) hide(); });
  return {
    async show(jobId) { if (jobId !== undefined) { sel = jobId; tab = 'deliv'; } panel.classList.add('open'); document.body.classList.add('jobs-open'); document.querySelectorAll('#top .tabs:not(.rooms) button').forEach(x => x.classList.toggle('active', x.id === 'jobsBtn')); await refresh().catch(e => { $('#jbMain').innerHTML = `<div class="bhint">${esc(clean(e))}</div>`; }); },
    hide, refresh, isOpen: () => panel.classList.contains('open')
  };
}
