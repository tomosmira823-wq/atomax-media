import { Office, AgentPreview, GEAR } from './office.js';
import { initDexUI } from './dexui.js';
import { initCheckUI } from './checkui.js';
import { initBizUI } from './bizui.js';
import { initModelingUI } from './modeling.js';

const $ = (s) => document.querySelector(s);
const api = window.office;

const office = new Office($('#scene'), $('#labels'));
window.__office = office;
let settings = {}, agents = [], posts = [], images = [], refImages = [];

// ---------- boot ----------
async function boot() {
  settings = await api.settings.get();
  agents = await api.agents.get();
  posts = await api.posts.get();
  syncOffice();
  renderAgentPick();
  updateKeyDots();
  fillImageSelects();
  if (!settings.anthropicKey) { fillSettings(); openModal('settingsModal'); }
}
boot();
function syncOffice() {
  const on = agents.filter(a => a.enabled);
  office.setAgents(on.filter(a => !isDrawing(a)), on.filter(isDrawing).slice(0, 2));
}

// ---------- updates ----------
api.version().then(v => { $('#verText').textContent = 'Atomax Media Office v' + v; });
api.update.onStatus(s => {
  const el = $('#update');
  if (s.state === 'downloading') el.textContent = 'Update ' + (s.version ? 'v' + s.version + ' ' : '') + 'downloading' + (s.percent != null ? ' ' + s.percent + '%' : '') + '…';
  else if (s.state === 'ready') { el.innerHTML = `<button class="btn small primary" id="installUpdate">Restart to update to v${esc(s.version)}</button>`; $('#installUpdate').addEventListener('click', () => api.update.install()); }
  else if (s.state === 'error') el.textContent = '';
});
$('#checkUpdate').addEventListener('click', async () => { $('#updText').textContent = 'Checking…'; try { $('#updText').textContent = await api.update.check(); } catch (e) { $('#updText').textContent = e.message; } });

