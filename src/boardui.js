// The project whiteboard in the meeting room: every job, its context notes, tasks set for the agents, and who has been working on what.
// Picking a job here also sets the "job in hand": every engineering agent gets that job as background in its prompts.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { renderJobDesk } from './jobdeskui.js';
const NOTE_COLOURS = ['#ffe066', '#7fc8ff', '#b2f2bb', '#ffb3c1', '#d0bfff', '#ffd8a8'];

export function initBoardUI({ office, api, getAgents, openAgent, openBusiness, goBack }) {
  const panel = $('#boardPanel');
  let V = null, sel = '', cur = '', msg = '';
  const jobOf = (id) => V && V.jobs.find(j => j.id === id);
  const tasksOf = (id) => (V ? V.tasks : []).filter(t => t.jobId === id);
  const agentColour = (name) => { const a = (getAgents() || []).find(x => x.name === name); return a ? a.colour : '#868e96'; };
  const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 2 ? 'just now' : m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };

  async function refresh() {
    V = await api.biz.get(); cur = await api.biz.current();
    if (!sel || !jobOf(sel)) sel = (jobOf(cur) && cur) || (V.jobs.find(j => j.status === 'Active') || V.jobs[0] || {}).id || '';
    render(); pushToBoard();
  }

  // what the 3D whiteboard shows
  function pushToBoard() {
    if (!V) return;
    const act = (id) => V.audit.find(a => a.jobId === id && !/^Task /.test(a.action));
    const jobs = V.jobs.filter(j => j.status !== 'Closed').slice(0, 6).map(j => {
      const t = tasksOf(j.id), a = act(j.id);
      return { number: j.number, name: j.name, status: j.status === 'Active' && j.id === cur ? 'In hand' : j.status, open: t.filter(x => x.status === 'todo').length, doing: t.filter(x => x.status === 'doing').length, done: t.filter(x => x.status === 'done').length, last: a ? a.who : '' };
    });
    const doing = {}; V.tasks.filter(t => t.status === 'doing' && t.agentName).forEach(t => { doing[t.agentName] = (doing[t.agentName] || 0) + 1; });
    const agents = Object.entries(doing).map(([name, n]) => ({ name, n: n > 1 ? '×' + n : '', colour: agentColour(name) }));
    office.setProjectBoard(V.jobs.length ? { jobs, agents } : null);
  }

  function render() {
    if (!V) return;
    const jobs = V.jobs;
    const list = jobs.length ? jobs.map((j, i) => {
      const t = tasksOf(j.id), n = t.filter(x => x.status !== 'done').length;
      return `<button class="bj ${j.id === sel ? 'on' : ''}" data-job="${j.id}" style="--c:${NOTE_COLOURS[i % NOTE_COLOURS.length]}"><b>${esc(j.number)}</b>${j.id === cur ? '<span class="bcur">IN HAND</span>' : ''}<span>${esc(j.name || '')}</span><i>${esc(j.status)} · ${n} open task${n === 1 ? '' : 's'}</i></button>`;
    }).join('') : '<div class="bhint">No jobs yet. Press + New job below.</div>';
    $('#bdJobs').innerHTML = list;
    const j = jobOf(sel);
    if (sel === '__new') { newJobForm(); return; }
    $('#bdMain').innerHTML = j ? jobPage(j) : overview();
    wireMain(j);
  }

  // a new job without leaving the whiteboard
  async function newJobForm() {
    let D = { nextNumber: '', saved: '', guess: '' }; try { D = await api.mail.defaults(); } catch {}
    let parent = D.saved || D.guess || '';
    const m = $('#bdMain');
    m.innerHTML = `<div class="bhead"><div><h2>New job</h2><div class="bsub">The job number is X + today's date unless you change it.</div></div></div>
      <div class="bnew">
        <label>Job number</label><input id="njNo" value="${esc(D.nextNumber || '')}">
        <label>Job name / site</label><input id="njName" placeholder="e.g. Eakring Training Centre">
        <label>Client</label><input id="njClient" placeholder="e.g. National Grid">
        <label>Project folder</label>
        <label class="bopt"><input type="radio" name="njMode" value="create" checked> Make a new folder from the Atomax template in <b id="njParent">${esc(parent || '(choose where your job folders live)')}</b> <button id="njParentPick" type="button">Change…</button></label>
        <label class="bopt"><input type="radio" name="njMode" value="link"> Use a folder I already have <button id="njLinkPick" type="button">Choose…</button> <span id="njLink" class="bsub"></span></label>
        <label class="bopt"><input type="radio" name="njMode" value="none"> No folder yet</label>
        <div class="brow"><button class="bprim" id="njSave">Create job</button><button id="njCancel">Cancel</button></div>
        <div id="njMsg" class="bsub"></div>
      </div>`;
    let link = '';
    $('#njParentPick').onclick = async () => { const f = await api.mail.pickParent(); if (f) { parent = f; $('#njParent').textContent = f; } };
    $('#njLinkPick').onclick = async () => { const f = await api.biz.pickFolder(); if (f) { link = f; $('#njLink').textContent = f; m.querySelector('input[value="link"]').checked = true; } };
    $('#njCancel').onclick = () => { sel = ''; render(); };
    $('#njSave').onclick = async () => {
      const mode = m.querySelector('input[name="njMode"]:checked').value;
      $('#njMsg').textContent = mode === 'create' ? 'Making the folder…' : 'Saving…';
      try {
        const r = await api.mail.newJob({ number: $('#njNo').value, name: $('#njName').value, client: $('#njClient').value, mode, folder: mode === 'create' ? parent : link });
        V = await api.biz.get(); sel = r.id; msg = r.folder ? 'Job created. Folder: ' + r.folder : 'Job created.'; render(); pushToBoard();
      } catch (e) { $('#njMsg').textContent = e.message; }
    };
  }

  function overview() {
    const rows = V.audit.filter(a => !/^Task /.test(a.action)).slice(0, 14);
    return `<div class="bhint">Pick a job on the left to see its notes, set tasks for the agents and see who has worked on it.</div><h3>Latest work, all jobs</h3>${rows.length ? rows.map(a => actRow(a, true)).join('') : '<div class="bhint">Nothing yet.</div>'}`;
  }

  const actRow = (a, withJob) => { const jj = withJob && jobOf(a.jobId); return `<div class="bact"><i style="background:${agentColour(a.who)}"></i><div><b>${esc(a.who)}</b> ${esc(a.action)}${jj ? ' · ' + esc(jj.number) : ''}<div class="bsub">${esc(String(a.detail || '').slice(0, 160))} <span>${ago(a.at)}</span></div></div></div>`; };

  function taskCard(t, i) {
    const col = agentColour(t.agentName);
    return `<div class="bt" style="--c:${NOTE_COLOURS[i % NOTE_COLOURS.length]}" data-t="${t.id}"><div class="bt-h"><b>${esc(t.title)}</b></div>${t.detail ? `<div class="bsub">${esc(t.detail.slice(0, 220))}</div>` : ''}
      <div class="bt-a">${t.agentName ? `<span class="chipA"><i style="background:${col}"></i>${esc(t.agentName)}</span>` : '<span class="chipA">Anyone</span>'}</div>
      ${t.lastActivity ? `<div class="bsub">${esc(t.lastActivity)}</div>` : ''}${t.note ? `<div class="bsub">Note: ${esc(t.note)}</div>` : ''}
      <div class="bt-b">${t.status !== 'done' ? `<button data-act="open" data-id="${t.id}">${t.agentName ? 'Open with ' + esc(t.agentName) : 'Start'}</button>` : ''}
        ${t.status === 'todo' ? `<button data-act="doing" data-id="${t.id}">Mark doing</button>` : ''}${t.status !== 'done' ? `<button data-act="done" data-id="${t.id}">Done</button>` : `<button data-act="todo" data-id="${t.id}">Reopen</button>`}<button data-act="del" data-id="${t.id}" title="Delete">×</button></div></div>`;
  }

  function jobPage(j) {
    const t = tasksOf(j.id), s = j.summary || {}, agents = (getAgents() || []).filter(a => a.enabled);
    const col = (st, label) => `<div class="bcol"><h4>${label} <span>${t.filter(x => x.status === st).length}</span></h4>${t.filter(x => x.status === st).map(taskCard).join('') || '<div class="bsub">—</div>'}</div>`;
    const acts = V.audit.filter(a => a.jobId === j.id).slice(0, 18);
    const who = {}; V.audit.filter(a => a.jobId === j.id && !/^Task /.test(a.action)).forEach(a => { who[a.who] = (who[a.who] || 0) + 1; });
    return `<div class="bhead"><div><h2>${esc(j.number)} ${esc(j.name || '')}</h2><div class="bsub">${esc(j.client || 'No client')} · ${esc(j.status)}${j.dueDate ? ' · due ' + esc(j.dueDate) : ''}${s.budget ? ` · hours ${s.used} of ${s.budget}` : ''} · ${s.live ?? 0} live drawing${s.live === 1 ? '' : 's'}</div></div>
      <div class="brow"><button class="${j.id === cur ? 'bon' : 'bprim'}" id="bdCur">${j.id === cur ? '✓ Job in hand (all bots know it)' : 'Work on this job'}</button><button id="bdEdit">Edit details</button></div></div>
      <div class="bfolder"><label>Project folder <span class="bsub">(the agents read this folder and write their files into it)</span></label><div id="bdFolderBody" class="bsub">Checking…</div></div>
      <div id="bdDesk"></div>
      <label>Context for the bots <span class="bsub">(what they should know: scope, client wishes, standards, anything unusual)</span></label>
      <textarea id="bdNotes" rows="4" placeholder="e.g. Existing substation, metric, 275 kV. The new rail is the one behind the tank. Client wants everything in grey.">${esc(j.notes || '')}</textarea>
      <div class="brow"><button id="bdSaveNotes">Save context</button><span class="bsub" id="bdMsg">${esc(msg)}</span></div>
      <h3>Tasks</h3>
      <div class="bnew"><input id="bdTitle" placeholder="Set a task, e.g. Add the pipe run behind the rail" /><select id="bdAgent"><option value="">Anyone</option>${agents.map(a => `<option value="${a.id}" data-name="${esc(a.name)}">${esc(a.name)} · ${esc(a.platform)}</option>`).join('')}</select><button id="bdAdd" class="bprim">Add</button></div>
      <textarea id="bdDetail" rows="2" placeholder="Details for the agent (optional)"></textarea>
      <div class="bcols">${col('todo', 'To do')}${col('doing', 'Doing')}${col('done', 'Done')}</div>
      <h3>Who has been working on this</h3>
      <div class="bchips">${Object.entries(who).map(([n, c]) => `<span class="chipA"><i style="background:${agentColour(n)}"></i>${esc(n)} · ${c}</span>`).join('') || '<span class="bsub">Nobody yet.</span>'}</div>
      ${acts.map(a => actRow(a, false)).join('')}`;
  }

  // the job's real folder: show it, find it, choose it, read it again
  async function renderFolder(j) {
    const box = $('#bdFolderBody'); if (!box) return;
    let info; try { info = await api.proj.info({ jobId: j.id }); } catch (e) { box.textContent = e.message; return; }
    const counts = info.read ? Object.entries(info.read.counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => n + ' ' + k).join(', ') : '';
    box.innerHTML = info.folder
      ? `<div class="bpath">${esc(info.folder)}</div><div>${info.read ? `${info.read.files} files (${esc(counts)}), ${info.read.extracts} read for context · read ${ago(info.read.at)}` : 'Not read yet'}</div>
         <div class="brow"><button id="bdRead">Read folder again</button><button id="bdOpenF">Open folder</button><button id="bdFind">Find another</button><button id="bdPick">Choose…</button></div><div id="bdSug"></div>`
      : `<div>Not linked yet. The agents will read this folder for context and save their work into it.</div><div class="brow"><button class="bprim" id="bdFind">Find the folder</button><button id="bdPick">Choose…</button></div><div id="bdSug"></div>`;
    const set = async (folder) => { box.querySelector('#bdSug').textContent = 'Reading the folder…'; try { await api.proj.setFolder({ jobId: j.id, folder }); msg = 'Folder linked and read.'; await renderFolder(j); } catch (e) { box.querySelector('#bdSug').textContent = e.message; } };
    box.querySelector('#bdFind').addEventListener('click', async () => {
      const sug = box.querySelector('#bdSug'); sug.textContent = 'Looking through your folders…';
      try {
        const list = await api.proj.suggest({ jobId: j.id });
        sug.innerHTML = list.length ? list.map((x, i) => `<div class="bsugg"><span><b>${esc(x.name)}</b><br><span class="bsub">${esc(x.path)} · matched ${esc(x.why)}</span></span><button data-use="${i}">Use this</button></div>`).join('') : 'Nothing found by job number or name. Use Choose… to pick it.';
        sug.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => set(list[+b.dataset.use].path)));
      } catch (e) { sug.textContent = e.message; }
    });
    box.querySelector('#bdPick').addEventListener('click', async () => { const p = await api.proj.pick(); if (p) set(p); });
    const rd = box.querySelector('#bdRead'); if (rd) rd.addEventListener('click', async () => { box.querySelector('#bdSug').textContent = 'Reading…'; try { await api.proj.gather({ jobId: j.id }); await renderFolder(j); } catch (e) { box.querySelector('#bdSug').textContent = e.message; } });
    const op = box.querySelector('#bdOpenF'); if (op) op.addEventListener('click', () => api.proj.open({ jobId: j.id }));
  }

  function wireMain(j) {
    const m = $('#bdMain');
    if (!j) return;
    renderFolder(j);
    renderJobDesk(api, $('#bdDesk'), j, { getAgents });
    $('#bdCur').addEventListener('click', async () => { cur = j.id; await api.biz.setCurrent({ id: j.id }); render(); pushToBoard(); });
    $('#bdEdit').addEventListener('click', () => openBusiness());
    $('#bdSaveNotes').addEventListener('click', async () => {
      try { const job = { ...j, notes: $('#bdNotes').value }; delete job.summary; V = await api.biz.jobSave({ job }); msg = 'Saved'; render(); } catch (e) { $('#bdMsg').textContent = e.message; }
    });
    $('#bdAdd').addEventListener('click', async () => {
      const title = $('#bdTitle').value.trim(); if (!title) { $('#bdTitle').focus(); return; }
      const opt = $('#bdAgent').selectedOptions[0];
      try { V = await api.biz.taskSave({ task: { jobId: j.id, title, detail: $('#bdDetail').value, agentId: $('#bdAgent').value, agentName: opt && opt.dataset.name || '' } }); msg = ''; render(); pushToBoard(); } catch (e) { $('#bdMsg').textContent = e.message; }
    });
    m.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
      const t = V.tasks.find(x => x.id === b.dataset.id); if (!t) return; const act = b.dataset.act;
      try {
        if (act === 'del') V = await api.biz.taskDelete({ id: t.id });
        else if (act === 'open') {
          cur = t.jobId; await api.biz.setCurrent({ id: t.jobId });
          V = await api.biz.taskSave({ task: { ...t, status: 'doing' } });
          pushToBoard(); openAgent(t, jobOf(t.jobId)); return;
        } else V = await api.biz.taskSave({ task: { ...t, status: act } });
        render(); pushToBoard();
      } catch (e) { msg = e.message; render(); }
    }));
  }

  panel.addEventListener('click', (e) => { const b = e.target.closest('button[data-job]'); if (b) { sel = b.dataset.job; msg = ''; render(); } });
  $('#bdBack').addEventListener('click', () => goBack());
  $('#bdNew').addEventListener('click', () => { sel = '__new'; msg = ''; render(); });

  return {
    async show() { panel.classList.add('open'); try { await refresh(); } catch (e) { $('#bdMain').innerHTML = '<div class="bhint">' + esc(e.message) + '</div>'; } },
    hide() { panel.classList.remove('open'); },
    refresh, pushToBoard,
    selectJob(id) { sel = id; render(); },
    renderFolder,
    _state: () => ({ sel, cur, tasks: V ? V.tasks.length : 0, jobs: V ? V.jobs.length : 0 })
  };
}
