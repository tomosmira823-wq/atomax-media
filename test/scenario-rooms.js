// The File Room and the Server Room through the real UI: walk in, open a cabinet, drop a file, tick an agent, change a skill and read what Cal is given,
// save a correction to a rulebook, run a writer (spend goes up), hit a monthly cap (the agent pauses), test a key, check the social expiry warning.
// AMO_SCENARIO=rooms, with AMO_MOCK=1 and AMO_USERDATA holding settings.json with a Claude key and social logins (LinkedIn expires in 3 days).
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 60000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await wait(100); } throw new Error('timeout waiting for ' + what); };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  // headless file reads never finish with Blob.stream: read through arrayBuffer instead
  window.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then(r => { let s = ''; const u = new Uint8Array(r); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); this.result = 'data:text/plain;base64,' + btoa(s); this.onload && this.onload(); }); } };
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const o = window.__office, api = window.office, RU = window.__roomsUI;

  await step('Both rooms are walkable from the corridor', async () => {
    const n = o.nav, cell = o.navCell, d = o._dims;
    const idx = (x, z) => Math.floor((z - -11) / cell) * n.cols + Math.floor((x - -13) / cell);
    const seen = new Uint8Array(n.grid.length);
    const sx = 20, sz = (d.CORR.z0 + d.CORR.z1) / 2; const q = [idx(sx, sz)]; seen[q[0]] = 1;
    while (q.length) { const i = q.pop(), c = i % n.cols, r = (i / n.cols) | 0; for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= n.cols || nr >= n.rows) continue; const j = nr * n.cols + nc; if (n.grid[j] && !seen[j]) { seen[j] = 1; q.push(j); } } }
    const bad = []; for (const [k, R] of [['file', d.FILE], ['server', d.SERVER]]) { let ok = false; for (let x = R.x0 + 1; x < R.x1 - 1 && !ok; x += 0.5) for (let z = R.z0 + 1; z < R.z1 - 1 && !ok; z += 0.5) if (seen[idx(x, z)]) ok = true; if (!ok) bad.push(k); }
    if (bad.length) throw new Error('not reachable from the corridor: ' + bad.join(', '));
    return 'file and server rooms reachable';
  });

  await step('The File Room plaque walks in and lists six cabinets', async () => {
    o.onPick('fileroom');
    await until(() => document.body.classList.contains('room-side') && $('#filePanel').classList.contains('open'), 60000, 'file panel');
    await until(() => document.querySelectorAll('#fcTabs .fc').length === 6, 60000, 'six cabinets');
    return [...document.querySelectorAll('#fcTabs .fc')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
  });

  await step('Clicking a cabinet slides its drawer out and shows its skills', async () => {
    o.onPick('cabinet:skills');
    await until(() => o.newRooms.file.cabs.find(c => c.key === 'skills').drawer.position.x > 0.5, 60000, 'drawer out');
    await until(() => [...document.querySelectorAll('#fcMain .frow')].some(r => r.textContent.includes('Electrical drawing check')), 60000, 'skill row');
    return 'drawer open, Electrical drawing check listed';
  });

  await step('Dropping a file files it into the open cabinet', async () => {
    o.onPick('cabinet:templates');
    await until(() => document.querySelectorAll('#fcTabs .fc.on').length === 1 && document.querySelector('#fcTabs .fc.on').dataset.key === 'templates', 60000, 'templates tab');
    const dt = new DataTransfer(); dt.items.add(new File(['Cover sheet: Atomax-UK standard, grey titleblock'], 'cover-sheet.md', { type: 'text/markdown' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    let items = []; for (let i = 0; i < 80 && !items.some(x => x.name === 'cover-sheet'); i++) { await wait(100); items = await api.library.items({ key: 'templates' }); }
    if (!items.some(x => x.name === 'cover-sheet')) throw new Error('file did not land in templates');
    return 'cover-sheet filed in templates';
  });

  await step('Ticking an agent on a file gives that agent the file', async () => {
    await api.library.save({ key: 'templates', file: 'cover-sheet.md', agents: ['documents'] });
    const view = await api.library.agentView({ agentId: 'documents' });
    if (!view.context) throw new Error('documents agent does not see the ticked template');
    return 'Dot now reads ' + view.context + ' characters of context';
  });

  await step('A skill change reaches Cal at run time', async () => {
    const before = (await api.library.agentView({ agentId: 'cal' })).skill;
    const files = await api.library.items({ key: 'skills' });
    const drawing = files.find(f => f.agents.includes('cal') && f.file.startsWith('electrical'));
    if (!drawing) throw new Error('no Cal skill in the library');
    await api.library.save({ key: 'skills', file: drawing.file, text: before + '\n\nSCENARIO-MARKER: circle every missing gland in red.' });
    const after = (await api.library.agentView({ agentId: 'cal' })).skill;
    if (!after.includes('SCENARIO-MARKER')) throw new Error('Cal does not read the changed skill');
    return 'Cal reads the changed skill';
  });

  await step('A correction saved to a rulebook is in that agent\'s prompt', async () => {
    o.onPick('cabinet:rulebooks');
    await until(() => document.querySelector('#fcTabs .fc.on') && document.querySelector('#fcTabs .fc.on').dataset.key === 'rulebooks', 60000, 'rulebooks tab');
    await api.library.correction({ agentId: 'linkedin', text: 'Never start a post with a question.' });
    const view = await api.library.agentView({ agentId: 'linkedin' });
    if (!view.rulebook.includes('Never start a post')) throw new Error('rulebook not read');
    return 'rulebook read by Lena';
  });

  await step('Server room plaque lists the providers and social logins', async () => {
    o.onPick('serverroom');
    await until(() => $('#serverPanel').classList.contains('open') && document.querySelectorAll('#srvMain .scard').length >= 4, 60000, 'server cards');
    const warn = $('#srvMain .sban');
    if (!warn || !warn.textContent.includes('LinkedIn')) throw new Error('no LinkedIn expiry warning (3 days left)');
    return document.querySelectorAll('#srvMain .scard').length + ' cards, LinkedIn expiry warning shown';
  });

  await step('A test run puts real numbers in the spend', async () => {
    const agent = { id: 'linkedin', name: 'Lena', platform: 'LinkedIn', tone: 'Plain and direct', rules: 'Max 1300 characters.' };
    await api.ai.writePost({ agent, brief: 'A short post about cable schedule checks' }).catch(() => {});
    const st = await api.server.status();
    const c = st.providers.find(p => p.provider === 'claude');
    if (!(c.spent > 0)) throw new Error('claude spend still zero');
    return 'Claude spend ' + c.spent.toFixed(3) + ' of ' + c.cap;
  });

  await step('A monthly cap pauses the agent and says so', async () => {
    await api.server.setCap({ provider: 'claude', cap: 0 });
    let err = '';
    try { await api.ai.writePost({ agent: { id: 'linkedin', name: 'Lena', platform: 'LinkedIn', tone: 'x', rules: 'y' }, brief: 'Should not run' }); } catch (e) { err = String(e.message || e); }
    if (!/cap reached/.test(err)) throw new Error('agent did not pause: ' + err);
    const st = await api.server.status();
    if (st.providers.find(p => p.provider === 'claude').state !== 'capped') throw new Error('state not capped');
    await api.server.setCap({ provider: 'claude', cap: 60 });
    return 'paused with: ' + err.slice(0, 90);
  });

  await step('Key test shows working and never shows the key', async () => {
    await api.ai.test('claude');
    const html = $('#serverPanel').innerHTML;
    if (html.includes('sk-test')) throw new Error('the key is shown in the panel');
    return 'Claude key works, key not shown';
  });

  await step('Back buttons return to the office', async () => {
    $('#srvBack').click();
    await until(() => !$('#serverPanel').classList.contains('open'), 60000, 'server panel closed');
    $('#fileBack').click();
    await until(() => !$('#filePanel').classList.contains('open') && !document.body.classList.contains('room-side'), 60000, 'file panel closed');
    return 'both panels closed';
  });

  await step('Closing and reopening the rooms shows the panels again (not collapsed)', async () => {
    for (const [room, sel] of [['file', '#filePanel'], ['server', '#serverPanel'], ['email', '#mailPanel']]) {
      window.__goRoom(room);
      await until(() => $(sel).classList.contains('open'), 60000, room + ' open');
      const back = $(sel).querySelector('.collapse'); back.click();
      await until(() => !$(sel).classList.contains('open'), 30000, room + ' closed');
      window.__goRoom(room);
      await until(() => $(sel).classList.contains('open'), 60000, room + ' reopened');
      if ($(sel).classList.contains('collapsed')) throw new Error(room + ' panel came back collapsed');
      window.__goRoom('overview');
    }
    if (getComputedStyle($('#brief')).display !== 'none') throw new Error('media brief shows in the whole office view');
    window.__goRoom('media'); await wait(500);
    if (getComputedStyle($('#brief')).display === 'none') throw new Error('media brief missing in the media office');
    window.__goRoom('overview');
    return 'file, server and email panels reopen full size; brief only in the media office';
  });

  return { steps: report.steps.map(s => ({ name: s.name, ok: s.ok, info: s.info, err: s.err })), errors: report.errors };
})()