const GOOGLE_IMAGE_MODELS = ['gemini-nano-banana-2.1', 'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image'];
const DEFAULT_IMAGE_MODELS = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2'];
function imageModelList() { return (settings.openaiImageModels && settings.openaiImageModels.length) ? settings.openaiImageModels : DEFAULT_IMAGE_MODELS; }
function modelLabel(id) { return id.startsWith('dall-e') ? id.replace('dall-e', 'DALL·E ') + (id === 'dall-e-3' ? ' (generate only)' : '') : id; }
function fillImageSelects() {
  const list = imageModelList();
  const cur = settings.openaiImageModel && list.includes(settings.openaiImageModel) ? settings.openaiImageModel : list[0];
  const gcur = settings.googleImageModel && GOOGLE_IMAGE_MODELS.includes(settings.googleImageModel) ? settings.googleImageModel : GOOGLE_IMAGE_MODELS[0];
  $('#imageProvider').innerHTML = list.map(id => `<option value="openai:${esc(id)}">OpenAI · ${esc(modelLabel(id))}</option>`).join('')
    + GOOGLE_IMAGE_MODELS.map(id => `<option value="google:${esc(id)}">Google · ${esc(id)}</option>`).join('')
    + '<option value="higgsfield">Higgsfield · SOUL</option>';
  $('#imageProvider').value = settings.imageProvider === 'higgsfield' ? 'higgsfield' : settings.imageProvider === 'google' ? 'google:' + gcur : 'openai:' + cur;
  if ($('#s_googleImageModel')) $('#s_googleImageModel').value = gcur;
  $('#s_openaiImageModel').innerHTML = list.map(id => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
  $('#s_openaiImageModel').value = cur;
  $('#s_openaiImageQuality').value = settings.openaiImageQuality || 'high';
}
$('#imageProvider').addEventListener('change', async () => {
  const { provider, model } = imageChoice();
  settings.imageProvider = provider; if (provider === 'openai' && model) settings.openaiImageModel = model; if (provider === 'google' && model) settings.googleImageModel = model;
  await api.settings.set(settings);
});
function imageChoice() {
  const v = $('#imageProvider').value || 'openai:gpt-image-2';
  const [provider, model] = v.split(':');
  return { provider, model: model || (provider === 'google' ? settings.googleImageModel : settings.openaiImageModel) };
}
function updateKeyDots() {
  $('#k-claude .dot').classList.toggle('ok', !!settings.anthropicKey);
  $('#k-openai .dot').classList.toggle('ok', !!settings.openaiKey);
  $('#k-google .dot').classList.toggle('ok', !!settings.googleKey);
  $('#k-hf .dot').classList.toggle('ok', !!(settings.higgsfieldKeyId && settings.higgsfieldSecret));
}

// ---------- tabs / modals ----------
document.querySelectorAll('#top .tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#top .tabs button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const t = b.dataset.tab;
  if (t === 'history') { renderHistory(); openModal('historyModal'); }
  if (t === 'business') { bizUI.open().then(() => openModal('bizModal')); return; }
  if (t === 'agents') { renderTeam(); openModal('agentsModal'); }
  if (t === 'settings') { fillSettings(); openModal('settingsModal'); }
}));
function openModal(id) { $('#' + id).classList.add('open'); }
function closeModals() {
  if (preview) preview.stop();
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('#top .tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'office'));
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
document.querySelectorAll('.modal').forEach(m => m.addEventListener('mousedown', (e) => { if (e.target === m) closeModals(); }));
document.querySelectorAll('.panel .collapse').forEach(b => { if (['deskBack', 'dexBack', 'modelBack'].includes(b.id)) return; b.addEventListener('click', () => b.closest('.panel').classList.toggle('collapsed')); }); // the room panels' x closes them (own handler), it must not also shrink them
['#checkPanel', '#dexPanel', '#modelPanel'].forEach(sel => $(sel).classList.remove('collapsed'));

// ---------- settings ----------
function fillConnections() {
  const so = settings.social || {};
  const li = so.linkedin || {}, fb = so.facebook || {}, x = so.x || {};
  $('#li_clientId').value = li.clientId || ''; $('#li_clientSecret').value = li.clientSecret || ''; $('#li_wantOrg').checked = !!li.wantOrg;
  $('#li_target').innerHTML = `<option value="${esc(li.memberUrn || '')}">Me${li.name ? ' (' + esc(li.name) + ')' : ''}</option>` + (li.orgs || []).map(o => `<option value="${esc(o.urn)}">${esc(o.name)} (company page)</option>`).join('');
  if (li.target) $('#li_target').value = li.target;
  $('#fb_appId').value = fb.appId || ''; $('#fb_appSecret').value = fb.appSecret || '';
  $('#fb_pageId').innerHTML = (fb.pages || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.igName ? ' · IG @' + esc(p.igName) : ''}</option>`).join('') || '<option value="">(connect first)</option>';
  if (fb.pageId) $('#fb_pageId').value = fb.pageId;
  $('#fb_ig').textContent = (fb.pages || []).some(p => p.igName) ? '' : (fb.connected ? 'No Instagram Business account linked to these Pages.' : '');
  $('#x_clientId').value = x.clientId || ''; $('#x_clientSecret').value = x.clientSecret || '';
  const st = (key, c) => { const el = document.querySelector(`.conn[data-key="${key}"] .cstat`); el.textContent = c.connected ? '● connected' + (c.name ? ' as ' + c.name : '') : '○ not connected'; el.classList.toggle('on', !!c.connected); };
  st('linkedin', li); st('facebook', fb); st('x', x);
  if (li.orgNote) document.querySelector('.conn[data-key="linkedin"] .cstat').textContent += ' · ' + li.orgNote;
}
function readConnections() {
  settings.social = {
    linkedin: { ...(settings.social?.linkedin || {}), clientId: $('#li_clientId').value.trim(), clientSecret: $('#li_clientSecret').value.trim(), wantOrg: $('#li_wantOrg').checked, target: $('#li_target').value || undefined },
    facebook: { ...(settings.social?.facebook || {}), appId: $('#fb_appId').value.trim(), appSecret: $('#fb_appSecret').value.trim(), pageId: $('#fb_pageId').value || undefined },
    x: { ...(settings.social?.x || {}), clientId: $('#x_clientId').value.trim(), clientSecret: $('#x_clientSecret').value.trim() }
  };
}
document.querySelectorAll('.conn .cconnect').forEach(b => b.addEventListener('click', async () => {
  const key = b.closest('.conn').dataset.key; const st = b.closest('.conn').querySelector('.cstat');
  readConnections(); await api.settings.set(settings);
  st.textContent = 'Opening login in your browser…'; st.className = 'cstat hint';
  try { settings.social = await api.social.connect({ key, wantOrg: $('#li_wantOrg').checked }); fillConnections(); }
  catch (e) { st.textContent = e.message; st.className = 'cstat err'; }
}));
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => api.openExternal(b.dataset.open)));
$('#cbCopy').addEventListener('click', () => { navigator.clipboard.writeText($('#cbUrl').value); $('#cbCopy').textContent = 'Copied ✓'; setTimeout(() => $('#cbCopy').textContent = 'Copy', 1500); });
document.querySelectorAll('.conn .cdisconnect').forEach(b => b.addEventListener('click', async () => {
  settings.social = await api.social.disconnect(b.closest('.conn').dataset.key); fillConnections();
}));

async function fillLogo() {
  const l = await api.logo.get();
  if (l?.base64) $('#logoPreview').src = 'data:image/png;base64,' + l.base64;
  $('#logoHint').textContent = l?.custom ? 'Your logo file' : 'Built-in Atomax-UK logo';
}
$('#logoPick').addEventListener('click', async () => { const r = await api.logo.set(); if (r) fillLogo(); });
$('#logoReset').addEventListener('click', async () => { await api.logo.reset(); fillLogo(); });
function fillSettings() {
  fillConnections(); fillLogo();
  for (const k of ['anthropicKey', 'openaiKey', 'googleKey', 'googleImageModel', 'higgsfieldKeyId', 'higgsfieldSecret', 'claudeModel', 'openaiImageModel', 'higgsfieldModel', 'imageProvider']) $('#s_' + k).value = settings[k] || '';
  for (const k of ['name', 'about', 'audience', 'website', 'doNot', 'knowledge']) $('#c_' + k).value = settings.company[k] || '';
  $('#siteHint').textContent = settings.company.pulledAt ? 'Last pulled ' + new Date(settings.company.pulledAt).toLocaleString('en-GB') + ' from ' + (settings.company.pages || []).length + ' pages.' : '';
}
$('#saveSettings').addEventListener('click', async () => {
  readConnections();
  for (const k of ['anthropicKey', 'openaiKey', 'googleKey', 'googleImageModel', 'higgsfieldKeyId', 'higgsfieldSecret', 'claudeModel', 'openaiImageModel', 'higgsfieldModel', 'imageProvider']) settings[k] = $('#s_' + k).value.trim();
  for (const k of ['name', 'about', 'audience', 'website', 'doNot', 'knowledge']) settings.company[k] = $('#c_' + k).value.trim();
  await api.settings.set(settings);
  settings.openaiImageQuality = $('#s_openaiImageQuality').value;
  updateKeyDots(); fillImageSelects(); closeModals();
});
$('#pullSite').addEventListener('click', async () => {
  const url = $('#c_website').value.trim(); if (!url) { $('#siteHint').textContent = 'Enter the website address first.'; return; }
  settings.anthropicKey = $('#s_anthropicKey').value.trim(); await api.settings.set(settings);
  $('#siteHint').innerHTML = '<span class="spinner"></span> Reading the site and writing the profile…'; $('#pullSite').disabled = true;
  try {
    const r = await api.companyFromWebsite(url);
    settings.company = r.company;
    for (const k of ['name', 'about', 'audience', 'website', 'knowledge']) $('#c_' + k).value = settings.company[k] || '';
    $('#siteHint').textContent = `Done. Read ${r.pages.length} pages: ${r.pages.slice(0, 5).join(' · ')}${r.pages.length > 5 ? ' …' : ''}`;
  } catch (e) { $('#siteHint').textContent = e.message; }
  $('#pullSite').disabled = false;
});
$('#detectModels').addEventListener('click', async () => {
  settings.openaiKey = $('#s_openaiKey').value.trim(); await api.settings.set(settings);
  $('#modelsHint').textContent = 'Checking…';
  try {
    const list = await api.image.openaiModels();
    if (!list.length) { $('#modelsHint').textContent = 'No image models found on this key.'; return; }
    settings.openaiImageModels = list;
    if (!list.includes(settings.openaiImageModel)) settings.openaiImageModel = list.find(x => x.startsWith('gpt-image')) || list[0];
    await api.settings.set(settings); fillImageSelects();
    $('#modelsHint').textContent = 'Your key can use: ' + list.join(', ');
  } catch (e) { $('#modelsHint').textContent = e.message; }
});
document.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
  // save first so the test uses what's typed
  for (const k of ['anthropicKey', 'openaiKey', 'googleKey', 'googleImageModel', 'higgsfieldKeyId', 'higgsfieldSecret', 'claudeModel', 'openaiImageModel', 'higgsfieldModel']) settings[k] = $('#s_' + k).value.trim();
  await api.settings.set(settings); updateKeyDots();
  const out = $('#t_' + b.dataset.test); out.textContent = 'Testing…'; out.className = 'hint';
  try { out.textContent = await api.ai.test(b.dataset.test); out.className = 'ok'; }
  catch (e) { out.textContent = e.message; out.className = 'err'; }
}));

// ---------- agents ----------
const isReviewer = (a) => a.role === 'reviewer';
function isDrawing(a) { return a.role === 'drawing' || a.role === 'drafter'; }
const isDrafter = (a) => a.role === 'drafter';
function renderAgentPick() {
  const writers = agents.filter(a => a.enabled && !isReviewer(a) && !isDrawing(a));
  const reviewers = agents.filter(a => a.enabled && isReviewer(a));
  const row = (a) => `<label><input type="checkbox" data-id="${a.id}" checked /> <i class="swatch" style="background:${a.colour}"></i> ${esc(a.name)} · ${esc(a.platform)}</label>`;
  $('#agentPick').innerHTML = (writers.map(row).join('') || '<span class="hint">No writers enabled. Add some in the Agents tab.</span>')
    + (reviewers.length ? `<div class="hint">Reviewers check every post</div>` + reviewers.map(row).join('') : '');
}
// ---------- agents: team grid + loadout ----------
const SWATCHES = ['#0a66c2', '#e1306c', '#1877f2', '#111111', '#00f2ea', '#f59f00', '#40bd00', '#8e44ad', '#20c997', '#ff6b35', '#ffffff', '#ff4757'];
let preview = null, loIndex = -1, loDraft = null;

function roleBadge(a) { if (isDrawing(a)) return '<span class="badge role rev">' + (isDrafter(a) ? 'DXF FIXER' : 'DRAWINGS') + '</span>'; return isReviewer(a) ? '<span class="badge role rev">REVIEWER</span>' : '<span class="badge role">WRITER</span>'; }

function renderTeam() {
  $('#teamView').style.display = ''; $('#loadoutView').style.display = 'none';
  if (preview) preview.stop();
  $('#teamGrid').innerHTML = agents.map((a, i) => `
    <div class="tcard ${a.enabled ? '' : 'off'}" data-i="${i}">
      ${roleBadge(a)}
      <div class="avatar" style="background:${a.colour}"></div>
      <div class="name">${esc(a.name)}</div>
      <div class="plat">${esc(a.platform)}${a.enabled ? '' : ' · off'}</div>
    </div>`).join('');
  $('#teamGrid').querySelectorAll('.tcard').forEach(c => c.addEventListener('click', () => openLoadout(+c.dataset.i)));
}

function openLoadout(i) {
  loIndex = i; loDraft = { ...agents[i], gear: agents[i].gear ? [...agents[i].gear] : (isReviewer(agents[i]) ? ['glasses', 'clipboard', 'lanyard'] : ['lanyard']) };
  $('#teamView').style.display = 'none'; $('#loadoutView').style.display = '';
  if (!preview) { try { preview = new AgentPreview($('#loCanvas')); } catch (e) { console.warn('preview unavailable', e); preview = { show() {}, start() {}, stop() {}, step() {}, t: 0 }; $('#loCanvas').style.display = 'none'; } window.__preview = preview; }
  fillLoadout();
  preview.show(loDraft); preview.start();
}

function fillLoadout() {
  const a = loDraft, rev = isReviewer(a);
  $('#loName').textContent = a.name; $('#loRole').textContent = isDrawing(a) ? (isDrafter(a) ? 'DXF fixer' : 'drawing checker') : (rev ? 'reviewer' : a.platform);
  $('#lo_name').value = a.name; $('#lo_platform').value = a.platform; $('#lo_role').innerHTML = isDrawing(a) ? (isDrafter(a) ? '<option value="drafter">DXF fixer — sits at the drafting table</option>' : '<option value="drawing">Drawing checker — works in the drawing room</option>') : '<option value="writer">Writer — posts to one account</option><option value="reviewer">Reviewer — checks every post</option>'; $('#lo_role').value = isDrawing(a) ? a.role : (rev ? 'reviewer' : 'writer');
  $('#lo_enabled').checked = !!a.enabled; $('#lo_colour').value = a.colour;
  $('#lo_tone').value = a.tone || ''; $('#lo_rules').value = a.rules || ''; $('#lo_examples').value = a.examples || '';
  const dr = isDrawing(a);
  $('#lo_platformLabel').textContent = dr ? 'Job' : rev ? 'Job (e.g. Checker, Brand guardian)' : 'Platform';
  $('#lo_toneLabel').textContent = dr ? `How ${a.name} behaves (attitude)` : rev ? 'How they review (attitude, what they care about)' : 'Tone / personality';
  $('#lo_rulesLabel').textContent = dr ? (isDrafter(a) ? 'Standing rules' : 'The standard skill (what Cal checks every time)') : rev ? 'What they check' : 'Format rules';
  $('#lo_examplesLabel').textContent = dr ? `Notes for ${a.name} (optional)` : rev ? 'Example reviews or notes (optional)' : 'Example posts in this voice (optional)';
  $('#loSwatches').innerHTML = SWATCHES.map(c => `<div class="sw ${c.toLowerCase() === a.colour.toLowerCase() ? 'on' : ''}" style="background:${c}" data-c="${c}"></div>`).join('');
  $('#loSwatches').querySelectorAll('.sw').forEach(s => s.addEventListener('click', () => { loDraft.colour = s.dataset.c; $('#lo_colour').value = s.dataset.c; fillLoadout(); preview.show(loDraft); }));
  const names = { glasses: 'Glasses', hardhat: 'Hard hat', headset: 'Headset', tie: 'Green tie', clipboard: 'Clipboard', lanyard: 'Lanyard' };
  $('#loGear').innerHTML = GEAR.map(g => `<button class="${a.gear.includes(g) ? 'on' : ''}" data-g="${g}">${names[g]}</button>`).join('');
  $('#loGear').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { const g = b.dataset.g; loDraft.gear = loDraft.gear.includes(g) ? loDraft.gear.filter(x => x !== g) : [...loDraft.gear, g]; fillLoadout(); preview.show(loDraft); }));
}
function readLoadout() {
  loDraft.name = $('#lo_name').value.trim() || 'Agent'; loDraft.platform = $('#lo_platform').value.trim() || 'Platform';
  loDraft.role = $('#lo_role').value; loDraft.enabled = $('#lo_enabled').checked; loDraft.colour = $('#lo_colour').value;
  loDraft.tone = $('#lo_tone').value.trim(); loDraft.rules = $('#lo_rules').value.trim(); loDraft.examples = $('#lo_examples').value.trim();
}
$('#lo_colour').addEventListener('input', () => { loDraft.colour = $('#lo_colour').value; preview.show(loDraft); });
$('#lo_role').addEventListener('change', () => { readLoadout(); fillLoadout(); preview.show(loDraft); });
$('#lo_name').addEventListener('input', () => { $('#loName').textContent = $('#lo_name').value; });
$('#loSave').addEventListener('click', () => { readLoadout(); agents[loIndex] = loDraft; renderTeam(); });
$('#loCancel').addEventListener('click', renderTeam);
$('#backToTeam').addEventListener('click', renderTeam);
$('#loRemove').addEventListener('click', () => { agents.splice(loIndex, 1); renderTeam(); });
$('#addAgent').addEventListener('click', () => {
  agents.push({ id: 'agent-' + Date.now(), enabled: true, role: 'writer', colour: '#8e44ad', name: 'New writer', platform: 'YouTube', tone: 'Describe the personality here.', rules: 'Formatting limits here.', gear: ['lanyard'] });
  openLoadout(agents.length - 1);
});
$('#addReviewer').addEventListener('click', () => {
  agents.push({ id: 'agent-' + Date.now(), enabled: true, role: 'reviewer', colour: '#20c997', name: 'New reviewer', platform: 'Engagement coach', tone: 'Thinks only about whether people will stop, read and react.', rules: 'Hook strength, clarity, whether there is a reason to comment or share, whether it sounds like a human wrote it. Score 1-10.', gear: ['glasses', 'clipboard', 'lanyard'] });
  openLoadout(agents.length - 1);
});
$('#resetAgents').addEventListener('click', async () => { agents = await api.agents.reset(); renderTeam(); });
$('#saveAgents').addEventListener('click', async () => {
  await api.agents.set(agents);
  syncOffice(); renderAgentPick(); closeModals();
});

// ---------- brief: images ----------
window.__testAttach = (img) => { images.push(img); renderThumbs(); };
$('#addImages').addEventListener('click', async () => {
  const picked = await api.files.pickImages();
  images.push(...picked); renderThumbs();
});
$('#addRefImages').addEventListener('click', async () => {
  const picked = await api.files.pickImages();
  refImages.push(...picked); renderRefThumbs();
});
function renderRefThumbs() {
  $('#refThumbs').innerHTML = refImages.map((im, i) => `<div class="t"><img src="data:${im.mime};base64,${im.base64}" title="${esc(im.name)}"/><button data-i="${i}">×</button></div>`).join('');
  $('#refThumbs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { refImages.splice(+b.dataset.i, 1); renderRefThumbs(); }));
}
function renderThumbs() {
  $('#thumbs').innerHTML = images.map((im, i) => `<div class="t"><img src="data:${im.mime};base64,${im.base64}" title="${esc(im.name)}"/><button data-i="${i}">×</button></div>`).join('');
  $('#thumbs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { images.splice(+b.dataset.i, 1); renderThumbs(); }));
}

$('#describe').addEventListener('click', async () => {
  if (!images.length) { $('#briefErr').textContent = 'Add an image first.'; return; }
  $('#briefErr').textContent = '';
  const card = addCard({ id: 'analysis', name: 'Image analysis', platform: 'Claude', colour: '#40bd00' }, 'Looking…');
  try {
    const text = await api.ai.describeImage({ images, question: $('#briefText').value.trim() ? `Context: ${$('#briefText').value.trim()}\n\nDescribe the image for a social post and suggest 3 concrete edits.` : undefined });
    card.querySelector('.content').innerHTML = `<pre>${esc(text)}</pre>`;
    card.querySelector('.status').textContent = 'done';
  } catch (e) { card.querySelector('.content').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
});

// ---------- run the office ----------
$('#run').addEventListener('click', async () => {
  const brief = $('#briefText').value.trim();
  const extra = $('#extraText').value.trim();
  const refText = $('#refText').value.trim();
  const imageBrief = $('#imageBrief').value.trim();
  const ids = [...$('#agentPick').querySelectorAll('input:checked')].map(i => i.dataset.id);
  const chosen = agents.filter(a => a.enabled && !isReviewer(a) && !isDrawing(a) && ids.includes(a.id));
  const reviewers = agents.filter(a => a.enabled && isReviewer(a) && ids.includes(a.id));
  if (!brief && !images.length) { $('#briefErr').textContent = 'Write a brief or add an image.'; return; }
  if (!chosen.length) { $('#briefErr').textContent = 'Pick at least one agent.'; return; }
  if (!settings.anthropicKey) { $('#briefErr').textContent = 'Add your Claude API key in Settings.'; openModal('settingsModal'); return; }
  $('#briefErr').textContent = '';
  $('#run').disabled = true;
  const boardRows = agents.filter(a => a.enabled && !isDrawing(a)).map(a => ({ colour: a.colour, text: `${a.name} · ${a.platform}`, status: chosen.includes(a) ? 'Working' : 'Ready' }));
  office.setBoard(boardRows);

  const runEntries = [];
  await Promise.all(chosen.map(async (agent) => {
    office.setState(agent.id, 'working', `writing ${agent.platform} post`);
    const card = addCard(agent, 'writing…');
    const slot = { agent, card, entry: null }; runEntries.push(slot);
    try {
      const post = await api.ai.writePost({ agent, brief: brief || '(no written brief, write from the image)', images, extra, refText, refImages, imageBrief });
      const entry = { id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), agentId: agent.id, agentName: agent.name, platform: agent.platform, colour: agent.colour, brief, refText, imageBrief, post, created: new Date().toISOString(), image: null };
      posts.unshift(entry); await api.posts.set(posts); slot.entry = entry;
      fillCard(card, agent, entry);
      office.setState(agent.id, 'done', 'post ready');
      boardRows.find(r => r.text.startsWith(agent.name)).status = 'Done'; office.setBoard(boardRows);
      await runReviews(card, agent, entry, reviewers, boardRows);
    } catch (e) {
      card.querySelector('.content').innerHTML = `<div class="err">${esc(e.message)}</div>`;
      card.querySelector('.status').textContent = 'failed';
      office.setState(agent.id, 'idle', 'error');
      boardRows.find(r => r.text.startsWith(agent.name)).status = 'Error'; office.setBoard(boardRows);
    }
  }));
  // images: one per writer by default (each from its own idea, in its platform's shape); optionally one shared image
  if ($('#makeImage').checked) {
    const made = runEntries.filter(x => x.entry);
    const shared = $('#sameImage').checked;
    const { provider, model } = imageChoice();
    const refNote = $('#refText').value.trim();
    const shapeFor = (platform) => /instagram/i.test(platform) ? { size: '1024x1024', aspect: '1:1' } : /tiktok/i.test(platform) ? { size: '1024x1536', aspect: '2:3' } : { size: '1536x1024', aspect: '3:2' };
    const makeFor = async (x) => {
      const post = x.entry.post;
      const shape = shared ? { size: 'auto', aspect: '1:1' } : shapeFor(x.agent.platform);
      const shapeNote = shared ? '' : `\nOutput shape: ${shape.size === '1024x1024' ? 'square' : shape.size === '1024x1536' ? 'portrait' : 'landscape'}, framed for ${x.agent.platform}.`;
      // the image brief leads; the writer's image idea is the platform-specific art direction underneath it
      const lead = imageBrief ? `THE IMAGE MUST SHOW: ${imageBrief}` + (settings.company?.knowledge ? `\nAbout the company (for accuracy): ${settings.company.about} ${settings.company.knowledge.slice(0, 600)}` : '') : '';
      const direction = post.imageIdea ? `Art direction for ${x.agent.platform}: ${post.imageIdea}` : '';
      if (images.length) {
        const instruction = [lead, direction, refNote ? 'Reference note from the brief: ' + refNote : ''].filter(Boolean).join('\n') || 'Tidy and brighten the photo and add a clean Atomax-UK branded banner.';
        return api.image.edit({ prompt: instruction + shapeNote, image: images[0], overlayText: post.overlayText || '', model, provider, aspect: shape.aspect, size: shared ? 'auto' : shape.size });
      }
      const prompt = [lead, direction || brief].filter(Boolean).join('\n') + `\nStyle: clean, modern, professional engineering photography look, Atomax-UK branding (green #40BD00, navy #0E121D). Any text must be spelled exactly and kept minimal.` + shapeNote;
      return api.image.generate({ provider, model, prompt, size: shape.size, aspect: shape.aspect });
    };
    if (made.length) {
      office.setBoard(boardRows.map(r => ({ ...r, status: r.status === 'Done' ? 'Working' : r.status })));
      const targets = shared ? [made[0]] : made;
      await Promise.all(targets.map(async (x) => {
        const group = shared ? made : [x];
        group.forEach(y => { y.card.querySelector('.status').innerHTML = '<span class="spinner"></span> making image'; office.setState(y.agent.id, 'working', images.length ? 'editing the photo' : 'making the image'); });
        try {
          const r = await makeFor(x);
          for (const y of group) y.entry.image = r.base64;
          await api.posts.set(posts);
          for (const y of group) fillCard(y.card, y.agent, y.entry);
        } catch (e) {
          for (const y of group) { y.card.querySelector('.err').textContent = 'Image: ' + e.message; y.card.querySelector('.status').textContent = 'image failed'; }
        }
        group.forEach(y => office.setState(y.agent.id, 'done', 'post + image ready'));
      }));
      office.setBoard(boardRows);
    }
  }
  $('#run').disabled = false;
  setTimeout(() => [...chosen, ...reviewers].forEach(a => office.setState(a.id, 'idle')), 25000);
});

