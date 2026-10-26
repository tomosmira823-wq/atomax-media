// The Business tab: Jobs, Approvals, Issue pack, Documents, Hours, Brief and Audit, on one modal.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDT = (iso) => { const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function initBizUI({ api, getSettings, openSettings }) {
  const box = $('#bizBox');
  let V = null, pane = 'jobs', editing = null, report = null, issue = { folder: '', transmittal: '' }, busy = false, filter = { job: '', text: '' };
  let lastApproved = null;

  const jobSel = (id, withAll = false) => `<select id="${id}">${withAll ? '<option value="">All jobs</option>' : '<option value="">Pick a job</option>'}${V.jobs.map(j => `<option value="${j.id}">${esc(j.number)} ${esc(j.name)}</option>`).join('')}</select>`;
  const jobNo = (id) => { const j = V && V.jobs.find(x => x.id === id); return j ? j.number : ''; };
  const peopleList = () => `<datalist id="bizPeople">${(V.people || []).map(p => `<option value="${esc(p)}">`).join('')}</datalist>`;
  const err = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const say = (id, msg, bad = true) => { const el = $('#' + id); if (el) { el.textContent = msg; el.style.color = bad ? 'var(--red)' : 'var(--green)'; } };
  const pending = () => (V ? V.approvals.filter(a => a.status === 'pending').length : 0);

  async function refresh() { V = await api.biz.get(); badge(); }
  function badge() { const n = pending(); const b = $('#bizBadge'); if (b) { b.textContent = n || ''; b.style.display = n ? '' : 'none'; } const t = $('#bizTabPend'); if (t) { t.textContent = n ? n : ''; t.style.display = n ? '' : 'none'; } }

  function shell() {
    const tabs = [['jobs', 'Jobs'], ['approvals', 'Approvals'], ['issue', 'Issue pack'], ['docs', 'Documents'], ['hours', 'Hours'], ['brief', 'Brief'], ['audit', 'Audit']];
    box.innerHTML = `<div class="biztabs">${tabs.map(([k, l]) => `<button data-p="${k}" class="${k === pane ? 'on' : ''}">${l}${k === 'approvals' && pending() ? ` <span class="pill">${pending()}</span>` : ''}</button>`).join('')}</div><div id="bizPane"></div>`;
    $$('.biztabs button', box).forEach(b => b.addEventListener('click', () => go(b.dataset.p)));
  }
  function go(p) { pane = p; editing = null; render(); }
  function render() { if (!V) return; shell(); const el = $('#bizPane'); ({ jobs, approvals, issue: issuePane, docs, hours, brief, audit })[pane](el); badge(); }

  // ---------------- Jobs ----------------
  const drawingText = (j) => (j.drawings || []).map(d => [d.no, d.title, d.rev, d.status && d.status !== 'Live' ? d.status : ''].filter((x, i) => i < 3 || x).join(' | ')).join('\n');
  function jobs(el) {
    if (editing) return jobForm(el);
    const cards = V.jobs.map(j => {
      const s = j.summary, bar = s.pct === null ? '' : `<div class="bar"><i style="width:${Math.min(100, s.pct)}%;background:${s.over ? 'var(--red)' : s.pct >= 80 ? 'var(--amber)' : 'var(--green)'}"></i></div>`;
      const due = j.dueDate ? (() => { const d = Math.round((Date.parse(j.dueDate) - Date.parse(todayISO())) / 86400000); return `<span class="${d < 0 ? 'bad' : d <= 3 ? 'warn' : ''}">Due ${esc(j.dueDate)}${d < 0 ? ' (overdue)' : d === 0 ? ' (today)' : ''}</span>`; })() : '';
      return `<div class="jobcard"><div class="jt"><b>${esc(j.number)}</b> ${esc(j.name)} <span class="st st-${esc(j.status.replace(/\s/g, ''))}">${esc(j.status)}</span></div>
        <div class="hint">${esc(j.client || 'No client')} ${due ? '· ' + due : ''}</div>
        <div class="jm"><span>${s.live} live drawing${s.live === 1 ? '' : 's'}${s.drawings > s.live ? ` (${s.drawings - s.live} struck)` : ''}</span><span>${s.used}${s.budget ? ' / ' + s.budget : ''} h${s.pct !== null ? ' · ' + s.pct + '%' : ''}</span>${s.pending ? `<span class="warn">${s.pending} waiting</span>` : ''}</div>${bar}
        <div class="row" style="margin-top:8px"><button class="btn small" data-edit="${j.id}">Edit</button><button class="btn small" data-hrs="${j.id}">Log hours</button><button class="btn small" data-audit="${j.id}">History</button></div></div>`;
    }).join('');
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="hint" style="flex:1">${V.jobs.length} job${V.jobs.length === 1 ? '' : 's'}. Cal, Dex, Iris and Doc all work against a job.</span><button class="btn primary" id="jobNew">+ New job</button></div>${V.jobs.length ? `<div class="jobgrid">${cards}</div>` : '<p class="hint">No jobs yet. Add your first job, with its drawing list, and everything else in the office hangs off it.</p>'}`;
    $('#jobNew').addEventListener('click', () => { editing = { drawings: [] }; render(); });
    $$('[data-edit]', el).forEach(b => b.addEventListener('click', () => { editing = V.jobs.find(j => j.id === b.dataset.edit); render(); }));
    $$('[data-hrs]', el).forEach(b => b.addEventListener('click', () => { go('hours'); setTimeout(() => { const s = $('#hJob'); if (s) s.value = b.dataset.hrs; }, 0); }));
    $$('[data-audit]', el).forEach(b => b.addEventListener('click', () => { filter.job = b.dataset.audit; go('audit'); }));
  }
  function jobForm(el) {
    const j = editing;
    el.innerHTML = `<h4 style="margin:0 0 10px">${j.id ? 'Edit job' : 'New job'}</h4>
      <div class="grid2"><div><label>Job number</label><input id="jNum" value="${esc(j.number || '')}" placeholder="X123456-10" /></div><div><label>Job name</label><input id="jName" value="${esc(j.name || '')}" /></div>
      <div><label>Client</label><input id="jClient" value="${esc(j.client || '')}" /></div><div><label>Status</label><select id="jStatus">${['Active', 'On hold', 'Issued', 'Closed'].map(s => `<option ${s === (j.status || 'Active') ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div><label>Budget hours</label><input id="jBudget" type="number" min="0" step="0.5" value="${j.budgetHours || ''}" /></div><div><label>Due date</label><input id="jDue" type="date" value="${esc(j.dueDate || '')}" /></div></div>
      <label>Drawing list <span class="hint">one per line: number | title | rev | status (optional, e.g. Cancelled)</span></label>
      <textarea id="jDraw" rows="7" placeholder="X123456-10-20-0042 | Loop diagram | P02">${esc(drawingText(j))}</textarea><div class="hint" id="jDrawN"></div>
      <label>Notes</label><textarea id="jNotes" rows="2">${esc(j.notes || '')}</textarea>
      <div class="err" id="jErr" style="margin-top:8px"></div>
      <div class="row" style="margin-top:12px"><button class="btn small" id="jCancel">Cancel</button><span style="flex:1"></span>${j.id ? '<button class="btn small danger" id="jDel">Delete job</button>' : ''}<button class="btn primary" id="jSave">Save job</button></div>`;
    const count = async () => { const r = await api.biz.parseDrawings({ text: $('#jDraw').value }); $('#jDrawN').textContent = `${r.length} drawing${r.length === 1 ? '' : 's'} recognised` + (r.filter(x => x.status !== 'Live').length ? `, ${r.filter(x => x.status !== 'Live').length} struck or cancelled` : ''); return r; };
    $('#jDraw').addEventListener('input', count); count();
    $('#jCancel').addEventListener('click', () => { editing = null; render(); });
    $('#jSave').addEventListener('click', async () => {
      try { const drawings = await count(); V = await api.biz.jobSave({ job: { id: j.id, number: $('#jNum').value, name: $('#jName').value, client: $('#jClient').value, status: $('#jStatus').value, budgetHours: $('#jBudget').value, dueDate: $('#jDue').value, notes: $('#jNotes').value, drawings } }); editing = null; badge(); render(); }
      catch (e) { $('#jErr').textContent = err(e); }
    });
    if ($('#jDel')) $('#jDel').addEventListener('click', async () => { if (!confirm('Delete this job and its logged hours? This cannot be undone.')) return; V = await api.biz.jobDelete({ id: j.id }); editing = null; render(); });
  }

  // ---------------- Approvals ----------------
  function approvals(el) {
    const pend = V.approvals.filter(a => a.status === 'pending'), done = V.approvals.filter(a => a.status !== 'pending').slice(0, 30);
    const card = (a) => `<div class="apcard"><div class="jt"><b>${esc(a.agent)}</b> · ${esc(a.title)}</div><div class="hint">${fmtDT(a.at)}${a.jobId ? ' · ' + esc(jobNo(a.jobId)) : ''}</div><p style="margin:6px 0">${esc(a.detail)}</p>
      ${a.kind === 'document' && a.payload.draftPath ? `<button class="btn small" data-open="${esc(a.payload.draftPath)}">Open the draft</button> ` : ''}${a.kind === 'issue-pack' ? `<div class="hint">${a.payload.files.length} files · to: ${esc(a.payload.to || '(not set)')} · ${esc(a.payload.purpose)}</div>` : ''}
      <div class="row" style="margin-top:8px"><input id="note-${a.id}" placeholder="Note (optional)" style="flex:1" /><button class="btn small" data-rej="${a.id}">Reject</button><button class="btn primary" data-app="${a.id}">Approve</button></div><div class="err" id="err-${a.id}"></div></div>`;
    el.innerHTML = (lastApproved ? `<div class="headline good">Done. ${esc(lastApproved.msg)} <button class="btn small" data-open="${esc(lastApproved.path)}">Show</button></div>` : '') +
      (pend.length ? pend.map(card).join('') : '<p class="hint">Nothing is waiting for you. Anything Doc or Iris prepares will land here first, and nothing goes out until you approve it.</p>') +
      (done.length ? `<h4 style="margin:16px 0 6px">Decided</h4>${done.map(a => `<div class="fx none"><div><b>${a.status === 'approved' ? 'Approved' : 'Rejected'}</b> · ${esc(a.agent)} · ${esc(a.title)}<div class="why">${fmtDT(a.decidedAt)}${a.note ? ' · ' + esc(a.note) : ''}</div></div></div>`).join('')}` : '');
    $$('[data-open]', el).forEach(b => b.addEventListener('click', () => api.showItem(b.dataset.open)));
    const decide = async (id, decision) => { lastApproved = null; try { const r = await api.biz.decide({ id, decision, note: ($('#note-' + id) || {}).value }); V = r.view; if (r.result && r.result.path) lastApproved = { path: r.result.path, msg: r.result.dir ? `${r.result.count} files copied to ${r.result.dir.split(/[\\/]/).pop()} with the transmittal.` : 'Filed under the job.' }; render(); } catch (e) { $('#err-' + id).textContent = err(e); } };
    $$('[data-app]', el).forEach(b => b.addEventListener('click', () => decide(b.dataset.app, 'approved')));
    $$('[data-rej]', el).forEach(b => b.addEventListener('click', () => decide(b.dataset.rej, 'rejected')));
  }

  // ---------------- Issue pack ----------------
  function issuePane(el) {
    const needKey = !(getSettings() || {}).anthropicKey;
    el.innerHTML = `<p class="hint" style="margin-top:0">Iris checks a folder before it goes out: file names, duplicate revisions, the job's drawing list, the transmittal, title blocks, cancelled or hatched sheets and colour. She never changes the folder. When it is clean she queues a copy, plus a transmittal, for you to approve.</p>
      <label>Job</label>${jobSel('iJob')}
      <label>Folder to issue</label><div class="row"><button class="btn" id="iFolder">Choose folder</button><span class="hint" id="iFolderN" style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(issue.folder || 'None chosen')}</span></div>
      <label>Transmittal (optional)</label><div class="row"><button class="btn" id="iTx">Choose transmittal</button><span class="hint" id="iTxN" style="flex:1">${esc(issue.transmittal || 'None. PDF, Excel or CSV')}</span>${issue.transmittal ? '<button class="btn small" id="iTxX">Clear</button>' : ''}</div>
      <label class="plain" style="display:flex;gap:8px;align-items:center;color:var(--text);margin:12px 0 4px"><input type="checkbox" id="iClaude" ${needKey ? '' : 'checked'} ${needKey ? 'disabled' : ''}/> Read title blocks and stamps with Claude (uses your key)</label>
      <div class="err" id="iErr"></div>
      <button class="btn primary" id="iGo" style="width:100%;margin-top:8px">Check the folder</button>
      <div id="iBar" hidden><div class="bar" style="margin-top:12px"><i id="iBarI" style="width:5%"></i></div><div class="hint" id="iMsg"></div></div>
      <div id="iOut"></div>`;
    if (issue.job) $('#iJob').value = issue.job;
    $('#iJob').addEventListener('change', () => issue.job = $('#iJob').value);
    $('#iFolder').addEventListener('click', async () => { const p = await api.biz.pickFolder(); if (p) { issue.folder = p; report = null; render(); } });
    $('#iTx').addEventListener('click', async () => { const p = await api.biz.pickFile({}); if (p) { issue.transmittal = p; render(); } });
    if ($('#iTxX')) $('#iTxX').addEventListener('click', () => { issue.transmittal = ''; render(); });
    $('#iGo').addEventListener('click', async () => {
      if (busy) return; $('#iErr').textContent = '';
      if (!issue.folder) { $('#iErr').textContent = 'Choose the folder first.'; return; }
      const useClaude = !!$('#iClaude').checked; if (issue.transmittal && !(getSettings() || {}).anthropicKey) { openSettings(); return; }
      busy = true; $('#iBar').hidden = false; $('#iGo').disabled = true;
      try { report = await api.biz.issueScan({ jobId: $('#iJob').value, folder: issue.folder, transmittalPath: issue.transmittal, useClaude }); await refresh(); } catch (e) { $('#iErr').textContent = err(e); }
      busy = false; if (pane === 'issue') { render(); if (report) showIssue(); }
    });
    if (report) showIssue();
  }
  function showIssue() {
    const r = report, out = $('#iOut'); if (!out) return;
    const groups = {}; r.findings.forEach(f => (groups[f.check] = groups[f.check] || []).push(f));
    out.innerHTML = `<div class="headline ${r.ok ? (r.warns ? 'warn' : 'good') : 'warn'}" style="margin-top:14px">${r.ok ? (r.warns ? `Nothing blocking. ${r.warns} to look at.` : 'Clean. Nothing found.') : `${r.fails} to fix before this goes out${r.warns ? `, ${r.warns} to look at` : ''}.`}</div>
      ${Object.entries(groups).map(([g, list]) => `<div class="grp"><h4>${esc(g)} <span>${list.length}</span></h4><ul>${list.map(f => `<li class="${f.level === 'fail' ? 'bad' : 'confirm'}"><b>${f.level === 'fail' ? 'FIX' : 'LOOK'}</b> ${esc(f.text)}${f.file ? `<div class="why">${esc(f.file)}</div>` : ''}</li>`).join('')}</ul></div>`).join('')}
      <div class="grp cov"><h4>What was checked</h4><ul>${r.coverage.map(c => `<li class="${/NOT/.test(c) ? 'confirm' : ''}">${esc(c)}</li>`).join('')}</ul>${(r.notes || []).length ? `<ul>${r.notes.map(n => `<li class="confirm">${esc(n)}</li>`).join('')}</ul>` : ''}</div>
      <div class="grid2"><div><label>Issued to</label><input id="qTo" placeholder="Client or contact" /></div><div><label>Purpose</label><input id="qPurpose" value="Issued for review" /></div>
      <div><label>Revision of transmittal</label><input id="qRev" value="P01" /></div><div><label>Prepared by</label><input id="qBy" list="bizPeople" /></div></div>${peopleList()}
      <div class="err" id="qErr" style="margin-top:8px"></div>
      <div class="row" style="margin-top:10px"><span style="flex:1" class="hint">${r.ok ? 'Queues a copy for your approval. Your folder is not changed.' : 'Fix the folder, then check again. Iris will not queue an issue with open fixes.'}</span><button class="btn primary" id="qGo" ${r.ok ? '' : 'disabled'}>Queue for approval</button></div>`;
    $('#qGo').addEventListener('click', async () => { try { V = await api.biz.issueQueue({ report: r, jobId: r.jobId, to: $('#qTo').value, purpose: $('#qPurpose').value, prepared: $('#qBy').value, revision: $('#qRev').value }); report = null; go('approvals'); } catch (e) { $('#qErr').textContent = err(e); } });
  }

  // ---------------- Documents ----------------
  let kinds = [];
  async function docs(el) {
    if (!kinds.length) kinds = await api.biz.docKinds();
    const docsHtml = V.docs.length ? V.docs.map(d => `<div class="fx none" style="opacity:1"><div style="flex:1"><b>${esc(d.docNumber)}</b> ${esc(d.revision || '')} · ${esc(d.kindLabel || d.kind)}<div class="why">${esc(jobNo(d.jobId))} · ${esc(d.date)} · ${esc(d.description || '')}</div></div><button class="btn small" data-open="${esc(d.path)}">Show</button></div>`).join('') : '<p class="hint">Nothing filed yet.</p>';
    el.innerHTML = `<p class="hint" style="margin-top:0">Doc writes RAMS, ITPs, NCRs, reports and quotes in the Atomax Word format from what you tell him, using only your facts. Anything he is missing comes out as TBC. The draft waits in Approvals.</p>
      <div class="grid2"><div><label>Type</label><select id="dKind">${kinds.map(k => `<option value="${k.kind}">${esc(k.label)}</option>`).join('')}</select></div><div><label>Job</label>${jobSel('dJob')}</div>
      <div><label>Document number <span class="hint">blank = next free</span></label><input id="dNum" /></div><div><label>Revision <span class="hint">blank = automatic</span></label><input id="dRev" placeholder="P01" /></div>
      <div style="grid-column:1/3"><label>Description of this revision</label><input id="dDesc" value="Issued for review" /></div>
      <div><label>Prepared by</label><input id="dPrep" list="bizPeople" /></div><div><label>Checked by</label><input id="dChk" list="bizPeople" /></div><div><label>Approved by</label><input id="dApp" list="bizPeople" /></div></div>${peopleList()}
      <label>What it should say</label><textarea id="dDetails" rows="8" placeholder="Scope, location, dates, who is doing what, standards to follow, results, prices. Whatever you have. Doc will not invent the rest."></textarea>
      <div class="err" id="dErr" style="margin-top:8px"></div>
      <button class="btn primary" id="dGo" style="width:100%;margin-top:8px">Have Doc write it</button><div id="dBar" hidden><div class="bar" style="margin-top:12px"><i id="dBarI" style="width:10%"></i></div><div class="hint" id="dMsg"></div></div>
      <h4 style="margin:18px 0 6px">Filed documents</h4>${docsHtml}`;
    $$('[data-open]', el).forEach(b => b.addEventListener('click', () => api.showItem(b.dataset.open)));
    $('#dGo').addEventListener('click', async () => {
      if (busy) return; $('#dErr').textContent = '';
      if (!(getSettings() || {}).anthropicKey) { openSettings(); return; }
      busy = true; $('#dBar').hidden = false; $('#dGo').disabled = true;
      try { const people = [$('#dPrep').value, $('#dChk').value, $('#dApp').value].filter(Boolean); V = (await api.biz.docDraft({ kind: $('#dKind').value, jobId: $('#dJob').value, details: $('#dDetails').value, prepared: $('#dPrep').value, checked: $('#dChk').value, approved: $('#dApp').value, revision: $('#dRev').value, description: $('#dDesc').value, docNumber: $('#dNum').value })).view; if (people.length) api.biz.people({ people: [...(V.people || []), ...people] }).then(v => V = v).catch(() => {}); busy = false; go('approvals'); return; }
      catch (e) { $('#dErr').textContent = err(e); }
      busy = false; $('#dGo').disabled = false; $('#dBar').hidden = true;
    });
  }

  // ---------------- Hours ----------------
  function hours(el) {
    const wk = (() => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); })();
    const week = {}; V.hours.filter(h => h.date >= wk).forEach(h => week[h.who] = (week[h.who] || 0) + h.hours);
    const last = V.hours[0];
    el.innerHTML = `<div class="grid2"><div><label>Job</label>${jobSel('hJob')}</div><div><label>Date</label><input id="hDate" type="date" value="${todayISO()}" /></div>
      <div><label>Hours</label><input id="hHrs" type="number" min="0" max="24" step="0.25" /></div><div><label>Who</label><input id="hWho" list="bizPeople" value="${esc(last ? last.who : 'Tom')}" /></div>
      <div style="grid-column:1/3"><label>What was done</label><input id="hNote" /></div></div>${peopleList()}
      <div class="err" id="hErr" style="margin-top:6px"></div><div class="row" style="margin-top:8px"><span style="flex:1" class="hint">This week: ${Object.keys(week).length ? Object.entries(week).map(([w, h]) => esc(w) + ' ' + Math.round(h * 100) / 100 + ' h').join(' · ') : 'nothing logged'}</span><button class="btn primary" id="hAdd">Log hours</button></div>
      <h4 style="margin:16px 0 6px">Against budget</h4>${V.jobs.filter(j => j.summary.used || j.summary.budget).map(j => `<div style="margin:6px 0"><div class="row"><b>${esc(j.number)}</b> <span class="hint" style="flex:1">${esc(j.name)}</span><span>${j.summary.used}${j.summary.budget ? ' / ' + j.summary.budget : ''} h</span></div>${j.summary.budget ? `<div class="bar"><i style="width:${Math.min(100, j.summary.pct)}%;background:${j.summary.over ? 'var(--red)' : j.summary.pct >= 80 ? 'var(--amber)' : 'var(--green)'}"></i></div>` : ''}</div>`).join('') || '<p class="hint">No hours or budgets yet.</p>'}
      <h4 style="margin:16px 0 6px">Recent</h4>${V.hours.slice(0, 40).map(h => `<div class="fx none" style="opacity:1"><div style="flex:1"><b>${h.hours} h</b> · ${esc(jobNo(h.jobId))} · ${esc(h.who)} <span class="hint">${esc(h.date)}</span>${h.note ? `<div class="why">${esc(h.note)}</div>` : ''}</div><button class="btn small" data-hdel="${h.id}">×</button></div>`).join('') || '<p class="hint">Nothing logged.</p>'}`;
    $('#hAdd').addEventListener('click', async () => { try { V = await api.biz.hoursAdd({ jobId: $('#hJob').value, date: $('#hDate').value, hours: $('#hHrs').value, who: $('#hWho').value, note: $('#hNote').value }); const j = $('#hJob').value; render(); $('#hJob').value = j; } catch (e) { $('#hErr').textContent = err(e); } });
    $$('[data-hdel]', el).forEach(b => b.addEventListener('click', async () => { V = await api.biz.hoursRemove({ id: b.dataset.hdel }); render(); }));
  }

  // ---------------- Brief ----------------
  function briefHtml(b) { return `<div class="briefcard"><div class="jt"><b>${esc(b.title)}</b> <span class="hint">${fmtDT(b.at)}</span></div>${b.lines.map(l => l.h ? `<h5>${esc(l.h)}</h5>` : `<div class="bl">${esc(l.t)}</div>`).join('')}</div>`; }
  function brief(el) {
    const m = V.routines.morning, w = V.routines.weekly;
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn primary" id="bM">Morning brief now</button><button class="btn" id="bW">Weekly summary now</button></div>
      <div class="jobcard" style="margin-bottom:12px"><b>Routines</b> <span class="hint">They run while the app is open. If it was closed, the brief appears the next time you open it after the set time.</span>
      <div class="row" style="margin-top:8px"><label class="plain" style="display:flex;gap:8px;align-items:center;color:var(--text);margin:0"><input type="checkbox" id="rM" ${m.on ? 'checked' : ''}/> Morning brief, weekdays at</label><input type="time" id="rMt" value="${m.time}" style="width:110px" /></div>
      <div class="row" style="margin-top:6px"><label class="plain" style="display:flex;gap:8px;align-items:center;color:var(--text);margin:0"><input type="checkbox" id="rW" ${w.on ? 'checked' : ''}/> Weekly summary on</label><select id="rWd" style="width:130px">${DAYS.map((d, i) => `<option value="${i}" ${i === w.day ? 'selected' : ''}>${d}</option>`).join('')}</select><span class="hint">at</span><input type="time" id="rWt" value="${w.time}" style="width:110px" /></div>
      <div class="row" style="margin-top:8px"><span style="flex:1" class="hint" id="rMsg"></span><button class="btn small" id="rSave">Save routines</button></div></div>
      ${V.briefs.length ? V.briefs.map(briefHtml).join('') : '<p class="hint">No briefs yet. Press the button above to make one.</p>'}`;
    const run = async (k) => { V = await api.biz.briefRun({ kind: k }); render(); };
    $('#bM').addEventListener('click', () => run('morning')); $('#bW').addEventListener('click', () => run('weekly'));
    $('#rSave').addEventListener('click', async () => { V = await api.biz.routinesSet({ routines: { morning: { on: $('#rM').checked, time: $('#rMt').value }, weekly: { on: $('#rW').checked, day: +$('#rWd').value, time: $('#rWt').value } } }); render(); say('rMsg', 'Saved.', false); });
  }

  // ---------------- Audit ----------------
  function audit(el) {
    const rows = V.audit.filter(a => (!filter.job || a.jobId === filter.job) && (!filter.text || JSON.stringify(a).toLowerCase().includes(filter.text.toLowerCase())));
    el.innerHTML = `<div class="row" style="margin-bottom:8px">${jobSel('aJob', true)}<input id="aText" placeholder="Search" value="${esc(filter.text)}" style="flex:1" /><button class="btn small" id="aCsv">Export CSV</button></div>
      <div class="hint" style="margin-bottom:6px">${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}. Every change made by you or an agent, with who, when, and the before and after.</div>
      <table class="aud"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Job</th><th>Before → After</th></tr></thead><tbody>${rows.slice(0, 300).map(a => `<tr><td>${fmtDT(a.at)}</td><td>${esc(a.who)}</td><td>${esc(a.action)}${a.detail ? `<div class="why">${esc(a.detail)}</div>` : ''}</td><td>${esc(jobNo(a.jobId))}</td><td>${a.before || a.after ? `<code>${esc(a.before)}</code> → <code>${esc(a.after)}</code>` : ''}</td></tr>`).join('')}</tbody></table>`;
    $('#aJob').value = filter.job;
    $('#aJob').addEventListener('change', () => { filter.job = $('#aJob').value; render(); });
    $('#aText').addEventListener('input', () => { filter.text = $('#aText').value; const pos = $('#aText').selectionStart; render(); const t = $('#aText'); t.focus(); t.setSelectionRange(pos, pos); });
    $('#aCsv').addEventListener('click', async () => { const q = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"'; const csv = ['When,Who,Action,Job,Before,After,Detail', ...rows.map(a => [a.at, a.who, a.action, jobNo(a.jobId), a.before, a.after, a.detail].map(q).join(','))].join('\n'); await api.files.saveText({ text: csv, name: 'audit-trail.txt' }); });
  }

  api.biz.onProgress((p) => { const bar = $('#iBarI') || $('#dBarI'); if (bar) bar.style.width = (p.pct || 5) + '%'; const m = $('#iMsg') || $('#dMsg'); if (m) m.textContent = p.message || ''; });
  api.biz.onBrief(async () => { await refresh(); if ($('#bizModal').classList.contains('open')) render(); });

  return {
    async open(which) { await refresh(); if (which) pane = which; render(); },
    refresh,
    // job picker for the Cal and Dex panels
    async fillJobSelect(sel) { try { const jobs = await api.biz.jobs(); const keep = sel.value; sel.innerHTML = '<option value="">No job</option>' + jobs.filter(j => j.status !== 'Closed').map(j => `<option value="${j.id}">${esc(j.number)} ${esc(j.name)}</option>`).join(''); sel.value = jobs.some(j => j.id === keep) ? keep : ''; } catch {} }
  };
}
