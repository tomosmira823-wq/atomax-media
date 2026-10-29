// The File Room panel (six cabinets, drop files, skills on/off, agent ticks, rulebooks) and the Server Room panel (spend, caps, key checks, social logins, bottom bar).
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '£' + (Math.round(n * 100) / 100).toFixed(n < 10 ? 2 : 0);

export function initRoomsUI({ api, getAgents, openSettings, goBack }) {
  let cabinets = [], key = 'skills', agents = [], open = null, msg = '';
  const agentById = (id) => agents.find(a => a.id === id);
  const agentColour = (id) => (agentById(id) || {}).colour || '#868e96';
  const agentName = (id) => (agentById(id) || {}).name || id;

  // ================= FILE ROOM =================
  const fpanel = $('#filePanel');
  async function fileRefresh() {
    agents = (await api.agents.get()) || getAgents() || [];
    cabinets = await api.library.cabinets();
    renderTabs(); await renderMain();
  }
  function renderTabs() {
    $('#fcTabs').innerHTML = cabinets.map(c => `<button class="fc ${c.key === key ? 'on' : ''}" data-key="${c.key}" style="--c:${c.colour}"><i></i>${esc(c.label)}<span>${c.count}</span></button>`).join('');
  }
  async function renderMain() {
    const c = cabinets.find(x => x.key === key) || {};
    const items = await api.library.items({ key });
    const head = `<div class="fhead"><div><h3>${esc(c.label || '')}</h3><div class="bsub">${subFor(key)}</div></div><div class="fbtns">
      ${key === 'skills' ? '<button id="fImport">Import from Claude</button><button id="fNewSkill" class="bprim">+ Add skill</button>' : key === 'rulebooks' ? '' : '<label class="fup">+ Add file<input type="file" id="fAdd" multiple hidden></label>'}</div></div>`;
    let body;
    if (key === 'rulebooks') body = items.map(rb => `<div class="frow ${open === rb.agentId ? 'open' : ''}" data-rb="${rb.agentId}"><b style="color:${agentColour(rb.agentId)}">■</b> <b>${esc(rb.name)}</b> <span class="bsub">${esc(rb.description)} · ${rb.text.trim() ? 'has lessons' : 'no lessons yet'}</span>
        ${open === rb.agentId ? `<div class="fedit"><textarea id="rbText" rows="6" placeholder="Lessons from corrections, one per line. Always included in this agent's prompt.">${esc(rb.text)}</textarea><div class="fbtns"><button class="bprim" id="rbSave">Save rulebook</button></div></div>` : ''}</div>`).join('');
    else body = items.map(i => `<div class="frow ${open === i.file ? 'open' : ''}" data-file="${esc(i.file)}">
        <div class="fmain"><b>${esc(i.name)}</b><div class="bsub">${esc(i.description || (i.readable ? '' : 'Stored, not read by agents'))}</div></div>
        <div class="fagents">${i.agents.map(a => `<span class="chipA"><i style="background:${agentColour(a)}"></i>${esc(agentName(a))}<button data-untick="${esc(a)}" data-file="${esc(i.file)}" title="Remove">×</button></span>`).join('')}
          ${agents.filter(a => a.enabled && !i.agents.includes(a.id)).length ? `<select data-tick="${esc(i.file)}"><option value="">+ agent</option>${agents.filter(a => a.enabled && !i.agents.includes(a.id)).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>` : ''}</div>
        ${key === 'skills' ? `<label class="fswitch"><input type="checkbox" data-on="${esc(i.file)}" ${i.on ? 'checked' : ''}><span></span></label>` : ''}
        <button class="fx" data-del="${esc(i.file)}" title="Remove from the library">×</button>
        ${open === i.file && i.readable ? `<div class="fedit"><input data-edit-name="${esc(i.file)}" value="${esc(i.name)}" /><input data-edit-desc="${esc(i.file)}" value="${esc(i.description)}" placeholder="What this is for" /><textarea data-edit-text="${esc(i.file)}" rows="8"></textarea><div class="fbtns"><button class="bprim" data-save="${esc(i.file)}">Save</button></div></div>` : ''}
      </div>`).join('') || `<div class="bhint">${key === 'skills' ? 'No skills yet. Import one from Claude or add a skill.' : 'Nothing in this cabinet yet. Drop files anywhere on this window to file them here.'}</div>`;
    $('#fcMain').innerHTML = head + (msg ? `<div class="fmsg">${esc(msg)}</div>` : '') + `<div class="flist">${body}</div>`;
    if (open && open !== '' && key !== 'rulebooks') {   // load the text of the open item into its editor
      const i = items.find(x => x.file === open);
      if (i && i.readable) { const text = await api.library.read({ key, file: open }); const ta = document.querySelector(`[data-edit-text="${CSS.escape(open)}"]`); if (ta) ta.value = text; }
    }
    wireMain(items);
  }
  const subFor = (k) => ({ skills: 'How each agent does its job. Switch a skill on and every agent ticked uses it from its next run.', templates: 'Templates the Documents agent can be given as context.', knowledge: 'Company knowledge: standards, client rules, house style.', jobs: 'Job files agents can be given as context.', brand: 'Logos, colours and brand copy for the media agents.', rulebooks: 'One rulebook per agent. Corrections saved here are in that agent\'s prompt from then on.' })[k] || '';

  function wireMain(items) {
    document.querySelectorAll('#fcMain [data-rb]').forEach(el => el.addEventListener('click', (e) => { if (e.target.closest('.fedit')) return; open = open === el.dataset.rb ? null : el.dataset.rb; renderMain(); }));
    $('#rbSave') && $('#rbSave').addEventListener('click', saveRulebook);
    document.querySelectorAll('#fcMain [data-file]').forEach(el => el.addEventListener('click', (e) => { if (e.target.closest('.fedit,.fagents,.fswitch,.fx,button,select,input')) return; const f = el.dataset.file; open = open === f ? null : f; renderMain(); }));
    document.querySelectorAll('#fcMain [data-tick]').forEach(sel => sel.addEventListener('change', async () => { if (!sel.value) return; const it = items.find(i => i.file === sel.dataset.tick); await save(sel.dataset.tick, { agents: [...it.agents, sel.value] }); }));
    document.querySelectorAll('#fcMain [data-untick]').forEach(b => b.addEventListener('click', async () => { const it = items.find(i => i.file === b.dataset.file); await save(b.dataset.file, { agents: it.agents.filter(a => a !== b.dataset.untick) }); }));
    document.querySelectorAll('#fcMain [data-on]').forEach(c => c.addEventListener('change', () => save(c.dataset.on, { on: c.checked })));
    document.querySelectorAll('#fcMain [data-del]').forEach(b => b.addEventListener('click', async (e) => { e.stopPropagation(); if (!confirm('Remove this from the File Room? The file is deleted from the library.')) return; await api.library.remove({ key, file: b.dataset.del }); open = null; await fileRefresh(); }));
    document.querySelectorAll('#fcMain [data-save]').forEach(b => b.addEventListener('click', async () => { const f = b.dataset.save; await save(f, { name: document.querySelector(`[data-edit-name="${CSS.escape(f)}"]`).value, description: document.querySelector(`[data-edit-desc="${CSS.escape(f)}"]`).value, text: document.querySelector(`[data-edit-text="${CSS.escape(f)}"]`).value }); msg = 'Saved.'; renderMain(); }));
    $('#fImport') && $('#fImport').addEventListener('click', async () => { try { const r = await api.library.importSkill(); if (r) { msg = 'Imported. Tick the agents that should use it.'; await fileRefresh(); } } catch (e) { msg = e.message; renderMain(); } });
    $('#fNewSkill') && $('#fNewSkill').addEventListener('click', async () => { const name = prompt('Name for the new skill?'); if (!name) return; await api.library.newSkill({ name, description: '', text: '' }); open = null; await fileRefresh(); });
    $('#fAdd') && $('#fAdd').addEventListener('change', (e) => dropFiles(e.target.files));
  }
  async function saveRulebook() {
    const text = $('#rbText').value;
    await api.library.setRulebook({ agentId: open, text });
    msg = 'Rulebook saved. It is in the agent\'s prompt from its next run.'; renderMain();
  }
  async function save(file, patch) {
    try { await api.library.save({ key, file, ...patch }); await fileRefresh(); }
    catch (e) { msg = e.message; renderMain(); }
  }
  async function dropFiles(list) {
    const files = [...(list || [])];
    if (!files.length) return;
    const data = await Promise.all(files.map(f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, base64: String(r.result).split(',')[1] }); r.onerror = rej; r.readAsDataURL(f); })));
    try { await api.library.drop({ key, files: data }); msg = `${files.length} file${files.length === 1 ? '' : 's'} filed in ${cabinets.find(c => c.key === key)?.label || key}.`; await fileRefresh(); }
    catch (e) { msg = e.message; renderMain(); }
  }
  // drop files anywhere on the window while the File Room panel is open
  window.addEventListener('dragover', (e) => { if (fpanel.classList.contains('open')) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!fpanel.classList.contains('open')) return; e.preventDefault(); dropFiles(e.dataTransfer && e.dataTransfer.files); });
  fpanel.addEventListener('click', (e) => { const b = e.target.closest('button[data-key]'); if (b) { key = b.dataset.key; open = null; msg = ''; renderTabs(); renderMain(); } });
  $('#fcTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-key]'); if (b) { key = b.dataset.key; open = null; msg = ''; renderTabs(); renderMain(); } });
  $('#fileBack').addEventListener('click', () => goBack());

  // ================= SERVER ROOM =================
  const spanel = $('#serverPanel');
  let status = null, tests = {};
  async function serverRefresh() {
    agents = (await api.agents.get()) || getAgents() || [];
    status = await api.server.status();
    renderServer();
    return status;
  }
  const stateWord = { ok: 'Working', near: 'Near cap', capped: 'Cap reached', error: 'Error today', nokey: 'No key' };
  const stateCls = { ok: 'good', near: 'warn', capped: 'bad', error: 'bad', nokey: 'off' };
  function renderServer() {
    if (!status) return;
    const totalSpent = status.providers.reduce((n, p) => n + p.spent, 0), totalCap = status.providers.reduce((n, p) => n + p.cap, 0);
    const exp = status.social.filter(s => s.state === 'expiring');
    const banner = exp.map(s => `<div class="sban"><span>● <b>${esc(s.label)} login runs out in ${s.days} day${s.days === 1 ? '' : 's'}.</b> ${s.key === 'facebook' ? 'Facebook and Instagram posts will stop until you reconnect.' : 'Posts will stop until you reconnect.'}</span><button data-reconnect="${s.key}">Reconnect ${esc(s.label)}</button></div>`).join('');
    const cards = status.providers.map(p => {
      const frac = p.cap ? Math.min(100, p.spent / p.cap * 100) : 0;
      const used = p.usedBy.map(a => esc(agentName(a))).join(' · ') || 'Nobody yet';
      const t = tests[p.provider];
      return `<div class="scard ${stateCls[p.state] || ''}">
        <div class="sh"><b>${esc(p.label)}</b><span class="pill ${stateCls[p.state] || ''}">${stateWord[p.state] || 'Working'}</span></div>
        <div class="sm">Spent this month</div><div class="sv">${money(p.spent)} <span>of ${money(p.cap)} cap</span></div>
        <div class="bar"><i style="width:${frac}%"></i></div>
        <div class="kv"><span>Most used by</span><b>${used}</b></div>
        <div class="kv"><span>Key</span><b>${p.keyed ? 'Set' : 'Not set'}${t ? ' · ' + esc(t) : ''}</b></div>
        ${p.lastError ? `<div class="serr">Last error: ${esc(p.lastError.slice(0, 160))}</div>` : ''}
        ${p.state === 'capped' ? `<div class="scap">Agents pause and ask you before they spend more.</div>` : ''}
        <div class="sbtns">${p.state === 'capped' || p.state === 'near' ? `<button class="bprim" data-cap="${p.provider}">Raise cap</button>` : `<button data-cap="${p.provider}">Change cap</button>`}<button data-test="${p.provider}">Test key</button><button data-replace="${p.provider}">Replace key</button></div>
        <div class="capedit" id="cap-${p.provider}" hidden><input type="number" min="0" step="5" value="${p.cap}" /><button data-savecap="${p.provider}">Save cap</button></div>
      </div>`;
    }).join('');
    const soc = status.social.map(s => {
      const word = s.state === 'off' ? 'Not connected' : s.state === 'expiring' ? `Expiring · ${s.days} days left` : `Connected · login good for ${s.days == null ? 'a while' : s.days + ' more days'}`;
      return `<div class="scard small ${s.state === 'expiring' ? 'bad' : s.state === 'off' ? 'off' : 'good'}"><div class="sh"><b>${esc(s.label)}</b><span class="pill ${s.state === 'expiring' ? 'bad' : s.state === 'off' ? 'off' : 'good'}">${s.state === 'off' ? 'Not connected' : s.state === 'expiring' ? 'Expiring' : 'Connected'}</span></div><div class="bsub">${esc(word)}</div>
        <div class="sbtns"><button data-reconnect="${s.key}">${s.state === 'off' ? 'Connect' : 'Reconnect'}</button></div></div>`;
    }).join('');
    const f = status.footer;
    const bar = `<span>${f.backup ? 'Backups · last ' + esc(f.backup) : 'Backups · not set up yet'}</span><span>App v${esc(f.version)} · ${f.update.state === 'downloading' ? 'downloading ' + (f.update.percent != null ? f.update.percent + '%' : 'update') : f.update.state === 'ready' ? 'update ready, restart to install' : f.update.state === 'error' ? 'update check failed' : 'up to date'}</span><span>${f.failedToday ? f.failedToday + ' failed run' + (f.failedToday === 1 ? '' : 's') + ' today' : 'No failed runs today'}</span>`;
    $('#srvMain').innerHTML = `<div class="stop"><div><h3>APIs and connections</h3><div class="bsub">Spend is an estimate from list prices. Keys are never shown, only whether they work.</div></div><div class="stotal">Total this month<b>${money(totalSpent)}</b> of ${money(totalCap)} caps</div></div>
      ${banner}<h4>AI services</h4><div class="sgrid">${cards}</div><h4>Social logins</h4><div class="sgrid">${soc}</div>`;
    $('#srvBar').innerHTML = bar;
    wireServer();
  }
  function wireServer() {
    document.querySelectorAll('#srvMain [data-cap]').forEach(b => b.addEventListener('click', () => { const el = $('#cap-' + b.dataset.cap); el.hidden = !el.hidden; }));
    document.querySelectorAll('#srvMain [data-savecap]').forEach(b => b.addEventListener('click', async () => { const p = b.dataset.savecap; const v = document.querySelector(`#cap-${p} input`).value; try { await api.server.setCap({ provider: p, cap: Number(v) }); await serverRefresh(); } catch (e) { alert(e.message); } }));
    document.querySelectorAll('#srvMain [data-test]').forEach(b => b.addEventListener('click', async () => {
      const p = b.dataset.test; tests[p] = 'checking…'; renderServer();
      try { await api.ai.test(p); tests[p] = 'working'; } catch (e) { tests[p] = 'not working: ' + String(e.message || e).slice(0, 120); }
      renderServer();
    }));
    document.querySelectorAll('#srvMain [data-replace]').forEach(b => b.addEventListener('click', () => openSettings && openSettings()));
    document.querySelectorAll('#srvMain [data-reconnect]').forEach(b => b.addEventListener('click', async () => {
      try { await api.social.connect({ key: b.dataset.reconnect, wantOrg: false }); await serverRefresh(); } catch (e) { alert(e.message); }
    }));
  }
  $('#srvBack').addEventListener('click', () => goBack());

  return {
    async showFile(k) { if (k) key = k; open = null; msg = ''; fpanel.classList.add('open'); await fileRefresh().catch(e => { $('#fcMain').innerHTML = `<div class="bhint">${esc(e.message)}</div>`; }); },
    hideFile() { fpanel.classList.remove('open'); },
    async showServer() { spanel.classList.add('open'); await serverRefresh().catch(e => { $('#srvMain').innerHTML = `<div class="bhint">${esc(e.message)}</div>`; }); },
    hideServer() { spanel.classList.remove('open'); },
    async refreshServer() { if (spanel.classList.contains('open')) return serverRefresh(); return null; },
    status: () => status
  };
}