async function runReviews(card, agent, entry, reviewers, boardRows) {
  entry.reviews = entry.reviews || [];
  for (const rev of reviewers) {
    office.setState(rev.id, 'working', `checking ${agent.name}'s post`);
    const row = boardRows.find(r => r.text.startsWith(rev.name)); if (row) { row.status = 'Working'; office.setBoard(boardRows); }
    const chipsBox = card.querySelector('.chips');
    const holder = document.createElement('span'); holder.className = 'chip'; holder.innerHTML = `<span class="spinner"></span> ${esc(rev.name)}`;
    if (chipsBox) chipsBox.appendChild(holder);
    try {
      const review = await api.ai.reviewPost({ reviewer: rev, agent, post: entry.post, brief: entry.brief, images, refText: entry.refText || '', refImages });
      review.reviewerId = rev.id; review.reviewerName = rev.name; review.colour = rev.colour;
      entry.reviews = entry.reviews.filter(x => x.reviewerId !== rev.id); entry.reviews.push(review);
      await api.posts.set(posts);
      fillCard(card, agent, entry);
      office.setState(rev.id, 'done', `${agent.name}: ${review.score}/10`);
    } catch (e) {
      holder.className = 'chip fail'; holder.textContent = rev.name + ' failed'; holder.title = e.message;
      office.setState(rev.id, 'idle', 'error');
    }
    if (row) { row.status = 'Done'; office.setBoard(boardRows); }
  }
}

