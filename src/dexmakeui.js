// Dex's "Make a new DXF" mode: pick the job (its project folder is where he reads and writes), say what to draw, answer his questions, get a DRAFT DXF.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initDexMakeUI({ api, office, bizUI, getDex }) {
  const panel = $('#dexPanel');
  let questions = [], emailId = '', busy = false;
  const setMode = (m) => { panel.classList.toggle('make-mode', m === 'make'); document.querySelectorAll('#dexMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); };
  setMode('make');
  document.querySelectorAll('#dexMode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // the job's folder: where Dex reads from and writes to
  async function showFolder() {
    const box = $('#dmFolder'), jobId = $('#dmJob').value;
    if (!jobId) { box.innerHTML = 'No job picked: Dex saves into the app\'s own DXF folder. Pick a job to read and write its project folder.'; return; }
    let info; try { info = await api.proj.info({ jobId }); } catch (e) { box.textContent = e.message; return; }
    if (info.folder) { box.innerHTML = `Reads and writes <span class="bp">${esc(info.folder)}</span>${info.read ? ` · ${info.read.files} files read` : ' · not read yet'}<br><button id="dmOpen">Open folder</button><button id="dmReread">Read it again</button>`; $('#dmOpen').onclick = () => api.proj.open({ jobId }); $('#dmReread').onclick = async () => { box.textContent = 'Reading the folder…'; try { await api.proj.gather({ jobId }); } catch (e) { alert(e.message); } showFolder(); }; return; }
    box.innerHTML = '<b>This job has no project folder yet.</b> <button id="dmFind">Find it</button><button id="dmPick">Choose…</button><div id="dmSug"></div>';
    const set = async (folder) => { $('#dmSug').textContent = 'Reading the folder…'; try { await api.proj.setFolder({ jobId, folder }); } catch (e) { $('#dmSug').textContent = e.message; return; } showFolder(); };
    $('#dmFind').onclick = async () => { $('#dmSug').textContent = 'Looking through your folders…'; const list = await api.proj.suggest({ jobId }).catch(e => { $('#dmSug').textContent = e.message; return null; }); if (!list) return; $('#dmSug').innerHTML = list.length ? list.map((x, i) => `<div><span class="bp">${esc(x.path)}</span> <button data-i="${i}">Use</button></div>`).join('') : 'Nothing found. Use Choose…'; $('#dmSug').querySelectorAll('[data-i]').forEach(b => b.onclick = () => set(list[+b.dataset.i].path)); };
    $('#dmPick').onclick = async () => { const p = await api.proj.pick(); if (p) set(p); };
  }
  $('#dmJob').addEventListener('change', showFolder);

  function renderQuestions() {
    $('#dmQs').innerHTML = questions.length ? `<div class="dmq"><b>Dex has ${questions.length === 1 ? 'a question' : 'some questions'} before he draws:</b>${questions.map((q, i) => `<label>${esc(q)}</label><input data-q="${i}" placeholder="Your answer (or leave blank for TBC)">`).join('')}</div>` : '';
    $('#dmGo').textContent = questions.length ? 'Answer and make the DXF' : 'Make the DXF';
  }

  async function go() {
    if (busy) return;
    const request = $('#dmReq').value.trim(); if (!request) { $('#dmErr').textContent = 'Say what Dex should draw.'; return; }
    const answers = questions.map((q, i) => ({ q, a: (document.querySelector(`[data-q="${i}"]`) || {}).value || 'TBC' }));
    busy = true; $('#dmErr').textContent = ''; $('#dmOut').innerHTML = ''; $('#dmRun').hidden = false; $('#dmGo').disabled = true;
    $('#dmMsg').textContent = answers.length ? 'Dex is drawing it' : 'Dex is reading the project files';
    const dex = getDex(); if (dex) office.setState(dex.id, 'working', 'drawing an SLD');
    try {
      const r = await api.dexMake({ jobId: $('#dmJob').value, request, answers, emailId });
      if (r.questions) { questions = r.questions; renderQuestions(); if (dex) office.setState(dex.id, 'idle'); return; }
      questions = []; renderQuestions();
      $('#dmOut').innerHTML = `<div class="headline good" style="margin-top:12px">Saved ${esc(r.path.split(/[\\/]/).pop())}</div>
        <div class="hint">${esc(r.summary || r.title)}${r.inJobFolder ? '' : ' · saved in the app folder because the job has no project folder'}</div>
        ${r.read && r.read.length ? `<div class="hint">Read from the project: ${esc(r.read.join(', '))}</div>` : ''}
        ${r.notes && r.notes.length ? `<div class="hint">To confirm: ${esc(r.notes.join(' · '))}</div>` : ''}
        <div class="dmsvg">${r.svg}</div>
        <button id="dmShow">Show in folder</button><button id="dmAgain">Change something</button>`;
      $('#dmShow').onclick = () => api.showItem(r.path);
      $('#dmAgain').onclick = () => { $('#dmReq').focus(); $('#dmReq').value += '\n\nChange: '; };
      if (dex) office.setState(dex.id, 'done', 'drew ' + r.path.split(/[\\/]/).pop());
    } catch (e) { $('#dmErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); if (dex) office.setState(dex.id, 'idle'); }
    finally { busy = false; $('#dmRun').hidden = true; $('#dmGo').disabled = false; }
  }
  $('#dmGo').addEventListener('click', go);

  return {
    // open in make mode, optionally with a job, a request and the email it came from; auto starts the first pass
    async preset({ jobId = '', request = '', email = '', auto = false } = {}) {
      setMode('make'); questions = []; renderQuestions(); emailId = email || ''; $('#dmOut').innerHTML = ''; $('#dmErr').textContent = '';
      await bizUI.fillJobSelect($('#dmJob'));
      if (jobId) $('#dmJob').value = jobId;
      if (request) $('#dmReq').value = request;
      await showFolder();
      if (auto && request) go();
    },
    async refresh() { await bizUI.fillJobSelect($('#dmJob')); showFolder(); },
    _state: () => ({ questions, emailId, busy })
  };
}
