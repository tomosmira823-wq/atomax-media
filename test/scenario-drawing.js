// Drives the drawing room through the real UI: open Cal's desk, drop a schedule and a drawing, check with a note, read the results.
// Run with AMO_SCENARIO=drawing (see README). Needs test/mock-api.js running and test keys in settings.
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 60000) => { const t0 = Date.now(); let n = 0; while (Date.now() - t0 < ms) { if (fn()) return true; if (n++ % 20 === 0) window.__office?.step(0.5); await wait(100); } throw new Error('timeout waiting'); };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  window.addEventListener('unhandledrejection', e => report.errors.push('unhandled: ' + (e.reason?.message || e.reason)));
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));

  await step('Drawing room: plaque and desk open the panel', async () => {
    window.__goRoom('media'); await wait(50);
    window.__office.step(0.1);
    if (!window.__office.doorPlaque) throw new Error('no door plaque');
    window.__office.onPick('door'); window.__goRoom('drawing');
    await until(() => document.body.classList.contains('room-drawing') && !$('#brief').offsetParent, 2000);
    if ($('#checkPanel').classList.contains('open')) throw new Error('panel should not open until the desk is clicked');
    window.__office.onPick('desk');
    await until(() => $('#checkPanel').classList.contains('open'), 2000);
    return 'room switched, panel opens from the desk';
  });

  await step('Drawing room: drop schedule + drawing, check with a note', async () => {
    const mkPdf = () => { const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] >>']; let out = '%PDF-1.4\n'; const off = []; objs.forEach((o, i) => { off.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; }); const x = out.length; out += 'xref\n0 4\n0000000000 65535 f \n' + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF'; return out; };
    const drop = (id, files) => { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); $(id).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); };
    drop('#dropSched', [new File(['Cable,From,To,Type,Drawing\nC-101,JB-1,PLC/RIO1,2C 1.5 SWA,DRG-001\nC-102,JB-2,PLC/RIO1,Instrument 1PR,DRG-001\n'], 'schedule.csv', { type: 'text/csv' })]);
    drop('#dropDwg', [new File([mkPdf()], 'DRG-001.pdf', { type: 'application/pdf' })]);
    await until(() => $('#schedFile').textContent.includes('schedule.csv') && $('#dwgFiles').textContent.includes('DRG-001.pdf') && !$('#checkGo').disabled, 20000).catch(() => { throw new Error('files did not land: sched=[' + $('#schedFile').textContent + '] dwg=[' + $('#dwgFiles').textContent + '] err=' + $('#checkErr').textContent); });
    document.querySelector('#checkMode [data-mode=note]').click();
    $('#checkNote').value = 'Look hard at C-103';
    $('#checkGo').click();
    const why = () => 'setup hidden=' + $('#checkSetup').hidden + ' run hidden=' + $('#checkRun').hidden + ' msg=' + $('#runMsg').textContent + ' err=' + $('#checkErr').textContent;
    await until(() => !$('#checkRun').hidden || !$('#checkResult').hidden || $('#checkErr').textContent, 20000).catch(() => { throw new Error('check did not start: ' + why()); });
    await until(() => !$('#checkResult').hidden || $('#checkErr').textContent, 60000).catch(() => { throw new Error('no result: ' + why()); });
    if ($('#checkErr').textContent) throw new Error('check failed: ' + $('#checkErr').textContent);
    const t = $('#checkResult').textContent;
    if (!/DRG-001/.test(t) || !/C-105/.test(t)) throw new Error('result missing the C-105 finding: ' + t.slice(0, 300));
    if (!/Mock answer to your note/.test(t)) throw new Error('note answer not shown');
    if (!/Marked-up copies/.test(t)) throw new Error('no markup section: ' + t.slice(-300));
    if (!/Not checked|What Cal covered/.test(t)) throw new Error('coverage missing');
    const cal = [...window.__office.agents.values()].find(a => a.zone === 'drawing');
    if (!cal || cal.state !== 'done') throw new Error('Cal state ' + (cal && cal.state));
    return 'findings, note answer, coverage and markups shown';
  });

  await step('Drawing room: back to the media office', () => { window.__goRoom('media'); if (document.body.classList.contains('room-drawing')) throw new Error('still in drawing room'); return 'ok'; });

  return report;
})();
