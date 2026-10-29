// Eli's panel at reception: drop an email, see what it asks for, say "Yes, start" per task (job + project folder), and the right agent gets going.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAMES = { dex: 'Dex · DXF maker', engineer: 'Ada · engineer', documents: 'Dot · documents', cal: 'Cal · drawing checker', milo: 'Milo · 3D modeller', theo: 'Theo · 3D builder', eli: 'Eli · job + folder setup', none: 'You (Tom)' };
const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function initMailUI({ api, office, getAgents, onStart, goBack }) {
  const panel = $('#mailPanel');
  let emails = [], cur = null, staged = [], startOpen = -1, jobs = [];
  const eli = () => (getAgents() || []).find(a => a.role === 'email' && a.enabled);
  const colourOf = (id) => ((getAgents() || []).find(a => a.id === id) || {}).colour || '#868e96';

  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, mime: f.type, base64: String(r.result).split(',')[1] || '' }); r.onerror = rej; r.readAsDataURL(f); });
  async function stage(list) { staged = [...staged, ...[...(list || [])]]; $('#mlDrop').querySelector('b').textContent = staged.length ? staged.map(f => f.name).join(', ') : 'Drop an email here'; }
  $('#mlDrop').addEventListener('click', () => $('#mlFile').click());
  $('#mlFile').addEventListener('change', (e) => stage(e.target.files));
  $('#mlDrop').addEventListener('dragover', (e) => { e.preventDefault(); $('#mlDrop').classList.add('over'); });
  $('#mlDrop').addEventListener('dragleave', () => $('#mlDrop').classList.remove('over'));
  $('#mlDrop').addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); $('#mlDrop').classList.remove('over'); stage(e.dataTransfer.files); });

  async function read() {
    const text = $('#mlPaste').value;
    if (!staged.length && !text.trim()) { $('#mlErr').textContent = 'Drop an email or paste its text first.'; return; }
    $('#mlErr').textContent = ''; $('#mlRead').disabled = true; $('#mlRead').textContent = 'Eli is reading it…';
    const a = eli(); if (a) office.setState(a.id, 'working', 'reading an email');
    try {
      const files = await Promise.all(staged.map(readFile));
      cur = await api.mail.read({ files, text });
      staged = []; $('#mlPaste').value = ''; $('#mlDrop').querySelector('b').textContent = 'Drop an email here';
      startOpen = -1; await refreshList(); render();
      if (a) office.setState(a.id, 'done', cur.asks.length + ' task' + (cur.asks.length === 1 ? '' : 's') + ' found');
    } catch (e) { $('#mlErr').textContent = clean(e); if (a) office.setState(a.id, 'idle'); }
    finally { $('#mlRead').disabled = false; $('#mlRead').textContent = 'Read it'; }
  }
  $('#mlRead').addEventListener('click', read);

  async function refreshList() {
    emails = await api.mail.list();
    $('#mlList').innerHTML = emails.map(e => { const open = e.asks.filter(a => a.status === 'proposed').length; return `<button class="mlitem ${cur && cur.id === e.id ? 'on' : ''}" data-id="${e.id}"><b>${esc(e.subject || e.summary || 'Email')}</b><i>${esc(e.from || '')} · ${open ? open + ' waiting for you' : 'all handled'}</i></button>`; }).join('') || '<div style="font-size:12.5px;color:#868e96;margin-top:6px">Nothing yet.</div>';
    $('#mlList').querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => { cur = emails.find(x => x.id === b.dataset.id); startOpen = -1; refreshList(); render(); }));
  }

  function render() {
    const m = $('#mlMain');
    if (!cur) { m.innerHTML = '<div class="bhint">Drop an email on the left. Eli works out what it asks for and who should do it. Nothing starts until you say yes.</div>'; return; }
    const e = cur;
    m.innerHTML = `<div class="mlhead"><h3>${esc(e.subject || 'Email')}</h3><div class="bsub">${esc(e.from)}${e.date ? ' · ' + esc(e.date) : ''}${e.site ? ' · site: ' + esc(e.site) : ''}${e.jobNumber ? ' · job ' + esc(e.jobNumber) : ''}</div></div>
      <div class="mlsum">${esc(e.summary)}</div>
      <div style="font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:#868e96;margin-top:12px">What it asks for</div>
      ${e.asks.length ? e.asks.map((a, i) => askCard(a, i)).join('') : '<div class="bhint">Eli found nothing to do in this one.</div>'}
      ${e.reply ? `<div class="mlreply"><b>Suggested reply</b><pre>${esc(e.reply)}</pre><button id="mlCopy">Copy reply</button> <button id="mlOpenE">Open the email files</button></div>` : ''}`;
    m.querySelectorAll('[data-yes]').forEach(b => b.addEventListener('click', () => { startOpen = +b.dataset.yes; render(); fillStart(+b.dataset.yes); }));
    m.querySelectorAll('[data-give]').forEach(s => s.addEventListener('change', async () => { cur = await api.mail.reassign({ id: e.id, ask: +s.dataset.give, agent: s.value }); if (startOpen === +s.dataset.give) startOpen = -1; render(); }));
    m.querySelectorAll('[data-no]').forEach(b => b.addEventListener('click', async () => { cur = await api.mail.decline({ id: e.id, ask: +b.dataset.no }); refreshList(); render(); }));
    m.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => api.showItem(b.dataset.show)));
    const cp = $('#mlCopy'); if (cp) cp.onclick = () => { navigator.clipboard.writeText(e.reply).catch(() => {}); cp.textContent = 'Copied'; };
    const oe = $('#mlOpenE'); if (oe) oe.onclick = () => api.mail.open({ id: e.id });
  }
  function askCard(a, i) {
    const who = a.status === 'proposed'
      ? `<label class="mlgive">Give to <select data-give="${i}">${Object.entries(NAMES).map(([k, v]) => `<option value="${k}" ${k === a.agent ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`
      : `<span class="chipA"><i style="background:${colourOf(a.agent)}"></i>${esc(NAMES[a.agent] || a.agent)}</span>`;
    const state = a.status === 'done' ? '<span class="bsub">✓ Done</span>' : a.status === 'running' ? '<span class="bsub">Working on it…</span>' : a.status === 'started' ? '<span class="bsub">✓ Started</span>' : a.status === 'declined' ? '<span class="bsub">Not now</span>' : `<div class="mlrow"><button class="bprim" data-yes="${i}">Yes, start</button><button data-no="${i}">Not now</button></div>`;
    return `<div class="mlask ${a.status}"><div class="mt"><div><b>${esc(a.title)}</b><div style="margin-top:4px">${who}${a.due ? ' <span class="bsub">due ' + esc(a.due) + '</span>' : ''}</div></div>${state}</div><div class="md">${esc(a.detail)}</div>${a.result ? `<div class="mlres"><b>${a.agent === 'engineer' ? 'Ada\'s note' : 'Result'}</b><div>${esc(a.result.summary)}</div>${a.result.path ? `<button data-show="${esc(a.result.path)}">${a.agent === 'engineer' ? 'Show the note' : 'Open the folder'}</button>` : ''}${a.result.text ? `<details><summary>Read it here</summary><pre>${esc(a.result.text)}</pre></details>` : ''}</div>` : ''}${a.error ? `<div class="err" style="color:#e03131;font-size:12.5px">${esc(a.error)}</div>` : ''}${startOpen === i && a.status === 'proposed' ? `<div class="mlstart" id="mlStart"></div>` : ''}</div>`;
  }

  // Yes, start: pick the job (Eli's best match first, or a new one), find its folder, then go
  async function fillStart(i) {
    const box = $('#mlStart'), e = cur, a = e.asks[i];
    const v = await api.biz.get(); jobs = v.jobs;
    const def = await api.mail.defaults().catch(() => ({ parent: '', nextNumber: '' }));
    let parent = def.parent;
    box.innerHTML = `<label><b>Job</b></label><select id="mlJob">${jobs.map(j => `<option value="${j.id}">${esc(j.number)} ${esc(j.name || '')}</option>`).join('')}<option value="__new">+ New job from this email</option></select>
      <div id="mlNew" hidden class="mlrow"><input id="mlNum" placeholder="Job number" value="${esc(e.jobNumber && !jobs.some(j => j.number.toLowerCase() === String(e.jobNumber).toLowerCase()) ? e.jobNumber : def.nextNumber)}" style="width:130px"><input id="mlName" placeholder="Job name / site" value="${esc(e.site || e.subject)}" style="flex:1"></div>
      <label><b>Project folder</b> <span class="bsub">(${a.agent === 'none' ? 'where the email is filed' : esc((NAMES[a.agent] || '').split(' ·')[0]) + ' reads from it and saves into it'})</span></label><div id="mlFolders" class="bsub">…</div>
      <div class="mlrow" style="margin-top:4px"><button class="bprim" id="mlGo">${a.agent === 'none' ? 'Add to the board' : 'Start ' + esc((NAMES[a.agent] || '').split(' ·')[0])}</button><button id="mlCancel">Cancel</button></div><div class="err" id="mlStartErr" style="color:#e03131;font-size:12.5px"></div>`;
    const sel = $('#mlJob'); sel.value = e.jobId && jobs.some(j => j.id === e.jobId) ? e.jobId : (jobs.length ? jobs[0].id : '__new');
    if (!jobs.length || (!e.jobId && e.jobNumber)) sel.value = jobs.some(j => j.number.toLowerCase() === String(e.jobNumber).toLowerCase()) ? jobs.find(j => j.number.toLowerCase() === String(e.jobNumber).toLowerCase()).id : '__new';
    let folder = '', create = false;
    const createRow = () => `<div class="mlsug"><input type="radio" name="mlf" value="create" ${create ? 'checked' : ''}><span><b>Create a new folder for this job</b><br>in ${esc(parent || '(pick where)')} <button id="mlParent" type="button">Change…</button></span></div>`;
    const wireCreate = (fb, list) => { fb.querySelectorAll('input[name=mlf]').forEach(r => r.addEventListener('change', () => { create = r.value === 'create'; if (!create && list && list[+r.value]) folder = list[+r.value].path; })); const pp = fb.querySelector('#mlParent'); if (pp) pp.onclick = async () => { const p = await api.mail.pickParent(); if (p) { parent = p; create = true; showFolders(); } }; };
    const showFolders = async () => {
      const fb = $('#mlFolders'), isNew = sel.value === '__new'; $('#mlNew').hidden = !isNew;
      const job = jobs.find(j => j.id === sel.value);
      if (job && job.folder) { folder = job.folder; create = false; fb.innerHTML = `<div class="mlsug"><input type="radio" name="mlf" checked><span>${esc(job.folder)} <i>(linked to this job)</i></span></div><button id="mlPick">Choose another…</button>`; }
      else {
        fb.textContent = 'Looking through your folders…';
        const list = await api.mail.folders({ id: e.id, jobId: isNew ? '' : sel.value }).catch(() => []);
        create = create || a.agent === 'eli' || !list.length;   // setting up a job, or nothing found: make a new folder
        folder = !create && list[0] ? list[0].path : '';
        fb.innerHTML = list.map((x, k) => `<div class="mlsug"><input type="radio" name="mlf" value="${k}" ${!create && k === 0 ? 'checked' : ''}><span><b>${esc(x.name)}</b><br>${esc(x.path)} · matched ${esc(x.why)}</span></div>`).join('') + (isNew ? createRow() : '') + '<button id="mlPick">Choose…</button>';
        wireCreate(fb, list);
      }
      $('#mlPick').onclick = async () => { const p = await api.proj.pick(); if (p) { folder = p; fb.innerHTML = `<div class="mlsug"><input type="radio" checked><span>${esc(p)}</span></div><button id="mlPick">Choose another…</button>`; $('#mlPick').onclick = () => showFolders(); } };
    };
    sel.addEventListener('change', showFolders); await showFolders();
    $('#mlCancel').onclick = () => { startOpen = -1; render(); };
    $('#mlGo').onclick = async () => {
      $('#mlStartErr').textContent = ''; $('#mlGo').disabled = true;
      try {
        const isNew = sel.value === '__new';
        const r = await api.mail.start({ id: e.id, ask: i, jobId: isNew ? '' : sel.value, newJob: isNew ? { number: $('#mlNum').value, name: $('#mlName').value } : null, folder: create ? '' : folder, createIn: create && isNew ? parent : '' });
        cur = r.email; startOpen = -1; await refreshList(); render();
        if (a.agent === 'engineer') {   // Ada works it straight away; the note lands in the job folder
          cur.asks[i].status = 'running'; render();
          try { cur = (await api.mail.engRun({ id: e.id, ask: i })).email; } catch (err) { cur.asks[i].status = 'started'; cur.asks[i].error = clean(err); }
          render();
        }
        onStart && onStart({ ask: a, email: cur, task: r.task, job: r.job });
      } catch (err) { $('#mlStartErr').textContent = clean(err); $('#mlGo').disabled = false; }
    };
  }
  $('#mailBack').addEventListener('click', () => goBack());

  return {
    async show() { panel.classList.add('open'); await refreshList().catch(() => {}); if (!cur && emails[0]) cur = emails[0]; render(); },
    hide() { panel.classList.remove('open'); },
    _state: () => ({ cur, staged: staged.length })
  };
}
