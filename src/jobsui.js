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
  let jobs = [], sel = '', tab = 'files', O = null, msg = '', busy = {}, poll = null, tellNo = '';   // tellNo: the drawing picked in the Tell Dex box, kept across refreshes
  // the Jobs list is Explorer's navigation pane over the Projects folders: a tree of folders (never files). Years and clients
  // expand in place; a job folder is a leaf (click = select it); what is inside a job is browsed in the Files tab on the right.
  // treeOpen = folders expanded in the tree (remembered); kids = what each expanded folder holds (sub-folders only), read live
  let roots = [], selPath = '', filesAt = '', selFolder = '', listTimer = null; const openDirs = new Set();   // filesAt = the folder the Files tab is showing (inside the job folder); selFolder = the job folder highlighted in the list
  let kids = new Map(), isJobAt = new Map();   // swapped whole after each read, never emptied in place: a redraw mid-read still has the last full picture
  const treeOpen = new Set((() => { try { return JSON.parse(localStorage.getItem('amo.jbTree') || '[]'); } catch { return []; } })());
  const rememberTree = () => { try { localStorage.setItem('amo.jbTree', JSON.stringify([...treeOpen])); } catch {} };
  const treeSig = () => JSON.stringify([...kids].map(([k, v]) => k + ':' + v.map(e => e.name).join('|')));
  // live agent runs (stage, elapsed, estimate) keyed by job|drawing, from the main process; the row shows them and offers Stop
  const RUNS = new Map(); const runKey = (jobId, no) => `${jobId}|${no}`;
  const fmtT = (ms) => { const sec = Math.round(ms / 1000); return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const runText = (r) => { if (!r) return ''; const est = r.estimate ? ` · usually about ${fmtT(r.estimate)}` : ''; return `${r.stage} · ${fmtT(r.elapsed)}${est}`; };
  if (api.runs && api.runs.onProgress) api.runs.onProgress((p) => { const k = runKey(p.jobId, p.no); if (p.done) RUNS.delete(k); else RUNS.set(k, p); const el = document.querySelector(`[data-runrow="${CSS.escape(k)}"]`); if (el) el.innerHTML = runCell(p.jobId, p.no); if (p.done && panel.classList.contains('open') && !busyPanel()) setTimeout(refresh, 400); });
  setInterval(() => { for (const [k, r] of RUNS) { r.elapsed += 1000; const el = document.querySelector(`[data-runrow="${CSS.escape(k)}"]`); if (el) el.innerHTML = runCell(r.jobId, r.no); } }, 1000);
  const runCell = (jobId, no) => { const r = RUNS.get(runKey(jobId, no)); if (!r) return ''; return `<span class="jbrun"><i class="jbspin"></i>${esc(runText(r))}</span><button class="jbbtn jbstop" data-stop="${esc(no)}" title="Stop this run (nothing is saved)">Stop</button>`; };
  // the in-app PDF viewer: a drawing or a markup opens over the job, with Cal's items for that drawing beside it (click one: that page)
  const viewer = { el: null };
  const fileUrl = (p) => 'app://local/?p=' + encodeURIComponent(p);
  function showPdf(p, { title = '', no = '', items = [], page = 1 } = {}) {
    if (!/\.pdf$/i.test(p)) { api.desk.open({ p }); return; }   // DXFs go to AutoCAD
    closeViewer(); const v = document.createElement('div'); v.className = 'jbviewer'; viewer.el = v;
    const list = items.length ? `<div class="jbv-side"><div class="jbv-h">${items.length} item${items.length === 1 ? '' : 's'} on this drawing</div>${items.map((c, i) => `<button class="jbv-item ${/responded|closed/i.test(c.status || '') ? 'done' : ''}" data-page="${c.page || 1}"><b>${i + 1}</b><span>${esc(c.comment)}</span><i>${esc(c.by || '')}${c.status && /responded|closed/i.test(c.status) ? ' · done' : ''}</i></button>`).join('')}</div>` : '';
    v.innerHTML = `<div class="jbv-top"><b>${esc(title || base(p))}</b><span class="bsub">${esc(p)}</span><span class="jbbar" style="margin:0 0 0 auto"><button class="jbbtn" id="jbvWin">Open in Windows</button><button class="jbbtn" id="jbvFolder">Show in folder</button><button class="jbbtn" id="jbvClose">Close</button></span></div>
      <div class="jbv-body"><iframe id="jbvFrame" src="${esc(fileUrl(p))}#page=${page}&toolbar=1" title="PDF"></iframe>${list}</div>`;
    $('#jbMain').appendChild(v);
    v.querySelector('#jbvClose').onclick = closeViewer; v.querySelector('#jbvWin').onclick = () => api.desk.open({ p }); v.querySelector('#jbvFolder').onclick = () => api.desk.show({ p });
    v.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { const f = v.querySelector('#jbvFrame'); f.src = fileUrl(p) + '#page=' + b.dataset.page + '&toolbar=1'; v.querySelectorAll('.jbv-item').forEach(x => x.classList.toggle('on', x === b)); });
    document.addEventListener('keydown', escClose);
  }
  const escClose = (e) => { if (e.key === 'Escape' && viewer.el) { e.stopPropagation(); closeViewer(); } };
  function closeViewer() { if (viewer.el) { viewer.el.remove(); viewer.el = null; } document.removeEventListener('keydown', escClose); }
  // the markups folder: its PDFs listed to pick from (one per checked drawing, plus the schedule notes)
  async function showMarkups(dir, no) {
    let entries = []; try { entries = (await api.proj.listAt({ path: dir })).entries.filter(e => !e.dir && /\.pdf$/i.test(e.name)); } catch { api.desk.show({ p: dir }); return; }
    const mine = entries.filter(e => !no || e.name.toUpperCase().includes(String(no).toUpperCase().replace(/[^A-Z0-9-]/g, ''))), pick = (mine.length ? mine : entries).sort((a, b) => b.mtime - a.mtime);
    if (!pick.length) { api.desk.show({ p: dir }); return; }
    const items = ((O && O.desk.crs) || []).filter(c => c.doc === no && c.by === 'Cal');
    showPdf(pick[0].path, { title: `Markup · ${no}`, no, items });
  }
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
  // a redraw reads slowly (OneDrive folders, the overview); if what is selected changed while it was reading, its result is stale and dropped,
  // so clicking a job and then a folder leaves the folder on screen, not the job that finished loading later
  let refreshGen = 0, focusPath = '';   // the folder just opened in the tree: scrolled into view on the next redraw
  async function refresh() {
    const g = ++refreshGen, want = () => `${sel}|${selPath}|${tab}`, at = want();
    try { if (api.runs && api.runs.live) { const live = await api.runs.live(); RUNS.clear(); for (const p of live) RUNS.set(runKey(p.jobId, p.no), p); } } catch {}   // runs still going in the main process (after a re-open or a redraw)
    await relist();
    const v = await api.biz.get(); jobs = v.jobs.filter(j => j.status !== 'Closed'); window.__jobs = v.jobs;
    if (g !== refreshGen && want() !== at) return;
    if (sel && !jobs.some(j => j.id === sel)) sel = '';
    renderList();
    if (!sel && selPath) { renderFolder(); return; }
    if (sel) { let O2 = null; try { O2 = await api.jobs.overview({ jobId: sel }); } catch (e) { msg = clean(e); }
      if (g !== refreshGen && want() !== at) return;
      if (busyPanel()) { refreshWhenFree(); return; }   // a Make / Revision panel opened while this was fetching: redraw once it closes
      O = O2; renderJob(); } else renderHome();
  }
  // the tree, read live (nothing cached between reads, nothing renamed or hidden beyond what Explorer hides): the roots, whether
  // each root is a job (a leaf) and the sub-folders of every expanded folder. A job folder is never expanded, whatever was remembered.
  async function relist() {
    try { roots = (await api.proj.roots()).roots || []; } catch { roots = []; }
    const under = (p) => roots.some(r => p === r.path || p.startsWith(r.path.replace(/[\\/]+$/, '') + (r.path.includes('\\') ? '\\' : '/')));
    const J2 = new Map(), K2 = new Map();
    const jobAt = async (p) => { const k = p.toLowerCase(); if (!J2.has(k)) { let J = null; try { J = await api.proj.jobFor({ path: p }); } catch {} J2.set(k, J); } return J2.get(k); };
    await Promise.all(roots.map(r => jobAt(r.path)));   // a root that is a job folder itself is a leaf
    if (roots.length === 1 && !treeOpen.size && !(await jobAt(roots[0].path))) treeOpen.add(roots[0].path);   // one Projects folder: it starts open
    await Promise.all([...treeOpen].map(async (p) => { if (!under(p) || await jobAt(p)) treeOpen.delete(p); }));
    await Promise.all([...treeOpen].map(async (p) => { try { const l = await api.proj.listAt({ path: p }); K2.set(p, l.entries.filter(e => e.dir)); } catch (e) { K2.set(p, []); } }));
    isJobAt = J2; kids = K2;
  }
  // one row of the tree: a folder with a chevron if it can open, indented by depth; a job folder is a leaf
  function treeRow(p, name, depth, job, extra) {
    const on = (selFolder || selPath).toLowerCase() === p.toLowerCase(), open = treeOpen.has(p);
    const tog = job ? '<i class="jbtog leaf"></i>' : `<i class="jbtog" data-tog="${esc(p)}" title="${open ? 'Collapse' : 'Expand'}">${open ? '▾' : '▸'}</i>`;
    return `<button class="jbj jbdir ${on ? 'on' : ''}" style="padding-left:${11 + depth * 14}px" data-dir="${esc(p)}" data-job="${job ? 1 : ''}" title="${esc(p)}"><b>${tog}📁 ${esc(name)}${extra || ''}</b></button>`;
  }
  function treeHtml(p, depth) {
    if (!treeOpen.has(p)) return '';
    const list = kids.get(p) || [];
    if (!list.length) return `<div class="bsub" style="padding:4px 8px 4px ${25 + depth * 14}px">No folders inside</div>`;
    const cloudDot = (e) => e.cloud ? '<i class="jbcloud" title="Online-only in OneDrive (not downloaded to this PC yet)"></i>' : '';
    return list.map(e => treeRow(e.path, e.name, depth, !!(e.isJob || e.job), cloudDot(e) + (e.job ? '<i class="jbsetdot" title="Set up for drawings"></i>' : '')) + treeHtml(e.path, depth + 1)).join('');
  }
  function renderList() {
    const head = `<div class="jbsearch"><input id="jbQ" type="search" placeholder="Find a job (number, name, client)" value="${esc(query)}" autocomplete="off">${query ? '<button class="x" id="jbQx" title="Clear">×</button>' : ''}</div><button class="jbnew" id="jbNew">+ New job</button><button class="jbnew mail" id="jbMail">✉ Email in</button><button class="jbj home ${!sel && !selPath ? 'on' : ''}" data-j="">Waiting on you</button>`;
    let body;
    const cloudDot = (e) => e.cloud ? '<i class="jbcloud" title="Online-only in OneDrive (not downloaded to this PC yet)"></i>' : '';
    const rec = recents().filter(r => roots.some(x => r.path === x.path || r.path.startsWith(x.path)) && (/[A-Za-z]\d{5,6}\b/.test(base(r.path)) || jobs.some(j => j.folder && j.folder.toLowerCase() === r.path.toLowerCase())));   // jobs only: a discipline folder clicked inside a job is not a recent job
    const recentHtml = !query && rec.length ? `<div class="jblabel">Recent</div>` + rec.map(r => `<button class="jbj recent ${(selFolder || selPath).toLowerCase() === r.path.toLowerCase() ? 'on' : ''}" data-dir="${esc(r.path)}" data-job="1" title="${esc(r.path)}"><b>${esc(String(r.name || '').replace(/^[A-Za-z]\d{5,6}\s*/, '').trim() ? r.name : base(r.path))}</b></button>`).join('') : '';
    if (query) body = `<div class="jblabel">${found === null ? 'Searching…' : found.length ? `${found.length} match${found.length === 1 ? '' : 'es'}` : 'Nothing matches'}</div>` + (found || []).map(f => `<button class="jbj ${selPath === f.path ? 'on' : ''}" data-dir="${esc(f.path)}" data-job="1" data-kind="${esc(f.kind || 'job')}" data-recid="${esc(f.job && f.job.id || '')}" title="${esc(f.path)}"><b>${f.kind && f.kind !== 'job' ? `<em class="jbkind">${esc(f.kind)}</em>` : ''}${esc(f.number)}${f.name ? ' · ' + esc(f.name) : ''}</b>${f.client ? `<span class="jbclient">${esc(f.client)}</span>` : ''}</button>`).join('');
    else if (!roots.length) body = `<div class="jblabel">Projects</div><div class="bsub" style="padding:6px 8px">Set your Projects folder (the live OneDrive one) to see your jobs here.</div><button class="jbnew" id="jbRoot">Set projects folder…</button>`;
    else { const norm = (p) => p.replace(/[\\/]+$/, '').toLowerCase(), topRoots = roots.filter(r => !roots.some(o => o !== r && norm(r.path).startsWith(norm(o.path) + (o.path.includes('\\') ? '\\' : '/'))));   // a root inside another root is already in the tree
      body = recentHtml + `<div class="jblabel">Projects <a href="#" id="jbRoot" class="jbrootlink">add folder</a></div>` + topRoots.map(r => treeRow(r.path, r.name, 0, !!isJobAt.get(r.path.toLowerCase())) + treeHtml(r.path, 1)).join(''); }
    const L0 = $('#jbList'), keepTop = L0 ? L0.scrollTop : 0;
    $('#jbList').innerHTML = head + body;
    const L = $('#jbList'); L.scrollTop = keepTop;
    // a folder just opened or picked: it goes to the top of the pane so what is inside it is in view
    if (focusPath) { const row = L.querySelector(`[data-dir="${CSS.escape(focusPath)}"]`); if (row) { const top = row.offsetTop - L.offsetTop - 6; if (top < L.scrollTop || row.offsetTop + row.offsetHeight > L.scrollTop + L.clientHeight - 40) L.scrollTop = Math.max(0, top); } focusPath = ''; }
    L.querySelector('[data-j=""]').onclick = () => { sel = ''; selPath = ''; tab = 'deliv'; msg = ''; refresh(); };
    // the navigation pane: a job is a leaf (click = select it, the other jobs stay in view); any other folder expands in place and
    // shows its contents on the right. Files are never listed here; inside a job they are browsed in the Files tab.
    const toggle = async (p) => { const opening = !treeOpen.has(p); if (opening) treeOpen.add(p); else treeOpen.delete(p); rememberTree(); if (opening) focusPath = p; await relist(); renderList(); };
    L.querySelectorAll('[data-tog]').forEach(i => i.onclick = (e) => { e.stopPropagation(); toggle(i.dataset.tog); });
    // open a folder from the pane (or one just picked): a job opens on the right; any other folder expands in place and shows its contents
    const openPath = async (p, { kind = '', isJob = true } = {}) => {
      let J = null; try { J = await api.proj.jobFor({ path: p }); } catch {}
      // not a job (a year, a client, an enquiry folder): it opens in the tree and its contents show on the right, like Explorer
      if (!J) { sel = ''; selPath = p; selFolder = ''; filesAt = ''; tab = 'files'; msg = ''; renderFolder(); if (!treeOpen.has(p)) { treeOpen.add(p); rememberTree(); } focusPath = p; await relist(); renderList(); return; }
      selFolder = J.folder || p; filesAt = (J.folder && p.toLowerCase() !== J.folder.toLowerCase()) ? p : '';
      if (J.id) { if (sel !== J.id) { tab = kind === 'drawing' ? 'deliv' : 'files'; msg = ''; openDirs.clear(); } sel = J.id; selPath = ''; noteRecent(J.folder || p, `${J.number || ''} ${J.name || ''}`.trim() || base(J.folder || p)); }
      else { sel = ''; selPath = J.folder; tab = 'files'; msg = ''; }
      refresh();
    };
    L.querySelectorAll('[data-dir]').forEach(b => b.onclick = async () => {
      const p = b.dataset.dir;
      // straight away: the row lights up and the right side says so, because a OneDrive folder can take seconds to answer
      L.querySelectorAll('.jbj.on').forEach(x => x.classList.remove('on')); b.classList.add('on');
      if (b.dataset.job) { const main = $('#jbMain'); if (main) main.innerHTML = `<div class="jbopening"><span class="spinner"></span> Opening ${esc(base(p))}…</div>`; }
      await openPath(p, { kind: b.dataset.kind || '' });
    });
    L.querySelectorAll('[data-j]').forEach(b => { if (b.dataset.j) b.onclick = () => { sel = b.dataset.j; selPath = ''; filesAt = ''; selFolder = ''; tab = 'files'; msg = ''; openDirs.clear(); refresh(); }; });
    // "add folder" / Choose the folder: a folder inside a root already shown is not a new root, it is opened where it sits in the tree
    // (every folder between the root and it expanded, scrolled into view, and opened on the right); only a folder outside every root
    // becomes a new root
    const pick = async (e) => { if (e) e.preventDefault(); const f = await api.proj.pick(); if (!f) return;
      const norm = (p) => p.replace(/[\\/]+$/, '').toLowerCase(), sep = f.includes('\\') ? '\\' : '/';
      const under = roots.find(r => norm(f) === norm(r.path) || norm(f).startsWith(norm(r.path) + sep));
      if (under) { let cur = norm(under.path), rest = f.replace(/[\\/]+$/, '').slice(cur.length).split(/[\\/]/).filter(Boolean); let acc = under.path.replace(/[\\/]+$/, ''); treeOpen.add(acc); for (const part of rest) { acc = acc + sep + part; treeOpen.add(acc); } rememberTree(); const main = $('#jbMain'); if (main) main.innerHTML = `<div class="jbopening"><span class="spinner"></span> Opening ${esc(base(f))}…</div>`; await openPath(f); return; }
      try { const st = await api.settings.get(); await api.settings.set({ projectRoots: [...new Set([...(st.projectRoots || []), f])] }); } catch (err) { msg = clean(err); } treeOpen.add(f); rememberTree(); focusPath = f; refresh(); };
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
    closeViewer(); const m = $('#jbMain'); if (!O) { m.innerHTML = `<div class="bhint">${esc(msg)}</div>`; return; }
    const j = O.job, V = O.desk, rows = O.rows;
    const openC = (V.crs || []).filter(c => !/responded|closed/i.test(c.status || '')).length;
    const leads = (getAgents ? getAgents() : []).filter(a => a.role === 'lead' && a.enabled !== false).slice(0, 2);
    const tabs = [['eli', '💬 Eli'], ...leads.map(a => ['lead:' + a.id, '💬 ' + esc(a.name)]), ['files', 'Files'], ['deliv', `Deliverables <em>${rows.length}</em>`], ['setup', 'Inputs &amp; setup'], ['comments', `Comments${openC ? ` <em>${openC}</em>` : ''}`], ['issue', 'Issue']];
    m.innerHTML = `<div class="jbhead"><div><h2>${esc(j.number)} ${esc(j.name || '')}</h2><div class="bsub">${esc(j.client || 'No client')} · border: <select id="jbBorderQ" class="jbinline" title="Drawing border for every drawing on this job">${[['auto', 'Automatic (by client)'], ['atomax', 'Atomax'], ['ng', 'National Grid'], ['bgen', 'BGEN'], ['pbe', 'PBE Group'], ['client', 'Client title block (File Room)']].map(([k, t]) => `<option value="${k}" ${(V.border || 'auto') === k ? 'selected' : ''}>${k === 'auto' ? 'Automatic: ' + (V.borderUsed || '') : t}</option>`).join('')}</select>${j.folder ? ` · <a href="#" id="jbFolder">open folder</a>` : ' · <b class="warn">no folder linked</b>'}</div></div>
        <div class="jbbar" style="margin:0"><button class="jbbtn primary" id="jbAddMail">✉ Add email / changes</button><button class="jbbtn" id="jbAddFiles" title="Drop the client's folder or files: they are filed into the job folder, emails read by Eli">📁 Add files</button><button class="jbbtn" id="jbWork">Work on this job</button></div></div>
      <div class="jbtabs">${tabs.map(([k, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${msg ? `<div class="jbmsg">${esc(msg)}</div>` : ''}
      <div id="jbTab"></div>`;
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; msg = ''; refresh(); });
    if ($('#jbFolder')) $('#jbFolder').onclick = (e) => { e.preventDefault(); api.proj.open({ jobId: j.id }).catch(() => api.showItem(j.folder)); };
    $('#jbBorderQ').onchange = async () => { try { await api.desk.border({ jobId: j.id, key: $('#jbBorderQ').value }); msg = $('#jbBorderQ').value === 'ng' ? 'National Grid border set. Put the NG site and Investment No. in Inputs & setup → Numbering; they go in the title box.' : ''; } catch (e) { msg = clean(e); } refresh(); };
    $('#jbAddFiles').onclick = () => addFiles(j);
    $('#jbAddMail').onclick = () => emailPanel(j.id);
    $('#jbWork').onclick = async () => { await api.biz.setCurrent({ id: j.id }); if (onWorkOn) onWorkOn(j.id); $('#jbWork').textContent = '✓ Job in hand'; };
    if (/^lead:/.test(tab) && !leads.some(a => 'lead:' + a.id === tab)) tab = 'eli';   /* a lead switched off: back to Eli */
    if (/^lead:/.test(tab)) tabLead(leads.find(a => 'lead:' + a.id === tab)); else ({ eli: tabEli, files: tabFiles, deliv: tabDeliv, setup: tabSetup, comments: tabComments, issue: tabIssue })[tab]();
    const working = rows.some(r => r.work && (r.work.status === 'working' || (r.work.check && r.work.check.status === 'working')));
    clearTimeout(poll); if (working && panel.classList.contains('open')) poll = setTimeout(refreshWhenFree, 3000);
  }

  // ---------- the job's real folder: the Atomax template layout as it is on OneDrive, opened folder by folder ----------
  const fIcon = (n) => /\.pdf$/i.test(n) ? '📄' : /\.(dwg|dxf|dwt)$/i.test(n) ? '📐' : /\.(xlsx?|xlsm|csv)$/i.test(n) ? '📊' : /\.(docx?|rtf)$/i.test(n) ? '📝' : /\.(msg|eml)$/i.test(n) ? '✉' : /\.(png|jpe?g|gif|bmp|tif)$/i.test(n) ? '🖼' : '📄';
  const fSize = (b) => !b ? '' : b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  const fDate = (t) => { if (!t) return ''; const d = new Date(t); return [d.getDate(), d.getMonth() + 1, d.getFullYear() % 100].map(v => String(v).padStart(2, '0')).join('.'); };
  // the job folder, live: inside the Projects folders it is read by path; an older job's folder elsewhere by the job
  async function tabFiles(folder = O && O.job && O.job.folder, jobId = O && O.job && O.job.id) {
    const el = $('#jbTab'); const root = folder;
    if (folder && filesAt && filesAt.toLowerCase().startsWith(folder.toLowerCase()) && /[\\/]/.test(filesAt.charAt(folder.length))) folder = filesAt;   // the folder clicked in the list, inside this job
    if (!folder) { el.innerHTML = `<div class="jbempty"><b>No project folder for this job.</b><span>Pick its folder in your Projects folder.</span><button class="jbbtn primary" id="jftPick">Choose the folder…</button></div>`; $('#jftPick').onclick = async () => { const f = await api.proj.pick(); if (f) { await api.proj.setFolder({ jobId, folder: f }); refresh(); } }; return; }
    const crumb = folder !== root ? `<a href="#" id="jftUp" class="jbrootlink" title="${esc(root)}">${esc(base(root))}</a> › ` : '';
    el.innerHTML = `<div class="jbcard jft"><div class="jft-top"><b>${crumb}${esc(base(folder))}</b><span class="bsub">${esc(folder)}</span><button class="jbbtn" id="jftRe" title="Read the folder again">↻</button><button class="jbbtn" id="jftOpen">Open in Explorer</button></div><div id="jftRoot" class="jft-list"><div class="bsub">Reading the folder…</div></div></div>`;
    $('#jftOpen').onclick = () => api.proj.openAt({ path: folder }).catch(() => jobId && api.proj.open({ jobId }));
    if ($('#jftUp')) $('#jftUp').onclick = (e) => { e.preventDefault(); filesAt = ''; tabFiles(root, jobId); };
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
    ents = ents.filter(e => e.dir || !/(\.(bak|dwl2?|sv\$|ac\$|tmp|err)$)|^~\$|^plot\.log$|^thumbs\.db$|^desktop\.ini$/i.test(e.name));   /* AutoCAD backups, lock files and Office temp files: never what Tom is looking for */
    if (!ents.length) { box.innerHTML = '<div class="bsub jft-empty">Empty</div>'; return; }
    box.innerHTML = ents.map(e => e.dir
      ? `<details class="jft-dir" data-rel="${esc(e.rel)}" data-path="${esc(e.path)}"><summary><span class="ic">📁</span><span class="nm">${esc(e.name)}</span><i></i></summary><div class="jft-kids"></div></details>`
      : `<div class="jft-file" data-rel="${esc(e.rel)}" data-path="${esc(e.path)}" title="Open ${esc(e.name)}"><span class="ic">${fIcon(e.name)}</span><span class="nm">${esc(e.name)}</span><i>${fDate(e.mtime)}</i><i>${fSize(e.size)}</i><button class="jbbtn sm" data-show="1" title="Show it in Explorer">Show</button></div>`).join('');
    box.querySelectorAll(':scope > details').forEach(d => {
      d.addEventListener('toggle', () => { if (d.open) { openDirs.add(d.dataset.path); if (!d.dataset.loaded) { d.dataset.loaded = '1'; fillDir(d.querySelector('.jft-kids'), ctx, d.dataset.rel); } } else openDirs.delete(d.dataset.path); });
      if (openDirs.has(d.dataset.path)) d.open = true;   // folders Tom opened stay open when the page refreshes
    });
    box.querySelectorAll(':scope > .jft-file').forEach(f => { f.onclick = (ev) => { const show = !!ev.target.closest('[data-show]'); if (!show && f.dataset.path && /\.pdf$/i.test(f.dataset.path)) { showPdf(f.dataset.path, { title: base(f.dataset.path) }); return; } (ctx.byPath ? api.proj.openAt({ path: f.dataset.path, show }) : api.proj.openFile({ jobId: ctx.jobId, rel: f.dataset.rel, show })).catch(err => { msg = clean(err); }); }; });
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
      ${O.needsMaster && !masterOk && V.master ? `<div class="jbbanner"><span><b>Master list built${V.master.tender ? ' from the scope documents (tender stage: tags and cable numbers to be allocated)' : ''}: ${V.master.devices} devices, ${V.master.cables} cables${(V.master.gaps || []).length ? `, ${V.master.gaps.length} gaps` : ''}.</b> Approve it and the BCDs and schedule can be made.</span><span class="jbbar" style="margin:0"><button class="jbbtn" id="jbToMaster">Review it</button><button class="jbbtn primary" id="jbApprove">✓ Approve it</button></span></div>` : ''}
      ${O.needsMaster && !masterOk && !V.master ? `<div class="jbbanner">BCDs and schedules are made from the master device list. <span data-runrow="${esc(runKey(O.job.id, 'MASTER'))}">${runCell(O.job.id, 'MASTER')}</span><button class="jbbtn" id="jbToMaster" ${RUNS.has(runKey(O.job.id, 'MASTER')) ? 'disabled' : ''}>${V.master ? 'Check and approve it' : 'Build it'}</button></div>` : ''}
      ${(O.dex || []).length ? `<div class="jbbanner jbdex"><div class="jbdexhead"><b>Dex</b><span class="bsub">${O.dex.filter(x => x.can === 'edit').length ? `${O.dex.filter(x => x.can === 'edit').length} ready to revise` : 'needs something from you'}</span></div>
        <div class="jbdexsays">${O.dex.map(x => `<div class="jbdexline ${esc(x.can)}"><span>${esc(x.say)}</span>${x.can === 'edit' ? `<button class="jbbtn primary small" data-revise-row="${esc(x.no)}">Revise</button>` : x.can === 'redraw' ? `<button class="jbbtn small" data-revise-row="${esc(x.no)}">Redraw with the changes</button>` : ''}</div>`).join('')}</div>
        <div class="jbdextell"><select id="jdTellNo">${rows.filter(r => r.group === 'drawing' || r.agent === 'Dex').map(r => `<option value="${esc(r.no)}" ${tellNo === r.no ? 'selected' : ''}>${esc(r.num)} · ${esc(r.ctitle)}</option>`).join('')}</select><input id="jdTell" placeholder="Tell Dex what to change on this drawing (e.g. change every LT to CT, all text black)"><button class="jbbtn" id="jdTellGo">Tell Dex</button>${O.dex.filter(x => x.can === 'edit').length > 1 ? `<button class="jbbtn primary" id="jdReviseAll">Revise all ${O.dex.filter(x => x.can === 'edit').length}</button>` : ''}</div></div>` : ''}
      ${(() => { const all = ((V.crs || []).filter(c => c.doc === '*' && !/responded|closed/i.test(c.status || ''))); if (!all.length) return ''; const dr = rows.filter(r => r.group === 'drawing'), can = dr.filter(r => r.canRev && !(r.work && r.work.status === 'working')), dwg = dr.filter(r => !r.canRev && r.src && r.src.dwg), none = dr.filter(r => !r.canRev && !(r.src && r.src.dwg));
        return `<div class="jbbanner jbask"><div><b>Asked for on every drawing</b> (${esc(all.map(c => c.by).filter(Boolean).join(', '))}): ${all.map(c => esc(c.comment)).join(' · ')}</div>
          <div class="bsub">${can.length} of ${dr.length} drawing${dr.length === 1 ? '' : 's'} can be revved now${dwg.length ? `. <b>${dwg.length} need a DXF first</b> (only a DWG on file): save each as DXF from AutoCAD next to the DWG, then press ↻ above the list` : ''}${none.length ? `. ${none.length} with no file in the job folder` : ''}.</div>
          ${dwg.length ? `<div class="jpin">${dwg.map(r => `<span title="${esc(r.src.dwg)}">${esc(r.num)} · ${esc(r.src.dwg.split('/').pop())}</span>`).join('')}</div>` : ''}
          ${can.length ? `<div class="jbbar" style="margin:6px 0 0"><button class="jbbtn primary" id="jbRevAll">Rev up all ${can.length} now</button><span class="bsub">Next P rev, title block only (${esc(issueStatus(all) || 'status unchanged')}), written into the next ISSUE folder under 013; the working files are not touched</span></div>` : ''}</div>`; })()}
      ${O.ngJob && (O.needNg || []).length ? `<div class="jbbanner jbask"><div><b>${O.needNg.length} deliverable${O.needNg.length === 1 ? ' has' : 's have'} no National Grid number yet</b>: ${O.needNg.map(n => { const r = rows.find(x => x.no === n); return esc(r ? (r.alt || r.no) + ' ' + r.ctitle : n); }).join(' · ')}</div><div class="bsub">On this job the NG number is the primary number and the file name. These go on a Document Request to BGEN document control before they can be issued.</div><div class="jbbar" style="margin:6px 0 0"><button class="jbbtn primary" id="jbDocReq">Write the Document Request</button></div></div>` : ''}
      ${rows.length ? `<div class="jbbar">${rows.some(r => r.agent && !r.work && !(r.src && (r.src.dxf || r.src.dwg || r.src.docx || r.src.xlsx)) && (masterOk || !['bcd', 'schedule'].includes(r.kind))) ? `<button class="jbbtn primary" id="jbAll">Make everything not made yet</button>` : ''}<button class="jbbtn" id="jbCheck" ${made ? '' : 'disabled'}>Cal: check the drawings</button><span class="bsub">${(O.dex || []).some(x => x.can === 'edit') ? 'Changes logged: press Revise on the row and Dex edits the drawing on file and revs it up.' : 'Each row: the agent makes it, Cal checks it, then it goes in the issue pack.'}</span></div>` : ''}
      <div class="jbrows">${['drawing', 'schedule', 'document', 'site', 'reserved'].map(g => { const R = rows.filter(r => (r.group || 'document') === g); if (!R.length) return ''; const made = R.filter(r => r.work && r.work.files).length;
        // a set (the 16 loop drawings, the 15 spool GAs) is one line, its sheets inside it; a single document is its own line
        const setOf = (r) => String(r.ctitle || r.title).replace(/\s*\(sheet \d+\)\s*$/i, '').trim().toLowerCase(); const sets = new Map(); for (const r of R) { const k = /\(sheet \d+\)\s*$/i.test(r.ctitle || r.title) ? setOf(r) : r.no; if (!sets.has(k)) sets.set(k, []); sets.get(k).push(r); }
        // why the row is on the list (Tom 10 Nov): the file and the words that asked for it, shown when the row is clicked
        const whyHtml = (r) => { const y = r.why; const how = y && { email: 'From an email', scope: 'From the scope documents', chat: 'From the chat', hand: 'Added by hand' }[y.how];
          const body = !y ? 'No reason saved: this row was added before the app kept them. Reading its documents again would save one.' : `${esc(how || 'From')}${y.from ? ': <b>' + esc(y.from) + '</b>' : ''}${y.quote ? ` — <q>${esc(y.quote)}</q>` : ''}`;
          return `<div class="jbwhy" data-why="${esc(r.no)}" hidden>${body}</div>`; };
        const rowHtml = (r) => { const w = r.work;
        return `<div class="jbrow" data-no="${esc(r.no)}">${whyHtml(r)}
          <div class="c1" data-whyrow="${esc(r.no)}" title="Click: why this is on the list"><b>${esc(r.num)}${r.alt ? ` <i class="jbalt">${esc(r.alt)}</i>` : ''}</b><span>${esc(r.ctitle)}</span>${w && w.summary && w.status !== 'made' && w.status !== 'working' ? `<i>${esc(w.summary)}</i>` : ''}${w && (w.status === 'working' || (w.check && w.check.status === 'working')) ? `<div class="jbrunrow" data-runrow="${esc(runKey(O.job.id, r.no))}">${runCell(O.job.id, r.no)}</div>` : ''}${w && w.warning ? `<i class="warn">${esc(w.warning)}</i>` : ''}</div>
          <div class="c2">${r.agent ? esc(r.agent) : (r.src && r.src.dxf ? 'Dex' : r.src && r.src.docx ? 'Wren' : r.src && r.src.xlsx ? 'Lex' : '<span class="bsub">by hand</span>')}</div>
          <div class="c3">${r.group === 'reserved' ? '<span class="st st-todo">not issued</span>' : ''}${r.group === 'drawing' && r.src && !r.src.dxf ? (r.src.dwg ? `<span class="st" title="${esc(r.src.dwg)}: Dex saves it as DXF with AutoCAD when he needs to edit or rev it.">DWG</span>` : r.agent ? '' : '<span class="st st-todo" title="No DXF, DWG or PDF for this number in the job folder">no file</span>') : ''}${openFor(r.no) ? `<span class="st st-needsyou" title="Changes logged against this drawing: press Revise">${openFor(r.no)} change${openFor(r.no) === 1 ? '' : 's'} to make</span>` : ''}${openFor(r.no) && !w ? '' : chip(w)}${w && w.rev && w.files ? `<span class="st">${esc(w.rev)}</span>` : ''}${w && w.check ? `<span class="st st-${w.check.status === 'passed' ? 'made' : w.check.status === 'working' ? 'working' : 'needsyou'}">${w.check.status === 'passed' ? 'Checked ✓' : w.check.status === 'working' ? 'Checking…' : `Check: ${w.check.count} to look at`}</span>` : ''}</div>
          <div class="c4">${w && w.files && w.files[0] ? `<span class="jbwhere" title="${esc(w.files[0])}">${esc(whereIs(w.files[0]))}</span>` : ''}${files(w)}${w && w.files && w.files[0] ? `<button class="jbfile jbreveal" data-reveal="${esc(w.files[0])}" title="Show ${esc(base(w.files[0]))} in its folder">📂 Show in folder</button>` : ''}${w && w.check && w.check.markups ? `<button class="jbfile" data-show="${esc(w.check.markups)}">MARKUPS</button>` : ''}${w && w.given ? `<button class="jbfile jbgiven" data-given="${esc(r.no)}" title="What ${esc(r.agent)} was given for this run">GIVEN</button>` : ''}</div>
          <div class="c5">${(() => { const busy = w && w.status === 'working', chg = openFor(r.no) > 0, hasDxf = r.src && r.src.dxf, hasDoc = r.src && (r.src.docx || r.src.xlsx);
            if (r.group === 'reserved') return '';
            if (chg && hasDxf) return `<button class="jbbtn primary" data-revise-row="${esc(r.no)}" ${busy ? 'disabled' : ''} title="Dex makes the logged changes on ${esc(r.src.dxf.split('/').pop())} (text edits) and revs it up into the issue folder">Revise</button><button class="jbbtn" data-revup="${esc(r.no)}" ${busy ? 'disabled' : ''} title="Next revision, title block only: the changes stay open for you to do in AutoCAD">Rev up only</button>`;
            if (chg && r.src && r.src.dwg && !hasDoc) return `<button class="jbbtn primary" data-revise-row="${esc(r.no)}" ${busy ? 'disabled' : ''} title="Dex saves ${esc(r.src.dwg.split('/').pop())} as DXF with AutoCAD, makes the logged changes and revs it up">Revise</button>`;
            let h = hasDxf || hasDoc ? `<button class="jbbtn" data-revup="${esc(r.no)}" ${busy ? 'disabled' : ''} title="${hasDxf ? `Next revision of ${esc(r.src.dxf.split('/').pop())}: new issue box and title block, content unchanged` : `Next revision of ${esc((r.src.docx || r.src.xlsx).split('/').pop())}: revision rows, header and cover, content unchanged`}">Rev up</button>` : '';
            if (r.agent) { const off = busy || (!masterOk && (r.kind === 'bcd' || r.kind === 'schedule')) ? 'disabled' : '';
              if (w && w.files && !hasDxf) h += `<button class="jbbtn" data-make="${esc(r.no)}" ${off} title="Make this revision again (the old copy goes to Archive)">Make again</button><button class="jbbtn ${chg ? 'primary' : ''}" data-rev="${esc(r.no)}" ${off} title="Next revision (e.g. P01 to P02); older versions go to Archive">Revision</button>`;
              else if (w && w.files && hasDxf) h += `<button class="jbbtn" data-rev="${esc(r.no)}" ${off} title="Dex draws the next revision again from the job's inputs (not from the DXF on file)">Redraw as next rev</button>`;
              else if (hasDxf) h += `<button class="jbbtn" data-make="${esc(r.no)}" ${off} title="Dex draws it again from the job's inputs: the DXF on file is not used">Redraw</button>`;
              else if (hasDoc) h += `<button class="jbbtn" data-make="${esc(r.no)}" ${off} title="${esc(r.agent)} writes it again from the job's inputs: the file on disk is not used">Rewrite</button>`;
              else if (chg) h += `<button class="jbbtn" data-revise-row="${esc(r.no)}" ${off} title="No drawing file on file: Dex draws it from the job's inputs with the logged changes">Redraw with the changes</button>`;
              else h += `<button class="jbbtn primary" data-make="${esc(r.no)}" ${off}>Make</button>`; }
            return h; })()}</div>
          ${w && w.questions ? `<div class="jbq"><b>${esc(r.agent)} asks:</b>${w.questions.map((q, i) => `<label class="plain">${esc(q)}</label><input data-ans="${i}" placeholder="Your answer">`).join('')}<button class="jbbtn primary" data-answer="${esc(r.no)}">Send answers</button></div>` : ''}
        </div>`; };
        const setHtml = (k, S) => { if (S.length === 1) return rowHtml(S[0]); const m = S.filter(r => r.work && r.work.files).length, busy = S.filter(r => r.work && r.work.status === 'working').length, need = S.filter(r => r.work && (r.work.status === 'needs you' || r.work.status === 'failed')).length, chg = S.reduce((n, r) => n + openFor(r.no), 0), open = openDirs.has('set:' + k);
          return `<details class="jbset" data-set="${esc(k)}" ${open ? 'open' : ''}><summary class="jbrow jbsetrow"><div class="c1"><b>${esc(String(S[0].ctitle || S[0].title).replace(/\s*\(sheet \d+\)\s*$/i, ''))}</b><span>${S.length} sheets · ${esc(S[0].num.replace(/\d+$/, ''))}${esc(S[0].num.match(/\d+$/) ? S[0].num.match(/\d+$/)[0] : '')} – ${esc(S[S.length - 1].num.match(/\d+$/) ? S[S.length - 1].num.match(/\d+$/)[0] : S[S.length - 1].num)}</span></div><div class="c2">${S[0].agent ? esc(S[0].agent) : '<span class="bsub">by hand</span>'}</div><div class="c3">${chg ? `<span class="st st-needsyou">${chg} change${chg === 1 ? '' : 's'}</span>` : ''}${busy ? '<span class="st st-working">Working…</span>' : ''}${need ? `<span class="st st-needsyou">${need} need you</span>` : ''}<span class="st ${m === S.length ? 'st-made' : 'st-todo'}">${m} of ${S.length} made</span></div><div class="c4"></div><div class="c5"><span class="bsub">${open ? 'Hide sheets' : 'Show sheets'}</span></div></summary><div class="jbsetrows">${S.map(rowHtml).join('')}</div></details>`; };
        return `<div class="jbgroup ${g === 'reserved' ? 'jbres' : ''}"><b>${{ drawing: 'Drawings', schedule: 'Schedules & lists', document: 'Documents & calculations', site: 'Site work & models', reserved: 'Reserved numbers (in the register, never issued, no file)' }[g]}</b><span class="bsub">${sets.size} item${sets.size === 1 ? '' : 's'} · ${R.length} document${R.length === 1 ? '' : 's'}${made ? ` · ${made} made` : ''}</span></div>` + [...sets].map(([k, S]) => setHtml(k, S)).join(''); }).join('')}</div>`;
    el.querySelectorAll('details.jbset').forEach(d => d.addEventListener('toggle', () => { if (d.open) openDirs.add('set:' + d.dataset.set); else openDirs.delete('set:' + d.dataset.set); const l = d.querySelector('summary .c5 .bsub'); if (l) l.textContent = d.open ? 'Hide sheets' : 'Show sheets'; }));
    // Build it: Lex builds the list now; once built, the button takes you to it (open, in view) to check and approve
    if ($('#jbApprove')) $('#jbApprove').onclick = () => act(async () => { await api.desk.approveMaster({ jobId: O.job.id }); msg = 'Master list approved. Make the BCD and the cable schedule from their rows.'; }, 'Approving…');
    if ($('#jbToMaster')) $('#jbToMaster').onclick = () => {
      if (!V.master) return act(async () => { await api.desk.buildMaster({ jobId: O.job.id }); const v = (await api.jobs.overview({ jobId: O.job.id })).desk.master; msg = v ? `Master list built: ${v.devices} devices, ${v.cables} cables${(v.gaps || []).length ? `, ${v.gaps.length} gap${v.gaps.length === 1 ? '' : 's'} to look at` : ''}. Review it, then press Approve it.` : 'Lex could not build the list: check the inputs are in the job folder (Inputs & setup).'; }, 'Lex is reading the job documents and building the master list (a minute or two)…');
      goMaster();
    };
    if ($('#jbAll')) $('#jbAll').onclick = () => act(() => api.jobs.makeAll({ jobId: O.job.id }), 'Making the deliverables…');
    if ($('#jbCheck')) $('#jbCheck').onclick = () => act(async () => { const r = await api.jobs.check({ jobId: O.job.id }); msg = `Cal checked against ${r.schedule}: ${r.headline || ''} ${r.findings} to look at.`; }, 'Cal is checking…');
    el.querySelectorAll('[data-make]').forEach(b => b.onclick = () => prep(b.closest('.jbrow'), b.dataset.make));
    // drop a marked-up PDF / picture on a drawing's row: Cal reads the red pen into the Comments tab against that drawing
    el.querySelectorAll('.jbrow[data-no]').forEach(row => {
      row.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); row.classList.add('drop'); } };
      row.ondragleave = () => row.classList.remove('drop');
      row.ondrop = (e) => { e.preventDefault(); row.classList.remove('drop'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return; const p = api.pathForFile ? api.pathForFile(f) : ''; if (!p) { toast('Could not read the dropped file', 'err'); return; }
        const no = row.dataset.no; act(async () => { const r = await api.jobs.readMarkup({ jobId: O.job.id, no, file: p }); msg = `${r.added} markup${r.added === 1 ? '' : 's'} logged against ${no}${r.skipped ? ` (${r.skipped} already there)` : ''}${r.unreadable ? '. Could not read: ' + r.unreadable : ''}. Make again fixes them.`; }, `${no}: Cal is reading the markup…`); };
    });
    // what the agent was given: request, files read, skills, schedule matches, queries, warnings; the full prompt as a text file
    el.querySelectorAll('[data-given]').forEach(b => b.onclick = () => { const row = b.closest('.jbrow'), w = (rows.find(r => r.no === b.dataset.given) || {}).work, g = w && w.given; if (!g) return; document.querySelectorAll('.jbprep').forEach(x => x.remove());
      const box = document.createElement('div'); box.className = 'jbprep'; const li = (a) => a && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="bsub">none</span>';
      box.innerHTML = `<div class="jbgiven-g"><div><label>Asked for</label><div class="jbgtext">${esc(g.request || '')}</div></div><div><label>Files read</label>${li(g.read)}</div><div><label>Skills</label>${li(g.skills)}</div><div><label>Schedule matches (the schedule's value used)</label>${li(g.fromSchedule)}</div><div><label>Queries to the RFI register</label>${li(g.queries)}</div><div><label>Layout warnings</label>${li(g.warnings)}</div></div>
        <div class="jbbar">${g.file ? `<button class="jbbtn" id="jgOpen">Open the full prompt</button>` : ''}<button class="jbbtn" id="jgClose">Close</button><span class="bsub">${esc(new Date(g.at).toLocaleString('en-GB'))}</span></div>`;
      row.appendChild(box); if ($('#jgOpen')) $('#jgOpen').onclick = () => api.openExternal(g.file); $('#jgClose').onclick = () => box.remove(); });
    el.onclick = (e) => { const b = e.target.closest('[data-stop]'); if (!b) return; b.disabled = true; b.textContent = 'Stopping…'; api.runs.stop({ jobId: O.job.id, no: b.dataset.stop }).catch(() => {}); };
    el.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => revPanel(b.closest('.jbrow'), b.dataset.rev));
    const allAsks = () => (V.crs || []).filter(c => c.doc === '*' && !/responded|closed/i.test(c.status || ''));
    const ppl = () => { const p = lastPeople() || {}; return { drawn: p.drawn || '', checked: p.checked || '', approved: p.approved || '' }; };
    if ($('#jbDocReq')) $('#jbDocReq').onclick = () => act(async () => { const p = (lastPeople() || {}); const r = await api.jobs.docRequest({ jobId: O.job.id, submittedBy: p.drawn || '' }); msg = `Document Request written: ${r.file.split(/[\\/]/).pop()} (${r.rows.length} number${r.rows.length === 1 ? '' : 's'} asked for). Send it to BGEN document control; when the numbers come back, tell Eli and he renumbers the rows.`; api.showItem && api.showItem(r.file); }, 'Eli is writing the Document Request…');
    el.querySelectorAll('[data-revup]').forEach(b => b.onclick = () => act(() => api.jobs.revUp({ jobId: O.job.id, no: b.dataset.revup, status: issueStatus(allAsks()), people: ppl() }), `${b.dataset.revup}: Dex is revving it up…`));
    const reviseRow = (no) => act(async () => { const r = await api.jobs.revise({ jobId: O.job.id, no, status: issueStatus(allAsks()), people: ppl() }); if (r && r.summary) msg = `Dex · ${no}: ${r.summary}`; }, `${no}: Dex is making the changes…`);
    el.querySelectorAll('[data-revise-row]').forEach(b => b.onclick = () => reviseRow(b.dataset.reviseRow));
    if ($('#jdReviseAll')) $('#jdReviseAll').onclick = () => { const list = (O.dex || []).filter(x => x.can === 'edit').map(x => x.no); act(async () => { const bad = []; for (const no of list) { try { await api.jobs.revise({ jobId: O.job.id, no, status: issueStatus(allAsks()), people: ppl() }); } catch (e) { bad.push(`${no}: ${clean(e)}`); } } if (bad.length) throw new Error(bad.join(' · ')); }, `Dex is revising ${list.length} drawings…`); };
    if ($('#jdTellNo')) $('#jdTellNo').onchange = () => { tellNo = $('#jdTellNo').value; };
    if ($('#jdTellGo')) { const go = () => { const t = $('#jdTell').value.trim(), no = $('#jdTellNo').value; tellNo = no; if (!t || !no) return; act(async () => { await api.desk.addComment({ jobId: O.job.id, doc: no, comment: t, by: 'Tom' }); msg = `Logged against ${no}. Dex: got it — press Revise on ${no} when you want me to do it.`; }, 'Telling Dex…'); }; $('#jdTellGo').onclick = go; $('#jdTell').onkeydown = (e) => { if (e.key === 'Enter') go(); }; }
    if ($('#jbRevAll')) $('#jbRevAll').onclick = () => { const list = rows.filter(r => r.group === 'drawing' && r.canRev && !(r.work && r.work.status === 'working')); act(async () => { const bad = []; for (const r of list) { try { if (r.agent === 'Dex' && !(r.src && r.src.dxf)) continue; await api.jobs.revUp({ jobId: O.job.id, no: r.no, status: issueStatus(allAsks()), people: ppl() }); } catch (e) { bad.push(`${r.num}: ${clean(e)}`); } } if (bad.length) throw new Error(bad.join(' · ')); }, `Dex is revving up ${list.length} drawings…`); };
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
  const issueStatus = (cs) => { for (const c of cs || []) { const m = String(c.comment || '').match(/\b(issued? for (?:comment|construction|approval|information|tender|review))\b/i); if (m) return m[1].toUpperCase().replace(/^ISSUE /, 'ISSUED '); } return ''; };
  const whereIs = (p) => { const parts = String(p || '').split(/[\\/]/); const name = parts.pop(), dir = parts.pop() || ''; const root = (O && O.job && O.job.folder) || ''; const inJob = root && String(p).toLowerCase().startsWith(root.toLowerCase()); return `${inJob ? '' : '… '}${dir ? dir + ' \\ ' : ''}${name}`; };   // "CLAUDE DESGIN \ X11475-...-7147_P04.dxf"
  const openList = (no) => { const r = O && O.rows.find(x => x.no === no); return ((O && O.desk.crs) || []).filter(c => (c.doc === no || (c.doc === '*' && !(r && r.group === 'reserved'))) && !/responded|closed/i.test(c.status || '')); };   // '*' = every drawing on the job (not a reserved number)
  const openFor = (no) => openList(no).length;
  // a new revision: the next one at the same stage (P01 > P02) unless another is typed (e.g. C01); anything different goes to the agent
  async function revPanel(rowEl, no) {
    document.querySelectorAll('.jbprep').forEach(x => x.remove());
    const box = document.createElement('div'); box.className = 'jbprep'; box.innerHTML = '<div class="bsub">Getting ready…</div>'; rowEl.appendChild(box);
    let P; try { P = await api.jobs.plan({ jobId: O.job.id, no }); } catch (e) { box.innerHTML = `<div class="bsub">${esc(clean(e))}</div>`; return; }
    const cs = openList(no), pp = P.people || lastPeople();
    box.innerHTML = `<div class="jbprep-g"><div>
        <label>New revision</label><div class="jbbar" style="margin:0"><span class="st">${esc(P.rev || 'P01')}</span><span>→</span><input id="jrTo" value="${esc(P.nextRev)}" maxlength="3" style="width:70px;text-transform:uppercase"><span class="bsub">Type another to jump stage, e.g. A01 for comment, C01 for construction.</span></div>
        <label>Revision table description</label><input id="jrDesc" maxlength="40" value="${esc(cs.length ? 'REVISED PER CLIENT COMMENTS ' + new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '')}" placeholder="e.g. REVISED PER CLIENT COMMENTS 04/11/26 (empty = PRELIMINARY REVISED / ISSUED FOR CONSTRUCTION by stage)" style="width:100%">
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
      act(() => api.jobs.revision({ jobId: O.job.id, no, to: want, note: box.querySelector('#jrNote').value.trim(), people, desc: box.querySelector('#jrDesc').value.trim() }), `${no}: ${P.agent} is making ${want || P.nextRev}…`);
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
        ${dl.length ? (() => { const pk = new Map(); for (const x of dl) { const k = x.no ? x.from || '' : '\u0000' + (x.title || x.type); if (!pk.has(k)) pk.set(k, []); pk.get(k).push(x); }
          return `<label>Deliverables asked for (${dl.length} document${dl.length === 1 ? '' : 's'})</label>` + [...pk].map(([k, xs]) => xs[0].no ? `<div class="bsub" style="margin:6px 0 2px">${esc(k)}: already on file</div><div class="jpin">${xs.map(x => `<span title="${esc(x.file || '')}">${esc(x.no)} ${esc(x.title)}${x.rev ? ' · ' + esc(x.rev) : ''}</span>`).join('')}</div>` : `<div class="jpin">${xs.map(x => `<span>${esc(x.title || x.type)}${x.qty > 1 ? ' ×' + x.qty : ''}</span>`).join('')}</div>`).join(''); })() : ''}
        ${(e.foundInputs || []).length ? `<label>Already in the job folder</label><div class="jpin">${e.foundInputs.map(f => `<span title="${esc(f.files.join('\n'))}">✓ ${esc(f.need)}</span>`).join('')}</div>` : ''}
        ${(e.missingInputs || []).length ? `<label>Still needed from the client</label><div class="jpin">${e.missingInputs.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        ${J ? `<div class="emchat">${(e.notes || []).map(n => `<div class="emq"><b>You:</b> ${esc(n.text)}</div>`).join('')}${e.eliSays ? `<div class="ema"><b>Eli:</b> ${esc(e.eliSays)}</div>` : ''}<div class="jbbar"><input id="emTell" placeholder="Tell Eli something, e.g. the document list is in the transmittal folder" style="flex:1"><button class="jbbtn" id="emTellGo">Tell Eli</button></div><span id="emTellMsg" class="bsub"></span></div>` : ''}
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
    if ($('#emTellGo')) { const go = async () => { const t = $('#emTell').value.trim(); if (!t) return; $('#emTellMsg').textContent = 'Eli is looking…'; $('#emTellGo').disabled = true; try { const r = await api.mail.tell({ id: e.id, jobId: J ? J.id : '', text: t }); showEmail({ ...R, email: r.email }, jobId); } catch (err) { $('#emTellMsg').textContent = clean(err); $('#emTellGo').disabled = false; } }; $('#emTellGo').onclick = go; $('#emTell').onkeydown = (ev) => { if (ev.key === 'Enter') go(); }; }
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
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const no = (b.closest('.jbrow') || {}).dataset ? b.closest('.jbrow').dataset.no : ''; const items = ((O && O.desk.crs) || []).filter(c => no && c.doc === no); showPdf(b.dataset.open, { no, items, title: no ? `${no} · ${base(b.dataset.open)}` : '' }); });
    el.querySelectorAll('[data-whyrow]').forEach(c => c.onclick = (e) => { if (e.target.closest('button, a, select, input')) return; const y = el.querySelector(`.jbwhy[data-why="${CSS.escape(c.dataset.whyrow)}"]`); if (y) y.hidden = !y.hidden; });
    el.querySelectorAll('[data-reveal]').forEach(b => b.onclick = (e) => { e.stopPropagation(); api.showItem(b.dataset.reveal); });
    el.querySelectorAll('[data-show]').forEach(b => b.onclick = () => { const no = (b.closest('.jbrow') || {}).dataset ? b.closest('.jbrow').dataset.no : ''; showMarkups(b.dataset.show, no); });
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

  // talk to Eli about this job: ask, correct the register, remove or add deliverables, close RFIs; he says what he changed.
  // A question in flight survives clicking to another tab and back (the answer lands when it comes, wherever Tom is)
  const eliPending = new Map();   // jobId -> { text, promise }
  async function tabEli() {
    const el = $('#jbTab'), jobId = O.job.id;
    el.innerHTML = `<div class="jbcard elichat"><div class="elilog" id="eliLog"><div class="bsub">Loading…</div></div>
      <div class="jbbar elibar"><textarea id="eliIn" rows="2" placeholder="Ask Eli about the job, or tell him what to change: 'remove the three switchroom option rows', 'the cable schedule is one workbook not three', 'close RFI-002, Lee answered it'"></textarea><button class="jbbtn primary" id="eliGo">Send</button></div><div id="eliFiles"></div>
      <div class="bsub">Eli sees the register, the RFIs, the open comments, what the scope documents said and the job folder. He changes things only when you tell him to, and says exactly what he changed.</div></div>`;
    const draw = (chat) => { const log = $('#eliLog'); if (!log) return; log.innerHTML = (chat || []).length ? chat.map(m => `<div class="elim ${m.role}"><b>${m.role === 'tom' ? 'You' : 'Eli'}</b><div>${esc(m.text).replace(/\n/g, '<br>')}</div>${m.done && m.done.length ? `<div class="elidone">${m.done.map(x => `<span>✓ ${esc(x)}</span>`).join('')}</div>` : ''}</div>`).join('') : `<div class="elim eli"><b>Eli</b><div>Morning. I've got ${O.rows.length} row${O.rows.length === 1 ? '' : 's'} on the register for ${esc(O.job.number)}, ${(O.desk.rfis || []).filter(r => !/closed|answered/i.test(r.status)).length} open RFI(s) and ${(O.desk.crs || []).filter(c => !/responded|closed/i.test(c.status || '')).length} open comment(s). What do you want to know, or change?</div></div>`;
      const p = eliPending.get(jobId); if (p) { log.insertAdjacentHTML('beforeend', `<div class="elim eli thinking"><b>Eli</b><div>… (thinking about: ${esc(p.text.slice(0, 80))})</div></div>`); if ($('#eliGo')) $('#eliGo').disabled = true; }
      log.scrollTop = log.scrollHeight; };
    try { draw((await api.eli.chatLog({ jobId })).chat); } catch (e) { const log = $('#eliLog'); if (log) log.innerHTML = `<div class="bsub">${esc(clean(e))}</div>`; }
    // a screenshot pasted (Ctrl+V) or dropped on the chat goes with the next message
    const eliFiles = []; const readF = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, base64: String(r.result).split(',')[1] || '' }); r.onerror = rej; r.readAsDataURL(f); });
    const showEliFiles = () => { const box = $('#eliFiles'); if (box) box.innerHTML = eliFiles.map((f, i) => `<span class="o3f"><img src="data:image/png;base64,${f.base64}" alt="" style="height:28px;border-radius:3px;margin-right:4px">${esc(f.name)} <button data-rm="${i}">×</button></span>`).join(''); if (box) box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { eliFiles.splice(+b.dataset.rm, 1); showEliFiles(); }); };
    const takeFiles = async (list) => { for (const f of [...(list || [])]) if (/^image\//.test(f.type)) eliFiles.push(await readF(f.name ? f : new File([f], `screenshot-${eliFiles.length + 1}.png`, { type: f.type }))); showEliFiles(); };
    $('#eliIn').onpaste = (e) => { const items = [...((e.clipboardData || {}).items || [])].filter(i => i.kind === 'file'); if (!items.length) return; e.preventDefault(); takeFiles(items.map((i, k) => { const f = i.getAsFile(); return f && new File([f], `screenshot-${eliFiles.length + k + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }); }).filter(Boolean)); };
    $('#eliIn').ondragover = (e) => e.preventDefault(); $('#eliIn').ondrop = (e) => { e.preventDefault(); e.stopPropagation(); takeFiles(e.dataTransfer.files); };
    const send = async () => { const t = $('#eliIn').value.trim(); if ((!t && !eliFiles.length) || eliPending.has(jobId)) return; const log = $('#eliLog'); $('#eliIn').value = ''; $('#eliGo').disabled = true; const files = eliFiles.splice(0); showEliFiles(); log.insertAdjacentHTML('beforeend', `<div class="elim tom"><b>You</b><div>${esc(t)}${files.length ? `<div class="bsub">${esc(files.map(f => f.name).join(', '))}</div>` : ''}</div></div><div class="elim eli thinking"><b>Eli</b><div>…</div></div>`); log.scrollTop = log.scrollHeight;
      const promise = api.eli.chat({ jobId, text: t || '(picture)', files }); eliPending.set(jobId, { text: t, promise });
      let r = null, err = null; try { r = await promise; } catch (e) { err = e; } eliPending.delete(jobId);
      const here = sel === jobId && tab === 'eli';   // still on this job's Eli tab?
      if (err) { if (here) { const th = document.querySelector('#eliLog .thinking div'); if (th) th.textContent = clean(err); const g = $('#eliGo'); if (g) g.disabled = false; } else toast('Eli: ' + clean(err), 'err'); return; }
      if (r.done && r.done.length) { try { O = await api.jobs.overview({ jobId }); } catch {} }
      if (here) { if (r.done && r.done.length) renderJob(); else { draw(r.chat); const g = $('#eliGo'); if (g) g.disabled = false; } }
      else toast(`Eli (${O.job.number}): ${r.reply.slice(0, 140)}${r.reply.length > 140 ? '…' : ''}`); };
    $('#eliGo').onclick = send; $('#eliIn').onkeydown = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); } }; $('#eliIn').focus();
  }
  // talk to Dave or Tom about this job. They work from their own brief and can do what Eli can on the job, and hand work to Lex, Wren, Ada,
  // Cal and Dex; nothing goes to a client and nothing is approved by them. A question in flight survives clicking away, as with Eli
  const leadPending = new Map();   // agentId:jobId -> { text, promise }
  async function tabLead(agent) {
    const el = $('#jbTab'), jobId = O.job.id, key = agent.id + ':' + jobId, who = agent.name;
    el.innerHTML = `<div class="jbcard elichat"><div class="elilog" id="eliLog"><div class="bsub">Loading…</div></div>
      <div class="jbbar elibar"><textarea id="eliIn" rows="2" placeholder="${esc(agent.id === 'dave' ? "Ask Dave: 'draft the fee proposal for this enquiry', 'check the protection on the SLD', 'what do we need from the client before we start?'" : "Ask Tom: 'revise the drawings for the SPEN comments', 'check the loop sheets against the BCD', 'build the issue and draft the transmittal'")}"></textarea><button class="jbbtn primary" id="eliGo">Send</button></div><div id="eliFiles"></div>
      <div class="bsub">${esc(who)} works from his brief, plus anything you add to his rulebook in the File Room. He can do what Eli can on the job, and hand work to Lex, Wren, Ada, Cal and Dex. Engineering work comes back marked DRAFT, and he never sends or approves anything.</div></div>`;
    const draw = (chat) => { const log = $('#eliLog'); if (!log) return; log.innerHTML = (chat || []).length ? chat.map(m => `<div class="elim ${m.role === 'tom' ? 'tom' : 'eli'}"><b>${m.role === 'tom' ? 'You' : esc(who)}</b><div>${esc(m.text).replace(/\n/g, '<br>')}</div>${m.done && m.done.length ? `<div class="elidone">${m.done.map(x => `<span>✓ ${esc(x)}</span>`).join('')}</div>` : ''}</div>`).join('') : `<div class="elim eli"><b>${esc(who)}</b><div>I've got ${esc(O.job.number)} open with ${O.rows.length} row${O.rows.length === 1 ? '' : 's'} on the register. What do you need?</div></div>`;
      const p = leadPending.get(key); if (p) { log.insertAdjacentHTML('beforeend', `<div class="elim eli thinking"><b>${esc(who)}</b><div>… (working on: ${esc(p.text.slice(0, 80))})</div></div>`); if ($('#eliGo')) $('#eliGo').disabled = true; }
      log.scrollTop = log.scrollHeight; };
    try { draw((await api.lead.chatLog({ agentId: agent.id, jobId })).chat); } catch (e) { const log = $('#eliLog'); if (log) log.innerHTML = `<div class="bsub">${esc(clean(e))}</div>`; }
    const pics = []; const readF = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, base64: String(r.result).split(',')[1] || '' }); r.onerror = rej; r.readAsDataURL(f); });
    const showPics = () => { const box = $('#eliFiles'); if (box) box.innerHTML = pics.map((f, i) => `<span class="o3f">${esc(f.name)} <button data-rm="${i}">×</button></span>`).join(''); if (box) box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { pics.splice(+b.dataset.rm, 1); showPics(); }); };
    const take = async (list) => { for (const f of [...(list || [])]) if (/^image\//.test(f.type) || /\.pdf$/i.test(f.name || '')) pics.push(await readF(f)); showPics(); };
    $('#eliIn').onpaste = (e) => { const items = [...((e.clipboardData || {}).items || [])].filter(i => i.kind === 'file'); if (!items.length) return; e.preventDefault(); take(items.map((i, k) => { const f = i.getAsFile(); return f && new File([f], `screenshot-${pics.length + k + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }); }).filter(Boolean)); };
    $('#eliIn').ondragover = (e) => e.preventDefault(); $('#eliIn').ondrop = (e) => { e.preventDefault(); e.stopPropagation(); take(e.dataTransfer.files); };
    const send = async () => { const t = $('#eliIn').value.trim(); if ((!t && !pics.length) || leadPending.has(key)) return; const log = $('#eliLog'); $('#eliIn').value = ''; $('#eliGo').disabled = true; const files = pics.splice(0); showPics(); log.insertAdjacentHTML('beforeend', `<div class="elim tom"><b>You</b><div>${esc(t)}${files.length ? `<div class="bsub">${esc(files.map(f => f.name).join(', '))}</div>` : ''}</div></div><div class="elim eli thinking"><b>${esc(who)}</b><div>…</div></div>`); log.scrollTop = log.scrollHeight;
      const promise = api.lead.chat({ agentId: agent.id, jobId, text: t || '(see the attachment)', files }); leadPending.set(key, { text: t, promise });
      let r = null, err = null; try { r = await promise; } catch (e) { err = e; } leadPending.delete(key);
      const here = sel === jobId && tab === 'lead:' + agent.id;
      if (err) { if (here) { const th = document.querySelector('#eliLog .thinking div'); if (th) th.textContent = clean(err); const g = $('#eliGo'); if (g) g.disabled = false; } else toast(`${who}: ${clean(err)}`, 'err'); return; }
      if (r.done && r.done.length) { try { O = await api.jobs.overview({ jobId }); } catch {} }
      if (here) { if (r.done && r.done.length) renderJob(); else { draw(r.chat); const g = $('#eliGo'); if (g) g.disabled = false; } }
      else toast(`${who} (${O.job.number}): ${r.reply.slice(0, 140)}${r.reply.length > 140 ? '…' : ''}`); };
    $('#eliGo').onclick = send; $('#eliIn').onkeydown = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); } }; $('#eliIn').focus();
  }
  function tabComments() {
    const V = O.desk, el = $('#jbTab'), docs = O.rows.map(r => r.no);
    const byDoc = {}; (V.crs || []).forEach(c => { const k = c.doc === '*' ? 'All drawings and documents' : (c.doc || 'General'); (byDoc[k] = byDoc[k] || []).push(c); });
    el.innerHTML = `<div class="jbcard"><b>Log client comments</b><div class="jbbar"><select id="jcDoc">${docs.map(d => `<option>${esc(d)}</option>`).join('')}<option value="*">All drawings and documents</option><option value="">General</option></select><input id="jcBy" placeholder="Who (e.g. Steve, NG)" style="max-width:200px"></div><textarea id="jcText" rows="3" placeholder="Paste the comment(s), one per line"></textarea><div class="jbbar"><button class="jbbtn primary" id="jcAdd">Add to the CRS</button></div></div>
      ${Object.keys(byDoc).length ? Object.entries(byDoc).map(([doc, cs]) => { const open = cs.filter(c => !/responded|closed/i.test(c.status || ''));
        return `<div class="jbcard"><div class="jbhead2"><b>${esc(doc)}</b>${O.rows.some(r => r.no === doc && (r.agent === 'Dex' || (r.src && r.src.dxf))) && open.length ? `<button class="jbbtn primary" data-revise="${esc(doc)}">Dex: revise the drawing for these ${open.length}</button>` : ''}${(() => { const x = (O.dex || []).find(d => d.no === doc); return x && x.can !== 'edit' ? `<span class="bsub jbdexnote">Dex: ${esc(x.say.replace(/^[^:]+: /, ''))}</span>` : ''; })()}</div>
          ${cs.map(c => `<div class="jbc ${/responded|closed/i.test(c.status || '') ? 'done' : ''}"><span class="bsub">${esc(c.no)} · ${esc(c.by || '')}</span><div>${esc(c.comment)}</div>${c.response ? `<div class="resp">↳ ${esc(c.response)}</div>` : ''}${!/responded|closed/i.test(c.status || '') ? `<button class="jbbtn" data-crsclose="${esc(c.no)}" title="Not a change: close it without doing anything">Close</button>` : ''}</div>`).join('')}</div>`; }).join('') : '<div class="jbempty"><b>No client comments yet.</b><span>When comments come back, log them here (or forward the email to Eli). Each drawing can then be revised in one click: next revision, changes clouded.</span></div>'}`;
    $('#jcAdd').onclick = async () => { const lines = $('#jcText').value.split('\n').map(s => s.trim()).filter(Boolean); if (!lines.length) return; for (const l of lines) await api.desk.addComment({ jobId: sel, doc: $('#jcDoc').value, comment: l, by: $('#jcBy').value }); refresh(); };
    el.querySelectorAll('[data-crsclose]').forEach(b => b.onclick = () => act(async () => { await api.desk.crs({ jobId: O.job.id, row: { no: b.dataset.crsclose, status: 'Closed', response: 'Closed by Tom: no change' } }); }, 'Closing…'));
    el.querySelectorAll('[data-revise]').forEach(b => b.onclick = () => { const doc = b.dataset.revise; tab = 'deliv'; act(async () => { const r = await api.jobs.revise({ jobId: sel, no: doc }); if (r && r.summary) msg = `Dex · ${doc}: ${r.summary}`; }, `${doc}: Dex is making the changes…`); });
  }

  function tabIssue() {
    const el = $('#jbTab'), ready = O.rows.filter(r => r.work && r.work.files);
    const ng = O.ngJob && (O.needNg || []).length ? O.needNg : [];
    el.innerHTML = `<div class="jbcard"><b>Issue pack</b><div class="bsub">Made deliverables: ${ready.length} of ${O.rows.length}. Before issue: checked both ways, monochrome PDFs beside each DXF, revisions right, nothing struck off, transmittal matches the folder.</div>
      ${ng.length ? `<div class="jbmsg">Not ready: ${ng.length} deliverable${ng.length === 1 ? '' : 's'} without a National Grid number (${ng.map(n => esc(n)).join(', ')}). Write the Document Request from the Deliverables tab and renumber when BGEN reply; nothing goes out under our own number.</div>` : ''}
      ${ready.map(r => `<div class="jbc"><b>${esc(r.no)}</b> ${esc(r.title)} <span class="bsub">${r.work.rev ? 'rev ' + esc(r.work.rev) : ''} ${r.work.check ? (r.work.check.status === 'passed' ? '· checked ✓' : '· check: ' + r.work.check.count + ' to look at') : '· not checked'}</span></div>`).join('')}
      <div class="jbbar"><button class="jbbtn primary" id="jbIssue" ${ready.length ? '' : 'disabled'}>Prepare the issue (transmittal, register, cover email)</button>${O.desk.openIssue ? `<button class="jbbtn" id="jbSent" title="You sent ISSUE ${esc(O.desk.openIssue.n)} yourself: the next revision opens ISSUE ${esc(O.desk.openIssue.n + 1)} and never writes into this one">I've sent ISSUE ${esc(O.desk.openIssue.n)}</button>` : ''}</div></div>`;
    $('#jbIssue').onclick = async () => { await api.biz.setCurrent({ id: sel }); if (openIssue) openIssue(sel); };
    if ($('#jbSent')) $('#jbSent').onclick = () => act(async () => { const r = await api.jobs.issueSent({ jobId: sel }); msg = `ISSUE ${r.n} is marked as sent. The next revision opens ISSUE ${r.n + 1}.`; }, 'Marking it sent…');
  }

  // ---------- new job ----------
  // a drop zone for the client's files or whole folder; returns { paths(), el }
  function dropZone(host, { hint = 'Emails, schedules, drawings, letters, photos — a whole folder is fine' } = {}) {
    const paths = [];
    host.innerHTML = `<div class="emdrop" id="fdZone"><b>Drop the client's files or folder here</b><span>${esc(hint)}</span><div class="jbbar" style="margin-top:6px"><button class="jbbtn" type="button" id="fdPickFolder">Choose a folder…</button><button class="jbbtn" type="button" id="fdPickFile">Choose a file…</button></div></div><ul class="fdlist" id="fdList"></ul>`;
    const list = host.querySelector('#fdList'), zone = host.querySelector('#fdZone');
    const show = () => { list.innerHTML = paths.map((p, i) => `<li><span>${esc(p.split(/[\\/]/).pop())}</span><i>${esc(p)}</i><button class="x" data-i="${i}" title="Remove">×</button></li>`).join(''); list.querySelectorAll('button.x').forEach(b => b.onclick = () => { paths.splice(+b.dataset.i, 1); show(); }); };
    const add = (ps) => { for (const p of ps) if (p && !paths.includes(p)) paths.push(p); show(); };
    zone.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); zone.classList.add('over'); } };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('over'); add([...e.dataTransfer.files].map(f => api.pathForFile ? api.pathForFile(f) : f.path).filter(Boolean)); };
    host.querySelector('#fdPickFolder').onclick = async () => { const f = await api.biz.pickFolder(); if (f) add([f]); };
    host.querySelector('#fdPickFile').onclick = async () => { const f = await api.biz.pickFile({}); if (f) add([f]); };
    return { paths: () => paths.slice(), el: zone };
  }
  const filedSummary = (r) => {
    const by = {}; for (const f of r.filed || []) { const d = f.to.split(/[\\/]/).slice(0, -1).pop() || ''; by[d] = (by[d] || 0) + 1; }
    const parts = Object.entries(by).map(([d, n]) => `${n} → ${d}`);
    if (r.emails && r.emails.length) parts.push(`${r.emails.length} email${r.emails.length === 1 ? '' : 's'} read by Eli (${r.emails.reduce((a, e) => a + (e.deliverables || 0), 0)} deliverable(s), ${r.emails.reduce((a, e) => a + (e.comments || 0), 0)} comment(s))`);
    if (r.scope) parts.push(`scope documents read: ${r.scope.listed} deliverable(s) listed, ${r.scope.added} added${(r.scope.conflicts || []).length ? `, ${r.scope.conflicts.length} point(s) where the documents disagree (Inputs & setup)` : ''}`);
    if (r.skipped && r.skipped.length) parts.push(`${r.skipped.length} already there`);
    if (r.errors && r.errors.length) parts.push('could not read: ' + r.errors.join('; '));
    return parts.length ? 'Filed: ' + parts.join(' · ') : 'Nothing to file.';
  };
  // add the client's files to an existing job
  function addFiles(job) {
    const m = $('#jbMain');
    m.innerHTML = `<div class="jbhead"><div><h2>Add files · ${esc(job.number)}</h2><div class="bsub">Everything is filed into the job folder where it belongs; emails are read by Eli for scope, deliverables and comments.</div></div></div><div class="jbcard" id="fdHost"></div><div class="jbbar"><button class="jbbtn primary" id="fdGo">File them</button><button class="jbbtn" id="fdCancel">Cancel</button></div><div id="fdMsg" class="bsub"></div>`;
    const dz = dropZone($('#fdHost'));
    $('#fdCancel').onclick = () => refresh();
    $('#fdGo').onclick = async () => { const paths = dz.paths(); if (!paths.length) { $('#fdMsg').textContent = 'Drop something first.'; return; } $('#fdGo').disabled = true; $('#fdMsg').innerHTML = `<span data-runrow="${esc(runKey(job.id, 'FILES'))}">${runCell(job.id, 'FILES') || 'Starting…'}</span>`;
      try { const r = await api.jobs.fileIn({ jobId: job.id, paths }); msg = filedSummary(r); tab = r.suggest && r.suggest.length ? 'deliv' : 'files'; if (window.toast) window.toast(msg); refresh(); } catch (e) { $('#fdMsg').textContent = clean(e); $('#fdGo').disabled = false; } };
  }
  async function newJob() {
    let D = { nextNumber: '', saved: '', guess: '' }; try { D = await api.mail.defaults(); } catch {}
    let parent = D.saved || D.guess || '', link = '';
    const m = $('#jbMain');
    m.innerHTML = `<div class="jbhead"><div><h2>New job</h2><div class="bsub">The number is X + today's date unless you change it.</div></div></div>
      <div class="jbcard jbform"><label>Job number</label><input id="njNo" value="${esc(D.nextNumber || '')}"><label>Job name / site</label><input id="njName" placeholder="e.g. Eakring Training Centre"><label>Client</label><input id="njClient" placeholder="e.g. National Grid">
        <label>Drawing border</label><div class="jbseg" id="njBorder">${[['auto', 'Automatic (by client)'], ['atomax', 'Atomax'], ['ng', 'National Grid'], ['bgen', 'BGEN'], ['pbe', 'PBE Group'], ['client', 'Client title block (File Room)']].map(([k, t]) => `<button type="button" data-b="${k}" class="${k === 'auto' ? 'on' : ''}">${t}</button>`).join('')}</div>
        <label>Project folder</label>
        <label class="plain"><input type="radio" name="njMode" value="create" checked> New folder from the Atomax template in <b id="njParent">${esc(parent || '(choose where your job folders live)')}</b> <button class="jbbtn" id="njParentPick" type="button">Change…</button></label>
        <label class="plain"><input type="radio" name="njMode" value="link"> A folder I already have <button class="jbbtn" id="njLinkPick" type="button">Choose…</button> <span id="njLink" class="bsub"></span></label>
        <label class="plain"><input type="radio" name="njMode" value="none"> No folder yet</label>
        <label>The client's files</label><div id="njDrop"></div>
        <div class="jbbar"><button class="jbbtn primary" id="njSave">Create job</button><button class="jbbtn" id="njCancel">Cancel</button></div><div id="njMsg" class="bsub"></div></div>`;
    const dz = dropZone($('#njDrop'), { hint: 'Drop the whole folder the client sent: it is filed into the new job folder (emails read by Eli) as the job is created' });
    $('#njBorder').querySelectorAll('button').forEach(b => b.onclick = () => { $('#njBorder').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#njParentPick').onclick = async () => { const f = await api.mail.pickParent(); if (f) { parent = f; $('#njParent').textContent = f; } };
    $('#njLinkPick').onclick = async () => { const f = await api.biz.pickFolder(); if (f) { link = f; $('#njLink').textContent = f; m.querySelector('input[value="link"]').checked = true; } };
    $('#njCancel').onclick = () => refresh();
    $('#njSave').onclick = async () => { const mode = m.querySelector('input[name="njMode"]:checked').value; $('#njMsg').textContent = 'Creating…';
      try { const r = await api.mail.newJob({ number: $('#njNo').value, name: $('#njName').value, client: $('#njClient').value, mode, folder: mode === 'create' ? parent : link }); const bk = (($('#njBorder') || {}).querySelector || (() => null)).call($('#njBorder'), 'button.on'); if (bk && bk.dataset.b !== 'auto') { try { await api.desk.border({ jobId: r.id, key: bk.dataset.b }); } catch {} } sel = r.id; tab = 'setup'; msg = r.folder ? 'Job created. Next: check the inputs are in the folder, then build the drawing register.' : 'Job created.';
        const paths = dz.paths(); if (paths.length && r.folder) { $('#njMsg').innerHTML = `Job created. <span data-runrow="${esc(runKey(r.id, 'FILES'))}">Filing the files…</span>`; try { const f = await api.jobs.fileIn({ jobId: r.id, paths }); msg = 'Job created. ' + filedSummary(f); tab = f.suggest && f.suggest.length ? 'deliv' : 'files'; } catch (e) { msg = 'Job created, but the files could not be filed: ' + clean(e); } }
        else if (paths.length) msg = 'Job created without a folder, so the files were not filed: give it a folder on the job desk, then Add files.';
        refresh(); } catch (e) { $('#njMsg').textContent = clean(e); } };
  }

  $('#jbBack').onclick = () => hide();
  function hide() { panel.classList.remove('open'); document.body.classList.remove('jobs-full'); clearTimeout(poll); clearInterval(listTimer); document.body.classList.remove('jobs-open'); const b = $('#jobsBtn'); if (b) b.classList.remove('active'); const o = document.querySelector('#top .tabs button[data-tab="office"]'); if (o) o.classList.add('active'); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open') && !document.querySelector('.modal.open')) hide(); });
  return {
    focusSearch() { const q = $('#jbQ'); if (q) { q.focus(); q.select(); } },
    async show(jobId, wantTab) { if (jobId !== undefined) { sel = jobId; selPath = ''; filesAt = ''; selFolder = ''; tab = 'deliv'; } if (wantTab) { tab = wantTab; if (!sel) { try { const c = await api.biz.current(); if (c) sel = typeof c === 'string' ? c : c.id; } catch {} } if (!sel) toast('Pick a job on the left, then the ' + wantTab.replace('lead:', '').replace(/^./, m => m.toUpperCase()) + ' tab'); } clearInterval(listTimer); listTimer = setInterval(async () => { if (!panel.classList.contains('open') || busyPanel() || !treeOpen.size || !document.hasFocus()) return; const before = treeSig(); await relist(); if (treeSig() !== before) renderList(); }, 15000); panel.classList.remove('collapsed'); panel.classList.add('open'); document.body.classList.add('jobs-open'); document.body.classList.remove('jobs-full'); if ($('#jbFull')) { $('#jbFull').textContent = '⛶'; $('#jbFull').title = 'Full screen (F11)'; } document.querySelectorAll('#top .tabs:not(.rooms) button').forEach(x => x.classList.toggle('active', x.id === 'jobsBtn')); await refresh().catch(e => { $('#jbMain').innerHTML = `<div class="bhint">${esc(clean(e))}</div>`; }); },
    hide, refresh, isOpen: () => panel.classList.contains('open')
  };
}
