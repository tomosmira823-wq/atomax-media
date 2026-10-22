// Drives a full office run through the real UI (runs inside the renderer via executeJavaScript).
// Returns a report object. Uses only what a user could do: typing, clicking, waiting.
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; window.__office?.step(0.05); await wait(100); } throw new Error('timeout waiting'); };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  window.addEventListener('unhandledrejection', e => report.errors.push('unhandled: ' + (e.reason?.message || e.reason)));

  await step('wait for agents loaded', () => until(() => document.querySelectorAll('#agentPick input').length >= 4, 20000));

  // attach a fake photo (bypasses the OS dialog; same shape the dialog returns)
  const V = window.__variant || '';
  if (V !== 'nophoto') await step('attach photo', async () => {
    const r = await fetch('./icon-512.png'); const b = await r.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(b)));
    window.__testAttach({ name: 'site.png', mime: 'image/png', base64 });
    await until(() => document.querySelectorAll('#thumbs .t').length === 1, 2000);
    return 'thumb shown';
  });

  await step('fill brief', () => {
    $('#briefText').value = 'Site commissioning visit at Diageo Runcorn.';
    $('#extraText').value = 'mention we are hiring';
    $('#refText').value = 'Example post text to copy the style of.';
    $('#imageBrief').value = 'Add a navy Atomax banner at the bottom reading Site Commissioning for Diageo Runcorn.';
    $('#makeImage').checked = true; $('#sameImage').checked = V === 'shared';
    if (V === 'nophoto') $('#imageBrief').value = 'An engineer at a CAD screen with a substation drawing, Atomax branding on the wall.';
    return 'ok';
  });

  await step('run the office', async () => {
    $('#run').click();
    await until(() => $('#run').disabled === true, 2000);
    return 'started, run button disabled';
  });

  await step('writers produce posts', async () => {
    await until(() => document.querySelectorAll('#boardBody .card .post-text:not(.hint)').length >= 3, 60000);
    return [...document.querySelectorAll('#boardBody .card .post-text')].map(e => e.textContent.slice(0, 60));
  });

  await step('agents went to desks (3D state)', () => {
    const states = [...window.__office.agents.values()].map(a => a.data.name + ':' + a.state);
    if (!states.some(s => /working|done/.test(s))) throw new Error('no agent working: ' + states.join(','));
    return states;
  });

  await step('reviewer chips land', async () => {
    await until(() => document.querySelectorAll('#boardBody .chip.pass, #boardBody .chip.fix, #boardBody .chip.fail').length >= 3, 60000);
    return [...document.querySelectorAll('#boardBody .chip')].map(c => c.textContent.trim());
  });

  await step('images made per agent', async () => {
    await until(() => document.querySelectorAll('#boardBody .card img.post-img:not(.draft)').length >= 3, 90000);
    const calls = await (await fetch('http://127.0.0.1:52900/__calls')).json();
    const gens = calls.filter(c => /images\/generations/.test(c.url)).length, edits = calls.filter(c => /images\/edits/.test(c.url)).length;
    if (V === 'nophoto' && (gens !== 3 || edits !== 0)) throw new Error(`expected 3 generations, got gens=${gens} edits=${edits}`);
    if (V === 'shared' && (edits !== 1)) throw new Error(`expected 1 edit for shared, got edits=${edits} gens=${gens}`);
    if (V === '' && (edits !== 3 || gens !== 0)) throw new Error(`expected 3 edits, got edits=${edits} gens=${gens}`);
    return `images on 3 cards; API calls gens=${gens} edits=${edits}`;
  });

  await step('run finished', async () => { await until(() => $('#run').disabled === false, 60000); return 'run button re-enabled'; });

  if (V === '') await step('prompts carried image brief, reference and photo', () => {
    const texts = [...document.querySelectorAll('#boardBody .card .post-text')].map(e => e.textContent);
    const missing = [];
    if (!texts.every(t => /image-brief-seen/.test(t))) missing.push('image brief');
    if (!texts.every(t => /ref-seen/.test(t))) missing.push('reference');
    if (!texts.every(t => /photo-seen/.test(t))) missing.push('photo');
    if (missing.length) throw new Error('writer did not receive: ' + missing.join(', '));
    return 'all three present in every writer prompt';
  });

  await step('cut-off JSON was repaired (Facebook)', () => {
    const fb = [...document.querySelectorAll('#boardBody .card')].find(c => /Facebook/.test(c.querySelector('.head').textContent));
    if (!fb) throw new Error('no Facebook card');
    if (/did not return JSON/.test(fb.textContent)) throw new Error('JSON error shown');
    if (!fb.querySelector('.post-text')?.textContent.trim()) throw new Error('empty caption');
    return 'Facebook caption present despite truncated reply';
  });

  await step('More panel + rewrite', async () => {
    const card = document.querySelector('#boardBody .card');
    card.querySelector('.b_more').click();
    if (card.querySelector('.more').style.display === 'none') throw new Error('More did not open');
    card.querySelector('.r_text').value = 'shorter';
    card.querySelector('.b_revise').click();
    await until(() => /Revised caption/.test(document.querySelector('#boardBody .card .post-text')?.textContent || ''), 20000);
    return 'rewrite applied';
  });

  if (V === '') await step('Post to each social (mock endpoints)', async () => {
    window.confirm = () => true;
    const results = [];
    for (const card of document.querySelectorAll('#boardBody .card')) {
      const name = card.querySelector('.head').textContent.trim();
      const btn = card.querySelector('.b_post');
      await until(() => !btn.disabled, 5000).catch(() => { throw new Error(name + ': Post button disabled (' + btn.title + ')'); });
      btn.click();
      await until(() => /Posted/.test(card.querySelector('.posted')?.textContent || '') || card.querySelector('.err')?.textContent, 20000);
      const err = card.querySelector('.err')?.textContent;
      if (err) throw new Error(name + ': ' + err);
      results.push(name + ' -> ' + card.querySelector('.posted').textContent.trim().slice(0, 40));
    }
    return results;
  });

  await step('Copy button', () => { document.querySelector('#boardBody .card .b_copy').click(); return 'clicked'; });

  await step('Posts tab shows history', async () => {
    document.querySelector('[data-tab=history]').click();
    await until(() => document.querySelectorAll('#history .card').length >= 3, 5000);
    const n = document.querySelectorAll('#history .card').length;
    document.querySelector('#historyModal .x').click();
    return n + ' saved posts';
  });

  await step('Agents tab -> loadout -> back', async () => {
    document.querySelector('[data-tab=agents]').click();
    await until(() => document.querySelectorAll('.tcard').length >= 4, 3000);
    document.querySelector('.tcard').click();
    await until(() => $('#loadoutView').style.display !== 'none', 2000);
    for (let i = 0; i < 5; i++) { window.__preview.t += 0.1; window.__preview.step(); await wait(10); }
    $('#backToTeam').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await until(() => !document.querySelector('#agentsModal').classList.contains('open'), 2000);
    return 'loadout opened and closed with Esc';
  });

  await step('Settings detect models', async () => {
    document.querySelector('[data-tab=settings]').click();
    $('#detectModels').click();
    await until(() => /Your key can use/.test($('#modelsHint').textContent), 10000);
    const opts = [...$('#imageProvider').options].map(o => o.value);
    document.querySelector('#settingsModal .x').click();
    return opts;
  });

  // leave the board visible for the screenshot
  for (let i = 0; i < 3; i++) { window.__office.step(0.05); await wait(10); }
  return report;
})();
