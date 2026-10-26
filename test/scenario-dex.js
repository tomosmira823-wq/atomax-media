// Drives Dex through the real UI using "Cal's last markups": open the drafting table, drop a DXF, find fixes, tick one, apply, read the result.
// Run with AMO_SCENARIO=dex; the runner seeds last-check.json in the user data folder (see README).
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); let n = 0, lastErr = ''; while (Date.now() - t0 < ms) { if (fn()) return true; n++; await wait(100); } throw new Error('timeout waiting ' + lastErr); };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  // Blob reads never complete for synthetic Files in the headless runner, so give the page a FileReader that reads the text we made the File from
  window.FileReader = class { readAsDataURL(f) { setTimeout(() => { this.result = 'data:application/octet-stream;base64,' + btoa(f.__t); this.onload && this.onload(); }, 0); } };
  const mkFile = (t, n, o) => { const f = new File([t], n, o); f.__t = t; return f; };
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
    const dt = new DataTransfer(); dt.items.add(mkFile(dxf(['C-1O1', 'C-102', 'C-1O1']), 'DRG-001.dxf', { type: 'application/dxf' }));
    $('#dropDxf').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    try { await until(() => !$('#dexFind').disabled, 60000); } catch (e) { throw new Error('find disabled (' + e + '); err=' + $('#dexErr').textContent + ' files=' + $('#dxfFiles').textContent + ' dis=' + $('#dexFind').disabled + ' hidden=' + $('#dexSetup').hidden + ' txt=' + $('#dexFind').textContent + ' src=' + document.querySelector('#dexSrc .on').dataset.src + ' note=' + $('#dexNote').value); }
    $('#dexFind').click(); try { await until(() => !$('#dexList').hidden, 60000); } catch (e) { throw new Error('no list. err=' + $('#dexErr').textContent + ' run=' + $('#dexRun').hidden + ' setup=' + $('#dexSetup').hidden); }
    const boxes = document.querySelectorAll('#dexList input[type=checkbox]');
    if (boxes.length !== 1) throw new Error('expected 1 fix, got ' + boxes.length);
    if (boxes[0].checked) throw new Error('fix should start unticked');
    if (!$('#dexApply').disabled) throw new Error('apply should be disabled until ticked');
    if (!/2 places/.test($('#dexList').textContent)) throw new Error('should count 2 places');
    return $('#dexList').textContent.replace(/\s+/g, ' ').slice(0, 220);
  });
  await step('Tick, apply, fixed copy saved', async () => {
    $('#dexAll').click(); if ($('#dexApply').disabled) throw new Error('apply still disabled');
    $('#dexApply').click(); await until(() => !$('#dexResult').hidden, 60000);
    const t = $('#dexResult').textContent; if (!/Fixed 1 of 1/.test(t) || !/DRG-001_FIXED\.dxf/.test(t)) throw new Error(t);
    return t.replace(/\s+/g, ' ').slice(0, 200);
  });
  await step('Markup PDF path reads notes and proposes the same fix', async () => {
    $('#dexAgain').click(); await wait(100);
    document.querySelector('#dexSrc [data-src=pdfs]').click();
    if ($('#dexFind').disabled === false) throw new Error('Find should wait for DXFs and a PDF');
    const drop = (id, f) => { const dt = new DataTransfer(); dt.items.add(f); $(id).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); };
    drop('#dropDxf', mkFile(dxf(['C-1O1']), 'DRG-001.dxf'));
    drop('#dropMk', mkFile('%PDF-1.4\n%%EOF', 'DRG-001_MARKUP.pdf', { type: 'application/pdf' }));
    await until(() => !$('#dexFind').disabled, 60000);
    $('#dexFind').click(); await until(() => !$('#dexList').hidden, 60000);
    if (document.querySelectorAll('#dexList input[type=checkbox]').length !== 1) throw new Error($('#dexList').textContent);
    return 'ok';
  });
  await step('Just tell Dex: edit inside a symbol, delete, add (no markup)', async () => {
    if (!$('#dexList').hidden) $('#dexBackSetup').click();
    if (!$('#dexResult').hidden) $('#dexAgain').click(); await wait(100);
    document.querySelectorAll('#dexPanel button[data-rm]').forEach(b => b.click());
    document.querySelector('#dexSrc [data-src=note]').click();
    if (!$('#dexNote').offsetParent) throw new Error('note box not shown');
    const T = (l, x, y, t) => ['0','TEXT','8',l,'10',String(x),'20',String(y),'30','0.0','40','2.5','1',t];
    const file = ['0','SECTION','2','TABLES','0','TABLE','2','LAYER','70','1','0','LAYER','2','ANNOT','70','0','62','2','6','CONTINUOUS','0','ENDTAB','0','ENDSEC','0','SECTION','2','BLOCKS','0','BLOCK','8','0','2','TX_SYM','70','0','10','0','20','0','30','0', ...T('ANNOT',0,0,'Dyn1l'), '0','ENDBLK','8','0','0','ENDSEC','0','SECTION','2','ENTITIES', ...T('ANNOT',1,1,'SAMPLE ONLY'), ...T('ANNOT',1,5,'TT-201'), '0','INSERT','8','ANNOT','2','TX_SYM','10','5','20','5','30','0','0','INSERT','8','ANNOT','2','TX_SYM','10','50','20','5','30','0','0','ENDSEC','0','EOF',''].join('\n');
    const dt = new DataTransfer(); dt.items.add(mkFile(file, 'SLD-001.dxf')); $('#dropDxf').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await until(() => $('#dxfFiles').textContent.includes('SLD-001'), 60000);
    if (!$('#dexFind').disabled) throw new Error('Find should wait for the instruction');
    $('#dexNote').value = 'Fix the transformer vector group Dyn1l to Dyn11, delete the SAMPLE ONLY line and add REV C'; $('#dexNote').dispatchEvent(new Event('input'));
    await until(() => !$('#dexFind').disabled, 60000);
    $('#dexFind').click(); await until(() => !$('#dexList').hidden, 60000);
    const t = $('#dexList').textContent.replace(/\s+/g, ' ');
    if (!/symbol TX_SYM \(used 2/.test(t) || !/Delete SAMPLE ONLY/.test(t) || !/Add REV C/.test(t)) throw new Error(t);
    if (document.querySelectorAll('#dexList input[data-i]').length !== 3) throw new Error('want 3 items: ' + t);
    $('#dexAll').click(); $('#dexApply').click(); await until(() => !$('#dexResult').hidden, 60000);
    const r = $('#dexResult').textContent.replace(/\s+/g, ' '); if (!/Fixed 3 of 3/.test(r) || !/SLD-001_FIXED\.dxf/.test(r)) throw new Error(r);
    return r.slice(0, 160);
  });
  console.log('REPORT_DONE');
  return report;
})()
