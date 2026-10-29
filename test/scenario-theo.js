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
  await step('Clicking Theo opens the panel in build mode', async () => {
    window.__goRoom('modeling'); await wait(100); window.__office.step(0.1);
    window.__office.onPick('builder'); await until(() => $('#modPanel').classList.contains('open'), 3000, 'panel');
    if ($('#modelPanel').classList.contains('open')) throw new Error('scan panel also open');
    if (window.__modellerUI._state().mode !== 'build') throw new Error('not in build mode'); if (!/Theo/.test($('#moTitle').textContent)) throw new Error('title ' + $('#moTitle').textContent);
    return $('#moGo').textContent;
  });
  await step('Theo can start with no model', async () => {
    $('#moRequest').value = 'A skid with one pump and a discharge pipe, 3 m x 1.5 m.'; $('#moRequest').dispatchEvent(new Event('input'));
    if ($('#moGo').disabled) throw new Error('go disabled with no model in build mode'); $('#moGo').click();
    await until(() => !$('#moQs').hidden, 150000, 'questions'); if (!/Theo needs/.test($('#moQs').textContent)) throw new Error('not Theo: ' + $('#moQs').textContent.slice(0, 100)); return 'asked';
  });
  await step('Answers go back and Theo builds from scratch', async () => {
    document.querySelectorAll('#moQs input[data-q]').forEach(i => { i.value = 'one'; });
    $('#moAnswer').click(); await until(() => !$('#moResult').hidden, 90000, 'result');
    const t = $('#moResult').textContent;
    for (const n of ['Skid base', 'Pump 1 body', 'Dome', 'Cone', 'Discharge pipe']) if (!t.includes(n)) throw new Error('missing ' + n + ': ' + t.slice(0, 300));
    if (!/Theo/.test(t)) throw new Error('summary not from Theo'); return t.slice(0, 200);
  });
  await step('Vera checks it and passes', async () => {
    $('#moToVera').click(); await until(() => /Passed/.test($('#moResult').textContent), 90000, 'pass'); return 'ok';
  });
  await step('Save copy is named THEO and export works', async () => {
    $('#moSave').click(); await until(() => /Saved: .*THEO.*\.glb/.test($('#moSaved').textContent), 120000, 'saved');
    $('#moScr').click(); await until(() => /Saved: .*\.scr/.test($('#moSaved').textContent), 20000, 'scr saved'); return $('#moSaved').textContent;
  });
  await step('Switch back to Milo mode', async () => {
    window.__modellerUI.setMode('edit'); if (window.__modellerUI._state().mode !== 'edit') throw new Error('mode'); if ($('#moGo').disabled === false) throw new Error('go should be disabled with no model/request'); return $('#moTitle').textContent;
  });
  window.__office.step(0.1); await wait(300);
  return report;
})();
