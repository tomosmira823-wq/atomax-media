// The 365 room and "skills for this run": Lex and Wren seated, the panel, an .xlsx and a .docx made, and a skill unticked for a run really left out.
(async () => {
  const report = { steps: [], errors: [] };
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const step = async (name, fn) => { try { const r = await fn(); report.steps.push({ name, ok: true, info: r }); } catch (e) { report.steps.push({ name, ok: false, err: String(e) }); report.errors.push(name + ': ' + e); } };
  const until = async (fn, ms = 90000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch {} await wait(150); } throw new Error('timeout waiting for ' + what); };
  await wait(1500);
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  const o = window.__office, api = window.office;
  const calls = async () => (await (await fetch('http://127.0.0.1:52900/__calls')).json());
  await step('Lex and Wren sit in the 365 room', async () => {
    await until(() => o.agents.has('excel') && o.agents.has('word'), 60000, 'agents');
    if (o.agents.get('excel').zone !== 'o365') throw new Error('zone ' + o.agents.get('excel').zone);
    const d = o._dims, n = o.nav, cell = o.navCell, idx = (x, z) => Math.floor((z + 11) / cell) * n.cols + Math.floor((x + 13) / cell);
    let free = 0; for (let x = d.O365.x0 + 1; x < d.O365.x1 - 1; x += 0.5) for (let z = d.O365.z0 + 6; z < d.O365.z1 - 1; z += 0.5) if (n.grid[idx(x, z)]) free++;
    if (!free) throw new Error('365 room floor not walkable');
    return 'seated; ' + free + ' walkable cells';
  });
  // a skill for Lex, ticked in the File Room
  await step('A skill ticked for Lex shows ticked in his picker', async () => {
    await api.library.newSkill({ name: 'Cable schedule house style', description: 'Columns and order for Atomax cable schedules', text: 'Column order: Cable No, From, To, Type, Size, Length.' });
    const it = (await api.library.items({ key: 'skills' })).find(i => i.name === 'Cable schedule house style');
    await api.library.save({ key: 'skills', file: it.file, agents: ['excel'] });
    o.onPick('o365:excel');
    await until(() => $('#o365Panel').classList.contains('open') && document.querySelector(`#o3Skills input[data-skill="${it.file}"]`), 60000, 'picker');
    if (!document.querySelector(`#o3Skills input[data-skill="${it.file}"]`).checked) throw new Error('not ticked by default');
    window.__skillFile = it.file;
    return 'ticked by default';
  });
  await step('Lex makes a workbook with the skill', async () => {
    $('#o3Req').value = 'Cable schedule for C-101 and C-102 with a total';
    $('#o3Go').click();
    await until(() => /Saved .*\.xlsx/.test($('#o3Out').textContent), 90000, 'xlsx saved');
    const c = (await calls()).filter(x => x.lex); if (!c.length || !c[c.length - 1].skill) throw new Error('skill not in the prompt');
    return $('#o3Out .headline').textContent + ' · ' + document.querySelectorAll('#o3Out .o3tbl tr').length + ' preview rows';
  });
  await step('Unticked for this run: the skill is left out', async () => {
    document.querySelector(`#o3Skills input[data-skill="${window.__skillFile}"]`).checked = false;
    $('#o3Go').click();
    await until(() => (document.querySelectorAll('#o3Out .headline').length && !$('#o3Run').offsetParent && !$('#o3Go').disabled), 90000, 'second run');
    await wait(500);
    const c = (await calls()).filter(x => x.lex); if (c.length < 2) throw new Error('second run not made');
    if (c[c.length - 1].skill) throw new Error('skill still in the prompt');
    return 'left out when unticked';
  });
  await step('Wren makes an Atomax Word document', async () => {
    document.querySelector('#o3Mode [data-role=word]').click();
    await until(() => /Wren/.test($('#o3Title').textContent), 30000, 'word mode');
    $('#o3Req').value = 'A short note on the Gwrhyd fault level check';
    $('#o3Go').click();
    await until(() => /Saved .*\.docx/.test($('#o3Out').textContent), 90000, 'docx saved');
    return $('#o3Out .headline').textContent + ' · outline: ' + [...document.querySelectorAll('#o3Out .o3outline div')].map(d => d.textContent.trim()).join(' / ');
  });
  return report;
})()
