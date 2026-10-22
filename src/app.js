import { Office } from './office.js';

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
  office.setAgents(agents.filter(a => a.enabled));
  renderAgentPick();
  updateKeyDots();
  $('#imageProvider').value = settings.imageProvider || 'openai';
  if (!settings.anthropicKey) { fillSettings(); openModal('settingsModal'); }
}
boot();

// ---------- updates ----------
api.version().then(v => { $('#verText').textContent = 'Atomax Media Office v' + v; });
api.update.onStatus(s => {
  const el = $('#update');
  if (s.state === 'downloading') el.textContent = 'Update ' + (s.version ? 'v' + s.version + ' ' : '') + 'downloading' + (s.percent != null ? ' ' + s.percent + '%' : '') + '…';
  else if (s.state === 'ready') { el.innerHTML = `<button class="btn small primary" id="installUpdate">Restart to update to v${esc(s.version)}</button>`; $('#installUpdate').addEventListener('click', () => api.update.install()); }
  else if (s.state === 'error') el.textContent = '';
});
$('#checkUpdate').addEventListener('click', async () => { $('#updText').textContent = 'Checking…'; try { $('#updText').textContent = await api.update.check(); } catch (e) { $('#updText').textContent = e.message; } });

function updateKeyDots() {
  $('#k-claude .dot').classList.toggle('ok', !!settings.anthropicKey);
  $('#k-openai .dot').classList.toggle('ok', !!settings.openaiKey);
  $('#k-hf .dot').classList.toggle('ok', !!(settings.higgsfieldKeyId && settings.higgsfieldSecret));
}

// ---------- tabs / modals ----------
document.querySelectorAll('#top .tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#top .tabs button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const t = b.dataset.tab;
  if (t === 'history') { renderHistory(); openModal('historyModal'); }
  if (t === 'agents') { renderAgentEditor(); openModal('agentsModal'); }
  if (t === 'settings') { fillSettings(); openModal('settingsModal'); }
}));
function openModal(id) { $('#' + id).classList.add('open'); }
function closeModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('#top .tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'office'));
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
document.querySelectorAll('.panel .collapse').forEach(b => b.addEventListener('click', () => b.closest('.panel').classList.toggle('collapsed')));

// ---------- settings ----------
function fillSettings() {
  for (const k of ['anthropicKey', 'openaiKey', 'higgsfieldKeyId', 'higgsfieldSecret', 'claudeModel', 'openaiImageModel', 'higgsfieldModel', 'imageProvider']) $('#s_' + k).value = settings[k] || '';
  for (const k of ['name', 'about', 'audience', 'website', 'doNot']) $('#c_' + k).value = settings.company[k] || '';
}
$('#saveSettings').addEventListener('click', async () => {
  for (const k of ['anthropicKey', 'openaiKey', 'higgsfieldKeyId', 'higgsfieldSecret', 'claudeModel', 'openaiImageModel', 'higgsfieldModel', 'imageProvider']) settings[k] = $('#s_' + k).value.trim();
  for (const k of ['name', 'about', 'audience', 'website', 'doNot']) settings.company[k] = $('#c_' + k).value.trim();
  await api.settings.set(settings);
  updateKeyDots(); $('#imageProvider').value = settings.imageProvider; closeModals();
});
document.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
  // save first so the test uses what's typed
  for (const k of ['anthropicKey', 'openaiKey', 'higgsfieldKeyId', 'higgsfieldSecret', 'claudeModel', 'openaiImageModel', 'higgsfieldModel']) settings[k] = $('#s_' + k).value.trim();
  await api.settings.set(settings); updateKeyDots();
  const out = $('#t_' + b.dataset.test); out.textContent = 'Testing…'; out.className = 'hint';
  try { out.textContent = await api.ai.test(b.dataset.test); out.className = 'ok'; }
  catch (e) { out.textContent = e.message; out.className = 'err'; }
}));

