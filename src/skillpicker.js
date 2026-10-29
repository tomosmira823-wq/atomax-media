// "Skills for this run": the skills ticked for the agent in the File Room, ticked by default; any other skill can be added for this run.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const row = (i, on) => `<label class="skp-r"><input type="checkbox" data-skill="${esc(i.file)}" ${on ? 'checked' : ''}><span>${esc(i.name)}${i.description ? `<i>${esc(i.description.slice(0, 90))}</i>` : ''}</span></label>`;

export async function renderSkillPicker(api, el, agentId, { uncheck = () => false } = {}) {
  if (!el) return { selected: () => undefined };
  let items = []; try { items = await api.library.items({ key: 'skills' }); } catch {}
  const mine = items.filter(i => i.on && i.agents.includes(agentId)), others = items.filter(i => !mine.includes(i));
  el.innerHTML = `<div class="skp"><div class="skp-h">Skills for this run <span>${mine.length ? 'untick any that do not fit' : 'none ticked for this agent in the File Room'}</span></div>
    ${mine.map(i => row(i, !uncheck(i))).join('')}
    ${others.length ? `<details><summary>Add another skill for this run (${others.length})</summary>${others.map(i => row(i, false)).join('')}</details>` : ''}</div>`;
  return { selected: () => [...el.querySelectorAll('input[data-skill]:checked')].map(c => c.dataset.skill) };
}
