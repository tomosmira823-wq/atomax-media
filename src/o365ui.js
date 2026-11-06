// The 365 room: a chat with Lex (Excel) or Wren (Word), one conversation per agent and job. Tom says what he wants and drops files; the
// agent answers in the chat: a question when something is missing, what it computed, what it made (with the file to open), and it
// changes the last file when asked. Pick the job (its folder is where they read and save), say what to make, drop files, send.
import { renderSkillPicker } from './skillpicker.js';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const WHO = { excel: { name: 'Lex', what: 'workbook', ph: 'e.g. A cable schedule from the attached drawings list: cable no, from, to, type, size, length, with a total length row' }, word: { name: 'Wren', what: 'document', ph: "e.g. An Atomax CT load monitoring report from the attached logger CSV and circuit schedule: kVA tables, charts, gaps in logging. Check the channel matching with me first." } };

export function initO365UI({ api, office, bizUI, getAgents, goBack }) {
  const panel = $('#o365Panel');
  let role = 'excel', files = [], picker = null, busy = false, lastFile = '';
  const agentOf = () => (getAgents() || []).find(a => a.role === role && a.enabled);
  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, base64: String(r.result).split(',')[1] || '' }); r.onerror = rej; r.readAsDataURL(f); });
  const renderFiles = () => { $('#o3Files').innerHTML = files.map((f, i) => `<span class="o3f">${/\.(png|jpe?g|gif|webp)$/i.test(f.name) ? `<img src="data:image/${f.name.split('.').pop().replace('jpg', 'jpeg')};base64,${f.base64}" alt="" style="height:28px;border-radius:3px;margin-right:4px">` : ''}${esc(f.name)} <button data-rm="${i}">×</button></span>`).join(''); $('#o3Files').querySelectorAll('[data-rm]').forEach(b => b.onclick = (e) => { e.stopPropagation(); files.splice(+b.dataset.rm, 1); renderFiles(); }); };
  const addFiles = async (list) => { for (const f of [...(list || [])]) files.push(await readFile(f)); renderFiles(); };
  $('#o3Drop').addEventListener('click', () => $('#o3File').click());
  $('#o3File').addEventListener('change', (e) => addFiles(e.target.files));
  $('#o3Drop').addEventListener('dragover', (e) => e.preventDefault());
  $('#o3Drop').addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); });
  // a screenshot pasted into the message (Ctrl+V) goes with it, like a dropped picture
  let pasted = 0;
  const pasteFiles = (e) => { const items = [...((e.clipboardData || {}).items || [])].filter(i => i.kind === 'file'); if (!items.length) return; e.preventDefault(); const list = items.map(i => { const f = i.getAsFile(); if (!f) return null; const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg'); return /^image\//.test(f.type) ? new File([f], `screenshot-${++pasted}.${ext}`, { type: f.type }) : f; }).filter(Boolean); addFiles(list); };
  $('#o3Req').addEventListener('paste', pasteFiles); panel.addEventListener('paste', (e) => { if (e.target !== $('#o3Req')) pasteFiles(e); });

  async function showFolder() {
    const box = $('#o3Folder'), jobId = $('#o3Job').value;
    if (!jobId) { box.innerHTML = 'No job: saved in the app\'s own 365 folder. Pick a job to read and save in its project folder.'; return; }
    try { const info = await api.proj.info({ jobId }); box.innerHTML = info.folder ? `Reads and saves in <span class="bp">${esc(info.folder)}</span>` : 'This job has no project folder yet: link one on the whiteboard (job page).'; } catch (e) { box.textContent = clean(e); }
  }
  $('#o3Job').addEventListener('change', () => { showFolder(); loadThread(); });

  const bubble = (m) => `<div class="elim ${m.who}"><b>${m.who === 'tom' ? 'You' : WHO[role].name}</b><div>${esc(m.text).replace(/\n/g, '<br>')}${m.files && m.files.length ? `<div class="bsub" style="margin-top:4px">${esc(m.files.join(', '))}</div>` : ''}${m.doc ? `<div class="elidone"><span>${esc(m.doc)}</span></div>` : ''}</div></div>`;
  function renderLog(messages, thinking = '') {
    const log = $('#o3Log'); log.innerHTML = (messages || []).map(bubble).join('') + (thinking ? `<div class="elim ${role === 'word' ? 'wren' : 'lex'} thinking"><b>${WHO[role].name}</b><div>${esc(thinking)}</div></div>` : '');
    log.scrollTop = log.scrollHeight;
    $('#o3Out').innerHTML = lastFile ? `<button id="o3Show" class="btn small">Show ${esc(lastFile.split(/[\\/]/).pop())} in folder</button>` : '';
    if ($('#o3Show')) $('#o3Show').onclick = () => api.showItem(lastFile);
  }
  // a turn keeps running when the room is left: coming back shows it still working and picks up the reply when it lands
  let pollTimer = null;
  async function loadThread() {
    clearTimeout(pollTimer);
    try {
      const t = await api.o365.thread({ jobId: $('#o3Job').value, role }); lastFile = t.file || '';
      renderLog(t.messages, t.pending ? (t.pending.stage || 'working') + '…' : '');
      $('#o3Go').disabled = !!t.pending; $('#o3Run').hidden = !t.pending; if (t.pending) $('#o3Msg').textContent = t.pending.stage || `${WHO[role].name} is on it`;
      if (t.pending) pollTimer = setTimeout(loadThread, 3000);
    } catch (e) { $('#o3Err').textContent = clean(e); }
  }

  async function setRole(r) {
    role = r;
    document.querySelectorAll('#o3Mode button').forEach(b => b.classList.toggle('on', b.dataset.role === r));
    $('#o3Who').textContent = WHO[r].name; $('#o3Req').placeholder = WHO[r].ph; $('#o3Title').textContent = `${WHO[r].name} · ${r === 'excel' ? 'Excel' : 'Word'}`;
    $('#o3Err').textContent = ''; lastFile = '';
    picker = await renderSkillPicker(api, $('#o3Skills'), r);
    await loadThread();
  }
  document.querySelectorAll('#o3Mode button').forEach(b => b.addEventListener('click', () => setRole(b.dataset.role)));

  async function send() {
    if (busy || $('#o3Go').disabled) return;
    const text = $('#o3Req').value.trim(); if (!text && !files.length) { $('#o3Err').textContent = `Say what ${WHO[role].name} should do.`; return; }
    busy = true; $('#o3Err').textContent = ''; $('#o3Run').hidden = false; $('#o3Go').disabled = true; $('#o3Msg').textContent = `${WHO[role].name} is on it`;
    const ag = agentOf(); if (ag) office.setState(ag.id, 'working', 'in the 365 room');
    const sent = { text, files: files.map(f => f.name) };
    const log = $('#o3Log'); log.insertAdjacentHTML('beforeend', bubble({ who: 'tom', text: sent.text || '(files)', files: sent.files }) + `<div class="elim ${role === 'word' ? 'wren' : 'lex'} thinking"><b>${WHO[role].name}</b><div>reading…</div></div>`); log.scrollTop = log.scrollHeight;
    try {
      const r = await api.o365.chat({ jobId: $('#o3Job').value, role, text, files, skills: picker ? picker.selected() : undefined });
      $('#o3Req').value = ''; files = []; renderFiles();
      if (r.path) lastFile = r.path;
      renderLog(r.messages); clearTimeout(pollTimer);
      if (r.warnings && r.warnings.length) $('#o3Err').textContent = r.warnings.join(' · ');
      if (r.incomplete) $('#o3Err').textContent += ' It ran out of room and may be incomplete.';
      if (ag) office.setState(ag.id, r.path ? 'done' : 'idle', r.path ? 'saved ' + r.path.split(/[\\/]/).pop() : '');
    } catch (e) { $('#o3Err').textContent = clean(e); if (ag) office.setState(ag.id, 'idle'); await loadThread(); }
    finally { busy = false; $('#o3Run').hidden = true; $('#o3Go').disabled = false; }
  }
  $('#o3Go').addEventListener('click', send);
  $('#o3Req').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#o3New').addEventListener('click', async () => { if (busy) return; await api.o365.newThread({ jobId: $('#o3Job').value, role }); lastFile = ''; renderLog([]); });
  $('#o3Back').addEventListener('click', () => goBack());

  return {
    async show(r) { panel.classList.add('open'); await bizUI.fillJobSelect($('#o3Job')); await setRole(r || role); showFolder(); },
    hide() { panel.classList.remove('open'); },
    async preset({ role: r, jobId = '', request = '' }) { await this.show(r); if (jobId) { $('#o3Job').value = jobId; await loadThread(); } if (request) $('#o3Req').value = request; showFolder(); },
    _state: () => ({ role, files: files.length })
  };
}
