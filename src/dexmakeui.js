// Dex's "Make a new DXF" mode: pick the job (its project folder is where he reads and writes), say what to draw, answer his questions, get a DRAFT DXF.
import { renderSkillPicker } from './skillpicker.js';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initDexMakeUI({ api, office, bizUI, getDex }) {
  const panel = $('#dexPanel');
  let questions = [], emailId = '', busy = false, picker = null;
  // the skills that fit THIS kind of drawing are ticked; an SLD skill is not ticked for earthing. If none is made for it, say so and offer to make one.
  const DK = api.drawKinds; let shownKind = '';
  const starter = (kind) => kind === 'earthing'
    ? '# Earthing drawings\n\n## What to show\n- MET and every earth bar, transformer tank and neutral links, cable screen bonds, test links, rods and mesh\n\n## Sizes\n- Take conductor sizes from the engineer\'s technical note, otherwise TBC\n\n## Symbols and labels\n- \n\n## Notes to always add\n- '
    : '# ' + DK.kindName(kind) + ' drawings\n\n## What to show\n- \n\n## Symbols and labels\n- \n\n## Notes to always add\n- ';
  const pickSkills = async () => {
    const kind = DK.kindOf($('#dmReq').value), name = DK.kindName(kind); shownKind = kind;
    picker = await renderSkillPicker(api, $('#dmSkills'), 'dex', { uncheck: (i) => !DK.skillFit(i, kind) });
    let items = []; try { items = await api.library.items({ key: 'skills' }); } catch {}
    if (items.some(i => i.on && DK.skillFit(i, kind) === 'match')) return;
    const box = document.createElement('div'); box.className = 'dmnoskill';
    box.innerHTML = `<div class="hint">No ${esc(name)} skill in the File Room, so Dex draws this without one (only general CAD rules, if any are ticked).</div><button id="dmNewSkill">Create a ${esc(name)} skill</button><div id="dmNewForm"></div>`;
    $('#dmSkills').appendChild(box);
    $('#dmNewSkill').onclick = () => {
      $('#dmNewForm').innerHTML = `<label>Skill name</label><input id="dmNsName" value="${esc(name.replace(/^./, c => c.toUpperCase()))} drawings (DXF)">
        <label>Your rules for ${esc(name)} drawings</label><textarea id="dmNsText" rows="9">${esc(starter(kind))}</textarea>
        <button class="btn primary" id="dmNsSave">Save skill and tick it for Dex</button>`;
      $('#dmNsSave').onclick = async () => {
        const nm = $('#dmNsName').value.trim() || name + ' drawings';
        try {
          const list = await api.library.newSkill({ name: nm, description: 'Dex: rules for ' + name + ' drawings', text: $('#dmNsText').value });
          const it = list.find(x => x.name === nm) || list[list.length - 1];
          await api.library.save({ key: 'skills', file: it.file, agents: [...new Set([...(it.agents || []), 'dex'])], on: true });
        } catch (e) { $('#dmErr').textContent = e.message; return; }
        pickSkills();
      };
    };
  };
  let kt; $('#dmReq').addEventListener('input', () => { clearTimeout(kt); kt = setTimeout(() => { if (DK.kindOf($('#dmReq').value) !== shownKind) pickSkills(); }, 400); });
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
      const r = await api.dexMake({ jobId: $('#dmJob').value, request, answers, emailId, skills: picker ? picker.selected() : undefined, revision: $('#dmRevOn').checked ? { on: true, stage: $('#dmRevStage').value, note: $('#dmRevNote').value } : null });
      if (r.questions) { questions = r.questions; renderQuestions(); if (dex) office.setState(dex.id, 'idle'); return; }
      questions = []; renderQuestions();
      $('#dmOut').innerHTML = `<div class="headline good" style="margin-top:12px">Saved ${esc(r.path.split(/[\\/]/).pop())}</div>
        <div class="hint">${esc(r.summary || r.title)}${r.inJobFolder ? '' : ' · saved in the app folder because the job has no project folder'}</div>
        ${r.drawingNumber ? `<div class="hint">Drawing ${esc(r.drawingNumber)} rev ${esc(r.revision || '')}${r.titleBlock ? ' · client title block ' + esc(r.titleBlock) : ' · Atomax draft title block (drop the client\'s title block DXF in the File Room Clients cabinet to use theirs)'}</div>` : ''}
        ${r.sheets && r.sheets.length > 1 ? `<div class="hint">${r.sheets.length} sheets: ${r.sheets.map(x => esc(x.path.split(/[\\/]/).pop())).join(', ')}</div>` : ''}
        ${r.masterCheck ? `<div class="hint">Checked against the approved master list: ${r.masterCheck.added.length ? 'added ' + r.masterCheck.added.length + ' cable(s) Dex left out' : 'no cables missing'}${r.masterCheck.extra.length ? ' · <b style="color:#e8590c">' + r.masterCheck.extra.length + ' not on the master list: ' + esc(r.masterCheck.extra.join(', ')) + '</b>' : ''}</div>` : ''}
        ${r.diff ? `<div class="hint">Revision ${esc(r.revision)} against the last one: ${[r.diff.added.length ? 'added ' + esc(r.diff.added.join(', ')) : '', r.diff.removed.length ? 'removed ' + esc(r.diff.removed.join(', ')) : '', r.diff.changed.length ? 'changed ' + esc(r.diff.changed.join(', ')) : ''].filter(Boolean).join(' · ') || 'no cable changes'} (clouded on the drawing)</div>` : r.revision && $('#dmRevOn').checked && !r.previousFound ? '<div class="hint">No earlier drawing by Dex found for this number, so nothing to compare with.</div>' : ''}
        ${r.read && r.read.length ? `<div class="hint">Read from the project: ${esc(r.read.join(', '))}</div>` : ''}
        <div class="hint">${r.skills && r.skills.length ? 'Skills used: ' + esc(r.skills.join(', ')) : 'No skills used: tick Dex on a skill in the File Room (Skills cabinet)'}</div>
        ${r.incomplete ? '<div class="err" style="margin-top:6px">Dex ran out of room: this drawing is incomplete. Press Make the DXF again.</div>' : ''}
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
  $('#dmRevOn').addEventListener('change', () => { $('#dmRevBox').hidden = !$('#dmRevOn').checked; });

  return {
    // open in make mode, optionally with a job, a request and the email it came from; auto starts the first pass
    async preset({ jobId = '', request = '', email = '', auto = false } = {}) {
      setMode('make'); questions = []; renderQuestions(); emailId = email || ''; $('#dmOut').innerHTML = ''; $('#dmErr').textContent = '';
      await bizUI.fillJobSelect($('#dmJob'));
      if (jobId) $('#dmJob').value = jobId;
      if (request) $('#dmReq').value = request;
      await showFolder(); await pickSkills();
      if (auto && request) go();
    },
    async refresh() { await bizUI.fillJobSelect($('#dmJob')); showFolder(); pickSkills(); },
    _state: () => ({ questions, emailId, busy })
  };
}
