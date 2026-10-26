// Drives the modeling room through the real UI: plaque -> room -> pedestal -> drop a photo -> model appears.
// Run with AMO_SCENARIO=model (AMO_VARIANT=room only walks into the room, for a screenshot). Needs test/mock-api.js and AMO_MOCK=1.
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); let n = 0; while (Date.now() - t0 < ms) { if (fn()) return true; await wait(100); } throw new Error('timeout waiting'); };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  window.addEventListener('unhandledrejection', e => report.errors.push('unhandled: ' + (e.reason?.message || e.reason)));
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const o = window.__office;
  // software GL renders the big scene very slowly and starves the page, so skip drawing it while the UI is exercised
  const realR = o.renderer.render.bind(o.renderer), realL = o.labelRenderer.render.bind(o.labelRenderer);
  const quiet = (on) => { o.renderer.render = on ? () => {} : realR; o.labelRenderer.render = on ? () => {} : realL; };
  const run = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { o.step(0.12); await wait(30); } };

  quiet(true);
  await step('Room exists and the drawing room plaque leads to it', async () => {
    if (!o.modelRoom) throw new Error('no modeling room in the scene');
    window.__goRoom('drawing'); await run(1500);
    if (!o.modelRoom.plaque.parent) throw new Error('plaque not attached');
    o.onPick('modeldoor');
    await until(() => document.body.classList.contains('room-modeling') && o.room === 'modeling', 2000);
    if ($('#modelPanel').classList.contains('open')) throw new Error('panel should wait for the pedestal click');
    if (document.querySelector('#rooms button.active').dataset.room !== 'modeling') throw new Error('tab not highlighted');
    await run(1500);
    return 'room switched, panel closed, tab active';
  });
  if (window.__variant === 'room') { quiet(false); await run(600); report.final = { room: o.room, tab: document.querySelector('#rooms button.active')?.dataset.room, cam: o.camera.position.toArray().map(n => +n.toFixed(1)), tgt: o.controls.target.toArray().map(n => +n.toFixed(1)), tween: !!o.tween }; report.done = true; return report; }

  await step('Pedestal click opens the panel; empty state', async () => {
    o.onPick('scan'); await until(() => $('#modelPanel').classList.contains('open'), 2000);
    if (!$('#modelGo').disabled) throw new Error('Make button should be disabled with no photo');
    if (o.modelRoom.hasModel()) throw new Error('pedestal should start empty');
    return 'panel open, button disabled';
  });

  await step('No Higgsfield key: asks to connect', async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#c0392b'; x.fillRect(100, 100, 400, 250); x.fillStyle = '#222'; x.fillRect(150, 60, 120, 60);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'pump.png', { type: 'image/png' }));
    $('#dropPhoto').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await until(() => !$('#modelGo').disabled, 15000);
    $('#modelGo').click(); await wait(300);
    if (!/Connect Higgsfield/.test($('#modelErr').textContent)) throw new Error('unexpected: ' + $('#modelErr').textContent);
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
    return $('#modelErr').textContent;
  });

  await step('Higgsfield connected: photo in, model on the pedestal and in the viewer, no endpoint needed', async () => {
    $('#s_higgsfieldKeyId').value = 'id'; $('#s_higgsfieldSecret').value = 'sec'; $('#saveSettings').click(); await wait(400);
    $('#modelGo').click();
    const why = () => 'run=' + $('#modelRun').hidden + ' result=' + $('#modelResult').hidden + ' err=' + $('#modelErr').textContent;
    await until(() => !$('#modelResult').hidden || $('#modelErr').textContent, 30000).catch(() => { throw new Error('no result: ' + why()); });
    if ($('#modelErr').textContent) throw new Error('generation failed: ' + $('#modelErr').textContent);
    if (!o.modelRoom.hasModel()) throw new Error('model did not reach the pedestal');
    await wait(1000); const V = window.__modelUI._viewer, cv = $('#modelCanvas');
    V.renderer.render(V.scene, V.camera);
    const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height; const tx = t.getContext('2d'); tx.drawImage(cv, 0, 0);
    const d = tx.getImageData(0, 0, t.width, t.height).data; let px = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) px++;
    if (px < 2000) throw new Error('viewer drew almost nothing (' + px + ' px)');
    return $('#modelInfo').textContent + ' | viewer pixels ' + px;
  });

  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  quiet(false); await run(2500);
  report.done = true; return report;
})();
