// A real Outlook .msg through Eli: AMO_SCENARIO=msg AMO_VARIANT=<path to a .msg>. Checks the forwarded text, the attachment and the Dex task.
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 90000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await wait(150); } throw new Error('timeout waiting for ' + what); };
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const api = window.office;
  let e;
  await step('Eli reads the .msg: forwarded request, the PDF, sender', async () => {
    e = await api.mail.read({ paths: window.__variant.split('|') });
    if (e.attachments.filter(a => /\.pdf$/i.test(a.name)).length !== 1) throw new Error('PDF count wrong: ' + JSON.stringify(e.attachments));
    if (e.attachments.some(a => /^image\d+/i.test(a.name) && a.name !== 'image002.png')) throw new Error('logos kept: ' + e.attachments.map(a => a.name));
    return e.attachments.map(a => a.name).join(', ');
  });
  await step('Drawing work in the email goes to Dex', async () => {
    const d = e.asks.find(a => a.agent === 'dex');
    if (!d) throw new Error('no Dex task: ' + e.asks.map(a => a.agent + ':' + a.title).join(' | '));
    return d.title;
  });
  await step('The panel shows the email', async () => {
    window.__goRoom('email');
    await until(() => $('#mailPanel').classList.contains('open') && document.querySelectorAll('#mlMain .mlask').length, 60000, 'panel');
    return document.querySelectorAll('#mlMain .mlask').length + ' tasks shown';
  });
  return report;
})()
