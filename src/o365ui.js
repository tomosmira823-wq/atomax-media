// The 365 room panel: Lex (Excel) and Wren (Word). Pick the job (its folder is where they read and save), say what to make, drop files, tick skills, go.
import { renderSkillPicker } from './skillpicker.js';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const WHO = { excel: { name: 'Lex', what: 'workbook', ph: 'e.g. A cable schedule from the attached drawings list: cable no, from, to, type, size, length, with a total length row' }, word: { name: 'Wren', what: 'document', ph: "e.g. Turn Ada's technical note into an Atomax report for the client, with a summary and the results table" } };

export function initO365UI({ api, office, bizUI, getAgents, goBack }) {
  const panel = $('#o365Panel');
  let role = 'excel', files = [], picker = null, busy = false;
  const agentOf = () => (getAgents() || []).find(a => a.role === role && a.enabled);
  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, base64: String(r.result).split(',')[1] || '' }); r.onerror = rej; r.readAsDataURL(f); });
  const renderFiles = () => { $('#o3Files').innerHTML = files.map((f, i) => `<span class="o3f">${esc(f.name)} <button data-rm="${i}">×</button></span>`).join(''); $('#o3Files').querySelectorAll('[data-rm]').forEach(b => b.onclick = (e) => { e.stopPropagation(); files.splice(+b.dataset.rm, 1); renderFiles(); }); };
  const addFiles = async (list) => { for (const f of [...(list || [])]) files.push(await readFile(f)); renderFiles(); };
  $('#o3Drop').addEventListener('click', () => $('#o3File').click());
  $('#o3File').addEventListener('change', (e) => addFiles(e.target.files));
  $('#o3Drop').addEventListener('dragover', (e) => e.preventDefault());
  $('#o3Drop').addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); });

  async function showFolder() {
    const box = $('#o3Folder'), jobId = $('#o3Job').value;
    if (!jobId) { box.innerHTML = 'No job: saved in the app\'s own 365 folder. Pick a job to read and save in its project folder.'; return; }
    try { const info = await api.proj.info({ jobId }); box.innerHTML = info.folder ? `Reads and saves in <span class="bp">${esc(info.folder)}</span>` : 'This job has no project folder yet: link one on the whiteboard (job page).'; } catch (e) { box.textContent = clean(e); }
  }
  $('#o3Job').addEventListener('change', showFolder);

  async function setRole(r) {
    role = r;
    document.querySelectorAll('#o3Mode button').forEach(b => b.classList.toggle('on', b.dataset.role === r));
    $('#o3Who').textContent = WHO[r].name; $('#o3Req').placeholder = WHO[r].ph; $('#o3Title').textContent = `${WHO[r].name} · ${r === 'excel' ? 'Excel' : 'Word'}`;
    $('#o3Go').textContent = `Make the ${WHO[r].what}`; $('#o3Out').innerHTML = ''; $('#o3Err').textContent = '';
    picker = await renderSkillPicker(api, $('#o3Skills'), r);
  }
  document.querySelectorAll('#o3Mode button').forEach(b => b.addEventListener('click', () => setRole(b.dataset.role)));

  async function go() {
    if (busy) return;
    const request = $('#o3Req').value.trim(); if (!request) { $('#o3Err').textContent = `Say what ${WHO[role].name} should make.`; return; }
    busy = true; $('#o3Err').textContent = ''; $('#o3Out').innerHTML = ''; $('#o3Run').hidden = false; $('#o3Go').disabled = true;
    $('#o3Msg').textContent = `${WHO[role].name} is working on it`;
    const ag = agentOf(); if (ag) office.setState(ag.id, 'working', 'making a ' + WHO[role].what);
    try {
      const args = { jobId: $('#o3Job').value, request, files, skills: picker ? picker.selected() : undefined };
      const r = role === 'excel' ? await api.o365.excel(args) : await api.o365.word(args);
      const name = r.path.split(/[\\/]/).pop();
      $('#o3Out').innerHTML = `<div class="headline good" style="margin-top:12px">Saved ${esc(name)}</div>
        ${r.incomplete ? '<div class="err">It ran out of room and may be incomplete. Try again with a narrower request.</div>' : ''}
        ${role === 'excel' ? `<div class="hint">${esc(r.summary)} · ${r.sheets.map(s => esc(s.name) + ' (' + s.rows + ' rows)').join(', ')}</div><div class="o3tbl"><table><tr>${r.preview.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${r.preview.rows.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></div>`
          : `<div class="hint">${esc(r.title)} · ${esc(r.docNumber)} P01</div><div class="o3outline">${r.outline.map(h => `<div>${esc(h)}</div>`).join('')}</div>`}
        <button id="o3Show" class="btn small">Show in folder</button>`;
      $('#o3Show').onclick = () => api.showItem(r.path);
      if (ag) office.setState(ag.id, 'done', 'saved ' + name);
    } catch (e) { $('#o3Err').textContent = clean(e); if (ag) office.setState(ag.id, 'idle'); }
    finally { busy = false; $('#o3Run').hidden = true; $('#o3Go').disabled = false; }
  }
  $('#o3Go').addEventListener('click', go);
  $('#o3Back').addEventListener('click', () => goBack());

  return {
    async show(r) { panel.classList.add('open'); await bizUI.fillJobSelect($('#o3Job')); await setRole(r || role); showFolder(); },
    hide() { panel.classList.remove('open'); },
    async preset({ role: r, jobId = '', request = '' }) { await this.show(r); if (jobId) $('#o3Job').value = jobId; if (request) $('#o3Req').value = request; showFolder(); },
    _state: () => ({ role, files: files.length })
  };
}
