// Dex's skill picker follows the kind of drawing: the SLD skill is not ticked for earthing, and a missing earthing skill can be created. AMO_SCENARIO=dexkind
(async () => {
  const out = { errors: [] }; const wait = (ms) => new Promise(r => setTimeout(r, ms)); const $ = (s) => document.querySelector(s); const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch {} await wait(200); } return false; };
  try {
    await wait(1500); const api = window.office;
    await api.library.newSkill({ name: 'Single line diagram DXF', text: 'SLD rules' });
    const it = (await api.library.items({ key: 'skills' })).find(x => x.name === 'Single line diagram DXF');
    await api.library.save({ key: 'skills', file: it.file, agents: ['dex'], on: true });
    out.kind = api.drawKinds.kindOf('earthing schematic');
    await window.__dexMake.preset({ request: 'Earthing schematic for the site' }); await wait(500);
    const box = (n) => [...document.querySelectorAll('#dmSkills input[data-skill]')].filter(c => c.closest('label').textContent.includes(n))[0];
    out.sldTickedForEarthing = box('Single line') ? box('Single line').checked : 'missing';
    out.offer = !!$('#dmNewSkill');
    $('#dmNewSkill').click(); await wait(100); $('#dmNsSave').click(); await until(() => box('Earthing drawings'));
    out.newTicked = box('Earthing drawings') ? box('Earthing drawings').checked : 'missing';
    out.offerGone = !$('#dmNewSkill'); out.html1 = [...document.querySelectorAll('#dmSkills label.skp-r')].map(l => l.textContent.slice(0, 30) + '=' + l.querySelector('input').checked); out.err = $('#dmErr').textContent; out.items = (await api.library.items({ key: 'skills' })).map(i => i.name + ':' + i.agents + ':' + i.on);
    $('#dmReq').value = 'SLD for the LV board'; $('#dmReq').dispatchEvent(new Event('input')); await until(() => box('Single line').checked);
    out.html2 = [...document.querySelectorAll('#dmSkills label.skp-r')].map(l => l.textContent.slice(0, 30) + '=' + l.querySelector('input').checked); out.sldTickedForSld = box('Single line').checked; out.earthTickedForSld = box('Earthing drawings').checked;
  } catch (e) { out.errors.push(String(e)); }
  return out;
})();
