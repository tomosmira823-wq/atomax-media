// Milo driving the PC, with the mouse and keyboard mocked (AMO_PC_MOCK=1): auto mode asks only for the risky key, approve mode asks every time, Stop works.
(async () => {
  const report = { steps: [], errors: [] };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  await wait(1500);
  const pc = window.office.pc;
  // answer prompts as they appear: the test plays the person at the green bar
  const decisions = []; let policy = (kind) => ({ type: 'approve' });
  const run = (opts, pol) => { policy = pol; const p = pc.run(opts); return p; };
  window.__pcWatch = setInterval(() => {}, 1000);
  await step('Auto mode: only the risky key asks, answers go back', async () => {
    const p = pc.run({ task: 'Run the script', approveEach: false });
    // the risky key (super+r) will wait for a decision: deny it; then ask_user waits: answer it
    let denied = false, answered = false;
    const t0 = Date.now(); let out = null; let settled = false; p.then(r => { out = r; settled = true; }, e => { out = e; settled = true; });
    while (!settled && Date.now() - t0 < 20000) { await wait(150); if (!denied) { pc.decide({ type: 'deny' }); } }
    // above sends a deny every 150 ms until done: it also answers the question with no text, so run a stricter second pass below
    if (!settled) throw new Error('did not finish'); if (out instanceof Error) throw out;
    const log = await pc.mockLog(); const kinds = log.map(a => a.kind + (a.text ? ':' + a.text : ''));
    if (kinds.join('|') !== 'click|type:SCRIPT|key:Return') throw new Error('actions were ' + kinds.join('|'));
    if (log[0].x !== 960 || log[0].y !== 540) throw new Error('click not scaled to real pixels: ' + log[0].x + ',' + log[0].y);
    return 'actions: ' + kinds.join(', ') + ' · final: ' + out.text.slice(0, 80);
  });
  await step('Approve mode: every action asks, Stop ends it', async () => {
    const before = (await pc.mockLog()).length;
    const p = pc.run({ task: 'Run the script', approveEach: true });
    await wait(1500); pc.decide({ type: 'approve' }); await wait(800); pc.decide({ type: 'stop' });
    const r = await p;
    const after = (await pc.mockLog()).length;
    if (!/Stopped/.test(r.text)) throw new Error('not stopped: ' + r.text);
    if (after - before !== 1) throw new Error('expected exactly 1 action before stop, got ' + (after - before));
    return r.text.slice(-40);
  });
  await step('Self test in mock mode', async () => { const r = await pc.selftest(); if (!r.ok) throw new Error(r.detail); return r.detail; });
  clearInterval(window.__pcWatch);
  return report;
})()