// ---------- agents ----------
const isReviewer = (a) => a.role === 'reviewer';
function renderAgentPick() {
  const writers = agents.filter(a => a.enabled && !isReviewer(a));
  const reviewers = agents.filter(a => a.enabled && isReviewer(a));
  const row = (a) => `<label><input type="checkbox" data-id="${a.id}" checked /> <i class="swatch" style="background:${a.colour}"></i> ${esc(a.name)} · ${esc(a.platform)}</label>`;
  $('#agentPick').innerHTML = (writers.map(row).join('') || '<span class="hint">No writers enabled. Add some in the Agents tab.</span>')
    + (reviewers.length ? `<div class="hint" style="margin-top:6px">Reviewers (check every post)</div>` + reviewers.map(row).join('') : '');
}
function renderAgentEditor() {
  $('#agentList').innerHTML = agents.map((a, i) => `
    <div class="agentrow" data-i="${i}">
      <div class="top">
        <input type="checkbox" class="a_enabled" ${a.enabled ? 'checked' : ''} title="Enabled" />
        <select class="a_role" style="width:110px"><option value="writer" ${isReviewer(a) ? '' : 'selected'}>Writer</option><option value="reviewer" ${isReviewer(a) ? 'selected' : ''}>Reviewer</option></select>
        <input type="color" class="a_colour" value="${a.colour}" />
        <input type="text" class="a_name" value="${esc(a.name)}" placeholder="Agent name" style="width:140px" />
        <input type="text" class="a_platform" value="${esc(a.platform)}" placeholder="${isReviewer(a) ? 'Job (e.g. Checker)' : 'Platform'}" style="width:160px" />
        <button class="btn small a_del" style="margin-left:auto">Remove</button>
      </div>
      <label>${isReviewer(a) ? 'How they review (attitude, what they care about)' : 'Tone / personality'}</label><textarea class="a_tone" style="min-height:60px">${esc(a.tone)}</textarea>
      <label>${isReviewer(a) ? 'What they check' : 'Format rules'}</label><textarea class="a_rules" style="min-height:50px">${esc(a.rules)}</textarea>
      <label>${isReviewer(a) ? 'Example reviews or notes (optional)' : 'Example posts in this voice (optional) — paste 2 or 3 real ones'}</label><textarea class="a_examples" style="min-height:50px" placeholder="Saved permanently. The agent matches this voice every time.">${esc(a.examples || '')}</textarea>
    </div>`).join('');
  $('#agentList').querySelectorAll('.a_del').forEach(b => b.addEventListener('click', () => { agents.splice(+b.closest('.agentrow').dataset.i, 1); renderAgentEditor(); }));
  $('#agentList').querySelectorAll('.a_role').forEach(sel => sel.addEventListener('change', () => { agents = readAgentEditor(); renderAgentEditor(); }));
}
function readAgentEditor() {
  return [...$('#agentList').querySelectorAll('.agentrow')].map((r, i) => ({
    id: agents[i]?.id || ('agent-' + Date.now() + i),
    enabled: r.querySelector('.a_enabled').checked,
    role: r.querySelector('.a_role').value,
    colour: r.querySelector('.a_colour').value,
    name: r.querySelector('.a_name').value.trim() || 'Agent',
    platform: r.querySelector('.a_platform').value.trim() || 'Platform',
    tone: r.querySelector('.a_tone').value.trim(),
    rules: r.querySelector('.a_rules').value.trim(),
    examples: r.querySelector('.a_examples').value.trim()
  }));
}
$('#addAgent').addEventListener('click', () => {
  agents = readAgentEditor();
  agents.push({ id: 'agent-' + Date.now(), enabled: true, role: 'writer', colour: '#8e44ad', name: 'New writer', platform: 'YouTube', tone: 'Describe the personality here.', rules: 'Formatting limits here.' });
  renderAgentEditor();
});
$('#addReviewer').addEventListener('click', () => {
  agents = readAgentEditor();
  agents.push({ id: 'agent-' + Date.now(), enabled: true, role: 'reviewer', colour: '#20c997', name: 'New reviewer', platform: 'Engagement coach', tone: 'Thinks only about whether people will stop, read and react.', rules: 'Hook strength, clarity, whether there is a reason to comment or share, whether it sounds like a human wrote it. Score 1-10.' });
  renderAgentEditor();
});
$('#resetAgents').addEventListener('click', async () => { agents = await api.agents.reset(); renderAgentEditor(); });
$('#saveAgents').addEventListener('click', async () => {
  agents = readAgentEditor();
  await api.agents.set(agents);
  office.setAgents(agents.filter(a => a.enabled)); renderAgentPick(); closeModals();
});

