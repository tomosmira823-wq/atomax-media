// Eli and Dex end to end: drop an email at reception, Eli proposes tasks, "Yes, start" the SLD for Dex (new job + folder found by job number),
// Dex asks a question, gets the answer, and saves a DRAFT DXF into the job's folder. AMO_SCENARIO=email (settings.projectRoots points at a fake OneDrive).
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 90000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await wait(150); } throw new Error('timeout waiting for ' + what); };
  window.onerror = (m) => report.errors.push('window.onerror: ' + m);
  window.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then(r => { let s = ''; const u = new Uint8Array(r); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); this.result = 'data:' + (b.type || 'application/octet-stream') + ';base64,' + btoa(s); this.onload && this.onload(); }); } };
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const o = window.__office, api = window.office;

  await step('Eli sits at reception', async () => {
    await until(() => o.agents.has('email'), 60000, 'Eli in the office');
    const a = o.agents.get('email'); if (a.zone !== 'reception') throw new Error('zone ' + a.zone);
    return a.data.name + ' · ' + a.data.platform;
  });

  await step('Clicking Eli opens the email panel', async () => {
    o.onPick('email');
    await until(() => $('#mailPanel').classList.contains('open'), 30000, 'mail panel');
    return 'open';
  });

  await step('Drop an .eml: Eli finds the SLD task for Dex and one for Tom', async () => {
    const eml = 'From: Sam Client <sam@client.co.uk>\r\nTo: tom@atomax.co.uk\r\nSubject: Test site SLD\r\nDate: Thu, 29 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHi Tom, job X22001. We need an SLD for the site on test by Friday. 1000kVA transformer, 1600A ACB. What will it cost?\r\nSam\r\n--b1--\r\n';
    const dt = new DataTransfer(); dt.items.add(new File([eml], 'Test site SLD.eml', { type: 'message/rfc822' }));
    $('#mlDrop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await until(() => $('#mlDrop b').textContent.includes('.eml'), 10000, 'file staged');
    $('#mlRead').click();
    await until(() => document.querySelectorAll('#mlMain .mlask').length === 2, 90000, 'two tasks');
    return [...document.querySelectorAll('#mlMain .mlask b')].map(b => b.textContent).join(' | ');
  });

  let jobId = '';
  await step('Yes, start: new job from the email, folder found by job number', async () => {
    document.querySelector('#mlMain [data-yes="0"]').click();
    await until(() => $('#mlStart') && $('#mlFolders') && /X22001 Test site/.test($('#mlFolders').textContent), 90000, 'folder suggestion');
    if ($('#mlJob').value !== '__new') throw new Error('expected a new job, got ' + $('#mlJob').value);
    if ($('#mlNum').value !== 'X22001') throw new Error('job number not prefilled: ' + $('#mlNum').value);
    $('#mlGo').click();
    await until(() => $('#dexPanel').classList.contains('open') && $('#dexPanel').classList.contains('make-mode'), 90000, 'Dex make mode');
    await until(() => $('#dmJob').value, 30000, 'job picked in Dex');
    jobId = $('#dmJob').value;
    const v = await api.biz.get(), job = v.jobs.find(j => j.id === jobId), task = v.tasks.find(t => t.jobId === jobId);
    if (!job || job.number !== 'X22001' || !/X22001 Test site/.test(job.folder)) throw new Error('job/folder wrong: ' + JSON.stringify(job && { n: job.number, f: job.folder }));
    if (!task || task.agentName !== 'Dex' || task.status !== 'doing') throw new Error('board task wrong: ' + JSON.stringify(task));
    return 'job ' + job.number + ' · folder linked · board task for Dex (doing)';
  });

  await step('Dex asks a question, then draws into the job folder', async () => {
    await until(() => document.querySelector('#dmQs .dmq'), 90000, 'Dex question');
    document.querySelector('#dmQs [data-q="0"]').value = '4C 95mm² SWA';
    $('#dmGo').click();
    await until(() => /Saved/.test($('#dmOut').textContent) && $('#dmOut svg'), 90000, 'saved DXF');
    return $('#dmOut .headline').textContent;
  });

  await step('The email is listed as started', async () => {
    const list = await api.mail.list();
    const e = list[0]; if (!e || e.asks[0].status !== 'started') throw new Error('status ' + (e && e.asks[0].status));
    return 'started, ' + e.asks.filter(a => a.status === 'proposed').length + ' still waiting';
  });

  await step('Give to: Tom moves a task Eli gave to nobody onto Dot', async () => {
    window.__goRoom('email');
    await until(() => document.querySelector('#mlMain [data-give="1"]'), 60000, 'Give to on the second task');
    const sel = document.querySelector('#mlMain [data-give="1"]'); sel.value = 'documents'; sel.dispatchEvent(new Event('change'));
    let e; for (let i = 0; i < 100; i++) { await wait(150); e = (await api.mail.list())[0]; if (e.asks[1].agent === 'documents') break; }
    if (e.asks[1].agent !== 'documents') throw new Error('still ' + e.asks[1].agent);
    return 'task 2 now for Dot';
  });

  return { steps: report.steps, errors: report.errors };
})()
