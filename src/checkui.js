// The drawing room's desk panel: drop the cable schedule and the drawings, optionally leave Cal a note, watch him check.
import { mountHistory } from './history.js';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCHED_OK = /\.(xlsx|csv|pdf|png|jpe?g)$/i, DWG_OK = /\.(pdf|png|jpe?g|xlsx|csv|dwg|dxf|xls)$/i;

export function initCheckUI({ office, api, getAgent, getSettings, openSettings }) {
  let schedule = null, drawings = [], mode = 'std', running = false, last = null;
  const panel = $('#checkPanel');

  const readFile = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve({ name: file.name, size: file.size, path: api.pathForFile ? api.pathForFile(file) : '', base64: String(fr.result).split(',')[1] || '' });
    fr.onerror = () => reject(new Error('Could not read ' + file.name));
    fr.readAsDataURL(file);
  });
  const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  function renderFiles() {
    $('#schedFile').innerHTML = schedule ? `<div class="fchip"><span>${esc(schedule.name)} <small>${kb(schedule.size)}</small></span><button data-rm="s" title="Remove">×</button></div>` : '';
    $('#dwgFiles').innerHTML = drawings.map((d, i) => `<div class="fchip"><span>${esc(d.name)} <small>${kb(d.size)}</small></span><button data-rm="${i}" title="Remove">×</button></div>`).join('');
    $('#dropSched').classList.toggle('has', !!schedule); $('#dropDwg').classList.toggle('has', drawings.length > 0);
    $('#checkGo').disabled = running || !schedule || !drawings.length;
    $('#checkErr').textContent = '';
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rm]'); if (!b) return;
    if (b.dataset.rm === 's') schedule = null; else drawings.splice(+b.dataset.rm, 1);
    renderFiles();
  });

  async function addFiles(kind, files) {
    const list = [...files]; if (!list.length) return;
    try {
      if (kind === 'sched') {
        const f = list.find(x => SCHED_OK.test(x.name));
        if (!f) { $('#checkErr').textContent = 'The cable schedule needs to be an Excel, CSV or PDF file.'; return; }
        schedule = await readFile(f);
      } else {
        for (const f of list) {
          if (!DWG_OK.test(f.name)) { $('#checkErr').textContent = f.name + ' is not a type Cal can look at.'; continue; }
          if (!drawings.some(d => d.name === f.name && d.size === f.size)) drawings.push(await readFile(f));
        }
      }
    } catch (e) { $('#checkErr').textContent = e.message; }
    renderFiles();
  }
  function wireDrop(id, kind, multiple) {
    const z = $(id), input = z.querySelector('input[type=file]');
    ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', (e) => { e.preventDefault(); addFiles(kind, e.dataTransfer.files); });
    z.addEventListener('click', (e) => { if (e.target.closest('button')) return; input.click(); });
    input.multiple = multiple;
    input.addEventListener('change', () => { addFiles(kind, input.files); input.value = ''; });
  }
  wireDrop('#dropSched', 'sched', false); wireDrop('#dropDwg', 'dwg', true);
  // a file dropped anywhere else must never navigate the window away
  ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, (e) => e.preventDefault()));

  document.querySelectorAll('#checkMode button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('#checkMode button').forEach(x => x.classList.toggle('on', x === b));
    $('#checkNote').style.display = mode === 'note' ? '' : 'none';
    $('#skillBox').style.display = mode === 'std' ? '' : 'none';
    if (mode === 'note') $('#checkNote').focus();
  }));
  api.check.skill().then(t => { $('#skillText').textContent = t; }).catch(() => {});

  // ---- progress ----
  const cal = () => getAgent();
  api.check.onProgress((p) => {
    if (!running) return;
    const msg = p.message || 'working';
    $('#runMsg').textContent = msg[0].toUpperCase() + msg.slice(1);
    if (p.total) $('#runBar').style.width = Math.min(100, Math.round((p.done || 0) / p.total * 100)) + '%';
    const a = cal(); if (a) office.setState(a.id, 'working', msg);
  });

  async function go() {
    if (running) return;
    const settings = getSettings(), a = cal();
    if (!settings.anthropicKey) { $('#checkErr').textContent = 'Add your Claude API key in Settings first.'; openSettings(); return; }
    if (!schedule || !drawings.length) return;
    const note = mode === 'note' ? $('#checkNote').value.trim() : '';
    if (mode === 'note' && !note) { $('#checkErr').textContent = 'Type your note for Cal, or switch to the standard skill.'; return; }
    running = true; renderFiles(); last = null;
    $('#checkSetup').hidden = true; $('#checkResult').hidden = true; $('#checkRun').hidden = false;
    $('#runMsg').textContent = 'Cal is getting the files'; $('#runBar').style.width = '4%';
    office.handOver({ hasSchedule: true, drawings: drawings.length });
    if (a) office.setState(a.id, 'working', 'reading the files');
    try {
      const report = await api.check.run({ agent: a ? { id: a.id, rules: a.rules } : null, schedule: { name: schedule.name, base64: schedule.base64 }, drawings: drawings.map(d => ({ name: d.name, base64: d.base64, path: d.path })), note });
      last = report; showResult(report); hist.refresh();
      if (a) office.setState(a.id, 'done', report.findings.length ? `${report.findings.length} to look at` : 'check finished');
    } catch (e) {
      $('#checkSetup').hidden = false; $('#checkErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (a) office.setState(a.id, 'idle', 'could not finish');
    } finally { running = false; $('#checkRun').hidden = true; renderFiles(); }
  }
  $('#checkGo').addEventListener('click', go);

  // ---- result ----
  function showResult(r) {
    const groups = new Map();
    for (const f of r.findings) { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); }
    const mk = r.markups || { made: [], failed: [] };
    const html = [];
    html.push(`<div class="headline ${r.findings.length ? 'warn' : 'good'}">${esc(r.headline || '')}</div>`);
    if (r.noteAnswer) html.push(`<div class="noteans"><b>Your note</b><br>${esc(r.noteAnswer)}</div>`);
    if (!r.findings.length) html.push('<p class="hint">Nothing to fix in what Cal could read. See what was covered below.</p>');
    for (const [g, list] of groups) {
      html.push(`<div class="grp"><h4>${esc(g)} <span>${list.length}</span></h4><ul>` + list.map(f => `<li class="${f.confirm ? 'confirm' : ''}">${esc(f.text)}${f.confirm ? `<div class="why">Please confirm${f.reason ? ': ' + esc(f.reason) : ''}</div>` : ''}</li>`).join('') + '</ul></div>');
    }
    if (r.notChecked && r.notChecked.length) html.push('<div class="grp unread"><h4>Not checked</h4><ul>' + r.notChecked.map(n => `<li>${esc(n)}</li>`).join('') + '</ul></div>');
    if (r.coverage && r.coverage.length) html.push('<div class="grp cov"><h4>What Cal covered</h4><ul>' + r.coverage.map(n => `<li>${esc(n)}</li>`).join('') + '</ul></div>');
    if (mk.made.length || mk.notes || mk.failed.length) {
      html.push('<div class="grp mk"><h4>Marked-up copies</h4>' + ((mk.made.length || mk.notes) ? `<p class="hint">${mk.made.length + (mk.notes ? 1 : 0)} saved in a MARKUPS folder. Your originals are untouched.</p><ul>` + mk.made.map(m => `<li>${esc(m.out.split(/[\\/]/).pop())} <small>${m.notes} note${m.notes === 1 ? '' : 's'}</small></li>`).join('') + (mk.notes ? `<li>${esc(mk.notes.out.split(/[\\/]/).pop())} <small>${mk.notes.count} schedule-level note${mk.notes.count === 1 ? '' : 's'}</small></li>` : '') + '</ul><button class="btn small" id="showMk">Show in folder</button>' : '')
        + (mk.failed.length ? '<ul>' + mk.failed.map(f => `<li class="confirm">${esc(f.name)}: ${esc(f.reason)}</li>`).join('') + '</ul>' : '') + '</div>');
    }
    html.push('<div class="row" style="margin-top:14px"><button class="btn small" id="copyRep">Copy report</button><button class="btn small" id="saveRep">Save report</button><span style="flex:1"></span><button class="btn small" id="again">Check something else</button></div>');
    $('#checkResult').innerHTML = html.join(''); $('#checkResult').hidden = false;
    $('#copyRep').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(r.text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Could not copy'; } });
    $('#saveRep').addEventListener('click', () => api.files.saveText({ text: r.text, name: 'cable-schedule-check.txt' }));
    if ($('#showMk')) $('#showMk').addEventListener('click', () => api.showItem((mk.made[0] || mk.notes).out));
    $('#again').addEventListener('click', () => { schedule = null; drawings = []; last = null; office.clearJob(); $('#checkResult').hidden = true; $('#checkSetup').hidden = false; renderFiles(); });
  }

  const hist = mountHistory($('#checkHist'), {
    heading: 'Previous checks',
    load: async () => (await api.history.list({ agent: 'cal' })).map(h => ({ key: h.id, at: h.at, title: h.title, summary: h.summary })),
    open: async (id) => { const h = await api.history.get({ id }); if (!h) return; last = h.data; $('#checkSetup').hidden = true; $('#checkRun').hidden = true; showResult(h.data); },
    remove: (id) => api.history.remove({ id })
  });
  renderFiles();
  return { show() { hist.refresh(); panel.classList.add('open'); }, hide() { panel.classList.remove('open'); }, get running() { return running; } };
}
