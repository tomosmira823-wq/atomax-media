// First person: walk through both doorways, bounce off walls, leave with Esc. AMO_SCENARIO=fp AMO_MOCK=1. AMO_VARIANT=shot leaves the camera in the modeling room for a screenshot.
(async () => {
  const report = { steps: [], errors: [] };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const o = window.__office, D = o._dims;
  const realR = o.renderer.render.bind(o.renderer), realL = o.labelRenderer.render.bind(o.labelRenderer);
  const quiet = (on) => { o.renderer.render = on ? () => {} : realR; o.labelRenderer.render = on ? () => {} : realL; };
  const walk = (x, z, yaw, steps) => { o.fp.x = x; o.fp.z = z; o.fp.yaw = yaw; o.fp.keys = { w: true }; for (let i = 0; i < steps; i++) o.step(0.1); o.fp.keys = {}; return [+o.fp.x.toFixed(2), +o.fp.z.toFixed(2)]; };
  quiet(true);
  const W = Math.PI / 2, E = -Math.PI / 2;
  await step('F key enters first person', async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })); if (!o.fp || !document.body.classList.contains('fp')) throw new Error('not in first person'); return 'on'; });
  await step('Walk drawing room -> modeling room through the new door', async () => {
    const p = walk(D.DRAW.x0 + 2.5, (D.DOOR2.z0 + D.DOOR2.z1) / 2, W, 90);
    if (!(p[0] < D.MODEL.x1 - 2)) throw new Error('did not get through, stopped at ' + p); return p;
  });
  await step('Walls elsewhere stop you', async () => {
    const p = walk(D.DRAW.x0 + 2.5, D.DRAW.z0 + 3, W, 90);
    if (p[0] < D.DRAW.x0 + 0.4) throw new Error('walked through the wall at ' + p); return p;
  });
  await step('Modeling room -> back through the door -> drawing room', async () => {
    const p = walk(D.MODEL.x1 - 2.5, (D.DOOR2.z0 + D.DOOR2.z1) / 2, E, 70);
    if (!(p[0] > D.DRAW.x0 + 2)) throw new Error('stuck at ' + p); return p;
  });
  await step('Drawing room -> media office through the original door', async () => {
    const p = walk(D.DRAW.x1 - 2.5, (D.DOOR.z0 + D.DOOR.z1) / 2, E, 80);
    if (!(p[0] > -D.ROOM_W / 2 + 1)) throw new Error('stuck at ' + p); return p;
  });
  await step('Clicking Cal\'s desk in first person works', async () => {
    if (!o.fp) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })); } o.step(0.1);
    const d = o.drawingDesk.position;
    o.fp.x = d.x; o.fp.z = d.z + 5; o.fp.yaw = 0; o.fp.pitch = -0.28; o.step(0.1); o.camera.updateMatrixWorld(true); o.camera.updateMatrixWorld(true);
    let picked = null; const old = o.onPick; o.onPick = (w) => { picked = w; };
    const r = o.canvas.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    o.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, buttons: 1, bubbles: true }));
    o.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true }));
    o.onPick = old; if (picked !== 'desk') throw new Error('picked ' + picked + ' in room ' + o.room);
    o.exitFirstPerson(true); return picked;
  });
  await step('Closing a room panel with the x does not leave it shrunk', async () => {
    window.__goRoom('desk'); await wait(100); document.querySelector('#deskBack').click(); await wait(100); window.__goRoom('desk'); await wait(100);
    if (document.querySelector('#checkPanel').classList.contains('collapsed')) throw new Error('panel shrunk to the x'); window.__goRoom('drawing'); return 'ok';
  });
  await step('Esc leaves first person and returns the room', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(200);
    if (o.fp || document.body.classList.contains('fp')) throw new Error('still in first person'); return o.room;
  });
  if (window.__variant === 'shot') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })); o.step(0.1);
    o.fp.x = D.MODEL.cx + 2; o.fp.z = (D.DOOR2.z0 + D.DOOR2.z1) / 2 + 3; o.fp.yaw = Math.PI * 0.62; o.fp.pitch = -0.1;
    quiet(false); for (let i = 0; i < 4; i++) { o.step(0.05); await wait(200); }
  }
  report.done = true; return report;
})()
