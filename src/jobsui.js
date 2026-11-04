// The Jobs screen: home for engineering work. Left: the jobs. Right: "Waiting on you" across every job, or one job's flow:
// Deliverables (each made by its agent, checked by Cal) · Inputs & setup · Comments (revisions) · Issue.
import { renderJobDesk, openDeskSection } from './jobdeskui.js';
import { renderSkillPicker } from './skillpicker.js';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const base = (p) => String(p || '').split(/[\\/]/).pop();

export function initJobsUI({ api, getAgents, openIssue, onWorkOn }) {
  const panel = $('#jobsPanel');
  let jobs = [], sel = '', tab = 'files', O = null, msg = '', busy = {}, poll = null;
  // the Jobs list IS the live Projects folder: nav = the folder being listed, selPath = the job folder open on the right
  let roots = [], nav = '', listing = null, selPath = '', listTimer = null; const openDirs = new Set();
  // live agent runs (stage, elapsed, estimate) keyed by job|drawing, from the main process; the row shows them and offers Stop
  const RUNS = new Map(); const runKey = (jobId, no) => `${jobId}|${no}`;
  const fmtT = (ms) => { const sec = Math.round(ms / 1000); return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const runText = (r) => { if (!r) return ''; const est = r.estimate ? ` · usually about ${fmtT(r.estimate)}` : ''; return `${r.stage} · ${fmtT(r.elapsed)}${est}`; };
  if (api.runs && api.runs.onProgress) api.runs.onProgress((p) => { const k = runKey(p.jobId, p.no); if (p.done) RUNS.delete(k); else RUNS.set(k, p); const el = document.querySelector(`[data-runrow="${CSS.escape(k)}"]`); if (el) el.innerHTML = runCell(p.jobId, p.no); if (p.done && panel.classList.contains('open') && !busyPanel()) setTimeout(refresh, 400); });
  setInterval(() => { for (const [k, r] of RUNS) { r.elapsed += 1000; const el = document.querySelector(`[data-runrow="${CSS.escape(k)}"]`); if (el) el.innerHTML = runCell(r.jobId, r.no); } }, 1000);
  const runCell = (jobId, no) => { const r = RUNS.get(runKey(jobId, no)); if (!r) return ''; return `<span class="jbrun"><i class="jbspin"></i>${esc(runText(r))}</span><button class="jbbtn jbstop" data-stop="${esc(no)}" title="Stop this run (nothing is saved)">Stop</button>`; };
  let query = '', found = null, searchT = null;   // the search box: a job by number, name or client across every Projects folder
  const toast = (t, k, o) => { try { window.toast && window.toast(t, k, o); } catch {} };
  // recently opened jobs (this PC), newest first
  const recents = () => { try { return JSON.parse(localStorage.getItem('amo.recentJobs') || '[]'); } catch { return []; } };
  const noteRecent = (p, name) => { if (!p) return; const r = recents().filter(x => x.path !== p); r.unshift({ path: p, name: name || base(p), at: Date.now() }); localStorage.setItem('amo.recentJobs', JSON.stringify(r.slice(0, 6))); };
  // the divider between the list and the job: dragged, remembered
  // full screen: remembered between sessions
  const setFull = (on) => { document.body.classList.toggle('jobs-full', on); const b = $('#jbFull'); if (b) { b.textContent = on ? '🗗' : '⛶'; b.title = on ? 'Exit full screen (F11)' : 'Full screen (F11)'; }  };
  if ($('#jbFull')) $('#jbFull').onclick = () => setFull(!document.body.classList.contains('jobs-full'));
  document.addEventListener('keydown', (e) => { if (e.key === 'F11' && panel.classList.contains('open')) { e.preventDefault(); setFull(!document.body.classList.contains('jobs-full')); } });
  const split = $('#jbSplit'); try { const w = +localStorage.getItem('amo.jbw'); if (w >= 200) panel.style.setProperty('--jbw', w + 'px'); } catch {}
  if (split) split.onmousedown = (e) => { e.preventDefault(); split.classList.add('on'); const x0 = e.clientX, w0 = $('#jbList').getBoundingClientRect().width;
    const mv = (ev) => { const w = Math.max(200, Math.min(560, w0 + ev.clientX - x0)); panel.style.setProperty('--jbw', w + 'px'); };
    const up = () => { split.classList.remove('on'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); try { localStorage.setItem('amo.jbw', String(Math.round($('#jbList').getBoundingClientRect().width))); } catch {} };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); };

  // while a Make / Revision panel is open (Tom choosing skills, typing initials) the page is not redrawn under him: the status
  // updates of other rows wait until he presses Start or Cancel
  const busyPanel = () => !!document.querySelector('.jbprep');
  async function refreshWhenFree() { while (busyPanel() && panel.classList.contains('open')) await new Promise(r => setTimeout(r, 800)); return refresh(); }
  async function refresh() {
    await relist();
    const v = await api.biz.get(); jobs = v.jobs.filter(j => j.status !== 'Closed');
    if (sel && !jobs.some(j => j.id === sel)) sel = '';
    renderList();
    if (!sel && selPath) { renderFolder(); return; }
    if (sel) { let O2 = null; try { O2 = await api.jobs.overview({ jobId: sel }); } catch (e) { msg = clean(e); }
      if (busyPanel()) { refreshWhenFree(); return; }   // a Make / Revision panel opened while this was fetching: redraw once it closes
      O = O2; renderJob(); } else renderHome();
  }
  // the folder being listed, read live (nothing cached, nothing renamed or hidden beyond what Explorer hides)
  async function relist() {
    try { roots = (await api.proj.roots()).roots || []; } catch { roots = []; }
    const inside = (p) => p && roots.some(r => p === r.path || p.startsWith(r.path.replace(/[\\/]+$/, '') + (r.path.includes('\\') ? '\\' : '/')));
    if (!inside(nav)) nav = roots.length === 1 ? roots[0].path : '';
    if (!nav) { listing = null; return; }
    try { listing = await api.proj.listAt({ path: nav }); } catch (e) { listing = { path: nav, name: base(nav), entries: [], error: clean(e) }; }
  }
  function crumbs() {
    if (!nav) return '';
    const r = roots.find(x => nav === x.path || nav.startsWith(x.path)); if (!r) return '';
    const sep = nav.includes('\\') ? '\\' : '/', rest = nav.slice(r.path.length).split(/[\\/]+/).filter(Boolean), out = [`<a href="#" data-nav="${esc(r.path)}">${esc(r.name)}</a>`];
    let acc = r.path.replace(/[\\/]+$/, ''); for (const part of rest) { acc += sep + part; out.push(`<a href="#" data-nav="${esc(acc)}">${esc(part)}</a>`); }
    return (roots.length > 1 ? '<a href="#" data-nav="">Projects</a> › ' : '') + out.join(' › ');
  }
  function renderList() {
    const head = `<div class="jbsearch"><input id="jbQ" type="search" placeholder="Find a job (number, name, client)" value="${esc(query)}" autocomplete="off">${query ? '<button class="x" id="jbQx" title="Clear">×</button>' : ''}</div><button class="jbnew" id="jbNew">+ New job</button><button class="jbnew mail" id="jbMail">✉ Email in</button><button class="jbj home ${!sel && !selPath ? 'on' : ''}" data-j="">Waiting on you</button>`;
    let body;
    const cloudDot = (e) => e.cloud ? '<i class="jbcloud" title="Online-only in OneDrive (not downloaded to this PC yet)"></i>' : '';
    const rec = recents().filter(r => roots.some(x => r.path === x.path || r.path.startsWith(x.path)));
    const recentHtml = !query && rec.length ? `<div class="jblabel">Recent</div>` + rec.map(r => `<button class="jbj recent ${selPath === r.path ? 'on' : ''}" data-dir="${esc(r.path)}" data-job="1" title="${esc(r.path)}"><b>${esc(r.name)}</b></button>`).join('') : '';
    if (query) body = `<div class="jblabel">${found === null ? 'Searching…' : found.length ? `${found.length} job${found.length === 1 ? '' : 's'}` : 'No job matches'}</div>` + (found || []).map(f => `<button class="jbj ${selPath === f.path ? 'on' : ''}" data-dir="${esc(f.path)}" data-job="1" title="${esc(f.path)}"><b>${esc(f.number)}${f.name ? ' · ' + esc(f.name) : ''}</b>${f.client ? `<span class="jbclient">${esc(f.client)}</span>` : ''}</button>`).join('');
    else if (!roots.length) body = `<div class="jblabel">Projects</div><div class="bsub" style="padding:6px 8px">Set your Projects folder (the live OneDrive one) to see your jobs here.</div><button class="jbnew" id="jbRoot">Set projects folder…</button>`;
    else if (!nav) body = recentHtml + `<div class="jblabel">Projects <a href="#" id="jbRoot" class="jbrootlink">add folder</a></div>` + roots.map(r => `<button class="jbj jbdir" data-go="${esc(r.path)}"><b>📁 ${esc(r.name)}</b><span class="bsub">${esc(r.path)}</span></button>`).join('');
    else body = recentHtml + `<div class="jblabel jbcrumbs">${crumbs()} <a href="#" id="jbRoot" class="jbrootlink">${roots.length ? 'add folder' : ''}</a></div>` + (listing && listing.error ? `<div class="bsub" style="padding:6px 8px">${esc(listing.error)}</div>` : '') +
      (listing && listing.entries.length ? listing.entries.map(e => e.dir
        ? `<button class="jbj jbdir ${selPath === e.path ? 'on' : ''}" data-dir="${esc(e.path)}" data-job="${e.isJob || e.job ? 1 : ''}" title="${esc(e.path)}"><b>📁 ${esc(e.name)}${cloudDot(e)}</b>${e.job ? '<span class="bsub">set up for drawings</span>' : ''}</button>`
        : `<button class="jbj jbfile" data-file="${esc(e.path)}" title="Open ${esc(e.name)}"><span>${fIcon(e.name)} ${esc(e.name)}${cloudDot(e)}</span></button>`).join('') : (listing && !listing.error ? '<div class="bsub" style="padding:6px 8px">Empty folder</div>' : ''));
    $('#jbList').innerHTML = head + body;
    const L = $('#jbList');
    L.querySelector('[data-j=""]').onclick = () => { sel = ''; selPath = ''; tab = 'deliv'; msg = ''; refresh(); };
    // a job folder opens on the right; any other folder (a year, a client) opens in the list, like Explorer
    L.querySelectorAll('[data-dir]').forEach(b => b.onclick = async () => {
      const p = b.dataset.dir;
      if (!b.dataset.job) { nav = p; await relist(); renderList(); return; }
      selPath = p; tab = 'files'; msg = ''; openDirs.clear(); noteRecent(p, (b.querySelector('b') || {}).textContent.replace(/^📁\s*/, '').trim());
      try { const r = await api.proj.recordAt({ path: p }); sel = r ? r.id : ''; } catch { sel = ''; }
      refresh();
    });
    L.querySelectorAll('[data-dir][data-job="1"]').forEach(b => b.ondblclick = async () => { nav = b.dataset.dir; await relist(); renderList(); });
    L.querySelectorAll('[data-go]').forEach(b => b.onclick = async () => { nav = b.dataset.go; await relist(); renderList(); });
    L.querySelectorAll('[data-nav]').forEach(a => a.onclick = async (e) => { e.preventDefault(); nav = a.dataset.nav; await relist(); renderList(); });
    L.querySelectorAll('[data-file]').forEach(b => b.onclick = () => api.proj.openAt({ path: b.dataset.file }).catch(err => { msg = clean(err); }));
    L.querySelectorAll('[data-j]').forEach(b => { if (b.dataset.j) b.onclick = () => { sel = b.dataset.j; selPath = ''; tab = 'files'; msg = ''; openDirs.clear(); refresh(); }; });
    const pick = async (e) => { if (e) e.preventDefault(); const f = await api.proj.pick(); if (!f) return; try { const st = await api.settings.get(); await api.settings.set({ projectRoots: [...new Set([...(st.projectRoots || []), f])] }); } catch (err) { msg = clean(err); } nav = f; refresh(); };
    if ($('#jbRoot')) $('#jbRoot').onclick = pick;
    $('#jbNew').onclick = newJob;
    $('#jbMail').onclick = () => { sel = ''; selPath = ''; renderList(); emailPanel(''); };
    const q = $('#jbQ'); q.oninput = () => { query = q.value.trim(); clearTimeout(searchT); if (!query) { found = null; renderList(); return; } found = null; searchT = setTimeout(async () => { try { found = await api.proj.search({ q: query }); } catch { found = []; } if (q.value.trim() === query) { const at = q.selectionStart; renderList(); const q2 = $('#jbQ'); q2.focus(); q2.setSelectionRange(at, at); } }, 250); };
    q.onkeydown = (e) => { if (e.key === 'Escape') { query = ''; found = null; renderList(); } if (e.key === 'Enter' && found && found[0]) L.querySelector('[data-dir]').click(); };
    if ($('#jbQx')) $('#jbQx').onclick = () => { query = ''; found = null; renderList(); $('#jbQ').focus(); };
  }
  // ---------- home: everything that needs Tom ----------
  async function renderHome() {
    const m = $('#jbMain'); m.innerHTML = '<div class="bhint">Looking…</div>';
    let W = []; try { W = await api.jobs.waiting(); } catch (e) { m.innerHTML = `<div class="bhint">${esc(clean(e))}</div>`; return; }
    const icon = { master: '☑', questions: '?', failed: '!', check: '⚑', rfi: '✉', comments: '✎', folder: '📁' };
    m.innerHTML = `<div class="jbhead"><div><h2>Waiting on you</h2><div class="bsub">Everything across your jobs that needs you. Click one to go to it.</div></div></div>
      ${W.length ? `<div class="jbwait">${W.map((w, i) => `<button class="jbw k-${w.kind}" data-i="${i}"><span class="ic">${icon[w.kind] || '•'}</span><span><b>${esc(w.text)}</b><i>${esc(w.job)}</i></span></button>`).join('')}</div>` : `<div class="jbempty"><b>Nothing waiting on you.</b><span>${jobs.length ? 'Pick a job on the left to see its deliverables, or start a new one.' : 'Start with + New job on the left.'}</span></div>`}`;
    m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const w = W[+b.dataset.i]; sel = w.jobId; tab = { master: 'setup', rfi: 'setup', folder: 'setup', comments: 'comments' }[w.kind] || 'deliv'; if (w.kind === 'master') { openDeskSection('master'); refresh().then(goMaster); } else refresh(); });
  }

  // ---------- one job ----------
  function renderJob() {
    const m = $('#jbMain'); if (!O) { m.innerHTML = `<div class="bhint">${esc(msg)}</div>`; return; }
    const j = O.job, V = O.desk, rows = O.rows;
    const openC = (V.crs || []).filter(c => !/responded|closed/i.test(c.status || '')).length;
    const tabs = [['files', 'Files'], ['deliv', `Deliverables <em>${rows.length}</em>`], ['setup', 'Inputs &amp; setup'], ['comments', `Comments${openC ? ` <em>${openC}</em>` : ''}`], ['issue', 'Issue']];
    m.innerHTML = `<div class="jbhead"><div><h2>${esc(j.number)} ${esc(j.name || '')}</h2><div class="bsub">${esc(j.client || 'No client')} · border: ${esc(V.borderUsed || '')}${j.folder ? ` · <a href="#" id="jbFolder">open folder</a>` : ' · <b class="warn">no folder linked</b>'}</div></div>
        <div class="jbbar" style="margin:0"><button class="jbbtn primary" id="jbAddMail">✉ Add email / changes</button><button class="jbbtn" id="jbWork">Work on this job</button></div></div>
      <div class="jbtabs">${tabs.map(([k, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${msg ? `<div class="jbmsg">${esc(msg)}</div>` : ''}
      <div id="jbTab"></div>`;
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; msg = ''; refresh(); });
    if ($('#jbFolder')) $('#jbFolder').onclick = (e) => { e.preventDefault(); api.proj.open({ jobId: j.id }).catch(() => api.showItem(j.folder)); };
    $('#jbAddMail').onclick = () => emailPanel(j.id);
    $('#jbWork').onclick = async () => { await api.biz.setCurrent({ id: j.id }); if (onWorkOn) onWorkOn(j.id); $('#jbWork').textContent = '✓ Job in hand'; };
    ({ files: tabFiles, deliv: tabDeliv, setup: tabSetup, comments: tabComments, issue: tabIssue })[tab]();
    const working = rows.some(r => r.work && (r.work.status === 'working' || (r.work.check && r.work.check.status === 'working')));
    clearTimeout(poll); if (working && panel.classList.contains('open')) poll = setTimeout(refreshWhenFree, 3000);
  }

  // ---------- the job's real folder: the Atomax template layout as it is on OneDrive, opened folder by folder ----------
  const fIcon = (n) => /\.pdf$/i.test(n) ? '📄' : /\.(dwg|dxf|dwt)$/i.test(n) ? '📐' : /\.(xlsx?|xlsm|csv)$/i.test(n) ? '📊' : /\.(docx?|rtf)$/i.test(n) ? '📝' : /\.(msg|eml)$/i.test(n) ? '✉' : /\.(png|jpe?g|gif|bmp|tif)$/i.test(n) ? '🖼' : '📄';
  const fSize = (b) => !b ? '' : b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  const fDate = (t) => { if (!t) return ''; const d = new Date(t); return [d.getDate(), d.getMonth() + 1, d.getFullYear() % 100].map(v => String(v).padStart(2, '0')).join('.'); };
  // the job folder, live: inside the Projects folders it is read by path; an older job's folder elsewhere by the job
  async function tabFiles(folder = O && O.job && O.job.folder, jobId = O && O.job && O.job.id) {
    const el = $('#jbTab');
    if (!folder) { el.innerHTML = `<div class="jbempty"><b>No project folder for this job.</b><span>Pick its folder in your Projects folder.</span><button class="jbbtn primary" id="jftPick">Choose the folder…</button></div>`; $('#jftPick').onclick = async () => { const f = await api.proj.pick(); if (f) { await api.proj.setFolder({ jobId, folder: f }); refresh(); } }; return; }
    el.innerHTML = `<div class="jbcard jft"><div class="jft-top"><b>${esc(base(folder))}</b><span class="bsub">${esc(folder)}</span><button class="jbbtn" id="jftRe" title="Read the folder again">↻</button><button class="jbbtn" id="jftOpen">Open in Explorer</button></div><div id="jftRoot" class="jft-list"><div class="bsub">Reading the folder…</div></div></div>`;
    $('#jftOpen').onclick = () => api.proj.openAt({ path: folder }).catch(() => jobId && api.proj.open({ jobId }));
    $('#jftRe').onclick = () => tabFiles(folder, jobId);
    let byPath = true; try { await api.proj.listAt({ path: folder }); } catch { byPath = false; }
    await fillDir($('#jftRoot'), { folder, jobId, byPath }, '');
  }
  const joinP = (a, b) => !b ? a : a.replace(/[\\/]+$/, '') + (a.includes('\\') ? '\\' : '/') + b;
  async function fillDir(box, ctx, rel) {
    let ents;
    try {
      if (ctx.byPath) { const r = await api.proj.listAt({ path: joinP(ctx.folder, rel) }); ents = r.entries.map(e => ({ ...e, rel: e.path.slice(ctx.folder.replace(/[\\/]+$/, '').length + 1) })); }
      else { const r = await api.proj.tree({ jobId: ctx.jobId, rel }); ents = r.entries.map(e => ({ ...e, path: joinP(ctx.folder, e.rel) })); }
    } catch (e) { box.innerHTML = `<div class="bsub">${esc(clean(e))}</div>`; return; }
    if (!ents.length) { box.innerHTML = '<div class="bsub jft-empty">Empty</div>'; return; }
    box.innerHTML = ents.map(e => e.dir
      ? `<details class="jft-dir" data-rel="${esc(e.rel)}" data-path="${esc(e.path)}"><summary><span class="ic">📁</span><span class="nm">${esc(e.name)}</span><i></i></summary><div class="jft-kids"></div></details>`
      : `<div class="jft-file" data-rel="${esc(e.rel)}" data-path="${esc(e.path)}" title="Open ${esc(e.name)}"><span class="ic">${fIcon(e.name)}</span><span class="nm">${esc(e.name)}</span><i>${fDate(e.mtime)}</i><i>${fSize(e.size)}</i><button class="jbbtn sm" data-show="1" title="Show it in Explorer">Show</button></div>`).join('');
    box.querySelectorAll(':scope > details').forEach(d => {
      d.addEventListener('toggle', () => { if (d.open) { openDirs.add(d.dataset.path); if (!d.dataset.loaded) { d.dataset.loaded = '1'; fillDir(d.querySelector('.jft-kids'), ctx, d.dataset.rel); } } else openDirs.delete(d.dataset.path); });
      if (openDirs.has(d.dataset.path)) d.open = true;   // folders Tom opened stay open when the page refreshes
    });
    box.querySelectorAll(':scope > .jft-file').forEach(f => { f.onclick = (ev) => { const show = !!ev.target.closest('[data-show]'); (ctx.byPath ? api.proj.openAt({ path: f.dataset.path, show }) : api.proj.openFile({ jobId: ctx.jobId, rel: f.dataset.rel, show })).catch(err => { msg = clean(err); }); }; });
  }
  // a job folder not yet set up for drawings: its files straight away; Deliverables, Inputs, Comments or Issue set it up there and then
  function renderFolder() {
    const m = $('#jbMain'), name = base(selPath);
    m.innerHTML = `<div class="jbhead"><div><h2>${esc(name)}</h2><div class="bsub">${esc(selPath)}</div></div></div>
      <div class="jbtabs">${[['files', 'Files'], ['deliv', 'Deliverables'], ['setup', 'Inputs & setup'], ['comments', 'Comments'], ['issue', 'Issue']].map(([k, l]) => `<button data-t="${k}" class="${k === 'files' ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${msg ? `<div class="jbmsg">${esc(msg)}</div>` : ''}<div id="jbTab"></div>`;
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => {
      if (b.dataset.t === 'files') return;
      try { const r = await api.proj.adopt({ path: selPath }); sel = r.id; tab = b.dataset.t; msg = ''; refresh(); } catch (e) { msg = clean(e); renderFolder(); }
    });
    tabFiles(selPath, '');
  }
  const chip = (w) => { if (!w) return '<span class="st st-todo">To do</span>'; const s = w.status; return `<span class="st st-${s.replace(/\s+/g, '')}">${{ working: 'Working…', made: 'Made', 'needs you': 'Needs you', failed: 'Failed', stopped: 'Stopped', issued: 'Issued' }[s] || esc(s)}</span>`; };
  const files = (w) => w && w.files ? [...w.files, ...(w.pdfs || [])].map(p => `<button class="jbfile" data-open="${esc(p)}" title="${esc(p)}">${esc(base(p).replace(/^.*\./, '').toUpperCase())}</button>`).join('') : '';

  function tabDeliv() {
    const rows = O.rows, V = O.desk, el = $('#jbTab');
    const masterOk = !O.needsMaster || (V.master && V.master.status === 'approved');
    const made = rows.filter(r => r.work && r.work.files && r.agent === 'Dex').length;
    el.innerHTML = `${!rows.length ? `<div class="jbempty"><b>No deliverables on this job yet.</b><span>Check or make the drawing register in Inputs &amp; setup, or forward the client's email to Eli: he lists what the job needs.</span></div>` : ''}
      ${O.needsMaster && !masterOk && V.master ? `<div class="jbbanner"><span><b>Master list built: ${V.master.devices} devices, ${V.master.cables} cables${(V.master.gaps || []).length ? `, ${V.master.gaps.length} gaps` : ''}.</b> Approve it and the BCDs and schedule can be made.</span><span class="jbbar" style="margin:0"><button class="jbbtn" id="jbToMaster">Review it</button><button class="jbbtn primary" id="jbApprove">✓ Approve it</button></span></div>` : ''}
      ${O.needsMaster && !masterOk && !V.master ? `<div class="jbbanner">BCDs and schedules are made from the master device list. <button class="jbbtn" id="jbToMaster">${V.master ? 'Check and approve it' : 'Build it'}</button></div>` : ''}
      ${rows.length ? `<div class="jbbar"><button class="jbbtn primary" id="jbAll" ${rows.some(r => r.agent && !r.work && (masterOk || !['bcd', 'schedule'].includes(r.kind))) ? '' : 'disabled'}>Make everything not made yet</button><button class="jbbtn" id="jbCheck" ${made ? '' : 'disabled'}>Cal: check the drawings</button><span class="bsub">Each row: the agent makes it, Cal checks it, then it goes in the issue pack.</span></div>` : ''}
      <div class="jbrows">${rows.map(r => { const w = r.work;
        return `<div class="jbrow">
          <div class="c1"><b>${esc(r.num)}</b><span>${esc(r.ctitle)}</span>${w && w.summary && w.status !== 'made' && w.status !== 'working' ? `<i>${esc(w.summary)}</i>` : ''}${w && (w.status === 'working' || (w.check && w.check.status === 'working')) ? `<div class="jbrunrow" data-runrow="${esc(runKey(O.job.id, r.no))}">${runCell(O.job.id, r.no)}</div>` : ''}${w && w.warning ? `<i class="warn">${esc(w.warning)}</i>` : ''}</div>
          <div class="c2">${r.agent ? esc(r.agent) : '<span class="bsub">by hand</span>'}</div>
          <div class="c3">${openFor(r.no) ? `<span class="st st-needsyou" title="Changes logged against this drawing">${openFor(r.no)} change${openFor(r.no) === 1 ? '' : 's'}</span>` : ''}${chip(w)}${w && w.rev && w.files ? `<span class="st">${esc(w.rev)}</span>` : ''}${w && w.check ? `<span class="st st-${w.check.status === 'passed' ? 'made' : w.check.status === 'working' ? 'working' : 'needsyou'}">${w.check.status === 'passed' ? 'Checked ✓' : w.check.status === 'working' ? 'Checking…' : `Check: ${w.check.count} to look at`}</span>` : ''}</div>
          <div class="c4">${files(w)}${w && w.check && w.check.markups ? `<button class="jbfile" data-show="${esc(w.check.markups)}">MARKUPS</button>` : ''}</div>
          <div class="c5">${r.agent ? (() => { const off = (w && w.status === 'working') || (!masterOk && (r.kind === 'bcd' || r.kind === 'schedule')) ? 'disabled' : ''; return w && w.files ? `<button class="jbbtn" data-make="${esc(r.no)}" ${off} title="Make this revision again (the old copy goes to Archive)">Make again</button><button class="jbbtn ${openFor(r.no) ? 'primary' : ''}" data-rev="${esc(r.no)}" ${off} title="Next revision (e.g. P01 to P02); older versions go to Archive">Revision</button>` : `<button class="jbbtn primary" data-make="${esc(r.no)}" ${off}>Make</button>`; })() : ''}</div>
          ${w && w.questions ? `<div class="jbq"><b>${esc(r.agent)} asks:</b>${w.questions.map((q, i) => `<label class="plain">${esc(q)}</label><input data-ans="${i}" placeholder="Your answer">`).join('')}<button class="jbbtn primary" data-answer="${esc(r.no)}">Send answers</button></div>` : ''}
        </div>`; }).join('')}</div>`;
    // Build it: Lex builds the list now; once built, the button takes you to it (open, in view) to check and approve
    if ($('#jbApprove')) $('#jbApprove').onclick = () => act(async () => { await api.desk.approveMaster({ jobId: O.job.id }); msg = 'Master list approved. Make the BCD and the cable schedule from their rows.'; }, 'Approving…');
    if ($('#jbToMaster')) $('#jbToMaster').onclick = () => {
      if (!V.master) return act(async () => { await api.desk.buildMaster({ jobId: O.job.id }); const v = (await api.jobs.overview({ jobId: O.job.id })).desk.master; msg = v ? `Master list built: ${v.devices} devices, ${v.cables} cables${(v.gaps || []).length ? `, ${v.gaps.length} gap${v.gaps.length === 1 ? '' : 's'} to look at` : ''}. Review it, then press Approve it.` : 'Lex could not build the list: check the inputs are in the job folder (Inputs & setup).'; }, 'Lex is reading the job documents and building the master list (a minute or two)…');
      goMaster();
    };
    if ($('#jbAll')) $('#jbAll').onclick = () => act(() => api.jobs.makeAll({ jobId: O.job.id }), 'Making the deliverables…');
    if ($('#jbCheck')) $('#jbCheck').onclick = () => act(async () => { const r = await api.jobs.check({ jobId: O.job.id }); msg = `Cal checked against ${r.schedule}: ${r.headline || ''} ${r.findings} to look at.`; }, 'Cal is checking…');
    el.querySelectorAll('[data-make]').forEach(b => b.onclick = () => prep(b.closest('.jbrow'), b.dataset.make));
    el.onclick = (e) => { const b = e.target.closest('[data-stop]'); if (!b) return; b.disabled = true; b.textContent = 'Stopping…'; api.runs.stop({ jobId: O.job.id, no: b.dataset.stop }).catch(() => {}); };
    el.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => revPanel(b.closest('.jbrow'), b.dataset.rev));
    el.querySelectorAll('[data-answer]').forEach(b => b.onclick = () => { const box = b.closest('.jbq'), qs = O.rows.find(r => r.no === b.dataset.answer).work.questions; const answers = qs.map((q, i) => ({ q, a: box.querySelector(`[data-ans="${i}"]`).value })); act(() => api.jobs.make({ jobId: O.job.id, no: b.dataset.answer, answers }), 'Sent. Working…'); });
    wireFiles(el);
  }
  // before an agent starts: what it will be asked (editable), the skills it will use (tick / untick), the inputs it will read
  async function prep(rowEl, no) {
    document.querySelectorAll('.jbprep').forEach(x => x.remove());
    const box = document.createElement('div'); box.className = 'jbprep'; box.innerHTML = '<div class="bsub">Getting ready…</div>'; rowEl.appendChild(box);
    let P; try { P = await api.jobs.plan({ jobId: O.job.id, no }); } catch (e) { box.innerHTML = `<div class="bsub">${esc(clean(e))}</div>`; return; }
    const fixes = openList(no);
    box.innerHTML = `<div class="jbprep-g"><div><label>What ${esc(P.agent)} will do</label><textarea id="jpReq" rows="3">${esc(P.request)}</textarea>
        ${fixes.length ? `<div class="jbmsg">Also fixes ${fixes.length} open item${fixes.length === 1 ? '' : 's'} (same revision): ${esc(fixes.map(c => c.comment).slice(0, 4).join(' · '))}${fixes.length > 4 ? ' …' : ''}. Close any you disagree with on the Comments tab first.</div>` : ''}
        <div class="bsub">Drawing number: <b>${esc(P.number || 'next free QS 006 number')}</b></div>
        ${P.agent === 'Dex' ? `<label>Title block</label><div class="jppeople">${['drawn', 'checked', 'approved'].map(k => `<span><i>${k[0].toUpperCase() + k.slice(1)}</i><input id="jp_${k}" maxlength="24" placeholder="initials" value="${esc(((P.people || lastPeople())[k]) || '')}"></span>`).join('')}</div>` : ''}
        <label>Inputs ${esc(P.agent)} will read from the job folder</label><div class="jpin">${P.inputs.length ? P.inputs.map(f => `<span>${esc(f)}</span>`).join('') : `<i class="warn">${P.folder ? 'Nothing matching found in the folder: add the inputs, then Read folder again in Inputs & setup' : 'No project folder linked'}</i>`}</div></div>
      <div id="jpSkills"></div></div>
      <div class="jbbar"><button class="jbbtn primary" id="jpGo">Start ${esc(P.agent)}</button><button class="jbbtn" id="jpCancel">Cancel</button></div>`;
    let picker = null;   // until the skills have loaded, Start uses the agent's usual skills for this kind of drawing
    box.querySelector('#jpCancel').onclick = () => { box.remove(); refresh(); };
    box.querySelector('#jpGo').onclick = () => {
      const request = box.querySelector('#jpReq').value.trim(), skills = picker ? picker.selected() : undefined;
      let people;
      if (P.agent === 'Dex') {
        people = Object.fromEntries(['drawn', 'checked', 'approved'].map(k => [k, box.querySelector('#jp_' + k).value.trim().toUpperCase()]));
        if (!people.drawn) { const f = box.querySelector('#jp_drawn'); f.focus(); f.classList.add('need'); f.placeholder = 'who drew it'; return; }
        try { localStorage.setItem('amo.people', JSON.stringify(people)); } catch {}
      }
      act(() => api.jobs.make({ jobId: O.job.id, no, request, skills, people }), `${no}: ${P.agent} is on it…`);
    };
    box.querySelector('#jpSkills').innerHTML = '<div class="skp"><div class="skp-h">Skills for this run <span>loading…</span></div></div>';
    const DK = api.drawKinds; picker = await renderSkillPicker(api, box.querySelector('#jpSkills'), P.agentId, { uncheck: (i) => !DK ? false : ['bcd', 'sld', 'earthing'].includes(P.kind) ? !DK.skillFit(i, P.kind) : P.agent !== 'Dex' ? (DK.skillKinds(i).length > 0 || /\bdxf\b|\bcad\b|title block/i.test(`${i.name} ${i.description}`)) : false });
  }
  function goMaster() { openDeskSection('master'); tab = 'setup'; msg = ''; renderJob(); const t0 = Date.now(); const look = () => { const d = document.querySelector('details.jd[data-sec="master"]'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1600); } else if (Date.now() - t0 < 5000) setTimeout(look, 150); }; look(); }
  const openList = (no) => ((O && O.desk.crs) || []).filter(c => c.doc === no && !/responded|closed/i.test(c.status || ''));
  const openFor = (no) => openList(no).length;
  // a new revision: the next one at the same stage (P01 > P02) unless another is typed (e.g. C01); anything different goes to the agent
  async function revPanel(rowEl, no) {
    document.querySelectorAll('.jbprep').forEach(x => x.remove());
    const box = document.createElement('div'); box.className = 'jbprep'; box.innerHTML = '<div class="bsub">Getting ready…</div>'; rowEl.appendChild(box);
    let P; try { P = await api.jobs.plan({ jobId: O.job.id, no }); } catch (e) { box.innerHTML = `<div class="bsub">${esc(clean(e))}</div>`; return; }
    const cs = openList(no), pp = P.people || lastPeople();
    box.innerHTML = `<div class="jbprep-g"><div>
        <label>New revision</label><div class="jbbar" style="margin:0"><span class="st">${esc(P.rev || 'P01')}</span><span>→</span><input id="jrTo" value="${esc(P.nextRev)}" maxlength="3" style="width:70px;text-transform:uppercase"><span class="bsub">Type another to jump stage, e.g. A01 for comment, C01 for construction.</span></div>
        <label>What's different <span class="bsub">(optional: leave empty for a straight revision)</span></label>
        <textarea id="jrNote" rows="4" placeholder="e.g. F3 now 125A, add a spare way on DB-01, move to C01">${esc(cs.map(c => c.comment).join('\n'))}</textarea>
        ${cs.length ? `<div class="bsub">${cs.length} logged change${cs.length === 1 ? '' : 's'} filled in above; they are marked done when the revision is made.</div>` : ''}
        ${P.agent === 'Dex' ? `<label>Title block for this revision</label><div class="jppeople">${['drawn', 'checked', 'approved'].map(k => `<span><i>${k[0].toUpperCase() + k.slice(1)}</i><input id="jr_${k}" maxlength="24" placeholder="initials" value="${esc(pp[k] || '')}"></span>`).join('')}</div>` : ''}
        <div class="bsub">The ${esc(P.rev || 'current')} files move to the Archive folder; the folder keeps only the new revision.</div></div></div>
      <div class="jbbar"><button class="jbbtn primary" id="jrGo">Make ${esc(P.nextRev)}</button><button class="jbbtn" id="jrCancel">Cancel</button></div>`;
    const to = box.querySelector('#jrTo'); to.oninput = () => { box.querySelector('#jrGo').textContent = 'Make ' + (to.value.trim().toUpperCase() || P.nextRev); };
    box.querySelector('#jrCancel').onclick = () => { box.remove(); refresh(); };
    box.querySelector('#jrGo').onclick = () => {
      let people;
      if (P.agent === 'Dex') { people = Object.fromEntries(['drawn', 'checked', 'approved'].map(k => [k, box.querySelector('#jr_' + k).value.trim().toUpperCase()])); if (!people.drawn) { const f = box.querySelector('#jr_drawn'); f.focus(); f.classList.add('need'); f.placeholder = 'who drew it'; return; } try { localStorage.setItem('amo.people', JSON.stringify(people)); } catch {} }
      const want = to.value.trim().toUpperCase();
      if (want && !/^[PACX]\d{1,2}$/.test(want)) { to.classList.add('need'); return; }
      act(() => api.jobs.revision({ jobId: O.job.id, no, to: want, note: box.querySelector('#jrNote').value.trim(), people }), `${no}: ${P.agent} is making ${want || P.nextRev}…`);
    };
  }
  // an email: on a job (changes, more deliverables) or on its own (a new job, or an existing one Eli recognises). Eli reads it first.
  function emailPanel(jobId) {
    const m = $('#jbMain'), job = jobs.find(j => j.id === jobId);
    m.innerHTML = `<div class="jbhead"><div><h2>${job ? `Add email / changes · ${esc(job.number)}` : 'New job from an email'}</h2><div class="bsub">${job ? 'Drop the email (or paste it). Changes it asks for are logged against the drawings, ready for a revision; anything new goes on the deliverables.' : 'Drop the client\'s email (or paste it). Eli reads it, finds the job if it already exists, or sets up a new one with its deliverables.'}</div></div><button class="jbbtn" id="emBack">Back</button></div>
      <div class="jbcard"><div class="emdrop" id="emDrop"><b>Drop the email here</b><span>.eml / .msg, or its PDF / screenshot</span><input type="file" id="emFile" multiple accept=".eml,.msg,.pdf,.png,.jpg,.jpeg,.txt"><button class="jbbtn" id="emPick" type="button">Choose file…</button><div id="emFiles" class="jpin"></div></div>
        <label>Or paste it</label><textarea id="emText" rows="6" placeholder="Paste the email text here"></textarea>
        <div class="jbbar"><button class="jbbtn primary" id="emRead">Read it</button><span id="emMsg" class="bsub"></span></div></div><div id="emOut"></div>`;
    let picked = [];
    const add = async (list) => { for (const f of list) { const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); }); picked.push({ name: f.name, mime: f.type, base64: b64 }); } $('#emFiles').innerHTML = picked.map(f => `<span>${esc(f.name)}</span>`).join(''); };
    $('#emBack').onclick = () => { if (job) renderJob(); else refresh(); };
    $('#emPick').onclick = () => $('#emFile').click(); $('#emFile').onchange = (e) => add([...e.target.files]);
    const dz = $('#emDrop'); dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over'); dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); add([...e.dataTransfer.files]); };
    $('#emRead').onclick = async () => {
      const text = $('#emText').value.trim(); if (!picked.length && !text) { $('#emMsg').textContent = 'Drop the email or paste it first.'; return; }
      $('#emMsg').textContent = 'Eli is reading it…'; $('#emRead').disabled = true;
      let R; try { R = await api.jobs.addEmail({ files: picked, text, jobId }); } catch (e) { $('#emMsg').textContent = clean(e); $('#emRead').disabled = false; return; }
      $('#emMsg').textContent = ''; $('#emRead').disabled = false; showEmail(R, jobId);
    };
  }
  async function showEmail(R, jobId) {
    const e = R.email, out = $('#emOut'), J = R.job;
    const cs = e.comments || [], dl = e.deliverables || [];
    let D = { saved: '', guess: '' }; if (!J) { try { D = await api.mail.defaults(); } catch {} }
    let parent = D.saved || D.guess || '', link = R.suggest.folderFound || '';
    out.innerHTML = `<div class="jbcard"><b>${esc(e.subject || 'Email')}</b><div class="bsub">${esc(e.from || '')}${e.date ? ' · ' + esc(e.date) : ''}</div><p>${esc(e.summary || '')}</p>
        ${cs.length ? `<label>Changes / comments (${cs.length})</label>${cs.map(c => `<div class="jbc"><span class="bsub">${esc(c.doc || 'General')}${c.by ? ' · ' + esc(c.by) : ''}</span><div>${esc(c.comment)}</div></div>`).join('')}` : ''}
        ${dl.length ? `<label>Deliverables asked for (${dl.length})</label><div class="jpin">${dl.map(x => `<span>${esc(x.title || x.type)}${x.qty > 1 ? ' ×' + x.qty : ''}</span>`).join('')}</div>` : ''}
        ${(e.missingInputs || []).length ? `<label>Still needed from the client</label><div class="jpin">${e.missingInputs.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        ${J ? `<div class="jbbar"><span>${(R.jobs || []).length > 1 ? `Jobs: <b>${R.jobs.map(x => esc(x.number + (x.name ? ' ' + x.name : ''))).join(', ')}</b>` : `Job: <b>${esc(J.number)} ${esc(J.name || '')}</b>`}</span>${!jobId ? '<button class="jbbtn" id="emOther">Not this job: make a new one</button>' : ''}</div>` : ''}
        <div id="emNew" ${J ? 'hidden' : ''} class="jbform"><label>New job number</label><input id="enNo" value="${esc(R.suggest.number)}"><label>Job name / site</label><input id="enName" value="${esc(R.suggest.name)}"><label>Client</label><input id="enClient" value="${esc(R.suggest.client)}">
          <label>Project folder</label>
          <label class="plain"><input type="radio" name="enMode" value="create" ${link ? '' : 'checked'}> New folder from the Atomax template in <b id="enParent">${esc(parent || '(choose where your job folders live)')}</b> <button class="jbbtn" id="enParentPick" type="button">Change…</button></label>
          <label class="plain"><input type="radio" name="enMode" value="link" ${link ? 'checked' : ''}> A folder I already have <button class="jbbtn" id="enLinkPick" type="button">Choose…</button> <span id="enLink" class="bsub">${esc(link)}</span></label>
          <label class="plain"><input type="radio" name="enMode" value="none"> No folder yet</label></div>
        ${J && !J.client && R.suggest.client ? `<label class="plain"><input type="checkbox" id="emSetClient" checked> Set the job's client to <b>${esc(R.suggest.client)}</b></label>` : ''}
        <div class="jbbar"><button class="jbbtn primary" id="emApply">${J ? `File it on ${esc((R.jobs || []).length > 1 ? R.jobs.map(x => x.number).join(' and ') : J.number)}` : 'Create the job and file it'}</button><span id="emAMsg" class="bsub"></span></div></div>`;
    let useNew = !J;
    if ($('#emOther')) $('#emOther').onclick = () => { useNew = true; $('#emNew').hidden = false; $('#emApply').textContent = 'Create the job and file it'; $('#emOther').remove(); };
    if ($('#enParentPick')) $('#enParentPick').onclick = async () => { const f = await api.mail.pickParent(); if (f) { parent = f; $('#enParent').textContent = f; } };
    if ($('#enLinkPick')) $('#enLinkPick').onclick = async () => { const f = await api.biz.pickFolder(); if (f) { link = f; $('#enLink').textContent = f; out.querySelector('input[value="link"]').checked = true; } };
    $('#emApply').onclick = async () => {
      $('#emAMsg').textContent = 'Filing…';
      try {
        const mode = useNew ? out.querySelector('input[name="enMode"]:checked').value : '';
        // an email about several jobs (malt and wheat) is filed on each, each getting only its own changes
        const targets = !useNew && (R.jobs || []).length > 1 ? R.jobs.map(x => x.id) : [useNew ? '' : J.id], done = [];
        for (const id of targets) done.push(await api.jobs.applyEmail({ emailId: e.id, jobId: id, client: $('#emSetClient') && $('#emSetClient').checked ? R.suggest.client : '', newJob: useNew ? { number: $('#enNo').value, name: $('#enName').value, client: $('#enClient').value, mode, folder: mode === 'create' ? parent : link } : null }));
        const r = done[0]; sel = r.job.id; tab = 'deliv';
        msg = done.map(x => `Filed on ${x.job.number}: ${x.comments} change${x.comments === 1 ? '' : 's'} logged${x.docs.length ? ' (' + x.docs.join(', ') + ')' : ''}, ${x.deliverables} deliverable${x.deliverables === 1 ? '' : 's'} added.`).join(' ') + (done.some(x => x.comments) ? ' Press Revision on a drawing to make the changes.' : '');
        refresh();
      } catch (err) { $('#emAMsg').textContent = clean(err); }
    };
  }
  function lastPeople() { try { return JSON.parse(localStorage.getItem('amo.people') || '{}') || {}; } catch { return {}; } }
  function wireFiles(el) {
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => api.desk.open({ p: b.dataset.open }));
    el.querySelectorAll('[data-show]').forEach(b => b.onclick = () => api.desk.show({ p: b.dataset.show }));
  }
  // run a job action: show it is going, refresh the rows while the agents work, report errors on the page
  async function act(fn, note) {
    msg = note; renderJob(); const t = setTimeout(refreshWhenFree, 1500);
    try { await fn(); if (msg === note) msg = ''; toast(note.replace(/…$/, '').replace(/ is on it$/, '') + ' — done'); } catch (e) { msg = clean(e); toast(clean(e), 'err'); }
    clearTimeout(t); await refreshWhenFree();
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
          ${cs.map(c => `<div class="jbc ${/responded|closed/i.test(c.status || '') ? 'done' : ''}"><span class="bsub">${esc(c.no)} · ${esc(c.by || '')}</span><div>${esc(c.comment)}</div>${c.response ? `<div class="resp">↳ ${esc(c.response)}</div>` : ''}${!/responded|closed/i.test(c.status || '') ? `<button class="jbbtn" data-crsclose="${esc(c.no)}" title="Not a change: close it without doing anything">Close</button>` : ''}</div>`).join('')}</div>`; }).join('') : '<div class="jbempty"><b>No client comments yet.</b><span>When comments come back, log them here (or forward the email to Eli). Each drawing can then be revised in one click: next revision, changes clouded.</span></div>'}`;
    $('#jcAdd').onclick = async () => { const lines = $('#jcText').value.split('\n').map(s => s.trim()).filter(Boolean); if (!lines.length) return; for (const l of lines) await api.desk.addComment({ jobId: sel, doc: $('#jcDoc').value, comment: l, by: $('#jcBy').value }); refresh(); };
    el.querySelectorAll('[data-crsclose]').forEach(b => b.onclick = () => act(async () => { await api.desk.crs({ jobId: O.job.id, row: { no: b.dataset.crsclose, status: 'Closed', response: 'Closed by Tom: no change' } }); }, 'Closing…'));
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
  function hide() { panel.classList.remove('open'); document.body.classList.remove('jobs-full'); clearTimeout(poll); clearInterval(listTimer); document.body.classList.remove('jobs-open'); const b = $('#jobsBtn'); if (b) b.classList.remove('active'); const o = document.querySelector('#top .tabs button[data-tab="office"]'); if (o) o.classList.add('active'); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open') && !document.querySelector('.modal.open')) hide(); });
  return {
    focusSearch() { const q = $('#jbQ'); if (q) { q.focus(); q.select(); } },
    async show(jobId) { if (jobId !== undefined) { sel = jobId; selPath = ''; tab = 'deliv'; } clearInterval(listTimer); listTimer = setInterval(async () => { if (!panel.classList.contains('open') || busyPanel() || !nav || !document.hasFocus()) return; const before = JSON.stringify(listing && listing.entries.map(e => e.name + e.dir)); await relist(); if (JSON.stringify(listing && listing.entries.map(e => e.name + e.dir)) !== before) renderList(); }, 15000); panel.classList.remove('collapsed'); panel.classList.add('open'); document.body.classList.add('jobs-open'); document.body.classList.remove('jobs-full'); if ($('#jbFull')) { $('#jbFull').textContent = '⛶'; $('#jbFull').title = 'Full screen (F11)'; } document.querySelectorAll('#top .tabs:not(.rooms) button').forEach(x => x.classList.toggle('active', x.id === 'jobsBtn')); await refresh().catch(e => { $('#jbMain').innerHTML = `<div class="bhint">${esc(clean(e))}</div>`; }); },
    hide, refresh, isOpen: () => panel.classList.contains('open')
  };
}
