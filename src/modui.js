// Milo's panel in the modeling room: a request, a 3D model, optional context (folder, notes, drawings, photos) -> Milo asks questions if he needs to,
// edits a copy of the model, then it goes to Vera to be checked. Originals are never changed.
import { toScript, toCsv, unitScale } from './plantexport.js';
import { loadModel, makeRoot, describe, describeText, applyOps, clashCheck, renderViews, exportGlb, MODEL_EXT, THREE } from './moder.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64ToBuf = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

export function initModellerUI({ office, api, getAgent, getChecker, getSettings, openSettings, fillJobSelect, showModel }) {
  const panel = $('#modPanel');
  let models = [], ctx = [], skipped = [], busy = false;
  let answers = [], questions = null, state = null;   // state: { before, after, ops, summary, assumptions, res, clash, verdict, savedPath }
  const milo = () => getAgent && getAgent(), vera = () => getChecker && getChecker();
  const say = (who, m) => { const a = who(); if (a) office.setState(a.id, 'working', m); };
  const nodeOf = (el, sel) => el.querySelector(sel);

  // ---------- inputs ----------
  const chip = (n, key, i, extra = '') => `<div class="fchip"><span>${esc(n)}${extra ? ' <i class="hint">' + esc(extra) + '</i>' : ''}</span><button data-rm="${key}:${i}" title="Remove">×</button></div>`;
  function render() {
    $('#moModels').innerHTML = models.map((m, i) => chip(m.name, 'm', i)).join('');
    $('#moCtx').innerHTML = ctx.map((c, i) => chip(c.name, 'c', i, c.kind)).join('') + (skipped.length ? `<div class="hint" style="margin-top:6px">Could not use ${skipped.length}: ${esc(skipped.slice(0, 3).map(s => s.name + ' (' + s.why + ')').join('; '))}${skipped.length > 3 ? '…' : ''}</div>` : '');
    $('#moDropModel').classList.toggle('has', models.length > 0); $('#moDropCtx').classList.toggle('has', ctx.length > 0);
    $('#moGo').disabled = busy || !models.length || !$('#moRequest').value.trim();
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rm]'); if (!b) return;
    const [k, i] = b.dataset.rm.split(':'); (k === 'm' ? models : ctx).splice(+i, 1); render();
  });
  $('#moRequest').addEventListener('input', render);

  async function addModelFromBuf(name, buf) {
    if (models.some(m => m.name === name)) return;
    models.push({ name, group: await loadModel(name, buf) });
  }
  function addCtx(files, sk) {
    for (const f of files) { if (f.kind === 'model') continue; if (!ctx.some(c => c.name === f.name)) ctx.push(f); }
    skipped = skipped.concat(sk || []);
  }
  async function takeFiles(list) {
    $('#moErr').textContent = '';
    const paths = [], loose = [];
    for (const f of list) { const p = api.pathForFile ? api.pathForFile(f) : ''; if (p) paths.push(p); else loose.push(f); }
    try {
      if (paths.length) {
        const r = await api.mo.readFiles({ paths });
        for (const f of r.files) { if (f.kind === 'model') await addModelFromBuf(f.name, b64ToBuf(f.base64)); }
        addCtx(r.files, r.skipped);
      }
      for (const f of loose) {   // no path (should not happen in the app): read in the page
        if (MODEL_EXT.test(f.name)) await addModelFromBuf(f.name, await f.arrayBuffer());
        else if (/\.(txt|md|csv|json)$/i.test(f.name)) addCtx([{ name: f.name, kind: 'text', text: (await f.text()).slice(0, 15000) }]);
        else skipped.push({ name: f.name, why: 'could not read' });
      }
    } catch (e) { $('#moErr').textContent = e.message; }
    render();
  }
  async function takeFolder(r) {
    if (!r) return;
    for (const f of r.files) if (f.kind === 'model') { try { await addModelFromBuf(f.name, b64ToBuf(f.base64)); } catch (e) { $('#moErr').textContent = e.message; } }
    addCtx(r.files, r.skipped); render();
  }
  function wire(id, onFiles) {
    const z = $(id), input = z.querySelector('input[type=file]');
    ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', async (e) => {
      e.preventDefault();
      const items = [...(e.dataTransfer.items || [])], files = [...e.dataTransfer.files];
      const plain = [];
      for (let i = 0; i < files.length; i++) {
        const ent = items[i] && items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
        if (ent && ent.isDirectory && api.pathForFile) { try { await takeFolder(await api.mo.readFolder({ dir: api.pathForFile(files[i]) })); } catch (err) { $('#moErr').textContent = err.message; } }
        else plain.push(files[i]);
      }
      if (plain.length) onFiles(plain);
    });
    z.addEventListener('click', (e) => { if (e.target.closest('button')) return; input.click(); });
    input.addEventListener('change', () => { onFiles([...input.files]); input.value = ''; });
  }
  wire('#moDropModel', (fs) => takeFiles(fs.filter(f => MODEL_EXT.test(f.name)).length ? fs.filter(f => MODEL_EXT.test(f.name)) : (($('#moErr').textContent = 'Milo opens GLB, GLTF, OBJ and STL models. For STEP or IFC, export a GLB first.'), [])));
  wire('#moDropCtx', (fs) => takeFiles(fs));
  $('#moFolder').addEventListener('click', async () => { try { await takeFolder(await api.mo.pickFolder()); } catch (e) { $('#moErr').textContent = e.message; } });

  // ---------- running ----------
  const show = (which) => { $('#moSetup').hidden = which !== 'setup'; $('#moRun').hidden = which !== 'run'; $('#moQs').hidden = which !== 'qs'; $('#moResult').hidden = which !== 'result'; };
  function run(msg, who) { busy = true; show('run'); $('#moMsg').textContent = msg; say(who || milo, msg); }
  function idle() { busy = false; const a = milo(), v = vera(); if (a) office.setState(a.id, 'idle', ''); if (v) office.setState(v.id, 'idle', ''); }
  const fail = (e, back) => { idle(); $('#moErr').textContent = e.message || String(e); show(back || 'setup'); render(); };
  api.mo.onProgress && api.mo.onProgress((p) => { if (busy && p && p.message) { $('#moMsg').textContent = p.message; } });
  const needKey = () => { if (!(getSettings() || {}).anthropicKey) { openSettings(); return true; } return false; };
  const jobId = () => $('#moJob').value || '';

  // one planning round: ask Claude (questions or edit list), then apply the edits to a fresh copy
  async function plan({ feedback = '', usePrevious = false } = {}) {
    if (needKey()) return;
    $('#moErr').textContent = '';
    run('Milo is looking at the model');
    try {
      await new Promise(r => setTimeout(r, 30));
      const before = makeRoot(models.map(m => m.group));
      const d = describe(before), modelText = describeText(d), views = renderViews(before);
      const r = await api.mo.plan({ request: $('#moRequest').value, modelText, views, context: ctx, answers, previous: usePrevious && state ? { ops: state.ops } : null, feedback });
      if (r.status === 'questions') { questions = r.questions; idle(); renderQuestions(); return; }
      const after = makeRoot(models.map(m => m.group));
      const res = applyOps(after, r.ops), clash = clashCheck(after);
      state = { before, after, ops: r.ops, summary: r.summary, assumptions: r.assumptions, res, clash, verdict: null, savedPath: null, unitGuess: d.unitGuess };
      showModel(after.clone(true));
      idle(); renderResult();
    } catch (e) { fail(e); }
  }

  function renderQuestions() {
    const el = $('#moQs');
    el.innerHTML = `<div class="warn-note" style="margin-top:0">Milo needs a few answers before he changes anything.</div>` + questions.map((q, i) => `<div class="q"><b>${esc(q)}</b><input type="text" data-q="${i}" /></div>`).join('')
      + `<button class="btn primary" id="moAnswer" style="width:100%;margin-top:14px">Send answers to Milo</button><button class="btn small" id="moQBack" style="margin-top:8px">Back</button>`;
    show('qs');
    $('#moAnswer').addEventListener('click', () => {
      const given = [...el.querySelectorAll('input[data-q]')].map(i => ({ q: questions[+i.dataset.q], a: i.value.trim() })).filter(x => x.a);
      if (!given.length) { return; }
      answers = answers.concat(given); questions = null; plan();
    });
    $('#moQBack').addEventListener('click', () => { show('setup'); render(); });
  }

  function renderResult() {
    const s = state, el = $('#moResult');
    const clashRows = s.clash.clashes.map(c => `<div class="op">⚠ <b>${esc(c.added)}</b> overlaps <b>${esc(c.with)}</b> (by about ${c.overlap})</div>`).join('');
    const v = s.verdict;
    el.innerHTML = `
      <div class="warn-note" style="margin-top:0"><b>${esc(s.summary || 'Milo has made the changes.')}</b></div>
      ${s.assumptions.length ? `<label>Milo assumed</label>${s.assumptions.map(a => `<div class="op">• ${esc(a)}</div>`).join('')}` : ''}
      <label>What he did</label>${s.res.lines.map(l => `<div class="op">${esc(l)}</div>`).join('') || '<div class="op hint">No changes were made.</div>'}
      ${s.res.warnings.length ? `<label>Could not do</label>${s.res.warnings.map(w => `<div class="op" style="color:var(--amber)">${esc(w)}</div>`).join('')}` : ''}
      <label>Clash check <span class="hint">(boxes, done in code)</span></label>${clashRows || ''}${s.clash.notes.map(n => `<div class="op hint">${esc(n)}</div>`).join('')}
      <div class="seg" id="moView" style="margin-top:12px"><button class="on" data-v="after">After (on the pedestal)</button><button data-v="before">Before</button></div>
      ${v ? `<div class="vcard ${v.verdict}"><b>Vera · ${v.verdict === 'pass' ? 'Passed' : 'Sent back'} · ${v.score}/10</b><div style="margin:6px 0">${esc(v.summary)}</div>
        ${v.findings.map(f => `<div class="op"><span class="sev ${f.severity}">${f.severity === 'fix' ? 'FIX' : 'LOOK'}</span>${esc(f.text)}</div>`).join('')}
        ${v.good.length ? `<div class="hint" style="margin-top:6px">Right: ${esc(v.good.join(' · '))}</div>` : ''}</div>` : ''}
      <label>Change something?</label><textarea id="moRevise" rows="2" placeholder="e.g. Move it 100 mm further from the rail, and make it blue."></textarea>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
        <button class="btn small" id="moReviseGo">Ask Milo to change it</button>
        ${v && v.verdict === 'fix' ? '<button class="btn small primary" id="moFix">Send back to Milo to fix</button>' : ''}
        ${!v ? '<button class="btn small primary" id="moToVera">Send to Vera to check</button>' : ''}
        <button class="btn small" id="moSave">Save copy</button><button class="btn small" id="moNew">New job</button>
      </div>
      <label>Take it into AutoCAD / Plant 3D <span class="hint">(what Milo added only)</span></label>
      <div class="row" style="gap:6px;flex-wrap:wrap"><select id="moUnits" style="width:auto"><option value="auto">Units: auto (${esc(s.unitGuess || '')})</option><option value="m">Model is in metres</option><option value="mm">Model is in mm</option></select>
        <button class="btn small" id="moScr">AutoCAD script (.scr)</button><button class="btn small" id="moCsv">Route list (.csv)</button></div>
      <div class="hint" style="margin-top:4px">Draws the pipe centreline and plain 3D solids, with Z up. They are normal AutoCAD objects, not Plant 3D pipe objects: snap Plant 3D pipe to the centreline.</div>
      <div class="hint" id="moSaved" style="margin-top:8px">${s.savedPath ? 'Saved: ' + esc(s.savedPath) : ''}</div>
      <div class="err" id="moErr2" style="margin-top:8px"></div>`;
    show('result');
    $('#moView').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { $('#moView').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); showModel((b.dataset.v === 'before' ? s.before : s.after).clone(true)); }));
    $('#moReviseGo').addEventListener('click', () => { const t = $('#moRevise').value.trim(); if (!t) return; plan({ feedback: 'The engineer wants this changed now: ' + t, usePrevious: true }); });
    const fx = $('#moFix'); if (fx) fx.addEventListener('click', () => plan({ feedback: 'Vera (model checker) sent it back:\n' + s.verdict.findings.map(f => `- [${f.severity}] ${f.text}`).join('\n'), usePrevious: true }));
    const tv = $('#moToVera'); if (tv) tv.addEventListener('click', toVera);
    $('#moSave').addEventListener('click', save);
    const exp = async (kind) => {
      try {
        const o = { scale: unitScale(s.unitGuess, $('#moUnits').value), addedNames: s.res.added, title: models[0] ? models[0].name : 'Milo' };
        if (!s.res.added.length) { $('#moErr2').textContent = 'Milo added nothing new, so there is nothing to export.'; return; }
        const text = kind === 'scr' ? toScript(s.ops, o).text : toCsv(s.ops, o);
        const r = await api.mo.saveText({ text, name: o.title, ext: kind });
        if (r) $('#moSaved').textContent = 'Saved: ' + r.path;
      } catch (e) { $('#moErr2').textContent = e.message; }
    };
    $('#moScr').addEventListener('click', () => exp('scr')); $('#moCsv').addEventListener('click', () => exp('csv'));
    $('#moNew').addEventListener('click', reset);
  }

  async function toVera() {
    if (needKey()) return;
    const s = state; run('Vera is checking the model', vera);
    office.setState(milo() ? milo().id : '', 'idle', '');
    try {
      await new Promise(r => setTimeout(r, 30));
      const views = renderViews(s.after), modelText = describeText(describe(s.after));
      const v = await api.mo.check({ request: $('#moRequest').value, modelText, views, context: ctx, ops: s.ops, lines: s.res.lines, clashes: s.clash.clashes, notes: s.clash.notes, assumptions: s.assumptions, jobId: jobId() });
      s.verdict = v; idle(); renderResult();
    } catch (e) { idle(); renderResult(); $('#moErr2').textContent = e.message; }
  }

  async function save() {
    const s = state; if (!s) return;
    try {
      const b64 = await exportGlb(s.after);
      const r = await api.mo.save({ base64: b64, name: models[0] ? models[0].name : 'model', jobId: jobId(), summary: s.summary });
      s.savedPath = r.path; $('#moSaved').textContent = 'Saved: ' + r.path;
    } catch (e) { $('#moErr2').textContent = e.message; }
  }

  function reset() {
    models = []; ctx = []; skipped = []; answers = []; questions = null; state = null; $('#moRequest').value = ''; $('#moErr').textContent = '';
    showModel(null); show('setup'); render();
  }

  $('#moGo').addEventListener('click', () => { if (busy) return; answers = []; state = null; plan(); });
  $('#modBack').addEventListener('click', () => window.__goRoom && window.__goRoom('modeling'));
  render(); show('setup');
  return {
    show() { fillJobSelect($('#moJob')); panel.classList.add('open'); },
    hide() { panel.classList.remove('open'); },
    // used by the tests
    _state: () => ({ models: models.length, ctx: ctx.length, skipped: skipped.length, state, questions })
  };
}