// ---------- brief: images ----------
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
  const ids = [...$('#agentPick').querySelectorAll('input:checked')].map(i => i.dataset.id);
  const chosen = agents.filter(a => a.enabled && !isReviewer(a) && ids.includes(a.id));
  const reviewers = agents.filter(a => a.enabled && isReviewer(a) && ids.includes(a.id));
  if (!brief && !images.length) { $('#briefErr').textContent = 'Write a brief or add an image.'; return; }
  if (!chosen.length) { $('#briefErr').textContent = 'Pick at least one agent.'; return; }
  if (!settings.anthropicKey) { $('#briefErr').textContent = 'Add your Claude API key in Settings.'; openModal('settingsModal'); return; }
  $('#briefErr').textContent = '';
  $('#run').disabled = true;
  const boardRows = agents.filter(a => a.enabled).map(a => ({ colour: a.colour, text: `${a.name} · ${a.platform}`, status: chosen.includes(a) ? 'Working' : 'Ready' }));
  office.setBoard(boardRows);

  const runEntries = [];
  await Promise.all(chosen.map(async (agent) => {
    office.setState(agent.id, 'working', `writing ${agent.platform} post`);
    const card = addCard(agent, 'writing…');
    const slot = { agent, card, entry: null }; runEntries.push(slot);
    try {
      const post = await api.ai.writePost({ agent, brief: brief || '(no written brief, write from the image)', images, extra, refText, refImages });
      const entry = { id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), agentId: agent.id, agentName: agent.name, platform: agent.platform, colour: agent.colour, brief, refText, post, created: new Date().toISOString(), image: null };
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
  // make the image once for the run (edit the attached photo, or generate from the first writer's idea) and attach it to every post
  if ($('#makeImage').checked) {
    const made = runEntries.filter(x => x.entry);
    if (made.length) {
      const lead = made[0];
      const provider = $('#imageProvider').value;
      const refNote = $('#refText').value.trim();
      made.forEach(x => { x.card.querySelector('.status').innerHTML = '<span class="spinner"></span> making image'; office.setState(x.agent.id, 'working', images.length ? 'editing the photo' : 'making the image'); });
      office.setBoard(boardRows.map(r => ({ ...r, status: r.status === 'Done' ? 'Working' : r.status })));
      try {
        let r;
        if (images.length) {
          const instruction = [lead.entry.post.imageIdea, refNote ? 'Reference note from the brief: ' + refNote : ''].filter(Boolean).join('\n') || 'Tidy and brighten the photo and add a clean Atomax-UK branded banner.';
          r = await api.image.edit({ prompt: instruction, image: images[0], overlayText: lead.entry.post.overlayText || '' });
        } else {
          const prompt = (lead.entry.post.imageIdea || brief) + `\nStyle: clean, modern, professional engineering photography look, Atomax brand green (#40BD00) and navy (#0E121D) accents.`;
          r = await api.image.generate({ provider, prompt, size: '1024x1024', aspect: '1:1' });
        }
        for (const x of made) { x.entry.image = r.base64; }
        await api.posts.set(posts);
        for (const x of made) fillCard(x.card, x.agent, x.entry);
      } catch (e) {
        for (const x of made) { x.card.querySelector('.err').textContent = 'Image: ' + e.message; x.card.querySelector('.status').textContent = 'image failed'; }
      }
      office.setBoard(boardRows);
      made.forEach(x => office.setState(x.agent.id, 'done', 'post + image ready'));
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
    const box = card.querySelector('.reviews');
    const holder = document.createElement('div'); holder.className = 'review'; holder.innerHTML = `<div class="rhead"><i class="swatch" style="background:${rev.colour}"></i><b>${esc(rev.name)}</b> <span class="spinner"></span> reviewing…</div>`;
    box.appendChild(holder);
    try {
      const review = await api.ai.reviewPost({ reviewer: rev, agent, post: entry.post, brief: entry.brief, images, refText: entry.refText || '', refImages });
      review.reviewerId = rev.id; review.reviewerName = rev.name; review.colour = rev.colour;
      entry.reviews = entry.reviews.filter(x => x.reviewerId !== rev.id); entry.reviews.push(review);
      await api.posts.set(posts);
      renderReview(holder, review, card, agent, entry);
      office.setState(rev.id, 'done', `${agent.name}: ${review.score}/10`);
    } catch (e) {
      holder.innerHTML = `<div class="rhead"><b>${esc(rev.name)}</b></div><div class="err">${esc(e.message)}</div>`;
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
  card.innerHTML = `<div class="head"><i class="swatch" style="background:${agent.colour}"></i>${esc(agent.name)} · ${esc(agent.platform)}<span class="status"><span class="spinner"></span> ${esc(status)}</span></div><div class="content"><span class="hint">Thinking about the brief…</span></div>`;
  $('#boardBody').prepend(card);
  return card;
}

function fillCard(card, agent, entry) {
  const p = entry.post;
  card.querySelector('.status').textContent = new Date(entry.created).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const c = card.querySelector('.content');
  c.innerHTML = `
    <pre class="caption">${esc(p.caption || '')}</pre>
    <div class="meta">${p.bestTime ? '⏰ ' + esc(p.bestTime) + '<br>' : ''}${p.altText ? '🖼 Alt: ' + esc(p.altText) + '<br>' : ''}${p.overlayText ? '🏷 Banner text: ' + esc(p.overlayText) + '<br>' : ''}${p.notes ? '⚠ ' + esc(p.notes) : ''}</div>
    <div class="imgwrap">${entry.image ? `<img class="gen" src="data:image/png;base64,${entry.image}"/>` : ''}</div>
    <div class="actions">
      <button class="btn small b_copy">Copy post</button>
      <button class="btn small b_save">Save .txt</button>
      <button class="btn small b_img">${entry.image ? 'Regenerate image' : 'Generate image'}</button>
      <button class="btn small b_edit" ${images.length ? '' : 'disabled title="Add an image in the brief first"'} title="OpenAI edits your photo. Default: the writer's image idea + your reference note, with the real Atomax logo supplied. Type your own instruction in the box below to override.">Edit my image</button>
      ${entry.image ? '<button class="btn small b_saveimg">Save image</button>' : ''}
      <button class="btn small b_del">Delete</button>
    </div>
    <div class="reviews"></div>
    <div class="revise"><input type="text" class="r_text" placeholder="Revise the post, or describe an image edit (e.g. shorter / brighten and tidy the background)" /><button class="btn small b_revise">Go</button></div>
    <div class="err"></div>`;
  (entry.reviews || []).forEach(r => { const h = document.createElement('div'); h.className = 'review'; c.querySelector('.reviews').appendChild(h); renderReview(h, r, card, agent, entry); });
  c.querySelector('.b_copy').addEventListener('click', () => { navigator.clipboard.writeText(p.caption || ''); c.querySelector('.b_copy').textContent = 'Copied ✓'; setTimeout(() => c.querySelector('.b_copy').textContent = 'Copy post', 1500); });
  c.querySelector('.b_save').addEventListener('click', () => api.files.saveText({ text: `${agent.platform} post — ${new Date(entry.created).toLocaleString('en-GB')}\n\n${p.caption}\n\nAlt text: ${p.altText || ''}\nBest time: ${p.bestTime || ''}\nImage idea: ${p.imageIdea || ''}`, name: `${agent.platform.replace(/\W+/g, '-')}-post.txt` }));
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
    const provider = $('#imageProvider').value;
    office.setState(agent.id, 'working', `making image (${provider})`);
    c.querySelector('.err').textContent = ''; c.querySelector('.b_img').disabled = true; c.querySelector('.b_img').innerHTML = '<span class="spinner"></span> generating';
    try {
      const prompt = (p.imageIdea || entry.brief || p.caption) + `\nStyle: clean, modern, professional engineering photography look, Atomax brand green (#40BD00) accents, no text in the image.`;
      const r = await api.image.generate({ provider, prompt, size: agent.platform === 'LinkedIn' ? '1536x1024' : '1024x1024', aspect: agent.platform === 'LinkedIn' ? '3:2' : '1:1' });
      entry.image = r.base64; await api.posts.set(posts); fillCard(card, agent, entry);
    } catch (e) { c.querySelector('.err').textContent = e.message; c.querySelector('.b_img').disabled = false; c.querySelector('.b_img').textContent = 'Generate image'; }
    office.setState(agent.id, 'done', 'post ready');
  });
  c.querySelector('.b_edit').addEventListener('click', async () => {
    if (!images.length) return;
    const typed = c.querySelector('.r_text').value.trim();
    const refNote = $('#refText').value.trim();
    const overlayText = p.overlayText || '';
    // default: the writer's own image idea (which already follows the reference) plus the reference note
    const instruction = typed || [p.imageIdea, refNote ? 'Reference note from the brief: ' + refNote : ''].filter(Boolean).join('\n')
      || 'Brighten it, tidy the background and add a subtle Atomax green accent';
    office.setState(agent.id, 'working', 'editing image');
    c.querySelector('.err').textContent = ''; c.querySelector('.b_edit').disabled = true; c.querySelector('.b_edit').innerHTML = '<span class="spinner"></span> editing';
    try {
      const r = await api.image.edit({ prompt: instruction, image: images[0], overlayText: typed ? '' : overlayText });
      entry.image = r.base64; await api.posts.set(posts); fillCard(card, agent, entry);
    } catch (e) { c.querySelector('.err').textContent = e.message; c.querySelector('.b_edit').disabled = false; c.querySelector('.b_edit').textContent = 'Edit my image'; }
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
