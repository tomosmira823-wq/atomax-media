import { mountHistory } from './history.js';
// Dex's panel at the drafting table: DXFs in, fixes found from Cal's last markups or dropped markup PDFs, tick what to change, fixed copies out.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initDexUI({ office, api, getAgent, openSettings, getSettings }) {
  let dxfs = [], mks = [], src = 'cal', busy = false, items = [];
  const panel = $('#dexPanel');
  const readFile = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve({ name: file.name, size: file.size, path: api.pathForFile ? api.pathForFile(file) : '', base64: String(fr.result).split(',')[1] || '' });
    fr.onerror = () => reject(new Error('Could not read ' + file.name));
    fr.readAsDataURL(file);
  });
  const chips = (list, key) => list.map((d, i) => `<div class="fchip"><span>${esc(d.name)}</span><button data-rm="${key}:${i}" title="Remove">×</button></div>`).join('');
  function render() {
    $('#dxfFiles').innerHTML = chips(dxfs, 'd'); $('#mkFiles').innerHTML = chips(mks, 'm');
    $('#dropDxf').classList.toggle('has', dxfs.length > 0); $('#dropMk').classList.toggle('has', mks.length > 0);
    $('#dropMk').style.display = src === 'pdfs' ? '' : 'none';
    $('#dexNoteBox').style.display = src === 'note' ? '' : 'none';
    $('#dexFind').textContent = src === 'note' ? 'Ask Dex to do it' : 'Find fixes';
    $('#dexFind').disabled = busy || !dxfs.length || (src === 'pdfs' && !mks.length) || (src === 'note' && !$('#dexNote').value.trim());
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rm]'); if (!b) return;
    const [k, i] = b.dataset.rm.split(':'); (k === 'd' ? dxfs : mks).splice(+i, 1); render();
  });
  async function add(kind, files) {
    const re = kind === 'd' ? /\.dxf$/i : /\.pdf$/i, list = kind === 'd' ? dxfs : mks;
    for (const f of [...files]) {
      if (!re.test(f.name)) { $('#dexErr').textContent = f.name + (kind === 'd' ? ' is not a .dxf file.' : ' is not a PDF.'); continue; }
      if (!list.some(x => x.name === f.name && x.size === f.size)) { try { list.push(await readFile(f)); } catch (e) { $('#dexErr').textContent = e.message; } }
    }
    render();
  }
  function wire(id, kind) {
    const z = $(id), input = z.querySelector('input[type=file]'); input.multiple = true;
    ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', (e) => { e.preventDefault(); $('#dexErr').textContent = ''; add(kind, e.dataTransfer.files); });
    z.addEventListener('click', (e) => { if (e.target.closest('button')) return; input.click(); });
    input.addEventListener('change', () => { add(kind, input.files); input.value = ''; });
  }
  wire('#dropDxf', 'd'); wire('#dropMk', 'm');
  $('#dexNote').addEventListener('input', render);
  document.querySelectorAll('#dexSrc button').forEach(b => b.addEventListener('click', () => {
    src = b.dataset.src; document.querySelectorAll('#dexSrc button').forEach(x => x.classList.toggle('on', x === b)); render();
  }));

  const dex = () => getAgent();
  const say = (m) => { const a = dex(); if (a) office.setState(a.id, 'working', m); };
  function setBusy(on, msg) { busy = on; $('#dexSetup').hidden = on || !$('#dexList').hidden || !$('#dexResult').hidden; $('#dexRun').hidden = !on; if (msg) $('#dexMsg').textContent = msg; say(on ? msg : ''); render(); }

  async function find() {
    if (busy) return;
    if ((src === 'pdfs' || src === 'note') && !(getSettings() || {}).anthropicKey) { openSettings(); return; }
    $('#dexErr').textContent = '';
    setBusy(true, src === 'cal' ? 'Dex is reading Cal\'s markups' : src === 'note' ? 'Dex is reading the drawing and your instruction' : 'Dex is reading the markups');
    office.handOver({ to: 'dex', drawings: dxfs.length });
    try {
      const r = await api.dxf.propose({ source: src, dxfs: dxfs.map(d => ({ name: d.name, base64: d.base64, path: d.path })), markups: mks.map(m => ({ name: m.name, base64: m.base64 })), note: $('#dexNote').value });
      items = r.items || [];
      setBusy(false); showList(r);
    } catch (e) { setBusy(false); $('#dexErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  }
  $('#dexFind').addEventListener('click', find);

  const describe = (it) => it.action === 'delete_text' ? `Delete <code>${esc(it.before || '')}</code>` : it.action === 'add_text' ? `Add <code>${esc(it.text)}</code> at ${Math.round(+it.x * 10) / 10}, ${Math.round(+it.y * 10) / 10}${it.layer ? ' on ' + esc(it.layer) : ''}` : `Change <code>${esc(it.before)}</code> to <code>${esc(it.after)}</code>`;
  function showList(r) {
    const can = items.filter(i => i.can);
    const h = [];
    if (r.notes && r.notes.length) h.push('<ul>' + r.notes.map(n => `<li class="confirm">${esc(n)}</li>`).join('') + '</ul>');
    if (!items.length) h.push('<p class="hint">Nothing to go on.</p>');
    else h.push(`<div class="headline ${can.length ? 'warn' : 'good'}">${can.length ? `${can.length} fix${can.length === 1 ? '' : 'es'} Dex can make in the DXFs. Tick the ones you want.` : (src === 'note' ? 'Dex could not turn that into a change.' : 'Nothing in these markups needs a change in the DXFs.')}</div>`);
    if (can.length) h.push('<div class="row" style="margin:8px 0"><button class="btn small" id="dexAll">Tick all fixes</button><button class="btn small" id="dexNone">Untick all</button></div>');
    items.forEach((it, idx) => {
      if (it.can) {
        const only = !it.places && it.inBlocks;
        const where = it.file ? ` · in ${esc(it.file)}` : '';
        const blk = it.inBlocks ? `<label class="blk"><input type="checkbox" data-b="${idx}" checked ${only ? 'disabled' : ''}><span>${only ? 'This text is inside' : 'Also change it inside'} ${(it.blocks || []).map(b => `symbol <b>${esc(b.name)}</b>${b.uses ? ` (used ${b.uses}×)` : ''}`).join(', ') || 'a symbol'}. That changes every copy of the symbol.</span></label>` : '';
        const n = it.action === 'replace_text' ? ` <small>(${it.places + it.inBlocks} place${it.places + it.inBlocks === 1 ? '' : 's'})</small>` : '';
        h.push(`<label class="fx"><input type="checkbox" data-i="${idx}"><div><b>${esc(it.drawing)}</b>${where}<br>${describe(it)}${n}${it.action === 'add_text' ? '<div class="warn">Dex picked the position from nearby text. Check it in your CAD.</div>' : ''}${it.why && src === 'note' ? `<div class="why">${esc(it.why)}</div>` : ''}${blk}</div></label>`);
      } else h.push(`<div class="fx none"><div><b>${esc(it.drawing)}</b><br>${esc(it.action === 'replace_text' || it.action === 'delete_text' || it.action === 'add_text' ? describe(it).replace(/<[^>]+>/g, '') : (it.note || ''))}<div class="why">${esc(it.warn || it.why || '')}</div></div></div>`);
    });
    h.push('<div class="row" style="margin-top:14px"><button class="btn small" id="dexBackSetup">‹ Back</button><span style="flex:1"></span>' + (can.length ? '<button class="btn primary" id="dexApply" disabled>Apply ticked fixes</button>' : '') + '</div>');
    $('#dexList').innerHTML = h.join(''); $('#dexList').hidden = false; $('#dexSetup').hidden = true;
    const boxes = () => [...document.querySelectorAll('#dexList input[data-i]')];
    const sync = () => { const b = $('#dexApply'); if (b) { const n = boxes().filter(x => x.checked).length; b.disabled = !n; b.textContent = n ? `Apply ${n} ticked fix${n === 1 ? '' : 'es'}` : 'Apply ticked fixes'; } };
    boxes().forEach(x => x.addEventListener('change', sync));
    if ($('#dexAll')) $('#dexAll').addEventListener('click', () => { boxes().forEach(x => x.checked = true); sync(); });
    if ($('#dexNone')) $('#dexNone').addEventListener('click', () => { boxes().forEach(x => x.checked = false); sync(); });
    $('#dexBackSetup').addEventListener('click', () => { $('#dexList').hidden = true; $('#dexSetup').hidden = false; });
    if ($('#dexApply')) $('#dexApply').addEventListener('click', () => apply(boxes().filter(x => x.checked).map(x => { const b = document.querySelector(`#dexList input[data-b="${x.dataset.i}"]`); return { ...items[+x.dataset.i], editBlocks: !!(b && b.checked) }; })));
  }

  async function apply(chosen) {
    if (busy || !chosen.length) return;
    $('#dexList').hidden = true; setBusy(true, 'Dex is fixing the DXFs');
    try {
      const r = await api.dxf.apply({ jobId: ($('#dexJob') || {}).value || '', dxfs: dxfs.map(d => ({ name: d.name, base64: d.base64, path: d.path })), fixes: chosen.map(c => ({ id: c.id, file: c.file, action: c.action, before: c.before, after: c.after, text: c.text, x: c.x, y: c.y, layer: c.layer, height: c.height, ref: c.ref, editBlocks: c.editBlocks })) });
      setBusy(false); showResult(r, chosen); hist.refresh();
    } catch (e) { setBusy(false); $('#dexList').hidden = false; $('#dexSetup').hidden = true; $('#dexErr').textContent = String(e.message || e); }
  }

  function showResult(r, chosen) {
    const h = [];
    const done = r.results.filter(x => x.status === 'applied');
    h.push(`<div class="headline ${done.length ? 'good' : 'warn'}">${done.length ? `Fixed ${done.length} of ${r.results.length} ticked.` : 'Nothing was changed.'}</div>`);
    if (r.files.length) h.push(`<div class="grp mk"><h4>Fixed copies</h4><p class="hint">Saved in a FIXED folder. Your originals are untouched.</p><ul>` + r.files.map(f => `<li>${esc(f.name)} <small>${f.changes} change${f.changes === 1 ? '' : 's'}</small></li>`).join('') + '</ul><button class="btn small" id="dexShow">Show in folder</button></div>');
    const bad = r.results.filter(x => x.status !== 'applied');
    if (bad.length) h.push('<div class="grp unread"><h4>Not changed</h4><ul>' + bad.map(x => `<li>${esc(x.action === 'delete_text' ? 'Delete ' + (x.before || '') : x.action === 'add_text' ? 'Add ' + (x.text || '') : (x.before || '') + ' → ' + (x.after || ''))}: ${esc(x.reason || x.status)}</li>`).join('') + '</ul></div>');
    if (r.failed && r.failed.length) h.push('<ul>' + r.failed.map(f => `<li class="confirm">${esc(f.name)}: ${esc(f.reason)}</li>`).join('') + '</ul>');
    h.push('<div class="row" style="margin-top:14px"><span style="flex:1"></span><button class="btn small" id="dexAgain">Fix something else</button></div>');
    $('#dexResult').innerHTML = h.join(''); $('#dexResult').hidden = false; $('#dexSetup').hidden = true;
    if ($('#dexShow')) $('#dexShow').addEventListener('click', () => api.showItem(r.files[0].path));
    $('#dexAgain').addEventListener('click', () => { dxfs = []; mks = []; items = []; $('#dexNote').value = ''; office.clearJob(); $('#dexResult').hidden = true; $('#dexList').hidden = true; $('#dexSetup').hidden = false; render(); });
  }

  const hist = mountHistory($('#dexHist'), {
    heading: 'Previous fixes',
    load: async () => (await api.history.list({ agent: 'dex' })).map(h => ({ key: h.id, at: h.at, title: h.title, summary: h.summary })),
    open: async (id) => { const h = await api.history.get({ id }); if (h) { $('#dexRun').hidden = true; $('#dexList').hidden = true; showResult(h.data, []); } },
    remove: (id) => api.history.remove({ id })
  });
  render();
  return { show() { hist.refresh(); panel.classList.add('open'); }, hide() { panel.classList.remove('open'); } };
}