function renderReview(holder, r, card, agent, entry) {
  const v = (r.verdict || 'fix').toLowerCase();
  const badge = v === 'pass' ? '<span class="badge pass">PASS</span>' : v === 'fail' ? '<span class="badge fail">FAIL</span>' : '<span class="badge fix">NEEDS WORK</span>';
  holder.innerHTML = `
    <div class="rhead"><i class="swatch" style="background:${r.colour}"></i><b>${esc(r.reviewerName)}</b> ${badge} <span class="score">${esc(r.score)}/10</span></div>
    <div class="rsum">${esc(r.summary || '')}</div>
    ${(r.good || []).length ? `<ul class="good">${r.good.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${(r.issues || []).length ? `<ul class="bad">${r.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${r.fixedCaption ? `<button class="btn small b_applyfix">Apply ${esc(r.reviewerName)}'s fix</button>` : ''}`;
  const b = holder.querySelector('.b_applyfix');
  if (b) b.addEventListener('click', async () => {
    entry.post = { ...entry.post, caption: r.fixedCaption };
    await api.posts.set(posts);
    fillCard(card, agent, entry);
  });
}

// ---------- cards ----------
function addCard(agent, status) {
  const first = $('#boardBody .hint'); if (first) first.remove();
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = `<div class="head"><i class="swatch" style="background:${agent.colour}"></i>${esc(agent.name)} · ${esc(agent.platform)}<span class="status"><span class="spinner"></span> ${esc(status)}</span></div><div class="content"><div class="post-text hint">Writing…</div></div>`;
  $('#boardBody').prepend(card);
  return card;
}

function fillCard(card, agent, entry) {
  const p = entry.post;
  card.querySelector('.status').textContent = new Date(entry.created).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const c = card.querySelector('.content');
  const reviews = entry.reviews || [];
  const chips = reviews.map(r => { const v = (r.verdict || 'fix').toLowerCase(); return `<span class="chip ${v}" title="${esc(r.summary || '')}">${esc(r.reviewerName)} ${esc(r.score)}/10</span>`; }).join('');
  c.innerHTML = `
    ${entry.image ? `<img class="post-img" src="data:image/png;base64,${entry.image}"/>` : (images[0] ? `<img class="post-img draft" src="data:${images[0].mime};base64,${images[0].base64}" title="Your attached photo (not edited yet)"/>` : '')}
    <div class="post-text">${esc(p.caption || '')}</div>
    <div class="post-foot">
      <button class="btn small primary b_post">Post</button>
      <button class="btn small b_copy">Copy</button>
      <span class="chips">${chips}</span>
      <button class="btn small b_more" style="margin-left:auto">More ▾</button>
    </div>
    <div class="posted">${entry.posted ? '✅ Posted ' + new Date(entry.posted.at).toLocaleString('en-GB') + (entry.posted.url ? ' · <a href="#" class="b_open">open</a>' : '') : ''}</div>
    <div class="more" style="display:none">
      <div class="revise"><input type="text" class="r_text" placeholder="Change the post (shorter, more formal…) or describe an image edit" /><button class="btn small b_revise">Rewrite</button><button class="btn small b_edit" ${images.length ? '' : 'disabled'}>Edit image</button></div>
      <div class="actions">
        <button class="btn small b_img">${entry.image ? 'New image' : 'Generate image'}</button>
        ${entry.image ? '<button class="btn small b_saveimg">Save image</button>' : ''}
        <button class="btn small b_save">Save .txt</button>
        <button class="btn small b_del">Delete</button>
      </div>
      <div class="meta">${p.overlayText ? '🏷 ' + esc(p.overlayText) + '<br>' : ''}${p.altText ? 'Alt: ' + esc(p.altText) + '<br>' : ''}${p.bestTime ? '⏰ ' + esc(p.bestTime) + '<br>' : ''}${p.notes ? '⚠ ' + esc(p.notes) : ''}</div>
      <div class="reviews"></div>
    </div>
    <div class="err"></div>`;
  reviews.forEach(r => { const h = document.createElement('div'); h.className = 'review'; c.querySelector('.reviews').appendChild(h); renderReview(h, r, card, agent, entry); });
  c.querySelector('.b_more').addEventListener('click', () => { const m = c.querySelector('.more'); const open = m.style.display === 'none'; m.style.display = open ? '' : 'none'; c.querySelector('.b_more').textContent = open ? 'Less ▴' : 'More ▾'; });
  c.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => { c.querySelector('.more').style.display = ''; c.querySelector('.b_more').textContent = 'Less ▴'; }));
  c.querySelector('.b_copy').addEventListener('click', () => { navigator.clipboard.writeText(p.caption || ''); c.querySelector('.b_copy').textContent = 'Copied ✓'; setTimeout(() => c.querySelector('.b_copy').textContent = 'Copy', 1500); });
  c.querySelector('.b_save').addEventListener('click', () => api.files.saveText({ text: `${agent.platform} post — ${new Date(entry.created).toLocaleString('en-GB')}\n\n${p.caption}\n\nAlt text: ${p.altText || ''}\nBest time: ${p.bestTime || ''}\nImage idea: ${p.imageIdea || ''}`, name: `${agent.platform.replace(/\W+/g, '-')}-post.txt` }));
  const postBtn = c.querySelector('.b_post');
  if (isReviewer(agent)) postBtn.remove();
  else api.social.canPost(agent.platform).then(r => { if (!r.ok) { postBtn.dataset.connect = '1'; postBtn.textContent = 'Connect ' + agent.platform; postBtn.title = r.why; } });
  if (postBtn.isConnected) postBtn.addEventListener('click', async () => {
    if (postBtn.dataset.connect) {
      const p0 = agent.platform.toLowerCase(); const key = p0.includes('linkedin') ? 'linkedin' : p0.includes('x') || p0.includes('twitter') ? 'x' : 'facebook';
      const have = settings.social?.[key] || {};
      if (!(have.clientId || have.appId)) { document.querySelector('[data-tab=settings]').click(); document.querySelector(`.conn[data-key="${key}"]`)?.scrollIntoView(); document.querySelector(`.conn[data-key="${key}"] details`)?.setAttribute('open', ''); return; }
      postBtn.disabled = true; postBtn.textContent = 'Opening login…';
      try { settings.social = await api.social.connect({ key, wantOrg: false }); fillConnections(); delete postBtn.dataset.connect; postBtn.textContent = 'Post'; } catch (e) { postBtn.textContent = 'Connect ' + agent.platform; postBtn.title = e.message; }
      postBtn.disabled = false; return;
    }
    const img = entry.image ? { base64: entry.image, mime: 'image/png', alt: p.altText || '' } : (images[0] ? { ...images[0], alt: p.altText || '' } : null);
    if (!confirm(`Post this to ${agent.platform} now${img ? ' with the image' : ' (no image)'}?`)) return;
    postBtn.disabled = true; postBtn.innerHTML = '<span class="spinner"></span> posting';
    office.setState(agent.id, 'working', `posting to ${agent.platform}`);
    try {
      const r = await api.social.publish({ platform: agent.platform, text: p.caption || '', image: img });
      entry.posted = { at: new Date().toISOString(), url: r.url, id: r.id }; await api.posts.set(posts); fillCard(card, agent, entry);
      office.setState(agent.id, 'done', 'posted ✓');
    } catch (e) { c.querySelector('.err').textContent = e.message; postBtn.disabled = false; postBtn.textContent = 'Post'; office.setState(agent.id, 'done', 'post failed'); }
  });
  const openLink = c.querySelector('.b_open'); if (openLink) openLink.addEventListener('click', (ev) => { ev.preventDefault(); api.openExternal(entry.posted.url); });
  c.querySelector('.b_del').addEventListener('click', async () => { posts = posts.filter(x => x.id !== entry.id); await api.posts.set(posts); card.remove(); });
  c.querySelector('.b_revise').addEventListener('click', async () => {
    const instruction = c.querySelector('.r_text').value.trim(); if (!instruction) return;
    office.setState(agent.id, 'working', 'revising');
    c.querySelector('.err').textContent = ''; c.querySelector('.b_revise').disabled = true;
    try {
      entry.post = await api.ai.revisePost({ agent, post: entry.post, instruction });
      await api.posts.set(posts); fillCard(card, agent, entry);
    } catch (e) { c.querySelector('.err').textContent = e.message; }
    c.querySelector('.b_revise').disabled = false; office.setState(agent.id, 'done', 'post ready');
  });
  c.querySelector('.b_img').addEventListener('click', async () => {
    const { provider, model } = imageChoice();
    office.setState(agent.id, 'working', `making image (${model || provider})`);
    c.querySelector('.err').textContent = ''; c.querySelector('.b_img').disabled = true; c.querySelector('.b_img').innerHTML = '<span class="spinner"></span> generating';
    try {
      const prompt = [entry.imageBrief ? 'THE IMAGE MUST SHOW: ' + entry.imageBrief : '', p.imageIdea ? 'Art direction: ' + p.imageIdea : (entry.brief || p.caption)].filter(Boolean).join('\n') + `\nStyle: clean, modern, professional engineering photography look, Atomax-UK branding (green #40BD00, navy #0E121D).`;
      const r = await api.image.generate({ provider, model, prompt, size: agent.platform === 'LinkedIn' ? '1536x1024' : '1024x1024', aspect: agent.platform === 'LinkedIn' ? '3:2' : '1:1' });
      entry.image = r.base64; await api.posts.set(posts); fillCard(card, agent, entry);
    } catch (e) { c.querySelector('.err').textContent = e.message; c.querySelector('.b_img').disabled = false; c.querySelector('.b_img').textContent = 'Generate image'; }
    office.setState(agent.id, 'done', 'post ready');
  });
  c.querySelector('.b_edit').addEventListener('click', async () => {
    if (!images.length) return;
    const typed = c.querySelector('.r_text').value.trim();
    const refNote = $('#refText').value.trim();
    const overlayText = p.overlayText || '';
    const instruction = typed || [p.imageIdea, refNote ? 'Reference note from the brief: ' + refNote : ''].filter(Boolean).join('\n')
      || 'Brighten it, tidy the background and add a subtle Atomax green accent';
    office.setState(agent.id, 'working', 'editing image');
    c.querySelector('.err').textContent = ''; c.querySelector('.b_edit').disabled = true; c.querySelector('.b_edit').innerHTML = '<span class="spinner"></span> editing';
    try {
      const r = await api.image.edit({ prompt: instruction, image: images[0], overlayText: typed ? '' : overlayText, model: imageChoice().model, provider: imageChoice().provider, aspect: '1:1' });
      entry.image = r.base64; await api.posts.set(posts); fillCard(card, agent, entry);
    } catch (e) { c.querySelector('.err').textContent = e.message; c.querySelector('.b_edit').disabled = false; c.querySelector('.b_edit').textContent = 'Edit image'; }
    office.setState(agent.id, 'done', 'post ready');
  });
  const si = c.querySelector('.b_saveimg'); if (si) si.addEventListener('click', () => api.files.saveImage({ base64: entry.image, name: `${agent.platform.replace(/\W+/g, '-')}-image.png` }));
}

