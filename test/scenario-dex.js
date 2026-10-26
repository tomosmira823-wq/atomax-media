// Drives Dex through the real UI using "Cal's last markups": open the drafting table, drop a DXF, find fixes, tick one, apply, read the result.
// Run with AMO_SCENARIO=dex; the runner seeds last-check.json in the user data folder (see README).
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); let n = 0; while (Date.now() - t0 < ms) { if (fn()) return true; if (n++ % 20 === 0) window.__office?.step(0.5); await wait(100); } throw new Error('timeout waiting'); };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const dxf = (tags) => ['0','SECTION','2','ENTITIES', ...tags.flatMap(t => ['0','TEXT','8','0','10','0.0','20','0.0','40','2.0','1',t]), '0','ENDSEC','0','EOF',''].join('\n');
  await step('Table click opens Dex panel', async () => {
    window.__goRoom('drawing'); await wait(50); window.__office.step(0.1);
    window.__office.onPick('drafting'); await until(() => $('#dexPanel').classList.contains('open'), 2000);
    if ($('#checkPanel').classList.contains('open')) throw new Error('Cal panel also open');
    return 'ok';
  });
  await step('Drop DXF, use Cal\'s last markups, find fixes', async () => {
    const dt = new DataTransfer(); dt.items.add(new File([dxf(['C-1O1', 'C-102', 'C-1O1'])], 'DRG-001.dxf', { type: 'application/dxf' }));
    $('#dropDxf').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    try { await until(() => !$('#dexFind').disabled, 12000); } catch (e) { throw new Error('find disabled; err=' + $('#dexErr').textContent + ' files=' + $('#dxfFiles').textContent); }
    $('#dexFind').click(); try { await until(() => !$('#dexList').hidden, 15000); } catch (e) { throw new Error('no list. err=' + $('#dexErr').textContent + ' run=' + $('#dexRun').hidden + ' setup=' + $('#dexSetup').hidden); }
    const boxes = document.querySelectorAll('#dexList input[type=checkbox]');
    if (boxes.length !== 1) throw new Error('expected 1 fix, got ' + boxes.length);
    if (boxes[0].checked) throw new Error('fix should start unticked');
    if (!$('#dexApply').disabled) throw new Error('apply should be disabled until ticked');
    if (!/2 places/.test($('#dexList').textContent)) throw new Error('should count 2 places');
    return $('#dexList').textContent.replace(/\s+/g, ' ').slice(0, 220);
  });
  await step('Tick, apply, fixed copy saved', async () => {
    $('#dexAll').click(); if ($('#dexApply').disabled) throw new Error('apply still disabled');
    $('#dexApply').click(); await until(() => !$('#dexResult').hidden, 15000);
    const t = $('#dexResult').textContent; if (!/Fixed 1 of 1/.test(t) || !/DRG-001_FIXED\.dxf/.test(t)) throw new Error(t);
    return t.replace(/\s+/g, ' ').slice(0, 200);
  });
  await step('Markup PDF path reads notes and proposes the same fix', async () => {
    $('#dexAgain').click(); await wait(100);
    document.querySelector('#dexSrc [data-src=pdfs]').click();
    if ($('#dexFind').disabled === false) throw new Error('Find should wait for DXFs and a PDF');
    const drop = (id, f) => { const dt = new DataTransfer(); dt.items.add(f); $(id).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); };
    drop('#dropDxf', new File([dxf(['C-1O1'])], 'DRG-001.dxf'));
    drop('#dropMk', new File(['%PDF-1.4\n%%EOF'], 'DRG-001_MARKUP.pdf', { type: 'application/pdf' }));
    await until(() => !$('#dexFind').disabled, 12000);
    $('#dexFind').click(); await until(() => !$('#dexList').hidden, 20000);
    if (document.querySelectorAll('#dexList input[type=checkbox]').length !== 1) throw new Error($('#dexList').textContent);
    return 'ok';
  });
  console.log('REPORT_DONE');
  return report;
})()
