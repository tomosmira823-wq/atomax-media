// A small dated list of past work (Cal's checks, Dex's fixes, finished 3D models). Click one to open it again.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const when = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

// el: container; load(): Promise<[{key,at,title,summary}]>; open(key); remove(key) optional
export function mountHistory(el, { heading = 'Previous work', load, open, remove }) {
  async function refresh() {
    let rows = []; try { rows = await load(); } catch { rows = []; }
    if (!rows.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<label>${esc(heading)}</label><ul class="hist">` + rows.map(r => `<li data-k="${esc(r.key)}"><button class="hopen"><b>${esc(when(r.at))}</b><span>${esc(r.title || '')}</span><small>${esc(r.summary || '')}</small></button>${remove ? '<button class="hdel" title="Remove from the list">×</button>' : ''}</li>`).join('') + '</ul>';
    el.querySelectorAll('li').forEach(li => {
      li.querySelector('.hopen').addEventListener('click', () => open(li.dataset.k));
      const d = li.querySelector('.hdel'); if (d) d.addEventListener('click', async (e) => { e.stopPropagation(); await remove(li.dataset.k); refresh(); });
    });
  }
  refresh();
  return { refresh };
}
