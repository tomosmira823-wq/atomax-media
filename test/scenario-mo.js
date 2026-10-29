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
  await step('Modeling room has Milo and Vera seated', async () => {
    window.__goRoom('modeling'); await wait(100); window.__office.step(0.1);
    const ag = [...window.__office.agents.values()].filter(a => a.zone === 'modeling'); if (ag.length !== 2) throw new Error('expected 2 seated agents, got ' + ag.length);
    return ag.map(a => a.data.name).join(', ');
  });
  await step('Clicking Milo opens his panel', async () => {
    window.__office.onPick('modeler'); await until(() => $('#modPanel').classList.contains('open'), 3000, 'panel');
    if ($('#modelPanel').classList.contains('open')) throw new Error('scan panel also open'); return 'ok';
  });
  await step('Context folder loads the model and the notes', async () => {
    $('#moFolder').click(); await until(() => window.__modellerUI._state().models >= 1, 20000, 'model loaded');
    const st = window.__modellerUI._state(); if (st.ctx < 1) throw new Error('no context read'); return st.models + ' model, ' + st.ctx + ' context, ' + st.skipped + ' skipped';
  });
  await step('Milo asks questions first', async () => {
    $('#moRequest').value = 'A new 150 mm pipe needs to run along the back of the rail.'; $('#moRequest').dispatchEvent(new Event('input'));
    if ($('#moGo').disabled) throw new Error('go disabled'); $('#moGo').click();
    await until(() => !$('#moQs').hidden, 60000, 'questions'); const n = document.querySelectorAll('#moQs input[data-q]').length; if (n !== 2) throw new Error('questions ' + n); return n + ' questions';
  });
  await step('Answers go back and Milo edits the model', async () => {
    document.querySelectorAll('#moQs input[data-q]').forEach(i => { i.value = 'answer ' + i.dataset.q; });
    $('#moAnswer').click(); await until(() => !$('#moResult').hidden, 60000, 'result');
    const t = $('#moResult').textContent;
    if (!/Added pipe "New pipe"/.test(t)) throw new Error('no pipe line: ' + t.slice(0, 300));
    if (!/Recoloured "rail"/i.test(t)) throw new Error('no recolour');
    if (!/Could not find "Nothing here"/.test(t)) throw new Error('bad op not reported');
    if (!/Back of the rail/.test(t)) throw new Error('assumptions missing');
    if (!/overlaps/.test(t) && !/No added part overlaps/.test(t)) throw new Error('no clash text');
    return t.slice(0, 220);
  });
  await step('Vera sends it back', async () => {
    $('#moToVera').click(); await until(() => /Sent back/.test($('#moResult').textContent), 60000, 'vera verdict');
    if (!/needs a support/.test($('#moResult').textContent)) throw new Error('finding missing'); if (!$('#moFix')) throw new Error('no send-back button'); return 'ok';
  });
  await step('Sent back to Milo, then Vera passes', async () => {
    $('#moFix').click(); await until(() => /Pipe support/.test($('#moResult').textContent) && !$('#moResult').hidden, 60000, 'fixed result');
    $('#moToVera').click(); await until(() => /Passed/.test($('#moResult').textContent), 60000, 'pass'); return 'ok';
  });
  await step('Before/after toggle and save a copy', async () => {
    document.querySelector('#moView button[data-v=before]').click(); await wait(200); document.querySelector('#moView button[data-v=after]').click(); await wait(200);
    $('#moSave').click(); try { await until(() => /Saved: .*MILO.*\.glb/.test($('#moSaved').textContent), 120000, 'saved'); } catch (e) { throw new Error(String(e) + ' err2=' + ($('#moErr2') && $('#moErr2').textContent)); } return $('#moSaved').textContent;
  });
  await step('Export AutoCAD script and route list', async () => {
    $('#moScr').click(); await until(() => /Saved: .*\.scr/.test($('#moSaved').textContent), 20000, 'scr saved');
    $('#moCsv').click(); await until(() => /Saved: .*\.csv/.test($('#moSaved').textContent), 20000, 'csv saved'); return $('#moSaved').textContent;
  });
  window.__office.step(0.1); await wait(300);
  return report;
})();
