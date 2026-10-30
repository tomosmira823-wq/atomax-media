// New job from the projects whiteboard: form, folder made from the template, job selected. AMO_SCENARIO=newjob
(async () => {
  const out = { steps: [], errors: [] }; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { out.steps.push({ name, ok: true, info: await fn() }); } catch (e) { out.steps.push({ name, ok: false, err: String(e) }); out.errors.push(name + ': ' + e); } };
  const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch {} await wait(200); } throw new Error('timeout'); };
  await wait(1500); document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  await step('form opens from + New job', async () => { window.__goRoom('board'); await window.__boardUI.show(); document.querySelector('#bdNew').click(); await until(() => document.querySelector('#njNo')); return document.querySelector('#njNo').value; });
  await step('job created with a folder from the template', async () => {
    document.querySelector('#njNo').value = 'X140726'; document.querySelector('#njName').value = 'Eakring Training Centre'; document.querySelector('#njClient').value = 'National Grid';
    document.querySelector('#njParentPick').click(); await wait(800);
    const t0 = Date.now(); document.querySelector('#njSave').click();
    try { await until(() => /X140726 Eakring/.test(document.querySelector('#bdMain').textContent) && !document.querySelector('#njNo'), 60000); out.ms = Date.now() - t0; } catch (e) { const t = document.querySelector('#bdMain').textContent; throw new Error('page: ' + JSON.stringify(t.slice(0, 40)) + ' nj=' + !!document.querySelector('#njNo') + ' re=' + /X140726 Eakring/.test(t)); }
    const v = await window.office.biz.get(); const j = v.jobs.find(x => x.number === 'X140726'); if (!j || !j.folder) throw new Error('no folder ' + JSON.stringify(j)); return j.folder;
  });
  await step('duplicate number refused', async () => { document.querySelector('#bdNew').click(); await until(() => document.querySelector('#njNo')); document.querySelector('#njNo').value = 'X140726'; document.querySelector('input[value="none"]').checked = true; document.querySelector('#njSave').click(); await until(() => /already/.test(document.querySelector('#njMsg').textContent)); return 'ok'; });
  return out;
})();
