// Drives the Business tab through the real UI. Needs AMO_PICK_DIR (a folder of PDFs), AMO_VARIANT = dirty | clean, a Claude key in settings and test/mock-api.js running.
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 60000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(100); } throw new Error('timeout waiting ' + what); };
  const click = (sel) => { const el = typeof sel === 'string' ? $(sel) : sel; if (!el) throw new Error('missing ' + sel); el.click(); };
  const setv = (sel, v) => { const el = $(sel); if (!el) throw new Error('missing ' + sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const tab = (p) => click(`.biztabs button[data-p=${p}]`);
  const variant = window.__variant || 'dirty';
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  await step('Business tab opens with no jobs', async () => {
    click('#top [data-tab=business]'); await until(() => $('#bizModal').classList.contains('open') && $('#bizPane'), 60000, 'modal');
    if (!/No jobs yet/.test($('#bizPane').textContent)) throw new Error($('#bizPane').textContent.slice(0, 200)); return 'ok';
  });
  await step('New job with drawing list', async () => {
    click('#jobNew'); await until(() => $('#jNum'), 60000, 'form');
    setv('#jNum', 'X123456-10'); setv('#jName', 'Test substation'); setv('#jClient', 'National Grid'); setv('#jBudget', '40'); setv('#jDue', new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
    setv('#jDraw', 'X123456-10-20-0042 | Loop diagram | P02\nX123456-10-20-0043 | Cable block | P01\nX123456-10-30-0001 | SLD | C01'); await wait(300);
    if (!/3 drawings recognised/.test($('#jDrawN').textContent)) throw new Error($('#jDrawN').textContent);
    click('#jSave'); try { await until(() => /Test substation/.test($('#bizPane').textContent), 60000, 'card'); } catch (e) { throw new Error(e.message + ' jErr=' + ($('#jErr') && $('#jErr').textContent) + ' pane=' + $('#bizPane').textContent.slice(0, 200)); }
    const t = $('#bizPane').textContent; if (!/3 live drawings/.test(t) || !/Due /.test(t)) throw new Error(t); return t.replace(/\s+/g, ' ').slice(0, 180);
  });
  await step('Duplicate job number is refused', async () => {
    click('#jobNew'); await until(() => $('#jNum'), 60000, 'form'); setv('#jNum', 'x123456-10'); click('#jSave'); await until(() => /already/.test($('#jErr').textContent), 60000, 'error'); click('#jCancel'); return 'ok';
  });
  await step('Log hours shows against budget', async () => {
    tab('hours'); await until(() => $('#hJob'), 60000, 'hours'); const id = [...$('#hJob').options].find(o => o.value).value; setv('#hJob', id); setv('#hHrs', '20'); setv('#hWho', 'Tom'); setv('#hNote', 'loops'); click('#hAdd');
    await until(() => /20 \/ 40/.test($('#bizPane').textContent), 60000, 'first hours row');
    setv('#hJob', id); setv('#hHrs', '14'); setv('#hWho', 'Dave'); click('#hAdd'); await until(() => /34 \/ 40/.test($('#bizPane').textContent), 60000, 'second hours row'); setv('#hHrs', '25'); click('#hAdd'); await until(() => /no more than 24/.test($('#hErr').textContent), 60000, 'over 24 refused'); return 'ok';
  });
  await step('Doc writes a RAMS into Approvals, approve files it', async () => {
    tab('docs'); await until(() => $('#dKind'), 60000, 'docs'); setv('#dKind', 'rams'); setv('#dJob', [...$('#dJob').options].find(o => o.value).value); setv('#dPrep', 'T. Mira'); setv('#dDetails', 'Replace the 11kV protection relay in the main substation on 3 November.');
    click('#dGo'); await until(() => document.querySelector('[data-app]'), 90000, 'approval card');
    const t = $('#bizPane').textContent; if (!/RAMS X123456-10-0001 P01/.test(t)) throw new Error(t.slice(0, 300));
    click('[data-app]'); await until(() => /Filed under the job/.test($('#bizPane').textContent), 60000, 'filed'); tab('docs'); await until(() => /X123456-10-0001/.test($('#bizPane').textContent), 60000, 'doc list'); return 'ok';
  });
  await step('Issue pack check on the folder (' + variant + ')', async () => {
    tab('issue'); await until(() => $('#iJob'), 60000, 'issue'); setv('#iJob', [...$('#iJob').options].find(o => o.value).value); click('#iFolder'); await until(() => /X123456|issue|dirty|clean|tmp/i.test($('#iFolderN').textContent) && !/None chosen/.test($('#iFolderN').textContent), 60000, 'folder');
    click('#iGo'); await until(() => $('#iOut') && $('#iOut').textContent.length > 50, 90000, 'result');
    const t = $('#iOut').textContent.replace(/\s+/g, ' ');
    if (variant === 'dirty') {
      for (const re of [/to fix before this goes out/, /Working or temporary/, /appears 2 times/, /Title block says rev P01 but the file name says rev P00/, /marked SUPERSEDED/, /Colour found/, /What was checked/]) if (!re.test(t)) throw new Error('missing ' + re + ' in ' + t.slice(0, 600));
      if (!$('#qGo').disabled) throw new Error('queue must be blocked while there are fixes'); return t.slice(0, 200);
    }
    if (!/Clean|Nothing blocking/.test(t)) throw new Error(t.slice(0, 600));
    setv('#qTo', 'Client PM'); click('#qGo'); await until(() => document.querySelector('[data-app]'), 60000, 'approval');
    click('[data-app]'); await until(() => /files copied to ISSUE_/.test($('#bizPane').textContent), 60000, 'issued'); return $('#bizPane').textContent.replace(/\s+/g, ' ').slice(0, 160);
  });
  await step('Brief and audit trail', async () => {
    tab('brief'); await until(() => $('#bM'), 60000, 'brief'); click('#bM'); await until(() => /Morning brief/.test($('#bizPane').textContent) && /Needs you|Deadlines|Hours|Active jobs/.test($('#bizPane').textContent), 60000, 'brief card');
    const b = $('#bizPane').textContent; if (!/due in 2 days/.test(b) || !/85%/.test(b)) throw new Error(b.slice(0, 400));
    tab('audit'); await until(() => $('table.aud'), 60000, 'audit'); const a = $('table.aud').textContent; for (const w of ['Job created', 'Hours logged', 'Approved', 'Document made', 'Issue check']) if (!a.includes(w)) throw new Error('audit missing ' + w + ': ' + a.slice(0, 400)); return 'ok';
  });
  console.log('REPORT_DONE');
  return report;
})()