// ---------- history ----------
function renderHistory() {
  if (!posts.length) { $('#history').innerHTML = '<p class="hint">Nothing yet.</p>'; return; }
  $('#history').innerHTML = '';
  posts.forEach(entry => {
    const agent = agents.find(a => a.id === entry.agentId) || { id: entry.agentId, name: entry.agentName, platform: entry.platform, colour: entry.colour };
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div class="head"><i class="swatch" style="background:${agent.colour}"></i>${esc(agent.name)} · ${esc(agent.platform)}<span class="status">${new Date(entry.created).toLocaleString('en-GB')}</span></div><div class="content"></div>`;
    $('#history').appendChild(card);
    fillCard(card, agent, entry);
  });
}
$('#clearHistory').addEventListener('click', async () => { if (confirm('Delete all saved posts?')) { posts = []; await api.posts.set(posts); renderHistory(); } });

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }


// ---------- rooms + Cal's desk ----------
const calAgent = () => agents.find(a => a.enabled && a.role === 'drawing');
const dexAgent = () => agents.find(a => a.enabled && isDrafter(a));
const checkUI = initCheckUI({ office, api, getAgent: calAgent, getSettings: () => settings, openSettings: () => { fillSettings(); openModal('settingsModal'); } });
const bizUI = initBizUI({ api, getSettings: () => settings, openSettings: () => { fillSettings(); openModal('settingsModal'); } });
const dexUI = initDexUI({ office, api, getAgent: dexAgent, getSettings: () => settings, openSettings: () => { fillSettings(); openModal('settingsModal'); } });
const modelUI = initModelingUI({ office, api, getSettings: () => settings, openSettings: () => { fillSettings(); openModal('settingsModal'); } });
function goRoom(where) {
  const inModel = where === 'modeling' || where === 'scan';
  const inDraw = where !== 'media';
  document.body.classList.toggle('room-drawing', inDraw);
  document.body.classList.toggle('room-modeling', inModel);
  document.querySelectorAll('#rooms button').forEach(b => b.classList.toggle('active', b.dataset.room === (inModel ? 'modeling' : inDraw ? 'drawing' : 'media')));
  ['#checkPanel', '#dexPanel', '#modelPanel'].forEach(sel => $(sel).classList.remove('collapsed'));
  if (where === 'desk') { checkUI.show(); bizUI.fillJobSelect($('#checkJob')); } else checkUI.hide();
  if (where === 'drafting') { dexUI.show(); bizUI.fillJobSelect($('#dexJob')); } else dexUI.hide();
  if (where === 'scan') modelUI.show(); else modelUI.hide();
  office.focus(where);
}
document.querySelectorAll('#rooms button').forEach(b => b.addEventListener('click', () => goRoom(b.dataset.room)));
$('#deskBack').addEventListener('click', () => goRoom('drawing'));
$('#dexBack').addEventListener('click', () => goRoom('drawing'));
$('#modelBack').addEventListener('click', () => goRoom('modeling'));
office.onPick = (what) => { if (what === 'door') goRoom('drawing'); else if (what === 'desk') { if (calAgent()) goRoom('desk'); } else if (what === 'drafting') { if (dexAgent()) goRoom('drafting'); } else if (what === 'modeldoor') goRoom('modeling'); else if (what === 'scan') goRoom('scan'); };
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape' || document.querySelector('.modal.open')) return; if (office.room === 'desk' || office.room === 'drafting') goRoom('drawing'); else if (office.room === 'scan') goRoom('modeling'); });
// ---- first person ----
office.onFirstPerson = (on, room) => {
  document.body.classList.toggle('fp', on);
  if (on) { checkUI.hide(); dexUI.hide(); modelUI.hide(); }
  else if (room) goRoom(room);
};
const toggleFP = () => { if (office.fp) office.exitFirstPerson(); else { if (['desk', 'drafting', 'scan'].includes(office.room)) goRoom(office.room === 'scan' ? 'modeling' : 'drawing'); office.enterFirstPerson(); } };
$('#fpBtn').addEventListener('click', toggleFP);
document.addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) || document.querySelector('.modal.open')) return;
  if (e.key === 'Escape' && office.fp) { office.exitFirstPerson(); e.preventDefault(); }
  else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFP();
});
window.__goRoom = goRoom;
window.__modelUI = modelUI;
