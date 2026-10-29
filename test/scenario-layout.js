// Milo and Vera through the real UI: pick a context folder (with an OBJ rail and notes), ask for a pipe, answer Milo's questions, send to Vera, send back, pass, save.
// AMO_SCENARIO=mo AMO_MOCK=1 AMO_MO_DIR=<folder> AMO_USERDATA=<dir>
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 60000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await wait(100); } throw new Error('timeout waiting for ' + what); };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  // Blob reads never complete headless: give the exporter a FileReader that uses blob.arrayBuffer()
  window.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then(r => { this.result = r; this.onloadend && this.onloadend(); }); } readAsDataURL(b) { b.arrayBuffer().then(r => { let s = ''; const u = new Uint8Array(r); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); this.result = 'data:application/octet-stream;base64,' + btoa(s); this.onloadend && this.onloadend(); }); } };
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const o = window.__office;
  await step('Grid connects every room', async () => {
    const d = o._dims, n = o.nav, cell = o.navCell; const NAVX0 = -13, NAVZ0 = -11;
    const idx = (x, z) => { const c = Math.floor((x - NAVX0) / cell), r = Math.floor((z - NAVZ0) / cell); return r * n.cols + c; };
    const start = idx(0, 8); if (!n.grid[start]) throw new Error('media start cell blocked');
    const seen = new Uint8Array(n.grid.length), q = [start]; seen[start] = 1;
    while (q.length) { const i = q.pop(), c = i % n.cols, r = (i / n.cols) | 0; for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= n.cols || nr >= n.rows) continue; const j = nr * n.cols + nc; if (n.grid[j] && !seen[j]) { seen[j] = 1; q.push(j); } } }
    const rooms = { media: [0, 4], drawing: [d.DRAW.cx, 7], modelling: [d.MODEL.cx, 7], corridor: [20, (d.CORR.z0 + d.CORR.z1) / 2], reception: [d.RECEP.cx, d.RECEP.z0 + 6], docs: [d.DOCS.cx - 1, d.DOCS.z0 + 6], meeting: [d.MEET.cx - 4, d.MEET.cz + 1.4], lounge: [d.LOUNGE.cx, d.LOUNGE.z0 + 5], next: [d.NEXT.x0 + 4, 0] };
    const bad = []; for (const [k, [x, z]] of Object.entries(rooms)) { let ok = false; for (let dx = -2; dx <= 2 && !ok; dx += 0.5) for (let dz = -2; dz <= 2 && !ok; dz += 0.5) { const i = idx(x + dx, z + dz); if (seen[i]) ok = true; } if (!ok) bad.push(k); }
    if (bad.length) throw new Error('not reachable from media: ' + bad.join(', '));
    return 'all ' + Object.keys(rooms).length + ' areas reachable';
  });
  await step('Agents wander and visit other rooms without getting stuck', async () => {
    const ids = [...o.agents.keys()]; const seenLabels = new Set(); const orig = o.renderer.render.bind(o.renderer), origL = o.labelRenderer.render.bind(o.labelRenderer); o.renderer.render = () => {}; o.labelRenderer.render = () => {};
    for (let i = 0; i < 1500; i++) { o.step(0.1); for (const id of ids) { const a = o.agents.get(id); const t = a.el.querySelector('.st').textContent; if (/to |at /.test(t)) seenLabels.add(t); } }
    o.renderer.render = orig; o.labelRenderer.render = origL;
    if (!seenLabels.size) throw new Error('nobody visited another room in 150 s of office time'); return [...seenLabels].slice(0, 6).join(' | ');
  });
  await step('Clicking the whiteboard opens the projects panel', async () => {
    window.__goRoom('overview'); await wait(200); o.onPick('board'); await until(() => $('#boardPanel').classList.contains('open'), 90000, 'board panel');
    return $('#bdMain').textContent.slice(0, 80);
  });
  await step('Set a job and a task from the board', async () => {
    const api = window.office; let V = await api.biz.jobSave({ job: { number: 'X999999', name: 'Test substation', client: 'Test', status: 'Active', notes: 'Metric. Grey everything.', drawings: [] } });
    await window.__boardUI.refresh(); const j = V.jobs.find(x => x.number === 'X999999'); window.__boardUI.selectJob(j.id);
    $('#bdCur').click(); await wait(300); if (!/in hand/i.test($('#bdCur').textContent)) throw new Error('not in hand: ' + $('#bdCur').textContent);
    $('#bdTitle').value = 'Build a skid'; const opt = [...$('#bdAgent').options].find(x => /Theo/.test(x.textContent)); if (!opt) throw new Error('no Theo in the list'); $('#bdAgent').value = opt.value;
    $('#bdAdd').click(); try { await until(() => /Build a skid/.test($('#bdMain').textContent), 90000, 'task card'); } catch (e) { throw new Error(String(e) + ' | msg=' + ($('#bdMsg') && $('#bdMsg').textContent) + ' | sel=' + JSON.stringify(window.__boardUI._state()) + ' | main=' + $('#bdMain').textContent.slice(500, 1800)); } return 'task added';
  });
  await step('Open with Theo carries the job and the text', async () => {
    document.querySelector('button[data-act=open]').click(); await until(() => $('#modPanel').classList.contains('open'), 90000, 'builder panel');
    if (window.__modellerUI._state().mode !== 'build') throw new Error('not build mode'); if (!/Build a skid/.test($('#moRequest').value)) throw new Error('prompt not filled');
    const cur = await window.office.biz.current(); if (!cur) throw new Error('no job in hand');
    $('#moGo').click(); await until(() => !$('#moQs').hidden || !$('#moResult').hidden, 150000, 'Theo answer'); return 'ok';
  });
  window.__office.step(0.1); await wait(300);
  return report;
})();
