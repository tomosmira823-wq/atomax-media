// Dex's DXF maker: Claude describes a drawing (for now: single line diagrams) as boards, incomers and feeder chains, and this file lays it out
// and writes a real AutoCAD R2010 DXF. Layout is done here, not by Claude, so symbols are always joined, labels never overlap and text is height 2 (MTEXT for labels).
'use strict';
const fs = require('fs');
const path = require('path');

const TH = 2;
// the house lettering (as the Atomax / BGEN drawings): Arial, letters at 0.9 width. The template's Standard style is txt.shx, so it is never used.
const HOUSE_STYLE = 'BGEN ARIAL', HOUSE_WF = 0.9;            // standard text height (Tom's house rule: 2, never smaller)
const LINE = TH * 1.7;   // MTEXT line pitch at height 2
const FEED = 55;         // spacing between feeders on a busbar (house symbols carry an operating handle to the left)
const LABEL_W = 33;      // label width beside a symbol

// ---------- symbols: drawn downwards from a top terminal at (0,0); `len` is where the bottom terminal is (0,-len); `end` = no bottom terminal ----------
const L = (x1, y1, x2, y2, layer = 'SLD-SYMBOL') => ({ t: 'line', x1, y1, x2, y2, layer });
const C = (x, y, r, layer = 'SLD-SYMBOL') => ({ t: 'circle', x, y, r, layer });
const T = (x, y, text, h = TH, layer = 'SLD-TEXT') => ({ t: 'text', x, y, text, h, align: 'center', layer });
const P = (pts, closed = false, layer = 'SLD-SYMBOL', width = 0) => ({ t: 'pline', pts, closed, layer, width });
const SYMBOLS = {
  breaker: () => ({ len: 14, w: 3.5, prims: [L(0, 0, 0, -4), L(-1, -3, 1, -5), L(-1, -5, 1, -3), L(0, -10, -3, -4.6), L(0, -10, 0, -14)] }),
  isolator: () => ({ len: 14, w: 3.5, prims: [L(0, 0, 0, -4), L(-1.2, -4, 1.2, -4), L(0, -10, -3, -4.6), L(0, -10, 0, -14)] }),
  contactor: () => ({ len: 14, w: 3.5, prims: [L(0, 0, 0, -3.2), { t: 'arc', x: 0, y: -4, r: 0.8, a0: 90, a1: 270, layer: 'SLD-SYMBOL' }, L(0, -10, -3, -4.6), L(0, -10, 0, -14)] }),
  fuse: () => ({ len: 14, w: 1.5, prims: [L(0, 0, 0, -3), P([[-1.2, -3], [1.2, -3], [1.2, -11], [-1.2, -11]], true), L(0, -3, 0, -11), L(0, -11, 0, -14)] }),
  switchfuse: () => ({ len: 16, w: 3.5, prims: [L(0, 0, 0, -3), L(-1.2, -3, 1.2, -3), L(0, -9, -3, -3.6), P([[-1.2, -9], [1.2, -9], [1.2, -14], [-1.2, -14]], true), L(0, -9, 0, -16)] }),
  // the Atomax transformer: two overlapping circles, an open delta in the HV winding and a plain star (Y) in the LV winding
  transformer: () => ({ len: 30, w: 7, prims: [L(0, 0, 0, -2), C(0, -9, 7), C(0, -21, 7), P([[0, -6.2], [3.2, -11.4], [-3.2, -11.4]], true), L(0, -21, 0, -25), L(0, -21, -3.4, -18.9), L(0, -21, 3.4, -18.9), L(0, -28, 0, -30)] }),
  ct: () => ({ len: 8, w: 2.5, prims: [L(0, 0, 0, -8), C(0, -4, 1.8)] }),
  meter: () => ({ len: 14, w: 4.5, prims: [L(0, 0, 0, -3), C(0, -7, 4), T(0, -7.9, 'kWh', TH), L(0, -11, 0, -14)] }),
  cable: () => ({ len: 16, w: 1.5, prims: [L(0, 0, 0, -16, 'SLD-CABLE'), L(-1.2, -7, 1.2, -9, 'SLD-CABLE')] }),
  supply: () => ({ len: 8, w: 1.5, top: true, prims: [C(0, -1, 1), L(0, -2, 0, -8)] }),
  generator: () => ({ len: 13, w: 5.5, top: true, prims: [C(0, -5, 5), T(0, -6.2, 'G', 3), L(0, -10, 0, -13)] }),
  ups: () => ({ len: 14, w: 5.5, prims: [L(0, 0, 0, -2), P([[-4, -2], [4, -2], [4, -11], [-4, -11]], true), T(0, -7.4, 'UPS', TH), L(0, -11, 0, -14)] }),
  load: () => ({ len: 9, w: 2, end: true, prims: [L(0, 0, 0, -6), P([[-1.5, -6], [1.5, -6], [0, -9]], true)] }),
  motor: () => ({ len: 13, w: 5.5, end: true, prims: [L(0, 0, 0, -3), C(0, -8, 5), T(0, -9.2, 'M', 3)] }),
  board: () => ({ len: 10, w: 10, end: true, inside: true, prims: [L(0, 0, 0, -2), P([[-9, -2], [9, -2], [9, -10], [-9, -10]], true)] }),
  earth: () => ({ len: 6, w: 3.5, end: true, prims: [L(0, 0, 0, -3), L(-3, -3, 3, -3), L(-2, -4.3, 2, -4.3), L(-1, -5.6, 1, -5.6)] }),
  spare: () => ({ len: 6, w: 1.5, end: true, prims: [L(0, 0, 0, -6)] }),
  // earthing: an earth rod (electrode), a disconnecting / test link, an earth mesh (grid)
  electrode: () => ({ len: 13.5, w: 2, end: true, prims: [L(0, 0, 0, -4), P([[-0.6, -4], [0.6, -4], [0.6, -12], [-0.6, -12]], true), P([[-0.6, -12], [0.6, -12], [0, -13.5]], true)] }),
  link: () => ({ len: 12, w: 2, prims: [L(0, 0, 0, -3), C(0, -3.8, 0.8), C(0, -8.2, 0.8), L(0.8, -3.8, 0.8, -8.2), L(0, -9, 0, -12)] }),
  grid: () => ({ len: 10, w: 5.5, end: true, prims: [L(0, 0, 0, -2), P([[-5, -2], [5, -2], [5, -10], [-5, -10]], true), L(-1.67, -2, -1.67, -10), L(1.67, -2, 1.67, -10), L(-5, -4.67, 5, -4.67), L(-5, -7.33, 5, -7.33)] }),
  line: () => ({ len: 8, w: 1, prims: [L(0, 0, 0, -8)] }),
  // drives and starters: a box in the way between the protective device and the isolator / motor
  vsd: () => ({ len: 16, w: 6, prims: [L(0, 0, 0, -2), P([[-6, -2], [6, -2], [6, -14], [-6, -14]], true), L(-6, -14, 6, -2), P(wave(-4.8, -5.4, 4)), P(wave(0.8, -11.2, 4)), L(0, -14, 0, -16)] }),
  dol: () => ({ len: 16, w: 6, prims: [L(0, 0, 0, -2), P([[-6, -2], [6, -2], [6, -14], [-6, -14]], true), T(0, -9, 'DOL', TH), L(0, -14, 0, -16)] }),
  softstarter: () => ({ len: 16, w: 6, prims: [L(0, 0, 0, -2), P([[-6, -2], [6, -2], [6, -14], [-6, -14]], true), T(0, -9, 'SS', TH), L(0, -14, 0, -16)] }),
  // surge protection: a box with an arrow, earthed underneath
  spd: () => ({ len: 18, w: 4, end: true, prims: [L(0, 0, 0, -2), P([[-3, -2], [3, -2], [3, -11], [-3, -11]], true), L(0, -3.5, 0, -9.5), P([[-1, -7.8], [0, -9.5], [1, -7.8]]), L(0, -11, 0, -14), L(-3, -14, 3, -14), L(-2, -15.3, 2, -15.3), L(-1, -16.6, 1, -16.6)] }),
  // power factor correction: a capacitor bank
  pfc: () => ({ len: 10, w: 4, end: true, prims: [L(0, 0, 0, -4), L(-4, -4, 4, -4), L(-4, -6, 4, -6), L(0, -6, 0, -10)] }),
};
function wave(x, y, w) { const pts = []; for (let i = 0; i <= 8; i++) pts.push([x + w * i / 8, y + 0.8 * Math.sin(i / 8 * 2 * Math.PI)]); return pts; }
const ALIASES = { mcb: 'breaker', mccb: 'breaker', acb: 'breaker', cb: 'breaker', vcb: 'breaker', rcbo: 'breaker', 'circuit breaker': 'breaker', switch: 'isolator', disconnector: 'isolator', 'switch disconnector': 'isolator', 'fuse switch': 'switchfuse', 'fused switch': 'switchfuse', tx: 'transformer', 'current transformer': 'ct', kwh: 'meter', 'distribution board': 'board', db: 'board', panel: 'board', mcc: 'board', dno: 'supply', incomer: 'supply', 'mains supply': 'supply', gen: 'generator', genset: 'generator', 'diesel generator': 'generator', conductor: 'line', rod: 'electrode', 'earth rod': 'electrode', 'earth electrode': 'electrode', 'test link': 'link', 'disconnecting link': 'link', 'earth link': 'link', mesh: 'grid', 'earth mesh': 'grid', 'earth mat': 'grid', 'earth grid': 'grid', equipment: 'board', inverter: 'board', switchgear: 'board', 'earth conductor': 'cable', bond: 'cable', 'variable speed drive': 'vsd', vfd: 'vsd', drive: 'vsd', 'inverter drive': 'vsd', 'dol starter': 'dol', 'direct on line starter': 'dol', starter: 'dol', 'motor starter': 'dol', 'soft starter': 'softstarter', 'soft start': 'softstarter', 'surge protection': 'spd', 'surge protection device': 'spd', 'surge protective device': 'spd', 'surge arrester': 'spd', 'power factor correction': 'pfc', capacitor: 'pfc', 'capacitor bank': 'pfc' };
// Atomax / BGEN house symbols, taken from the SLD symbol template (Template_MCCB.dxf): top terminal at (0,0), drawn downwards, at the template's own scale (text height 2)
const HOUSE = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'cad', 'symbols-sld.json'), 'utf8')); } catch { return {}; } })();
// each house symbol is written as an INSERT of the real block (the block definitions are in the Atomax DXF template); previews draw the same geometry
const house = (name, extra = {}) => () => { const s = HOUSE[name]; const ins = { t: 'insert', name, x: 0, y: 0, layer: 'SLD-SYMBOL', prims: s.prims }; return { len: -s.bbox[1], w: Math.max(2, s.bbox[2]), house: name, ...extra, prims: extra.text ? [ins, T(0, s.bbox[1] / 2 - 1.1, extra.text, 3)] : [ins] }; };
if (HOUSE.MCCB) Object.assign(SYMBOLS, {
  breaker: house('MCCB'), mcb: house('MCB'), isolator: house('ISOLATOR DISCONNECTOR'), switch: house('SWITCH DISCONNECTOR'), switchfuse: house('FUSED SWITCH DISCONNECTOR'),
  fuse: house('FUSE'), contactor: house('CONTACTOR1'), motor: house('MOTOR', { end: true, text: 'M' }), load: house('LOAD', { end: true }),
});
ALIASES.mcb = HOUSE.MCB ? 'mcb' : 'breaker'; ALIASES.switch = HOUSE.MCCB ? 'switch' : 'isolator'; ALIASES['switch disconnector'] = ALIASES.switch; ALIASES.disconnector = ALIASES.switch;
const symbolOf = (name) => { const n = String(name || '').toLowerCase().trim(); return SYMBOLS[n] ? n : ALIASES[n] || (SYMBOLS[n.replace(/s$/, '')] ? n.replace(/s$/, '') : 'line'); };

const moved = (p, dx, dy) => {
  if (p.t === 'line') return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
  if (p.pts) return { ...p, pts: p.pts.map(([x, y]) => [x + dx, y + dy]), ...(p.rings ? { rings: p.rings.map(r => r.map(([x, y]) => [x + dx, y + dy])) } : {}) };
  return { ...p, x: p.x + dx, y: p.y + dy };
};
const lines = (s) => String(s || '').split(/\r?\n|\\n/).map(x => x.trim()).filter(Boolean);
// wrap a label to fit the label width at text height 2 (about 0.9 x height per character)
function wrap(text, width = LABEL_W) {
  const max = Math.max(6, Math.floor(width / (TH * 0.9))), out = [];
  for (const ln of lines(text)) { let cur = ''; for (const w of ln.split(/\s+/)) { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); }
  return out;
}

// draw one chain (incomer or feeder) downward from (x, y); returns the y it ends at and its prims
// National Grid SLD style (from X11395-BGN-ZZ-XX-DR-E-7262): a cable is a tag box on the conductor with its text written up the box,
// switching devices carry their state "(OPEN)" / "(CLOSED)", and items are coloured by status: existing black, new green, for removal red.
const STATUS_COLOUR = { new: 3, modified: 3, remove: 1, removal: 1, removed: 1, 'for removal': 1 };
// the colours only mean something on a phase drawing (PHASE 1, PHASE 2 ...): each phase's sheet shows what is new / removed at THAT phase. Any other SLD is all black.
let PHASED = false;
const isPhased = (spec) => !!(spec.phase || /\bphase\s*\d+/i.test(String(spec.title || '')));
const TAG_CHARS = 16;   // longest line written up a cable tag
function cableTag(label, minH = 0) {
  const ls = wrap(label, TAG_CHARS * TH * 0.9).slice(0, 6), n = Math.max(1, ls.length), bw = n * LINE + 1.2, bh = Math.max(18, minH, Math.max(...ls.map(l => l.length), 6) * TH * 0.92 + 5);
  const prims = [L(0, 0, 0, -3, 'SLD-CABLE'), P([[-bw / 2, -3], [bw / 2, -3], [bw / 2, -3 - bh], [-bw / 2, -3 - bh]], true, 'SLD-CABLE'), L(0, -3 - bh, 0, -6 - bh, 'SLD-CABLE')];
  // the lines sit in the middle of the box across its width (each line's letters run from its baseline up by the text height)
  const first = -((n - 1) * LINE + TH) / 2 + TH;
  ls.forEach((l, i) => prims.push({ t: 'text', x: first + i * LINE, y: -3 - bh / 2, h: TH, text: l, align: 'center', rot: 90, layer: 'SLD-TEXT' }));
  return { len: 6 + bh, w: bw / 2, prims, tagged: true };
}
const UNDER = new Set(['motor', 'load']), UNDER_W = 30;   // motors and loads have their description centred underneath
function drawChain(chain, x, y) {
  const prims = [];
  for (let item of chain || []) {
    if (item.gap) { prims.push(L(x, y, x, y - item.gap, 'SLD-CABLE')); y -= item.gap; continue; }
    const kind = symbolOf(item.symbol), col = !PHASED ? 0 : STATUS_COLOUR[String(item.status || '').toLowerCase().trim()] || 0;
    const sym = kind === 'cable' && item.label ? cableTag(item.label, item._tagH || 0) : SYMBOLS[kind]();
    if (kind === 'meter' && !sym.house) { const k = /ammeter/i.test(item.label || '') ? 'A' : /voltmeter/i.test(item.label || '') ? 'V' : ''; if (k) sym.prims = sym.prims.map(p => p.t === 'text' && p.text === 'kWh' ? { ...p, text: k, h: 3, y: p.y - 0.4 } : p); }
    if (sym.tagged) { const from = prims.length; sym.prims.forEach(p => prims.push(moved(p, x, y))); if (col) for (let i = from; i < prims.length; i++) prims[i] = { ...prims[i], colour: col }; y -= sym.len; continue; }
    const state = /^(open|closed)$/i.test(String(item.state || '').trim()) ? `(${String(item.state).trim().toUpperCase()})` : '';
    if (state) item = { ...item, label: [item.label, state].filter(Boolean).join('\n') };
    const from0 = prims.length;
    const label = wrap(item.label, sym.inside ? 16 : sym.end && UNDER.has(kind) ? UNDER_W : LABEL_W);
    const need = sym.inside ? 0 : label.length * LINE + 2.8;
    if (sym.inside && label.length > 2) {   // a board name over two lines: the box grows to hold it
      const bh = label.length * LINE + 3; sym.prims = [L(0, 0, 0, -2), P([[-9, -2], [9, -2], [9, -2 - bh], [-9, -2 - bh]], true)]; sym.len = 2 + bh;
    }
    sym.prims.forEach(p => prims.push(moved(p, x, y)));
    if (label.length) {
      if (sym.inside) prims.push({ t: 'mtext', x: x, y: y - 2 - (sym.len - 2) / 2, w: 17, h: TH, text: label.join('\n'), attach: 5, layer: 'SLD-TEXT' });
      else if (sym.end && UNDER.has(kind)) prims.push({ t: 'mtext', x, y: y - sym.len - 1, w: UNDER_W, h: TH, text: label.join('\n'), attach: 2, layer: 'SLD-TEXT' });   // a load's description centred under it
      else prims.push({ t: 'mtext', x: x + sym.w + 2, y: y - 1.8, w: LABEL_W, h: TH, text: label.join('\n'), attach: 1, layer: 'SLD-TEXT' });
    }
    if (col) for (let i = from0; i < prims.length; i++) prims[i] = { ...prims[i], colour: col };
    if (item.enclosure) for (let i = from0; i < prims.length; i++) prims[i] = { ...prims[i], _enc: String(item.enclosure).toUpperCase().trim() };   // which room this item is in (boxed by the caller)
    const labelBottom = !label.length || sym.inside ? y : sym.end && UNDER.has(kind) ? y - sym.len - 1 - label.length * LINE : y - 1.8 - label.length * LINE;
    y -= sym.len;
    if (sym.end) return { y: Math.min(y, labelBottom - 0.5), prims, ended: true };
    // the label is taller than the symbol: carry the conductor on so the next symbol's label cannot touch this one
    const extra = Math.max(0, need - sym.len);
    if (extra > 0) { prims.push(L(x, y, x, y - extra, 'SLD-CABLE')); y -= extra; }
  }
  return { y, prims, ended: false };
}
const chainHeight = (chain) => { const r = drawChain(chain, 0, 0); return -r.y; };

// ---------- layout: one connected tree ----------
// A feeder that supplies another board carries it as its last item ({ board: {...} }); that board is drawn underneath, joined by the feeder's conductor.
// Boards with no feeder above them are drawn side by side. Each feeder gets a slot wide enough for its labels and any board under it.
const SUB_GAP_MIN = 6;
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const chainParts = (chain) => { const items = chain || []; const last = items[items.length - 1]; return last && last.board ? { items: items.slice(0, -1), sub: last.board } : { items, sub: null }; };
const feederWidth = (f) => { const { sub } = chainParts(f.chain); return Math.max(FEED, sub ? boardWidth(sub) + 6 : 0); };
function boardWidth(b) { const fs = b.feeders || []; return Math.max(FEED + 20, fs.reduce((n, f) => n + feederWidth(f), 0) + 10); }
// a feeder label that only repeats the name of the item at its end is left off
function feederLabelAdds(f) {
  if (!f.label) return false;
  const { items, sub } = chainParts(f.chain), endLabel = sub ? sub.label : (items[items.length - 1] || {}).label;
  const fl = norm(f.label), el = norm(endLabel);
  if (!el) return true;
  const firstTwo = (x) => x.split(' ').slice(0, 2).join(' ');
  return !(el.includes(fl) || fl.includes(firstTwo(el)) || el.includes(firstTwo(fl)));
}

// ---- the feeders of a board line up row by row: protective device, drive / starter, cable, isolator, cable, load all level across the board ----
const ROLE_OF = (it) => { if (it.board) return null; if (it.gap) return null; const k = symbolOf(it.symbol), sym = SYMBOLS[k](); if (sym.end) return 'end'; if (k === 'cable') return 'cable'; if (['vsd', 'dol', 'softstarter', 'contactor', 'ups'].includes(k)) return 'drive'; if (['ct', 'meter'].includes(k)) return 'meter'; return 'switch'; };
function mergeRoles(a, b) {   // shortest common supersequence of two role lists
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(a[i++]); else out.push(b[j++]); }
  return [...out, ...a.slice(i), ...b.slice(j)];
}
function itemH(it) { if (it.gap) return it.gap; const r = drawChain([it], 0, 0); return -r.y; }
function alignFeeders(feeders) {
  // feeders made of the same kinds of item in the same order (e.g. breaker, drive, cable, isolator, cable, motor) line up row for row
  const sig = (f) => chainParts(f.chain).items.map(ROLE_OF).filter(Boolean).join('>') + (chainParts(f.chain).sub ? '>board' : '') + (f._inRoom ? '>inroom' : '');   // a feeder kept inside the room is not pulled down to its neighbours' level
  const groups = {}; feeders.forEach((f, i) => (groups[sig(f)] = groups[sig(f)] || []).push(i));
  const out = [...feeders];
  for (const idx of Object.values(groups)) if (idx.length > 1) alignGroup(idx.map(i => feeders[i])).forEach((f, k) => { out[idx[k]] = f; });
  return out;
}
function alignGroup(feeders) {
  const parts = feeders.map(f => { const { items, sub } = chainParts(f.chain); return { f, items: items.map(it => ({ ...it })), sub }; });
  if (parts.length < 2) return feeders;
  let master = []; for (const p of parts) master = mergeRoles(master, p.items.map(ROLE_OF).filter(Boolean));
  // which master slot each item takes (in order); gap items ride along with the item after them
  const slotOf = parts.map(p => { let k = 0; return p.items.map(it => { const r = ROLE_OF(it); if (!r) return -1; while (k < master.length && master[k] !== r) k++; return k++; }); });
  const ys = parts.map(() => 0), next = parts.map(() => 0), out = parts.map(() => []);
  for (let s = 0; s < master.length; s++) {
    const who = [];
    parts.forEach((p, pi) => { // gaps before this feeder's next real item are taken now
      while (next[pi] < p.items.length && slotOf[pi][next[pi]] === -1) { const g = p.items[next[pi]++]; out[pi].push(g); ys[pi] += itemH(g); }
      if (next[pi] < p.items.length && slotOf[pi][next[pi]] === s) who.push(pi);
    });
    if (!who.length) continue;
    const top = Math.max(...who.map(pi => ys[pi]));
    if (master[s] === 'cable') { const tagH = Math.max(...who.map(pi => { const it = parts[pi].items[next[pi]]; return it.label ? cableTag(it.label).len - 6 : 0; })); who.forEach(pi => { parts[pi].items[next[pi]]._tagH = tagH; }); }
    const bottom = Math.max(...who.map(pi => top + itemH(parts[pi].items[next[pi]])));
    who.forEach(pi => {
      const it = parts[pi].items[next[pi]++];
      if (top - ys[pi] > 0.01) out[pi].push({ gap: top - ys[pi] });
      out[pi].push(it); ys[pi] = top + itemH(it);
      // a switching device or drive shorter than its row is carried on to the row's bottom, so the next row starts level
      if (master[s] !== 'end' && bottom - ys[pi] > 0.01) { out[pi].push({ gap: bottom - ys[pi] }); ys[pi] = bottom; }
    });
  }
  parts.forEach((p, pi) => { while (next[pi] < p.items.length) out[pi].push(p.items[next[pi]++]); });
  return parts.map((p, pi) => ({ ...p.f, chain: [...out[pi], ...(p.sub ? [{ board: p.sub }] : [])] }));
}
// a feeder with no board under it, drawn at (fx, y): its chain, then its own label underneath when that adds something
function drawSimple(f, fx, y, prims) {
  const { items } = chainParts(f.chain), r = drawChain(items, fx, y); prims.push(...r.prims);
  let yEnd = r.y;
  if (feederLabelAdds(f)) { const tl = wrap(f.label, UNDER_W); prims.push({ t: 'mtext', x: fx, y: yEnd - 2, w: UNDER_W, h: TH, text: tl.join('\n'), attach: 2, layer: 'SLD-TEXT' }); yEnd -= 3 + tl.length * LINE; }
  return { yEnd, ended: r.ended, chainEnd: r.y };
}
// an earthing feeder (only cable / earth / electrode / link items, ending in an earth): drawn off the board's EARTH BAR, a separate bar
// under the busbar, never off the phase busbar (TN-S: separate PE throughout)
const EARTH_SYMS = ['cable', 'earth', 'electrode', 'grid', 'link'];
const isEarthFeeder = (f) => { const { items, sub } = chainParts(f.chain || []); const syms = items.filter(it => !it.gap).map(it => symbolOf(it.symbol)); return !sub && syms.length > 0 && syms.every(x => EARTH_SYMS.includes(x)) && syms.some(x => ['earth', 'electrode', 'grid'].includes(x)); };
const EARTH_BAR = 8;
let SUBLOG = null;   // filled while measuring a switchroom: where each sub-board in the room lands
let ROOMLOG = null;  // and in the final drawing: each in-room board's busbar level and width, for the room outline
function drawBoard(b, x0, y, prims, top, over = null) {
  let minY = y, maxY = y, maxX = x0 + FEED + 20; const ixs = [];
  // feeders, left to right at the feeder pitch. A board fed by a feeder (an MCC, a DB) is drawn underneath, reaching across under the
  // neighbouring feeders and dropped below the deepest of them, so the drawing stays compact (it does not stretch the main board).
  // A feeder that has its own board under it starts past the end of the board before it, so two sub-boards never share the space.
  const fs = alignFeeders(b.feeders || []), fxs = [], subs = [];
  let cx = x0 + 5;
  for (const f of fs) {
    const { sub } = chainParts(f.chain);
    if (sub) { const busy = subs.reduce((m, s) => Math.max(m, s.x1), -Infinity); if (busy > cx) cx = busy + 6; }
    const fx = cx + 10; fxs.push(fx);
    if (sub) { const sx0 = Math.min(cx, fx - 6); subs.push({ i: fxs.length - 1, x0: sx0, x1: sx0 + boardWidth(sub) }); }
    cx += FEED;
  }
  // depths of the simple feeders (drawn into scratch to measure them)
  const fy = (f) => isEarthFeeder(f) ? y - EARTH_BAR : y;
  const ext = fs.map((f, i) => { if (chainParts(f.chain).sub) return null; const tmp = [], d = drawSimple(f, fxs[i], fy(f), tmp), bb = primsBounds(tmp); return { x0: Math.min(bb.x0, fxs[i] - 10), x1: Math.max(bb.x1, fxs[i] + 10), y0: Math.min(bb.y0, d.yEnd) }; });
  // boards fed side by side (an MCC and a DB off the same board) line up: same busbar level, and their outgoing cables start at the
  // same depth below it, so the cable tags across the drawing sit in one row
  const awayOf = (sub) => !!sub.enclosure && String(sub.enclosure).toUpperCase().trim() !== String(b.enclosure || '').toUpperCase().trim();
  const subYOf = (i) => { const f = fs[i], { items, sub } = chainParts(f.chain), inc = (sub.incomers || []).flatMap(c => c.chain || []), r = drawChain([...items, ...inc], fxs[i], y); if (r.ended) return null;
    const S = subs.find(s => s.i === i), under = ext.filter(e => e && e.x1 > S.x0 && e.x0 < S.x1), extra = awayOf(sub) ? wrap(sub.label, 44).length * LINE + TH + 8 : 0;
    return Math.min(r.y - SUB_GAP_MIN - extra, ...under.map(e => e.y0 - 10 - extra)); };
  const subIdx = fs.map((f, i) => chainParts(f.chain).sub ? i : -1).filter(i => i >= 0), ys0 = subIdx.map(subYOf).filter(v => v !== null);
  const lineUp = subIdx.length > 1 && subIdx.some(i => awayOf(chainParts(fs[i].chain).sub));   // only where a board sits in another room (approved layouts unchanged)
  const rowY = lineUp && ys0.length ? Math.min(...ys0) : null;
  const firstCab = (g) => { const { items } = chainParts(g.chain || []), k = items.findIndex(it => !it.gap && symbolOf(it.symbol) === 'cable'); if (k < 0) return -1; if (k === 0) return 0; const r = drawChain(items.slice(0, k).filter(it => !it.gap), 0, 0), bb = primsBounds(r.prims); return Math.max(-r.y, Number.isFinite(bb.y0) ? -bb.y0 : 0); };   // measured as a room measures it, before any room gap (words under a starter count)
  const subCabD = (sub) => Math.max(0, ...(sub.feeders || []).filter(g => !chainParts(g.chain || []).sub).map(firstCab));
  const rowCab = lineUp ? Math.max(0, ...subIdx.map(i => subCabD(chainParts(fs[i].chain).sub))) : 0;
  const padSub = (sub) => { if (!rowCab) return sub; return { ...sub, feeders: (sub.feeders || []).map(g => { if (chainParts(g.chain || []).sub || g._inRoom || (g.chain || []).some(it => it.gap)) return g;   /* a room already sets where its cables leave */ const h = firstCab(g); if (h < 0 || rowCab - h < 0.5) return g; const chain = [...g.chain], { items } = chainParts(chain), k = items.findIndex(it => !it.gap && symbolOf(it.symbol) === 'cable'), at = chain.indexOf(items[k]); chain.splice(at, 0, { gap: rowCab - h }); return { ...g, chain }; }) }; };
  fs.forEach((f, i) => {
    const fx = fxs[i], { items, sub } = chainParts(f.chain);
    if (!sub) { const d = drawSimple(f, fx, fy(f), prims); minY = Math.min(minY, d.yEnd); maxX = Math.max(maxX, ext[i].x1); return; }
    const inc = (sub.incomers || []).flatMap(c => c.chain || []);
    const r = drawChain([...items, ...inc], fx, y); prims.push(...r.prims);
    let yEnd = r.y;
    if (!r.ended) {
      // the conductor carries on down to the board it feeds; that board's name sits beside the conductor
      // the board's name goes above the right-hand end of its own busbar (clear of the feeders over it), not in the feed
      const S = subs.find(s => s.i === i), under = ext.filter(e => e && e.x1 > S.x0 && e.x0 < S.x1);
      const away = awayOf(sub);   // fed from another room: boxed in its own room, with space above for its name and the room's
      const extra = away ? wrap(sub.label, 44).length * LINE + TH + 8 : 0, natural = yEnd - SUB_GAP_MIN - extra, subY = rowY !== null ? rowY : Math.min(natural, ...under.map(e => e.y0 - 10 - extra));
      prims.push(L(fx, yEnd, fx, subY, 'SLD-CABLE'));
      if (SUBLOG && sub._room) SUBLOG.push({ id: sub._room, y: subY });
      const ov = [...under, { x0: fx - 10, x1: fx + 6 + LABEL_W + 4, y0: -1e9 }], d = away ? drawRoomed({ ...padSub(sub), incomers: [] }, S.x0, subY, prims, false, ov, { x: fx, ceil: Math.min(yEnd, ...under.map(e => e.y0)) - 1.5, minD: rowCab }) : drawBoard({ ...padSub(sub), incomers: [] }, S.x0, subY, prims, false, ov);   // its own feed (and that feed's labels) too
      if (ROOMLOG && sub._room) ROOMLOG.push({ id: sub._room, y: subY, x0: Math.min(S.x0, fx - 10), x1: Math.max(d.maxX, S.x1, fx + 6 + LABEL_W + 4) });
      yEnd = d.minY; maxX = Math.max(maxX, d.maxX, S.x1);
    }
    minY = Math.min(minY, yEnd);
  });
  // incomers (top-level boards only) land on the bus clear of every feeder
  (b.incomers || []).forEach((c, i) => {
    let ix = (fxs.length ? (fxs[0] + fxs[fxs.length - 1]) / 2 : x0 + 20) + i * FEED; while (fxs.some(fx => Math.abs(fx - ix) < 8)) ix += 8; ixs.push(ix);
    const h = chainHeight(c.chain);
    if (c.label) { const tl = wrap(c.label, 40); prims.push({ t: 'mtext', x: ix - 20, y: y + h + 3 + tl.length * LINE, w: 40, h: TH, text: tl.join('\n'), attach: 1, layer: 'SLD-TEXT' }); maxY = Math.max(maxY, y + h + 3 + tl.length * LINE); }
    const r = drawChain(c.chain, ix, y + h); prims.push(...r.prims); maxY = Math.max(maxY, y + h);
    // the items of an incomer that sit in another room (RMU and transformer in the HV compound, the generator in its enclosure): a dashed box
    // round each room's run, named above it, so every room on the drawing is shown the same way
    const own = String(b.enclosure || '').toUpperCase().trim(), rooms = [...new Set(r.prims.map(p => p._enc).filter(e => e && e !== own))];
    for (const e of rooms) { const bb = primsBounds(r.prims.filter(p => p._enc === e)); if (!Number.isFinite(bb.x0)) continue;
      const m = 5, x0 = bb.x0 - m, x1 = Math.max(bb.x1 + m, x0 + 30), y0 = bb.y0 - m, y1 = bb.y1 + m;
      dashBox(prims, x0, y0, x1, y1, 'SLD-ENCLOSURE'); prims.push({ t: 'text', x: x0, y: y1 + 1.5, h: TH, text: e, layer: 'SLD-TEXT' }); maxY = Math.max(maxY, y1 + 1.5 + TH); }
  });
  // the busbar spans its own feeders and incomers only
  const xs = [...fxs, ...ixs], busL = xs.length ? Math.min(...xs) - 8 : x0, busR = Math.max(xs.length ? Math.max(...xs) + 14 : x0 + 30, busL + 30);
  prims.push(P([[busL, y], [busR, y]], false, 'SLD-BUS', 0.8));
  { const ex = fs.map((f, i) => isEarthFeeder(f) ? fxs[i] : null).filter(v => v !== null);
    if (ex.length) { const e0 = Math.min(...ex) - 6, e1 = Math.max(...ex) + 6, tag = String(b.label || '').split(/\n|\\n/)[0].trim();
      prims.push(P([[e0, y - EARTH_BAR], [e1, y - EARTH_BAR]], false, 'SLD-EARTH', 0.5));
      prims.push({ t: 'text', x: e0, y: y - EARTH_BAR + 1.6, h: TH, text: `${tag ? tag + ' ' : ''}EARTH BAR`.toUpperCase(), layer: 'SLD-TEXT' }); } }
  // a board fed from a feeder: its name above the right-hand end of its busbar, kept clear of the feeders drawn over it
  if (!top && over && b.label) {
    const bl = wrap(b.label, 44), clearX = Math.max(busL + 10, ...over.map(e => e.x1 + 3)), w = Math.min(44, Math.max(30, busR - clearX)), bw = wrap(b.label, w), h = bw.length * LINE;   // height from the lines as they will be drawn at that width
    const room = over.every(e => e.x1 + 2 < busR - w || e.y0 > y + h + 2 + 2);
    if (room) prims.push({ t: 'mtext', x: busR, y: y + 1.5 + h, w, h: TH, text: bw.join('\n'), attach: 3, layer: 'SLD-TEXT' });
    else prims.push({ t: 'mtext', x: busR + 3, y: y + h / 2, w: 44, h: TH, text: bl.join('\n'), attach: 4, layer: 'SLD-TEXT' });   // no room above: past the right end
    maxY = Math.max(maxY, y + 2 + h);
  }
  // a top-level board's name: above the bus at the left when there is room, otherwise past its right end
  if (top && b.label) {
    const room = (busR - busL) / 2 - 14, bl = wrap(b.label, room >= 30 ? Math.min(44, room) : 44);
    if (room >= 30) prims.push({ t: 'mtext', x: busL + 1, y: y + 1.5 + bl.length * LINE, w: Math.min(44, room), h: TH, text: bl.join('\n'), attach: 1, layer: 'SLD-TEXT' });
    else prims.push({ t: 'mtext', x: busL - 3, y, w: 44, h: TH, text: bl.join('\n'), attach: 6, layer: 'SLD-TEXT' });   // left of the busbar, clear of the feeder labels on the right
    maxY = Math.max(maxY, y + 2 + bl.length * LINE);
  }
  return { minY, maxY, maxX, w: maxX - x0 };
}

const SHEETS = [['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
// the outline of a union of rectangles, as straight segments (used for room / area boxes that step round what they hold)
function unionSegs(rs) {
  const xs = [...new Set(rs.flatMap(r => [r.x0, r.x1]))].sort((a, b) => a - b), ys = [...new Set(rs.flatMap(r => [r.y0, r.y1]))].sort((a, b) => a - b);
  const inside = (i, j) => i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 && rs.some(r => (xs[i] + xs[i + 1]) / 2 > r.x0 && (xs[i] + xs[i + 1]) / 2 < r.x1 && (ys[j] + ys[j + 1]) / 2 > r.y0 && (ys[j] + ys[j + 1]) / 2 < r.y1);
  const out = [];
  for (let j = 0; j < ys.length; j++) { let run = null; for (let i = 0; i < xs.length - 1; i++) { const e = inside(i, j) !== inside(i, j - 1); if (e && run) run.x1 = xs[i + 1]; else if (e) run = { x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j] }; if (!e && run) { out.push(run); run = null; } } if (run) out.push(run); }
  for (let i = 0; i < xs.length; i++) { let run = null; for (let j = 0; j < ys.length - 1; j++) { const e = inside(i, j) !== inside(i - 1, j); if (e && run) run.y1 = ys[j + 1]; else if (e) run = { x0: xs[i], y0: ys[j], x1: xs[i], y1: ys[j + 1] }; if (!e && run) { out.push(run); run = null; } } if (run) out.push(run); }
  return out;
}
function dashPath(prims, pts, layer, open = false) {   // a dashed outline through the points (closed unless open)
  for (let i = 0; i < pts.length - (open ? 1 : 0); i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], len = Math.hypot(bx - ax, by - ay); if (len < 1e-6) continue; const ux = (bx - ax) / len, uy = (by - ay) / len; for (let d = 0; d < len; d += 9) { const e = Math.min(len, d + 6); prims.push(L(ax + ux * d, ay + uy * d, ax + ux * e, ay + uy * e, layer)); } }
}
function dashBox(prims, x0, y0, x1, y1, layer) {
  const seg = (ax, ay, bx, by) => { const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len; for (let d = 0; d < len; d += 9) { const e = Math.min(len, d + 6); prims.push(L(ax + ux * d, ay + uy * d, ax + ux * e, ay + uy * e, layer)); } };
  seg(x0, y1, x1, y1); seg(x1, y1, x1, y0); seg(x1, y0, x0, y0); seg(x0, y0, x0, y1);
}
// a board in its room (switchroom, kiosk, hall): drawn with its dashed room box round it, every cable leaving at one level.
// Used for the top-level boards and for any board fed from another room (PSB-01 fed from MSB-EX in the main switchroom).
function drawRoomed(b, x0, y, prims, top, over = null, feed = null) {   // feed: { x, ceil } of the cable coming in from the other room
  const keepS = SUBLOG, keepR = ROOMLOG; SUBLOG = null; ROOMLOG = null;
  try {
    // in a switchroom / kiosk: every cable leaves the room at the same level, a little below the deepest item inside, so the dashed wall
    // only ever crosses bare conductor (never a cable tag, a label or a symbol). Feeders with no cable stay wholly inside.
    let wall = null, wallTop = null, roomSubs = false, roomWalls = null, ownWall = null;
    if (b.enclosure) {
      const firstCable = (items) => items.findIndex(it => !it.gap && symbolOf(it.symbol) === 'cable');
      const depthOf = (items) => { if (!items.length) return 0; const r = drawChain(items, 0, 0), bb = primsBounds(r.prims); return Math.max(-r.y, Number.isFinite(bb.y0) ? -bb.y0 : 0); };
      // a feeder with no cable stays wholly inside: its depth includes the words under it (and the earth bar drop)
      const fDepth = (f) => { const { items } = chainParts(f.chain), k = firstCable(items), off = isEarthFeeder(f) ? EARTH_BAR : 0; if (k >= 0) return off + depthOf(items.slice(0, k)); const tmp = [], d = drawSimple(f, 0, -off, tmp), bb = primsBounds(tmp); return Math.max(-d.yEnd, Number.isFinite(bb.y0) ? -bb.y0 : 0); };
      const gapIn = (f, Dw) => { const chain = [...(f.chain || [])], { items } = chainParts(chain), k = firstCable(items); if (k < 0) return f; const off = isEarthFeeder(f) ? EARTH_BAR : 0, h = off + (k ? chainHeight(items.slice(0, k)) : 0); chain.splice(k, 0, { gap: Dw + 5 - h }); return { ...f, chain }; };
      const room = String(b.enclosure).toUpperCase().trim(), inRoom = (sb) => sb && String(sb.enclosure || '').toUpperCase().trim() === room;
      // a feeder of this board ending at something in the same room (PFC, earth bar, a load in the room) stays wholly inside
      const tagOf0 = (t) => String(t || '').split(/\n|\\n|\s/)[0].trim().toUpperCase();
      const ownIn = (g) => { const { items, sub } = chainParts(g.chain || []); if (sub) return false; const last = items.filter(it => !it.gap).slice(-1)[0]; return !!last && inRoom(last); };
      const fullD0 = (g) => { const tmp = [], dd = drawSimple(g, 0, isEarthFeeder(g) ? -EARTH_BAR : 0, tmp), bb = primsBounds(tmp); return Math.max(-dd.yEnd, Number.isFinite(bb.y0) ? -bb.y0 : 0); };
      const D = Math.max(8, feed && feed.minD || 0, ...(b.feeders || []).map(g => ownIn(g) ? fullD0(g) : fDepth(g)));   // minD: line its cables up with the boards beside it
      wall = -D - 3; ownWall = wall;
      roomSubs = (b.feeders || []).some(f => inRoom(chainParts(f.chain).sub));
      if (roomSubs) {
        // boards in the same room (MCC, DBs): measured once to find where each lands, then every one of their cables leaves at one level
        // a feeder ending at something in the same room (e.g. DB-03 to the MCC-01 PLC section) stays wholly inside: the wall goes under it
        const tagOf = (t) => String(t || '').split(/\n|\\n|\s/)[0].trim().toUpperCase();
        const roomTags = new Set([tagOf(b.label), ...(b.feeders || []).map(f => chainParts(f.chain).sub).filter(inRoom).map(sb => tagOf(sb.label))].filter(Boolean));
        const endsInRoom = (g) => { const { items } = chainParts(g.chain || []), last = items.filter(it => !it.gap).slice(-1)[0]; return !!last && (inRoom(last) || roomTags.has(tagOf(last.label))); };
        const fullDepth = (g) => { const tmp = [], d = drawSimple(g, 0, isEarthFeeder(g) ? -EARTH_BAR : 0, tmp), bb = primsBounds(tmp); return Math.max(-d.yEnd, Number.isFinite(bb.y0) ? -bb.y0 : 0); };
        const subD = (sb) => Math.max(8, ...(sb.feeders || []).map(g => endsInRoom(g) ? fullDepth(g) : fDepth(g)));
        let n = 0; const tagged = { ...b, feeders: (b.feeders || []).map(f => { const chain = (f.chain || []).map(it => it.board && inRoom(it.board) ? { ...it, board: { ...it.board, _room: 'r' + (n++) } } : it); return { ...f, chain }; }) };
        SUBLOG = []; drawBoard(tagged, 0, 0, [], top); const at = new Map(SUBLOG.map(e => [e.id, e.y])); SUBLOG = null;
        const subsT = tagged.feeders.map(f => chainParts(f.chain).sub).filter(sb => sb && sb._room);
        roomWalls = new Map(subsT.map(sb => [sb._room, subD(sb)]));
        wall = Math.min(...subsT.map(sb => at.get(sb._room) - subD(sb) - 3));
        // this board's own feeders that leave the room (not to a board in it): their cables cross its wall like any other room's
        if (!top) { tagged.feeders = tagged.feeders.map(f => { const sb = chainParts(f.chain).sub; if (sb && sb._room) return f; return ownIn(f) ? { ...f, _inRoom: true } : gapIn(f, D); }); wall = Math.min(wall, -D - 3); }
        b = { ...tagged, feeders: tagged.feeders.map(f => ({ ...f, chain: (f.chain || []).map(it => it.board && it.board._room ? { ...it, board: { ...it.board, feeders: (it.board.feeders || []).map(g => endsInRoom(g) ? { ...g, _inRoom: true } : gapIn(g, subD(it.board))) } } : it) })) };
      }
      // incomers from another place (a transformer in its compound, a generator in its enclosure): their cable crosses the top wall
      // the same way, so what feeds the board in sits outside the room
      const lastCable = (items) => { let k = -1; items.forEach((it, i) => { if (!it.gap && symbolOf(it.symbol) === 'cable') k = i; }); return k; };
      const ins0 = (b.incomers || []).map(c => { const items = c.chain || [], k = lastCable(items); return k < 0 ? null : { k, h: chainHeight(items.slice(k + 1)) }; });
      if (ins0.some(Boolean)) {
        const U = Math.max(8, ...ins0.filter(Boolean).map(x => x.h)); wallTop = U + 3;
        b = { ...b, incomers: (b.incomers || []).map((c, i) => { const x = ins0[i]; if (!x) return c; const chain = [...c.chain]; chain.splice(x.k + 1, 0, { gap: U + 5 - x.h }); return { ...c, chain }; }) };
      }
      if (!roomSubs) b = { ...b, feeders: (b.feeders || []).map(f => ownIn(f) ? { ...f, _inRoom: true } : gapIn(f, D)) };
    }
    if (roomSubs) ROOMLOG = [];
    const from = prims.length, d = drawBoard(b, x0, y, prims, top, over);
    const placedRooms = ROOMLOG || []; ROOMLOG = null;
    if (wall !== null) {   // a dashed box round the board and its incomers, named above it
      const inside = (p) => { const q = primsBounds([p]); return q.y0 >= y + wall - 0.5 && (wallTop === null || q.y1 <= y + wallTop + 0.5); };
      const bb = primsBounds(prims.slice(from).filter(inside)), m = 6, ex0 = bb.x0 - m, ex1 = bb.x1 + m, ey0 = y + wall, ey1 = feed ? Math.min(bb.y1 + m, feed.ceil - TH - 3) : wallTop === null ? bb.y1 + m : y + wallTop;
      if (roomSubs && placedRooms.length) {
        // the room steps down round each board in it: the top part down to the shallowest board's cable level, then each board's own part
        const walls = placedRooms.map(e => ({ ...e, w: e.y - roomWalls.get(e.id) - 3 })), topW = Math.max(top ? -Infinity : y + ownWall, ...walls.map(e => e.w));
        const rs = [{ x0: ex0, y0: topW, x1: ex1, y1: ey1 }, ...walls.filter(e => e.w < topW - 1e-6).map(e => ({ x0: e.x0 - m, y0: e.w, x1: e.x1 + m, y1: topW + 1 }))];
        for (const g of unionSegs(rs)) dashPath(prims, [[g.x0, g.y0], [g.x1, g.y1]], 'SLD-ENCLOSURE', true);
      } else dashBox(prims, ex0, ey0, ex1, ey1, 'SLD-ENCLOSURE');
      // the name: centred above the box, or (incomer cables crossing the top) at its top left, inside, clear of them
      if (feed) prims.push({ t: 'text', x: feed.x + 8, y: ey1 + 1.5, h: TH, text: String(b.enclosure).toUpperCase(), layer: 'SLD-TEXT' });   // a board fed from another room: its room named just above the box, beside the cable coming in
      else prims.push(wallTop === null ? { t: 'text', x: (ex0 + ex1) / 2, y: ey1 + 2, h: TH, text: String(b.enclosure).toUpperCase(), align: 'center', layer: 'SLD-TEXT' } : { t: 'text', x: ex0 + 3, y: ey1 - 3 - TH, h: TH, text: String(b.enclosure).toUpperCase(), layer: 'SLD-TEXT' });
      d.maxY = Math.max(d.maxY, ey1 + 2 + TH); d.maxX = Math.max(d.maxX, ex1); d.minY = Math.min(d.minY, ey0); d.x0 = ex0;
    }
    return d;
  } finally { SUBLOG = keepS; ROOMLOG = keepR; }
}

function layoutSld(spec, opts = {}) {
  PHASED = isPhased(spec);
  if (PHASED && spec.phase && !/\bphase\b/i.test(spec.title || '')) spec.title = `${spec.title || ''} - PHASE ${String(spec.phase).replace(/^phase\s*/i, '')}`.trim();
  const prims = [], boards = spec.boards || spec.busbars || [];
  if (!boards.length) throw new Error('The drawing has no boards');
  // two sources written as one incomer (transformer ... then a generator ... down to the bus): split at each source into its own incomer
  { const SRC = new Set(['supply', 'generator']);
    const splitInc = (b) => { if (!b) return; const out = [];
      for (const c of b.incomers || []) { const items = c.chain || []; const starts = items.map((it, i) => !it.gap && !it.board && SRC.has(symbolOf(it.symbol)) ? i : -1).filter(i => i > 0);
        if (!starts.length) { out.push(c); continue; }
        let from = 0; for (const i of [...starts, items.length]) { if (i > from) out.push({ ...c, label: from === 0 ? c.label : '', chain: items.slice(from, i) }); from = i; } }
      b.incomers = out; for (const f of b.feeders || []) for (const it of f.chain || []) if (it.board) splitInc(it.board); };
    boards.forEach(splitInc); }
  // an SLD is the power circuits: control and instrument cables (local stations, transmitters, e-stops, pair cables) hung off a
  // busbar with no protective device are taken off (they are on the BCD), with the note saying so
  { const PROT = new Set(['breaker', 'isolator', 'switchfuse', 'fuse', 'contactor', 'link', 'ups', 'vsd', 'dol', 'softstarter']), dropped = [];
    const ctl = (f) => { const its = (f.chain || []).filter(it => !it.gap); if (its.some(it => it.board || PROT.has(symbolOf(it.symbol)))) return false; const end = its[its.length - 1] || {}; if (['earth', 'electrode', 'spare', 'spd', 'pfc'].includes(symbolOf(end.symbol))) return false;
      const txt = its.map(it => String(it.label || '')).join(' ').toUpperCase(); return /\b\d+\s?PR\b|\bINST\b|LOCAL CONTROL|\bLCS-|TRANSMITTER|E-?STOP|EMERGENCY STOP|4-20\s?MA|\bPUSH ?BUTTON/.test(txt); };
    const strip = (b) => { if (!b) return; b.feeders = (b.feeders || []).filter(f => { if (ctl(f)) { dropped.push(String(((f.chain || []).find(it => symbolOf(it.symbol) === 'cable') || {}).label || '').split(/\n|\\n/)[0]); return false; } return true; }); for (const f of b.feeders) for (const it of f.chain || []) if (it.board) strip(it.board); };
    boards.forEach(strip);
    if (dropped.length) { (spec._warnings = spec._warnings || []).push('Control / instrument cables taken off the SLD (on the BCD): ' + dropped.join(', '));
      if (!(spec.notes || []).some(n => /CONTROL|INSTRUMENT/i.test(n) && /BLOCK CABLE|BCD/i.test(n))) (spec.notes = spec.notes || []).push('CONTROL AND INSTRUMENTATION CABLES ARE SHOWN ON THE BLOCK CABLE DIAGRAM.'); } }
  const kinds = new Set(), walk = (b) => { for (const c of [...(b.incomers || []), ...(b.feeders || [])]) for (const it of c.chain || []) { if (it.board) walk(it.board); else if (!it.gap) kinds.add(symbolOf(it.symbol)); } };
  boards.forEach(walk); spec._kinds = [...kinds];
  let x0 = 0, minY = 0, maxY = 0, maxX = 0;
  for (const b of boards) {
    const d = drawRoomed(b, x0, 0, prims, true);
    if (d.x0 !== undefined) x0 = Math.min(x0, d.x0);
    minY = Math.min(minY, d.minY); maxY = Math.max(maxY, d.maxY); maxX = Math.max(maxX, d.maxX); x0 = d.maxX + 25;
  }
  const f = frame(prims, spec, minY, maxY, maxX, '', { fill: opts.fill, borderKey: opts.border });
  return { prims: f.prims || prims, bounds: f.bounds, sheet: f.sheet, page: f.page, border: f.border };
}


// ---------- BCD (block cable diagram): panels / RIOs on the left, junction boxes in the middle, field devices on the right.
// Every cable is a line between two blocks carrying a yellow cable box (number, type, cores x size). One A3 sheet per file; long BCDs run onto more sheets.
const BCD_PITCH = 22, BCD_X = { panel: 0, jb: 150, device: 280 }, BCD_W = { panel: 50, jb: 40, device: 60 };
function bcdModel(spec) {
  const nodes = new Map();
  const typeOf = (t) => /panel|rio|mcc|plc|cabinet|\bio\b|marshall/i.test(t || '') ? 'panel' : /jb|junction/i.test(t || '') ? 'jb' : 'device';
  const yes = (v) => v === true || /^(true|yes|others|by others)$/i.test(String(v || '').trim());
  for (const n of (spec.nodes || [])) if (n && n.tag) nodes.set(String(n.tag), { tag: String(n.tag), label: String(n.label || ''), status: n.status || '', type: n.type ? typeOf(n.type) : typeOf(n.tag), location: String(n.location || '').trim(), byOthers: yes(n.byOthers) || yes(n.scope) });
  const cables = (spec.cables || []).filter(c => c && c.from && c.to).map(c => ({ ...c, from: String(c.from), to: String(c.to), byOthers: yes(c.byOthers) || yes(c.scope) }));
  for (const c of cables) for (const t of [c.from, c.to]) if (!nodes.has(t)) nodes.set(t, { tag: t, label: '', type: typeOf(t) });
  return { nodes, cables };
}
// groups: one per JB (its devices), plus devices wired straight to a panel; each group belongs to one panel
function bcdGroups({ nodes, cables }) {
  const rank = { panel: 0, jb: 1, device: 2 }, groups = [], seen = new Set();
  const ends = (c) => { const a = nodes.get(c.from), b = nodes.get(c.to); return rank[a.type] <= rank[b.type] ? [a, b] : [b, a]; };
  const panelOf = (tag) => { const c = cables.find(c => (c.from === tag || c.to === tag) && ends(c)[0].type === 'panel' && ends(c)[1].tag === tag); return c ? ends(c)[0].tag : ''; };
  for (const n of nodes.values()) if (n.type === 'jb') {
    const up = cables.filter(c => ends(c)[1].tag === n.tag && ends(c)[0].type === 'panel');
    const down = cables.filter(c => ends(c)[0].tag === n.tag);
    groups.push({ panel: up[0] ? ends(up[0])[0].tag : '', jb: n, up, down: down.map(c => ({ c, dev: ends(c)[1] })) });
    up.forEach(c => seen.add(c)); down.forEach(c => seen.add(c));
  }
  for (const c of cables) if (!seen.has(c)) { const [a, b] = ends(c); if (a.type === 'panel' && b.type === 'panel') continue; groups.push({ panel: a.type === 'panel' ? a.tag : panelOf(a.tag), jb: null, up: [], down: [{ c, dev: b }], direct: a.type === 'panel' }); seen.add(c); }
  const links = cables.filter(c => !seen.has(c));   // panel to panel
  return { groups, links };
}
const cableText = (c) => [c.no || 'TBC', [c.cores && c.size ? `${c.cores}x${c.size}` : (c.cores || c.size || ''), c.type || ''].filter(Boolean).join(' ')].filter(Boolean).join('\n');
const BOX_W = 40;
// a horizontal cable run from xa to xb at y with its cable box at xc: the line stops at the box edges so it never runs through the text
// National Grid LVAC style (from TEMPLATE - BCD - National Grid.dxf): equipment as filled blocks (green energised / existing, red de-energised / new),
// cables as coloured lines (blue current supply, red new by BGEN, dashed green existing by others) with the cable text above the line, and a legend
let BSTYLE = { ng: false };
const NG = { energised: 3, existing: 3, 'de-energised': 1, deenergised: 1, new: 1 };
const ngCableColour = (c) => /new/i.test(c.status || '') ? 1 : /exist|others/i.test(c.status || '') ? 82 : 5;
function dashed(prims, x1, y, x2, colour) { const len = Math.abs(x2 - x1), dir = Math.sign(x2 - x1) || 1; for (let d = 0; d < len; d += 4.5) prims.push({ ...L(x1 + dir * d, y, x1 + dir * Math.min(len, d + 3), y, 'BCD-CABLE'), colour }); }
function hRun(prims, xa, xb, y, xc, c, boxes, pre = []) {
  if (BSTYLE.ng) {
    const col = ngCableColour(c);
    if (pre.length) prims.push({ ...P([...pre, [xa, y]], false, 'BCD-CABLE'), colour: col });
    if (col === 82) dashed(prims, xa, y, xb, col); else prims.push({ ...L(xa, y, xb, y, 'BCD-CABLE'), colour: col });
    const t = cableText(c).replace(/\n/g, ' '); prims.push({ t: 'mtext', x: xc, y: y + 1.2 + LINE / 2, w: Math.abs(xb - xa) - 4, h: TH, text: t, attach: 5, layer: 'BCD-TEXT', colour: 5 });
    if (boxes) boxes.push({ no: String(c.no || ''), x0: xc - 20, y0: y - 1, x1: xc + 20, y1: y + 1.2 + LINE });
    return;
  }
  const l = xc - BOX_W / 2, r = xc + BOX_W / 2;
  prims.push(P([...pre, [xa, y], [l, y]], false, 'BCD-CABLE')); prims.push(L(r, y, xb, y, 'BCD-CABLE'));
  cableBox(prims, xc, y, c, boxes);
}
function cableBox(prims, xc, y, c, boxes) {
  const lines = cableText(c).split('\n'), w = BOX_W, h = lines.length * LINE + 3;
  prims.push(P([[xc - w / 2, y - h / 2], [xc + w / 2, y - h / 2], [xc + w / 2, y + h / 2], [xc - w / 2, y + h / 2]], true, 'BCD-CABLEBOX'));
  prims.push({ t: 'mtext', x: xc, y, w: w - 2, h: TH, text: lines.join('\n'), attach: 5, layer: 'BCD-TEXT' });
  if (boxes) boxes.push({ no: String(c.no || ''), x0: xc - w / 2, y0: y - h / 2, x1: xc + w / 2, y1: y + h / 2 });
}
const block = (prims, x, yTop, w, h, lines, node) => {
  const box = [[x, yTop - h], [x + w, yTop - h], [x + w, yTop], [x, yTop]];
  if (BSTYLE.ng) { const col = NG[String(node && node.status || 'energised').toLowerCase()] || 3; prims.push({ t: 'fill', pts: box, layer: 'BCD-BLOCK', colour: col }); prims.push({ ...P(box, true, 'BCD-BLOCK'), colour: col }); prims.push({ t: 'mtext', x: x + w / 2, y: yTop - h / 2, w: w - 3, h: TH, text: lines.filter(Boolean).join('\n'), attach: 5, layer: 'BCD-TEXT', colour: 5 }); return; }
  prims.push(P(box, true, 'BCD-BLOCK'));
  prims.push({ t: 'mtext', x: x + w / 2, y: yTop - h / 2, w: w - 3, h: TH, text: lines.filter(Boolean).join('\n'), attach: 5, layer: 'BCD-TEXT' });
};
function bcdSheetBody(groups, links, nodes, prims, boxes) {
  let y = 0; const panelSpan = {};
  for (const g of groups) {
    const n = Math.max(1, g.down.length), hGroup = n * BCD_PITCH;
    const devY = g.down.map((_, i) => y - (i + 0.5) * BCD_PITCH), mid = y - hGroup / 2;
    if (g.panel) { const s = panelSpan[g.panel] || (panelSpan[g.panel] = { top: y, bottom: y - hGroup }); s.bottom = y - hGroup; }
    if (g.jb) {
      // the JB is as tall as its devices, so every cable leaves it on its own straight line: no bends, no shared or crossing runs
      const jh = Math.max(14, hGroup - 4), jTop = mid + jh / 2;
      block(prims, BCD_X.jb, jTop, BCD_W.jb, jh, [g.jb.tag, ...wrap(g.jb.label, 22)], g.jb);
      g.up.forEach((c, k) => { const yy = g.up.length > 1 ? jTop - (k + 0.5) * (jh / g.up.length) : mid, x0 = BCD_X.panel + BCD_W.panel, x1 = BCD_X.jb; hRun(prims, x0, x1, yy, (x0 + x1) / 2, c, boxes); });
      if (!g.up.length && g.panel) prims.push(L(BCD_X.panel + BCD_W.panel, mid, BCD_X.jb, mid, 'BCD-CABLE'));
      g.down.forEach(({ c }, i) => hRun(prims, BCD_X.jb + BCD_W.jb, BCD_X.device, devY[i], (BCD_X.jb + BCD_W.jb + BCD_X.device) / 2, c, boxes));
    } else g.down.forEach(({ c }, i) => { const x0 = BCD_X.panel + BCD_W.panel; hRun(prims, x0, BCD_X.device, devY[i], BCD_X.jb + BCD_W.jb / 2, c, boxes); });
    g.down.forEach(({ dev }, i) => block(prims, BCD_X.device, devY[i] + 7, BCD_W.device, 14, [dev.tag, ...wrap(dev.label, 30).slice(0, 2)], dev));
    y -= hGroup + 6;
  }
  for (const [tag, s] of Object.entries(panelSpan)) { const nd = nodes.get(tag) || { tag, label: '' }; block(prims, BCD_X.panel, s.top + 2, BCD_W.panel, s.top - s.bottom + 4, [nd.tag, ...wrap(nd.label, 26)], nd); }
  // panel-to-panel links listed under the blocks (they are usually "LINK TO ... SEE DWG" interfaces)
  links.forEach((c, i) => { const yy = y - 6 - i * 14; hRun(prims, BCD_X.panel + BCD_W.panel / 2, BCD_X.jb, yy + 4, BCD_X.panel + BCD_W.panel + 40, c, boxes); prims.push({ t: 'mtext', x: BCD_X.jb + 2, y: yy + 4, w: 120, h: TH, text: `${c.from} TO ${c.to}${c.note ? '\n' + c.note : ''}`, attach: 4, layer: 'BCD-TEXT' }); });
  return { minY: y - links.length * 14 - 6, maxX: BCD_X.device + BCD_W.device };
}
// sheet frame: our own border + title block, unless the client's title block is used (then only the content is placed)
// ---------- the drawing border: the BGEN / Atomax A0 border and title block (from the template), drawings placed inside it at 1:1 (text height 2) ----------
// Drawing borders. Atomax A1 (from X191026-0000-06-70-0030, the frame block ATOMAX_A1_FRAME) is the default; the BGEN/Boulting A0 one is kept for clients that use it.
// Each border: its geometry (for previews / PDFs; the DXF inserts the real block when the template has it), where the title block values go,
// the revision rows, and the NOTES / LEGEND / REFERENCE DOCUMENTS column. Drawings go inside at 1:1 (text height 2).
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'cad', f), 'utf8')); } catch { return null; } };
// The company border families from the DWT templates (ATOMAX_ALL_TEMPLATES / BGEN / PBE_GROUP_BORDERS): A0-A3, each with its title block attributes,
// revision box, drawing area (the template's viewport), NOTES / REFERENCE DOCUMENTS headings and the CDM box. Blocks are in the DXF template renamed
// "<COMPANY> <SIZE> BORDER" so one file can hold all three families.
const FAMILY = {};
function familyCfg(j) {
  const colX = j.notes ? j.notes[0] : j.box.x1 + 8, colR = j.colR || j.geo.x0 + j.geo.w - 6, colW = colR - colX;
  // the CDM 2015 box (Boulting Group wording, BS 7671:2008) is left off every border: only the column divider stays
  const cdm = (j.extras.texts || []).some(t => /CDM|BOULTING/i.test(String(t.text)));
  if (cdm) j = { ...j, extras: { texts: [], prims: (j.extras.prims || []).filter(p => p.t === 'line' && Math.max(p.x1, p.x2) < colX - 2) } };
  // the CDM box in the notes column: notes start under it
  const inCol = (t) => t.x >= colX - 2;
  const mtLines = (t) => String(t.text).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length * t.h * 0.9 / Math.max(10, t.w || colW))), 0);   // MTEXT wraps at its width
  const extraBottom = Math.min(...[...j.extras.texts.filter(inCol).map(t => t.y - (t.t === 'mtext' ? mtLines(t) * t.h * 1.7 : 0)), ...j.extras.prims.filter(p => p.t === 'line' && Math.min(p.x1, p.x2) >= colX - 2).map(p => Math.min(p.y1, p.y2))].filter(Number.isFinite), j.notes ? j.notes[1] - 4 : j.box.y1);
  // the small title block values (drawn, checked, approved, date, scale) sit in the middle of their cells, worked out from the border's own lines
  const segs = [];
  for (const p of j.geo.prims) { if (p.t === 'line') segs.push([p.x1, p.y1, p.x2, p.y2]); else if (p.pts) for (let i = 1; i < p.pts.length; i++) segs.push([...p.pts[i - 1], ...p.pts[i]]); }
  const vert = segs.filter(q => Math.abs(q[0] - q[2]) < 0.01);
  const attrs = { ...j.attrs };
  for (const tag of ['DRN', 'CHKD', 'APRVD', 'DATE', 'SCALE']) {
    const a = attrs[tag]; if (!a) continue;
    const y = a[1] + 1, xs = vert.filter(q => Math.min(q[1], q[3]) <= y && Math.max(q[1], q[3]) >= y).map(q => q[0]);
    const left = Math.max(...xs.filter(x => x < a[0] - 0.5)), right = Math.min(...xs.filter(x => x > a[0] + 0.5));
    if (Number.isFinite(left) && Number.isFinite(right) && right - left < 80) attrs[tag] = [(left + right) / 2, a[1], a[2], 'center', a[4] || 0];
  }
  return {
    geo: j.geo, block: j.block, page: j.size, box: j.box, keepOut: j.keepOut || null, maxScale: 1, textLayer: 'E-020___T-E-Drawing Frame Text', notesLayer: 'Z-903___T-E-Notes Text',
    attrs, titleWidth: j.titleWidth || Math.max(30, colW - 6), company: j.company, size: j.size, colX,
    revbox: { prims: j.rev.prims, texts: j.rev.texts, attrs: j.rev.attrs, block: j.revBlock }, rev: { x0: j.rev.x, y: j.rev.y, pitch: j.rev.h || 8, dx: j.rev.dx || 0, max: j.rev.max || 8 },
    heads: [...(j.notes ? [['NOTES', j.notes[0], j.notes[1]]] : []), ...(j.refs ? [['REFERENCE DOCUMENTS', j.refs[0], j.refs[1]]] : [])], extras: j.extras,
    notes: j.notes && { x: colX, tx: colX + 5.9, y: Math.min(j.notes[1] - 6, extraBottom - 6), pitch: 3.35, w: colW, bottom: (j.refs ? j.refs[1] : j.rev.y) + 12 },
    legendFlow: true, refs: j.refs && { x: colX, y: j.refs[1] - 6, pitch: 3.4, h: 2, w: colW, bottom: j.rev.y + (j.rev.h || 8) * 3 + 4 },
  };
}
for (const c of ['atomax', 'bgen', 'pbe', 'ng']) { const j = readJson('borders/' + c + '.json'); if (j) for (const k of Object.keys(j)) FAMILY[k] = familyCfg(j[k]); }
const SIZES = ['A3', 'A2', 'A1', 'A0'];
// the border for a company: the size asked for, else the smallest sheet the drawing fits at 1:1
// the drawing fits a sheet if it fits its drawing area, keeping clear of the CDM box (beside it, or above it)
const fitsIn = (B, W, H) => { const bw = B.box.x1 - B.box.x0 - 4, bh = B.box.y1 - B.box.y0 - 4; if (!B.keepOut) return W <= bw && H <= bh; const k = B.keepOut; return (W <= bw && H <= B.box.y1 - k.y1 - 4) || (W <= k.x0 - B.box.x0 - 4 && H <= bh); };
function resolveBorder(company = 'atomax', size = '', W = 0, H = 0) {
  const own = company === 'ng';   // National Grid has its own sizes only (A2, A1, A0)
  const fam = (sz) => FAMILY[`${company}-${sz}`] || (own ? null : FAMILY[`atomax-${sz}`]);
  if (size && fam(size)) return fam(size);
  for (const sz of SIZES) { const B = fam(sz); if (B && fitsIn(B, W, H)) return B; }
  return fam('A0');
}
const BORDERS = {
  atomax: FAMILY['atomax-A1'] || (() => { const g = readJson('border-atomax-a1.json'); return g && { geo: g, block: 'ATOMAX_A1_FRAME', page: 'A1', box: { x0: 24, y0: 24, x1: 730, y1: 572 }, maxScale: 1, textLayer: 'E-020___T-E-Drawing Frame Text', notesLayer: 'Z-903___T-E-Notes Text', attrs: {}, rev: { y: 135.2, pitch: 8, max: 0 } }; })(),
  bgen: FAMILY['bgen-A1'], pbe: FAMILY['pbe-A1'], ng: FAMILY['ng-A0'],
};
const BORDER = BORDERS.atomax || BORDERS.bgen;
const BORDER_NAMES = { atomax: 'Atomax', bgen: 'BGEN', pbe: 'PBE Group', ng: 'National Grid' };
// a border key is a company ('atomax', 'bgen', 'pbe') or company-size ('bgen-A3'); a ready border object passes through
const borderOf = (key, W, H) => { if (key && key.geo) return key; const [c, sz] = String(key || 'atomax').split('-'); if (c === 'ng' && FAMILY['ng-A0']) return resolveBorder('ng', sz || '', W, H); return resolveBorder(FAMILY[`${c}-A1`] ? c : 'atomax', sz || '', W, H); };
// ---------- notes: a drawing goes to the client, so its notes are statements a client needs, never our working ----------
// Questions, TQs / RFIs, internal sources (the master device list, Dex, the app), how something was worked out, and TBC lists of title block
// fields are taken off the drawing; questions go to the job's RFI register instead (intake.js).
const INTERNAL_NOTE = [
  /master (device )?list/i, /\bdex\b|atomax media|media office|\bthe app\b/i, /\b(TQ|RFI)[\s-]*\d*\b/, /\?\s*$/,
  /^(please |to be )?(confirm|check|clarif|advise|query|question)/i, /\b(needs?|requires?) (to be )?confirm/i, /\bto be confirmed by\b/i,
  /\b(drawing number|drawing no|revision|drawn|checked|approved)\b[^.]*\bTBC\b/i, /\bnot on the master list\b|\bdex had left\b/i,
  /\bno separate tags? (are|is) given\b|\bso (they|it|these) (are|is) shown\b|\bhave been (assumed|taken) as\b|\bwe (have )?(assumed|taken|shown)\b/i,
  /^draft by dex/i, /\b\d+ devices?,? \d+ cables?\b/i,
  /\btruncated\b|\bin the workbook\b|\bworkbook (cells?|rows?|notes?)\b|\b(rows?|cells?) [A-Z]?\d+\b|\bR\d+ TO R\d+\b|\bawaiting client confirmation\b/i,
];
const isInternalNote = (t) => INTERNAL_NOTE.some(re => re.test(String(t)));
const cleanLabel = (t) => units(String(t).replace(/\bPFC\s+(?=\d+(?:\.\d+)?\s*kA)/gi, 'PROSPECTIVE FAULT ')).replace(/\s*[([]?\s*(?:SEE|REF(?:ER)?(?: TO)?|PER)\s+(?:TQ|RFI)[\s-]*[\w/-]*\s*[)\]]?/gi, '').replace(/\s*[([]\s*(?:TQ|RFI)[\s-]*\d+[\w/ -]*[)\]]/gi, '').replace(/[ \t]+\n/g, '\n').trim();
function cleanLabels(spec) {   // every label on an SLD / BCD spec, in place
  const walk = (b) => { if (!b) return; if (b.label) b.label = cleanLabel(b.label); for (const c of [...(b.incomers || []), ...(b.feeders || [])]) { if (c.label) c.label = cleanLabel(c.label); for (const it of c.chain || []) { if (it.label) it.label = cleanLabel(it.label); if (it.board) walk(it.board); } } };
  (spec.boards || spec.busbars || []).forEach(walk);
  for (const n of spec.nodes || []) if (n.label) n.label = cleanLabel(n.label);
  for (const c of spec.cables || []) if (c.note) c.note = cleanLabel(c.note);
}
// the schedule is the source: each BCD cable's type (with its voltage), cores, size and length, and each item's location, are copied
// straight from the workbook's own columns, so nothing Dex retyped (a dropped "11kV") reaches the drawing. Returns what changed.
function fromSchedule(spec, sheets) {
  const norm = (v) => String(v ?? '').trim(), key = (v) => norm(v).toUpperCase().replace(/\s+/g, ''), changed = [];
  const tables = (want) => { const out = []; for (const sh of sheets || []) { const rows = sh.rows || []; for (let i = 0; i < Math.min(rows.length, 15); i++) { const h = (rows[i].c || []).map(x => norm(x).toLowerCase()); const col = {}; for (const [k, re] of Object.entries(want)) col[k] = h.findIndex(x => re.test(x)); if (col.id >= 0 && Object.entries(col).filter(([k, v]) => k !== 'id' && v >= 0).length) { out.push({ col, rows: rows.slice(i + 1) }); break; } } } return out; };
  const cabs = new Map();
  for (const t of tables({ id: /^cable\s*(no|number|ref|tag)\b|^cable$/, type: /^cable\s*type$|^type$/, cores: /cores?/, size: /csa|^size/, volt: /^voltage|rated voltage/, len: /^length/ }))
    for (const r of t.rows) { const c = r.c || [], id = key(c[t.col.id]); if (id && !cabs.has(id) && !(r.st || []).some(Boolean)) cabs.set(id, { type: norm(c[t.col.type]), cores: norm(c[t.col.cores]), size: norm(c[t.col.size]), volt: norm(c[t.col.volt]), len: norm(c[t.col.len]) }); }
  for (const cb of spec.cables || []) {
    const s0 = cabs.get(key(cb.no)); if (!s0) continue;
    const hasV = (t) => /\d(?:\.\d+)?\s*k?V\b/i.test(t), vt = s0.volt && s0.volt !== '-' && !key(s0.type).includes(key(s0.volt)) ? s0.volt : '';
    const want = { type: s0.type ? (vt ? s0.type + (hasV(s0.type) ? ', ' : ' ') + vt : s0.type) : '', cores: s0.cores && s0.cores !== '-' ? s0.cores : '', size: s0.size && s0.size !== '-' ? s0.size : '', length: s0.len && s0.len !== '-' ? s0.len.replace(/\s*m$/i, '') : '' };
    const same = (k, a, b) => { const f = (x) => { let t = key(x); if (k === 'size') t = t.replace(/MM²|MM2|MM$/, ''); if (k === 'cores') t = t.replace(/(PAIRS?|PRS?|P)$/, 'P').replace(/(CORES?|C)$/, ''); if (k === 'length') t = t.replace(/M$/, ''); return t.replace(/^(\d+)\.0$/, '$1'); }; return f(a) === f(b); };
    for (const [k, v] of Object.entries(want)) if (v && !same(k, cb[k], v)) { changed.push(`${cb.no} ${k}: ${norm(cb[k]) || '(none)'} -> ${v}`); cb[k] = v; }
  }
  // SLD cable labels ("C-001\n3C 95mm² XLPE/SWA/PVC 6.35/11kV ..."): the type and voltage put back as the schedule writes them
  const fixType = (lab) => {
    const lines = String(lab || '').split(/\n|\\n/), no = key((lines[0] || '').split(/[\s/]/)[0].replace(/[A-Z]$/i, m => m)), s0 = cabs.get(no) || cabs.get(key((lines[0] || '').split(/\s/)[0]).split('/')[0]);
    if (!s0 || !s0.type) return lab;
    const vt = s0.volt && s0.volt !== '-' && !key(s0.type).includes(key(s0.volt)) ? s0.volt : '', T = vt ? s0.type + (/\d(?:\.\d+)?\s*k?V\b/i.test(s0.type) ? ', ' : ' ') + vt : s0.type;
    const k2 = (v) => key(v).replace(/,/g, ''); if (k2(lab).includes(k2(T))) return lab;
    // only a type Dex wrote with a voltage that differs from the schedule's is replaced (the rest of the label, e.g. its length, kept)
    const first = s0.type.split(/\s+/)[0].toUpperCase(), li = lines.findIndex(l => l.toUpperCase().includes(first)); if (li < 0) return lab;
    const line = lines[li], pos = line.toUpperCase().indexOf(first), seg = line.slice(pos), cut = seg.search(/\s+\d+(?:\.\d+)?\s*m\b|\s+\(/i), part = cut < 0 ? seg : seg.slice(0, cut);
    if (!/\d(?:\.\d+)?\s*k?V\b/i.test(part) || k2(part) === k2(T)) return lab;
    const elsewhere = vt && lines.some((l, i) => i !== li && k2(l).includes(k2(vt))) || (vt && k2(seg.slice(cut < 0 ? seg.length : cut)).includes(k2(vt)));
    lines[li] = line.slice(0, pos) + (elsewhere ? s0.type : T) + (cut < 0 ? '' : seg.slice(cut));
    return lines.join('\n');
  };
  const walk = (b) => { if (!b) return; for (const f of [...(b.incomers || []), ...(b.feeders || [])]) for (const it of f.chain || []) { if (it.board) walk(it.board); else if (symbolOf(it.symbol) === 'cable' && it.label) { const nl = fixType(it.label); if (nl !== it.label) { changed.push(`${String(it.label).split(/\n|\\n/)[0]} type: -> ${nl.split(/\n|\\n/).slice(1).join(' ')}`); it.label = nl; } } } };
  (spec.boards || spec.busbars || []).forEach(walk);
  const locs = new Map();
  for (const t of tables({ id: /^(equipment\s*)?tag$/, loc: /^location$/ })) for (const r of t.rows) { const c = r.c || [], loc = norm(c[t.col.loc]); if (loc) for (const tg of norm(c[t.col.id]).split(/\s*[,;\/]\s*|\s+&\s+/)) if (tg) locs.set(key(tg), loc); }
  // the cable schedule's from / to locations too (an equipment list wins where both give one)
  for (const end of ['from', 'to']) for (const t of tables({ id: new RegExp('^' + end + '$'), loc: new RegExp('^' + end + '\\s*(location|loc|area|room)$') })) for (const r of t.rows) { const c = r.c || [], loc = norm(c[t.col.loc]), tg = norm(c[t.col.id]); if (loc && tg && !(r.st || []).some(Boolean) && !locs.has(key(tg))) locs.set(key(tg), loc); }
  // SLD: each board, and each load at the end of a feeder, in its room from the schedule (so every room is boxed the same way)
  const tagOfL = (t) => key(String(t || '').split(/\n|\\n|\s/)[0]);
  const sldWalk = (b) => { if (!b) return; const l = locs.get(tagOfL(b.label)); if (l && String(b.enclosure || '').toUpperCase() !== l.toUpperCase()) { changed.push(`${tagOfL(b.label)} room: ${norm(b.enclosure) || '(none)'} -> ${l}`); b.enclosure = l; }
    for (const f of [...(b.incomers || []), ...(b.feeders || [])]) for (const it of f.chain || []) { if (it.board) sldWalk(it.board); else if (it.label && !it.gap && ['supply', 'generator', 'transformer', 'load', 'motor', 'ups', 'earth', 'electrode', 'pfc', 'spd', 'grid'].includes(symbolOf(it.symbol))) { const li = locs.get(tagOfL(it.label)); if (li) it.enclosure = li; } } };
  (spec.boards || spec.busbars || []).forEach(sldWalk);
  // every spare way on the schedule is shown on its board (a breaker and SPARE), struck through or not: the client wants to see them
  if (spec.boards || spec.busbars) {
    const spares = new Map();
    for (const t of tables({ id: /^cable\s*(no|number|ref|tag)\b|^cable$/, from: /^from$/, to: /^to$/, fn: /function|description|duty|service/ })) for (const r of t.rows) {
      const c = r.c || [], to = norm(c[t.col.to]), fn = norm(c[t.col.fn]), from = key(c[t.col.from]);
      if (from && (/^spare\b/i.test(to) || /\bspare\s+way\b/i.test(fn))) { const a = spares.get(from) || []; a.push({ no: norm(c[t.col.id]), rating: (fn.match(/\b\d+(?:\.\d+)?\s?A\b/i) || [''])[0].toUpperCase().replace(/\s/g, '') }); spares.set(from, a); } }
    const addSpares = (b) => { if (!b) return; const want = spares.get(tagOfL(b.label)) || []; const have = (b.feeders || []).filter(f => (f.chain || []).some(it => symbolOf(it.symbol) === 'spare')).length;
      for (const sp of want.slice(have)) { (b.feeders = b.feeders || []).push({ chain: [{ symbol: 'breaker', label: sp.rating || 'TBC' }, { symbol: 'spare', label: 'SPARE - EQUIPPED, OFF & LOCKED' }] }); changed.push(`${tagOfL(b.label)}: spare way ${sp.no} added`); }
      for (const f of b.feeders || []) for (const it of f.chain || []) if (it.board) addSpares(it.board); };
    (spec.boards || spec.busbars || []).forEach(addSpares);
  }
  for (const n of spec.nodes || []) { const l = locs.get(key(n.tag)); if (l && norm(n.location) !== l) { changed.push(`${n.tag} location: ${norm(n.location) || '(none)'} -> ${l}`); n.location = l; } }
  return changed;
}
function clientNotes(spec) {
  const keep = [], moved = [];
  for (const raw of (spec.notes || [])) { const t = String(raw || '').replace(/^\s*(?:note\s*)?\d+\s*[.):-]\s*/i, '').replace(/\bP\s*[-=]\s*PAIRS?\b/gi, 'PR - PAIR').trim(); if (!t) continue;
    if (/^\s*(ABBREVIATIONS?|KEY TO ABBREVIATIONS)\b/i.test(t) || (noteLines(t, 200)[0] === 'ABBREVIATIONS:')) continue; (isInternalNote(t) ? moved : keep).push(t); }   // Atomax drawings carry no abbreviations note (Tom)
  return { notes: keep, moved };
}
// the notes as printed (numbered by the border); a note that does not fit is reported, never dropped quietly
// the words a reader meets: on the drawing, and in the other notes (an abbreviation used only in a note, e.g. ICP, still goes in the key)
const isAbbrNote = (n) => /^\s*(ABBREVIATIONS?|KEY TO ABBREVIATIONS)\b/i.test(String(n));
const usedFor = (spec) => { if (!(spec._used instanceof Set)) return spec._used; const w = new Set(spec._used); for (const n of clientNotes(spec).notes) if (!isAbbrNote(n)) for (const m of String(n).toUpperCase().matchAll(/[A-Z0-9/&]+/g)) { w.add(m[0]); m[0].split('/').forEach(x => x && w.add(x)); } return w; };
const notesOf = (spec, k = 1) => [...clientNotes(spec).notes.filter(n => noteLines(n, 200, usedFor(spec)).length), ...(k < 1 ? [`DRAWING REDUCED TO ${Math.round(k * 100)}% TO FIT THE SHEET.`] : [])];
// a note's lines in the notes column; a list of abbreviations ("VSD - VARIABLE SPEED DRIVE. DOL - DIRECT ON LINE.") puts each one on its
// own line, never split at its dash
// units written normally even in capitals (11kV, 1000kVA, 75kW, 200kVAr, 50kA 1s, 95mm²), as on the SLD
const UNIT = { MA: 'mA', HZ: 'Hz', KVAR: 'kVAr', KVA: 'kVA', KV: 'kV', KW: 'kW', KA: 'kA', MVA: 'MVA', MW: 'MW', 'MM²': 'mm²', MM2: 'mm²', MM: 'mm' };
const units = (s) => String(s).replace(/\b(YN|ZN|D|Y|Z)(YN|ZN|Y|D|Z)(\d{1,2})\b/g, (m, a, b, n) => a + b.toLowerCase() + n).replace(/(\d)\s?(HZ|KVAR|KVA|KV|KW|KA|MVA|MW|MM²|MM2|MM|MA)(?![A-Z0-9])/gi, (m, d, u) => d + (UNIT[u.toUpperCase()] || u)).replace(/(kA,?\s*\d+(?:\.\d+)?)S(?![A-Z])/g, '$1s');
// the words written on the drawing itself (not the border or notes): an abbreviation only goes in the key when it is used
function usedWords(prims) { const w = new Set(); for (const p of flatPrims(prims)) if ((p.t === 'text' || p.t === 'mtext') && !/BORDER|NOTES/i.test(p.layer || '')) for (const m of String(p.text).toUpperCase().matchAll(/[A-Z0-9/&]+/g)) { w.add(m[0]); m[0].split('/').forEach(x => x && w.add(x)); } return w; }
const abbrUsed = (a, used) => !(used instanceof Set) || used.has(a) || [...used].some(x => (x.startsWith(a) && /^\d/.test(x.slice(a.length))) || (x.endsWith(a) && /^[\d.]+$/.test(x.slice(0, -a.length))));   // a word, a tag starting with it (LIS-P01, LIS01) or a size ending in it (2PR)
function noteLines(nt, width, used) {
  // a list of abbreviations, however Dex wrote it ("ABBREVIATIONS: PR - PAIR, C - CORE" or "VSD - VARIABLE SPEED DRIVE. DOL - DIRECT ON LINE."):
  // under ABBREVIATIONS:, one per line, never split at its dash, only the ones written on the drawing
  const t = String(nt).toUpperCase().replace(/\s+/g, ' ').trim(), head = t.match(/^(ABBREVIATIONS?|KEY TO ABBREVIATIONS)\s*[:\-–]?\s*/);
  // entries split at commas / full stops, and also wherever a new "XXX - " starts (Dex sometimes runs them together with no separator)
  const body = head ? t.slice(head[0].length) : t, parts = body.split(/\s*[,;]\s+|\.\s+|\.$/).flatMap(x => x.split(/\s+(?=[A-Z0-9][A-Z0-9/&]{0,7}\s+[-–=]\s+)/)).map(x => x.trim()).filter(Boolean);
  // under an ABBREVIATIONS heading a missing dash is fine ("SWA STEEL WIRE ARMOURED"): nothing Dex listed is lost
  const ents = parts.map(x => x.match(/^([A-Z0-9][A-Z0-9/&]{0,7})\s*(?:\s[-–=:]\s|\s+-\s*|\s*-\s+)\s*(.+)$/) || (head && x.match(/^([A-Z0-9][A-Z0-9/&]{0,7})\s+([A-Z].+)$/))).filter(Boolean);
  if (ents.length >= 2 && ents.length >= parts.length * (head ? 0.6 : 0.9)) {
    const keep = ents.filter(m => abbrUsed(m[1], used)); if (!keep.length) return [];
    const glue = ([, a, b]) => wrap(b, width - (a.length + 3) * TH * 0.9).map((l, i) => (i ? ' '.repeat(a.length + 3) : a + ' - ') + l);
    return ['ABBREVIATIONS:', ...keep.flatMap(glue).map(units)];
  }
  return wrap(t, width).map(units);
}
function notesFit(B, spec) {
  const N = B && B.notes; if (!N) return true;
  let ny = N.y; for (const nt of notesOf(spec)) { const ls = noteLines(nt, N.w - (N.tx - N.x), usedFor(spec)); if (ny - ls.length * N.pitch < N.bottom) return false; ny -= ls.length * N.pitch + 1.6; }
  return true;
}
const LEGEND_TEXT = { MCCB: 'MCCB. TEXT: RATING, FRAME', MCB: 'MCB / RCBO. TEXT: RATING, POLES, TYPE', 'SWITCH DISCONNECTOR': 'SWITCH DISCONNECTOR / MAIN SWITCH / ISOLATOR', 'ISOLATOR DISCONNECTOR': 'ISOLATOR', 'FUSED SWITCH DISCONNECTOR': 'FUSED SWITCH DISCONNECTOR', FUSE: 'FUSE', CONTACTOR1: 'CONTACTOR', MOTOR: 'MOTOR', LOAD: 'FINAL CIRCUIT / LOAD', 'HV-LV TRANSFORMER': 'TRANSFORMER' };
// a reference document as Atomax writes it: one line, NUMBER - SHORT TITLE (no revision, no bracketed detail), shortened at a word to fit the column
function shortRef(r, maxC = 44) {
  let t = String(r || '').toUpperCase().replace(/\([^)]*\)/g, ' ').replace(/\bREV(?:ISION)?\.?\s*[A-Z]?\d+\b/g, ' ').replace(/\s+/g, ' ').replace(/[\s,;:-]+$/, '').trim();
  if (t.length <= maxC) return t;
  const words = t.split(' '); let outS = '';
  for (const w of words) { const n = outS ? outS + ' ' + w : w; if (n.length > maxC) break; outS = n; }
  return (outS || t.slice(0, maxC)).replace(/[\s,;:-]+$/, '');
}
const LEGEND_OWN = { breaker: 'CIRCUIT BREAKER', isolator: 'ISOLATOR', fuse: 'FUSE', switchfuse: 'FUSE SWITCH', contactor: 'CONTACTOR', transformer: 'TRANSFORMER', ct: 'CURRENT TRANSFORMER', meter: 'MULTIFUNCTION METER (kWh)', supply: 'SUPPLY', generator: 'GENERATOR', ups: 'UPS', vsd: 'VARIABLE SPEED DRIVE', dol: 'DOL STARTER', softstarter: 'SOFT STARTER', spd: 'SURGE PROTECTION DEVICE', pfc: 'POWER FACTOR CORRECTION', load: 'LOAD', motor: 'MOTOR', board: 'DISTRIBUTION BOARD / PANEL', earth: 'EARTH', electrode: 'EARTH ELECTRODE', link: 'TEST / DISCONNECTING LINK', grid: 'EARTH MESH' };
function primsBounds(prims) {
  prims = flatPrims(prims);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const p of prims) {
    if (p.t === 'line') { add(p.x1, p.y1); add(p.x2, p.y2); }
    else if (p.pts) p.pts.forEach(([x, y]) => add(x, y));
    else if (p.t === 'circle' || p.t === 'arc') { add(p.x - p.r, p.y - p.r); add(p.x + p.r, p.y + p.r); }
    else if (p.t === 'mtext') { const n = String(p.text).split('\n').length, h = n * (p.h || TH) * 1.7, w = p.w || 30; const col = ((p.attach || 1) - 1) % 3, xl = col === 1 ? p.x - w / 2 : col === 2 ? p.x - w : p.x; const yt = p.attach >= 4 && p.attach <= 6 ? p.y + h / 2 : p.y; add(xl, yt); add(xl + w, yt - h); }
    else if (p.t === 'text') { const w = String(p.text).length * p.h * 0.9; add(p.align === 'center' ? p.x - w / 2 : p.x, p.y); add(p.align === 'center' ? p.x + w / 2 : p.x + w, p.y + p.h); }
  }
  return { x0, y0, x1, y1 };
}
// where a drawing goes on a sheet at 1:1: in the middle of the drawing area; if any of it would land on the CDM box it moves up (then left) just far enough.
// null when it does not fit at 1:1.
function placeIn(B, prims, c = primsBounds(prims)) {
  const cb = B.box, KO = B.keepOut, W = c.x1 - c.x0, H = c.y1 - c.y0;
  if (W > cb.x1 - cb.x0 || H > cb.y1 - cb.y0) return null;
  const boxes = KO ? flatPrims(prims).map(p => primsBounds([p])).filter(b => Number.isFinite(b.x0)) : [];
  const hits = (dx, dy) => KO && boxes.some(b => b.x1 + dx > KO.x0 - 2 && b.x0 + dx < KO.x1 + 2 && b.y1 + dy > KO.y0 && b.y0 + dy < KO.y1 + 2);
  const cx = cb.x0 + (cb.x1 - cb.x0 - W) / 2 - c.x0, cy = cb.y1 - (cb.y1 - cb.y0 - H) / 2 - c.y1, top = cb.y1 - c.y1, left = cb.x0 - c.x0;
  if (!hits(cx, cy)) return { k: 1, dx: cx, dy: cy };
  // otherwise the clear spot nearest the middle (moving left, up, or a bit of both)
  let best = null;
  for (let dx = cx; dx >= left - 1e-6; dx -= 2) for (let dy = cy; dy <= top + 1e-6; dy += 2) {
    const d = Math.hypot(cx - dx, dy - cy); if (best && d >= best.d) break;
    if (!hits(dx, dy)) { best = { k: 1, dx, dy, d }; break; }
  }
  return best;
}
function borderFrame(prims, spec, sheetLabel, opts) {
  const c = primsBounds(prims), W = c.x1 - c.x0, H = c.y1 - c.y0;
  let B = opts.border && opts.border.geo ? opts.border : borderOf(opts.borderKey || opts.border, W, H);
  // no size asked for: a bigger sheet when the notes would not fit the column
  if (!(opts.border && opts.border.geo) && !/-A\d$/.test(String(opts.borderKey || opts.border || '')) && B.company && !notesFit(B, spec)) for (const sz of SIZES.slice(SIZES.indexOf(B.size) + 1)) { const Cb = FAMILY[`${B.company}-${sz}`]; if (Cb) { B = Cb; if (notesFit(Cb, spec)) break; } }
  const cb = B.box, f = opts.fill || {};
  // the drawing goes in the middle of the drawing area; when that would run into the CDM box it moves up (or left) clear of it
  const fit = placeIn(B, prims, c) || (() => {   // too big for the sheet at 1:1: reduced to fit the area beside / above the CDM box (said in the notes)
    const KO = B.keepOut, above = KO ? { ...cb, y0: KO.y1 + 2 } : cb, beside = KO ? { ...cb, x1: KO.x0 - 2 } : cb;
    const sc = (a) => Math.min(1, (a.x1 - a.x0) / W, (a.y1 - a.y0) / H), area = sc(above) >= sc(beside) ? above : beside, k = Math.min(B.maxScale || 1, sc(area));
    return { k, dx: area.x0 + ((area.x1 - area.x0) - W * k) / 2 - c.x0 * k, dy: area.y1 - ((area.y1 - area.y0) - H * k) / 2 - c.y1 * k }; })();
  const { k, dx, dy } = fit;
  const out = place(prims, dx, dy, k);
  // the frame: the real block in the DXF, its geometry in previews
  out.push({ t: 'insert', name: B.block || '__border', x: 0, y: 0, layer: 'SLD-BORDER', prims: [...B.geo.prims.map(p => ({ ...p, layer: 'SLD-BORDER' })), ...B.geo.texts.map(t => t.t === 'mtext' ? { ...t, layer: 'SLD-BORDER' } : { t: 'text', x: t.x, y: t.y, h: t.h, text: t.text, align: t.align, rot: t.rot || 0, wf: t.wf, layer: 'SLD-BORDER' })] });
  const title = wrap(spec.title || f.title || 'DRAWING', B.titleWidth || 76).slice(0, 4), proj = wrap(f.project || '', B.titleWidth || 76);
  const today = (() => { const d = new Date(); return [d.getDate(), d.getMonth() + 1, d.getFullYear()].map((v, i) => String(v).padStart(i < 2 ? 2 : 4, '0')).join('.'); })();
  const val = { DRAWING_NUMBER: spec.drawingNumber || f.drawingNumber || 'TBC', REV: spec.revision || 'P01', TITLE1: title[0] || '', TITLE2: title[1] || '', TITLE3: title[2] || '', TITLE4: title[3] || '', DRN: f.drawn || '', DATE: f.date || today, SCALE: 'NTS', CHKD: f.checked || '', APRVD: f.approved || '', SHT: f.sht || '1', SHTX: f.shtx || '1', CLIENT_1: f.client || '', CLIENT_2: f.client2 || '', PROJECT_1: proj[0] || '', PROJECT_2: proj[1] || f.project2 || '',
    NG_NUMBER: spec.ngNumber || f.ngNumber || 'TBC', SIZE: B.size || '', SITE: String(f.site || f.project || '').toUpperCase().slice(0, 40), STATUS: f.status || (/^[PA]/i.test(spec.revision || 'P') ? 'S3' : '') };
  // the drawing number is shrunk until it fits between the sheet-size label and the revision box
  const fitH = (tag, a, v) => { const h = a[2] || 2; if (tag !== 'DRAWING_NUMBER' || B.company === 'ng' || !B.colX || a[3] !== 'center') return h; const half = a[0] - (B.colX + 7); return Math.max(2, Math.min(h, (2 * half) / (String(v).length * 0.92))); };
  if (B.size === 'A3' || B.size === 'A2') val.DATE = val.DATE.replace(/\.(\d{2})(\d{2})$/, '.$2');   // the narrow title blocks take dd.mm.yy
  if (B.attrs.REV) val.REV = val.REV;
  for (const [tag, a] of Object.entries(B.attrs)) if (val[tag]) out.push({ t: 'text', x: a[0], y: a[1], h: tag === 'REV' && B.company !== 'ng' ? Math.min(a[2] || 2, 3.3) : fitH(tag, a, val[tag]), text: String(val[tag]).slice(0, 60), align: a[3] || 'left', layer: B.textLayer });
  // revision rows, oldest at the bottom, each above the last
  const hist = spec.revHistory && spec.revHistory.length ? spec.revHistory : [{ rev: val.REV, what: stageWords(val.REV) }];
  // the description is wrapped to its own column so it never runs over the lines (narrow on A3 / A2)
  const descW = B.company === 'ng' ? 84 : B.revbox && B.revbox.attrs && B.revbox.attrs.DRAWN ? Math.max(18, (Array.isArray(B.revbox.attrs.DRAWN) ? B.revbox.attrs.DRAWN[0] : B.revbox.attrs.DRAWN.x) - 4 - 20 - 1) : 40;
  const R = B.rev;
  hist.slice(-(R.max || 7)).forEach((r, i) => {
    const y = R.y + i * R.pitch, desc = String(r.what || '').toUpperCase().split('\n').flatMap(l => wrap(l, descW)).slice(0, 2), by = r.by || f.drawn || '';
    if (B.revbox) {   // the BGEN revision block
      const ox = R.x0 + i * (R.dx || 0), oy = R.y + (R.dx ? 0 : i * R.pitch), dt = String(r.date || val.DATE).replace(/\.(\d{2})(\d{2})$/, '.$2');
      const rv = { REV: r.rev, DATE: B.company === 'ng' ? dt.replace(/\./g, '/') : dt, DESC1: desc[0] || '', DESC2: desc[1] || '', DRAWN: by, CHECKED: r.checked || f.checked || '', APPROVED: r.approved || f.approved || '', INV: f.ngInvestment ? 'NG Investment No. ' + f.ngInvestment : '' };
      if (B.revbox.block) out.push({ t: 'insert', name: B.revbox.block, x: ox, y: oy, layer: 'SLD-BORDER', prims: [...B.revbox.prims.map(p => ({ ...p, layer: 'SLD-BORDER' })), ...(B.revbox.texts || []).map(t => ({ ...t, t: t.t === 'mtext' ? 'mtext' : 'text', layer: 'SLD-BORDER' }))] });
      else for (const p of B.revbox.prims) out.push(moved({ ...p, layer: 'SLD-BORDER' }, ox, oy));
      for (const [tag, a0] of Object.entries(B.revbox.attrs)) { const a = Array.isArray(a0) ? { x: a0[0], y: a0[1], h: a0[2], align: a0[3] } : a0; if (rv[tag]) out.push({ t: 'text', x: ox + a.x, y: oy + a.y - a.h / 2, h: a.h, text: rv[tag], align: a.align, layer: B.textLayer }); }
      return;
    }
    if (i > 0) { const yt = y + R.pitch / 2, yb = y - R.pitch / 2; out.push(L(R.x0, yt, R.x1, yt, 'SLD-BORDER')); R.cols.forEach(x => out.push(L(x, yb, x, yt, 'SLD-BORDER'))); }   // the frame draws the first row; later rows are added above it
    const tx = (x, text, h = R.h, yy = y - h / 2) => out.push({ t: 'text', x, y: yy, h, text, align: 'center', layer: B.textLayer });
    tx(R.REV, r.rev); tx(R.DATE, String(r.date || val.DATE).replace(/\.(\d{2})(\d{2})$/, '.$2'), R.descH);
    if (desc.length > 1) { tx(R.DESC, desc[0], R.descH, y + 0.95); tx(R.DESC, desc[1], R.descH, y - 2.65); } else tx(R.DESC, desc[0] || '', R.descH);
    tx(R.DRAWN, by); tx(R.CHECKED, r.checked || f.checked || ''); tx(R.APPROVED, r.approved || f.approved || '');
  });
  // the template's own headings and the CDM box (its XXXXX placeholders get the project number and job title)
  for (const [t, x, y] of (B.heads || [])) out.push({ t: 'text', x, y: y - 2, h: 2.6, text: t, layer: B.notesLayer });
  if (B.extras) { let n = 0; out.push(...B.extras.prims.map(p => ({ ...p, layer: 'SLD-BORDER' }))); for (const t of B.extras.texts) { const txt = /^X{4,}$/.test(String(t.text).trim()) ? (n++ === 0 ? (f.projectNo || f.project || '').split(' ')[0] : (f.jobTitle || f.project || '').replace(/^\S+\s*/, '')) : t.text; out.push({ ...t, text: txt, layer: B.notesLayer }); } }
  // NOTES, then the LEGEND of the symbols used, then REFERENCE DOCUMENTS
  if (!(spec._used instanceof Set)) spec._used = usedWords(prims);
  const N = B.notes, notes = notesOf(spec, k);
  let ny = N.y;
  notes.forEach((nt, i) => { const ls = noteLines(nt, N.w - (N.tx - N.x), usedFor(spec)); if (ny - ls.length * N.pitch < N.bottom) { spec._warnings = [...new Set([...(spec._warnings || []), `note ${i + 1} does not fit the ${B.size || ''} notes column`])]; return; } out.push({ t: 'text', x: N.x, y: ny, h: 2, text: (i + 1) + '.', layer: B.notesLayer }); ls.forEach(l => { out.push({ t: 'text', x: N.tx, y: ny, h: 2, text: l, layer: B.notesLayer }); ny -= N.pitch; }); ny -= 1.6; });
  if (B.legend || B.legendFlow) {
    const Lg = B.legend || { x: N.x + 6.6, tx: N.x + 18.4, y: ny - 6, bottom: N.bottom };
    const usedHouse = [...new Set(prims.filter(p => p.t === 'insert' && LEGEND_TEXT[p.name]).map(p => p.name))];
    const kinds = spec._kinds || [];
    const own = kinds.filter(k => LEGEND_OWN[k] && SYMBOLS[k] && !SYMBOLS[k]().house);
    const entries = [
      ...usedHouse.map(name => { const sy = Object.values(SYMBOLS).map(f => f()).find(q => q.house === name); return { h: -HOUSE[name].bbox[1] * 0.6, text: LEGEND_TEXT[name], draw: (x, y) => place(sy ? sy.prims : [{ t: 'insert', name, x: 0, y: 0, layer: 'SLD-SYMBOL', prims: HOUSE[name].prims }], x, y, 0.6) }; }),
      ...own.map(k => { const sy = SYMBOLS[k](); return { h: Math.max(sy.len * 0.75, 6), text: LEGEND_OWN[k], draw: (x, y) => place(sy.prims, x, y, 0.75) }; }),
      ...(prims.some(p => p.layer === 'SLD-BUS') ? [{ h: 4, text: 'BUSBAR', draw: (x, y) => [P([[x - 5, y - 2], [x + 5, y - 2]], false, 'SLD-BUS', 0.8)] }] : []),
      ...(kinds.includes('cable') ? [{ h: 10, text: 'CABLE: NUMBER, CORES, SIZE, TYPE', draw: (x, y) => [P([[x - 1.6, y], [x + 1.6, y], [x + 1.6, y - 10], [x - 1.6, y - 10]], true, 'SLD-CABLE')] }] : []),
      ...(prims.some(p => p.layer === 'SLD-ENCLOSURE') ? [{ h: 4, text: 'SWITCHROOM / ENCLOSURE', draw: (x, y) => { const o = []; dashBox(o, x - 5, y - 4, x + 5, y, 'SLD-ENCLOSURE'); return o; } }] : []),
      ...(prims.some(p => p.layer === 'BCD-CABLEBOX') ? [{ h: 4, text: 'CABLE: NUMBER, CORES x SIZE, TYPE', draw: (x, y) => [P([[x - 6, y - 4], [x + 6, y - 4], [x + 6, y], [x - 6, y]], true, 'BCD-CABLEBOX')] }] : []),
    ];
    const hasExtra = entries.length || (spec.legend || []).length || (spec.ngLegend || []).length;
    if (B.legendFlow && hasExtra) out.push({ t: 'text', x: N.x, y: ny - 2, h: 2.6, text: 'LEGEND', layer: B.notesLayer });   // no empty LEGEND heading (the NG BCD has its own legend on the drawing)
    if (B.legendFlow) Lg.y = ny - 7;
    let ly = Lg.y;
    // two columns: symbol, then its words wrapped beside it; each row as tall as its taller entry
    const colW = Math.max(30, (N.w || 80) / 2), textW = colW - 15;
    for (let i = 0; i < entries.length; i += 2) {
      const row = entries.slice(i, i + 2).map(e => ({ ...e, ls: wrap(e.text, textW) }));
      const rh = Math.max(...row.map(e => Math.max(e.h, e.ls.length * 3.4))) + 4;
      if (ly - rh < Lg.bottom) break;
      row.forEach((e, j) => { const sx = N.x + 5 + j * colW, tx = sx + 9; out.push(...e.draw(sx, ly)); const mid = ly - Math.max(e.h, e.ls.length * 3.4) / 2; e.ls.forEach((l, q) => out.push({ t: 'text', x: tx, y: mid + (e.ls.length / 2 - q - 1) * 3.4 + 0.7, h: 2, text: l, layer: B.notesLayer })); });
      ly -= rh;
    }
    for (const [kind, t] of (spec.ngLegend || [])) {   // the National Grid key: cable colours and equipment states
      if (ly - 6 < Lg.bottom) break; const x0 = Lg.x - 6, x1 = Lg.x + 6, y = ly - 3;
      if (kind === 'dash82') dashed(out, x0, y, x1, 82); else if (kind.startsWith('line')) out.push({ ...L(x0, y, x1, y, 'BCD-CABLE'), colour: +kind.slice(4) });
      else { const b = [[x0, y - 2], [x1, y - 2], [x1, y + 2], [x0, y + 2]], col = +kind.slice(4); out.push({ t: 'fill', pts: b, layer: 'BCD-BLOCK', colour: col }); out.push({ ...P(b, true, 'BCD-BLOCK'), colour: col }); }
      out.push({ t: 'text', x: Lg.tx, y: ly - 4, h: 2, text: t, layer: B.notesLayer }); ly -= 6;
    }
    for (const t of (spec.legend || [])) { if (ly - 6 < Lg.bottom) break; out.push({ t: 'text', x: Lg.tx, y: ly - 3, h: 2, text: String(t).toUpperCase(), layer: B.notesLayer }); ly -= 6; }
  }
  if (B.refs) { const R0 = B.rev || {}, refBottom = R0.dx ? B.refs.bottom : (R0.y || 0) + Math.max(1, hist.length) * (R0.pitch || 8) + 3; let ry = B.refs.y; const maxC = Math.floor(((B.refs.w || 80) - 2) / (B.refs.h * 0.9)); const seenNo = new Set(); for (const r of [...new Set((spec.references || []).map(x => shortRef(x, maxC)).filter(Boolean))].filter(x => { const no = (x.match(/^\S+/) || [''])[0]; if (/\d/.test(no) && seenNo.has(no)) return false; seenNo.add(no); return true; })) { if (ry < refBottom) break; out.push({ t: 'text', x: B.refs.x, y: ry, h: B.refs.h, text: r, layer: B.notesLayer }); ry -= B.refs.pitch; } }
  if (sheetLabel && !B.attrs.SHT) out.push({ t: 'text', x: 1112, y: 128 + hist.length * 8, h: TH, text: sheetLabel, align: 'center', layer: B.textLayer });
  const g = B.geo;
  return { prims: out, bounds: { x0: g.x0 - 2, y0: g.y0 - 2, x1: g.x0 + g.w + 2, y1: g.y0 + g.h + 2 }, sheet: B.page, page: B.page, content: cb, border: `${B.company || ''} ${B.page}`.trim() };
}
function frame(prims, spec, minY, maxY, maxX, sheetLabel, opts = {}) {
  if (BORDER && !opts.noTitle && !opts.ownBorder) { const r = borderFrame(prims, spec, sheetLabel, opts); prims.length = 0; prims.push(...r.prims); return r; }
  const notes = (spec.notes || []).map(String).filter(Boolean);
  const nl = notes.flatMap((n, i) => wrap((i + 1) + '. ' + n, 150)), notesH = nl.length ? (nl.length + 1) * LINE + 8 : 0;
  const tbW = 130, tbH = 32, m = 15;
  const needW = Math.max(maxX + 2 * m + 10, 150 + tbW + 3 * m), needH = (maxY - minY) + Math.max(notesH, tbH) + 3 * m + 10;
  const sheet = opts.fixed ? SHEETS[0] : (SHEETS.find(([, W, H]) => W >= needW && H >= needH) || ['', needW, needH]);
  const [sheetName, SW, SH] = sheet;
  const left = -m - 5, top = maxY + m, right = left + SW, bottom = top - SH;
  if (nl.length) prims.push({ t: 'mtext', x: left + m, y: bottom + m + notesH, w: 150, h: TH, text: ['NOTES', ...nl].join('\n'), attach: 1, layer: 'SLD-NOTES' });
  if (!opts.noTitle) {
    prims.push(P([[left, bottom], [right, bottom], [right, top], [left, top]], true, 'SLD-BORDER'));
    prims.push(P([[left + 5, bottom + 5], [right - 5, bottom + 5], [right - 5, top - 5], [left + 5, top - 5]], true, 'SLD-BORDER'));
    const tbx = right - 10 - tbW, tby = bottom + 10;
    prims.push(P([[tbx, tby], [tbx + tbW, tby], [tbx + tbW, tby + tbH], [tbx, tby + tbH]], true, 'SLD-BORDER'));
    prims.push(L(tbx, tby + 14, tbx + tbW, tby + 14, 'SLD-BORDER'));
    prims.push({ t: 'mtext', x: tbx + 3, y: tby + tbH - 3, w: tbW - 6, h: 3.5, text: wrap(spec.title || 'BLOCK CABLE DIAGRAM', 70).join('\n'), attach: 1, layer: 'SLD-TEXT' });
    prims.push({ t: 'mtext', x: tbx + 3, y: tby + 11, w: tbW - 6, h: TH, text: [`DWG No: ${spec.drawingNumber || 'TBC'}   REV: ${spec.revision || 'P01'}${sheetName ? '   ' + sheetName : ''}${sheetLabel ? '   ' + sheetLabel : ''}`, `DRAWN: Dex (Atomax Media Office) · ${new Date().toISOString().slice(0, 10)}`, 'DRAFT FOR CHECKING'].join('\n'), attach: 1, layer: 'SLD-TEXT' });
  }
  return { bounds: { x0: left, y0: bottom, x1: right, y1: top }, sheet: sheetName || 'oversize', content: { x0: left + m, y0: bottom + m, x1: right - m, y1: top - m } };
}
// no two cable runs may overlap or cross (Tom's rule): every BCD-CABLE segment is checked against every other
function cableClashes(prims) {
  const segs = [];
  for (const p of prims) if (p.layer === 'BCD-CABLE') { if (p.t === 'line') segs.push([p.x1, p.y1, p.x2, p.y2]); else if (p.t === 'pline') for (let i = 1; i < p.pts.length; i++) segs.push([...p.pts[i - 1], ...p.pts[i]]); }
  const e = 1e-6, out = [], between = (v, a, b) => v > Math.min(a, b) + e && v < Math.max(a, b) - e;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const [a, b] = [segs[i], segs[j]], ha = Math.abs(a[1] - a[3]) < e, hb = Math.abs(b[1] - b[3]) < e, va = Math.abs(a[0] - a[2]) < e, vb = Math.abs(b[0] - b[2]) < e;
    if (ha && hb && Math.abs(a[1] - b[1]) < e && Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2])) - Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2])) > e) out.push('overlap at y=' + a[1]);
    else if (va && vb && Math.abs(a[0] - b[0]) < e && Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3])) - Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3])) > e) out.push('overlap at x=' + a[0]);
    else if (ha && vb && between(b[0], a[0], a[2]) && between(a[1], b[1], b[3])) out.push(`crossing at ${b[0]},${a[1]}`);
    else if (va && hb && between(a[0], b[0], b[2]) && between(b[1], a[1], a[3])) out.push(`crossing at ${a[0]},${b[1]}`);
  }
  return out;
}
const sheetRows = (B) => B ? Math.floor((B.box.y1 - B.box.y0 - 20) / 22) : 10;   // device rows per sheet (A0 border at 1:1, or the old A3 frame)
function isPowerBcd(spec, model) {
  if (spec.layout === 'power') return true; if (spec.layout === 'instrument') return false;
  const nodes = [...model.nodes.values()];
  if (nodes.some(n => /^rio$/i.test(n.type || ''))) return false;   // RIO racks: the instrument (National Grid style) layout
  // a junction box alone does not make it an instrument drawing: a power BCD can carry a JB with its instruments hung off it
  const instr = (c) => /BS\s?5308|instrument|\bpairs?\b|\bCY\b|\b\d+\s?P\b|screened\s+pair/i.test(`${c.type || ''} ${c.cores || ''}`);
  const power = (c) => /SWA|XLPE|LSZH|\bkV\b|G\/Y|\d+\s?C\b/i.test(`${c.type || ''} ${c.cores || ''}`) || /^\d+$/.test(String(c.cores || '').trim());
  const p = model.cables.filter(c => power(c) && !instr(c)).length, i = model.cables.filter(instr).length;
  const tags = nodes.map(n => String(n.tag || '')).join(' ');
  return p > i || /\b(TX|MSB|SWB|MCC|DB|UPS|GEN|RMU|PFC)[-\d]/i.test(tags) && p >= i;
}
function layoutBcd(spec, opts = {}) {
  const model = bcdModel(spec);
  if (!model.cables.length) throw new Error('The BCD has no cables');
  BSTYLE = { ng: spec.style === 'ng' || spec.style === 'national-grid' };
  // a power BCD (boards, transformers, MCCs, DBs on SWA / XLPE cable) uses the block layout with cable runs; RIO / JB / field-device BCDs keep the instrument layout
  if (BSTYLE.ng) return [layoutPowerBcd(spec, model, opts)];
  if (spec.layout === 'flow') return [layoutPowerBcd(spec, model, opts)];
  if (isPowerBcd(spec, model)) return layoutPanelBcd(spec, model, opts);
  const { groups: raw, links } = bcdGroups(model);
  // a JB with more devices than a sheet holds carries on to the next sheet ("CONT.")
  const SHEET_ROWS = sheetRows(opts.noTitle ? null : borderOf(String(opts.border || 'atomax').includes('-') ? opts.border : `${opts.border || 'atomax'}-A1`));
  const groups = raw.flatMap(g => { if (g.down.length <= SHEET_ROWS) return [g]; const out = []; for (let i = 0; i < g.down.length; i += SHEET_ROWS) out.push({ ...g, jb: g.jb && i ? { ...g.jb, label: (g.jb.label ? g.jb.label + ' ' : '') + '(CONT.)' } : g.jb, up: i ? [] : g.up, down: g.down.slice(i, i + SHEET_ROWS) }); return out; });
  // split the groups over sheets (a JB never splits across sheets)
  const sheets = []; let cur = [], rows = 0;
  for (const g of groups) { const n = Math.max(1, g.down.length); if (cur.length && rows + n > SHEET_ROWS) { sheets.push(cur); cur = []; rows = 0; } cur.push(g); rows += n; }
  if (cur.length) sheets.push(cur);
  return sheets.map((gs, i) => {
    const prims = [], boxes = [];
    const body = bcdSheetBody(gs, i === sheets.length - 1 ? links : [], model.nodes, prims, boxes);
    if (BSTYLE.ng) {   // the legend, as on the National Grid template
      const lx = BCD_X.device + BCD_W.device + 25; let ly = 0;
      const item = (draw, text) => { draw(lx, ly); prims.push({ t: 'mtext', x: lx + 16, y: ly, w: 50, h: TH, text, attach: 4, layer: 'BCD-TEXT' }); ly -= 7; };
      item((x, y) => dashed(prims, x, y, x + 12, 82), 'EXISTING BY OTHERS');
      item((x, y) => prims.push({ ...L(x, y, x + 12, y, 'BCD-CABLE'), colour: 1 }), 'NEW BY BGEN');
      item((x, y) => prims.push({ ...L(x, y, x + 12, y, 'BCD-CABLE'), colour: 5 }), 'CURRENT SUPPLY CABLING');
      const sw = (col) => (x, y) => { const b = [[x, y - 2.5], [x + 12, y - 2.5], [x + 12, y + 2.5], [x, y + 2.5]]; prims.push({ t: 'fill', pts: b, layer: 'BCD-BLOCK', colour: col }); prims.push({ ...P(b, true, 'BCD-BLOCK'), colour: col }); };
      item(sw(3), 'ENERGISED'); item(sw(1), 'DE-ENERGISED');
    }
    if (opts.diff) for (const b of boxes) if (opts.diff.added.includes(b.no) || opts.diff.changed.includes(b.no)) revCloud(prims, b, spec.revision);
    const clash = cableClashes(prims); if (clash.length) throw new Error('BCD layout has cables that overlap or cross (' + clash.slice(0, 3).join('; ') + '). Not saved.');
    const label = sheets.length > 1 ? `SHEET ${i + 1} OF ${sheets.length}` : '';
    if (sheets.length > 1 && i < sheets.length - 1) prims.push({ t: 'mtext', x: BCD_X.device, y: body.minY - 2, w: 80, h: TH, text: `CONTINUED ON SHEET ${i + 2}`, attach: 1, layer: 'BCD-TEXT' });
    const f = frame(prims, spec, body.minY - 8, 10, body.maxX, label, { fixed: true, noTitle: !!opts.noTitle, border: borderOf(String(opts.border || 'atomax').includes('-') ? opts.border : `${opts.border || 'atomax'}-A1`), fill: { ...(opts.fill || {}), sht: String(i + 1), shtx: String(sheets.length) } });
    return { prims, bounds: f.bounds, content: f.content, sheet: f.sheet, page: f.page, border: f.border, label, boxes, cables: [...gs.flatMap(g => [...g.up, ...g.down.map(d => d.c)]), ...(i === sheets.length - 1 ? links : [])].map(c => String(c.no || '')) };
  });
}
// ---------- panel BCD (Atomax standard, X11481-01-WHT-06-71-0004 style): one sheet per panel, going down ----------
// The panel is a long box across the sheet; what feeds it sits above it (rising cables), what it feeds drops straight down below it in
// schedule order (a device fed through another, e.g. isolator then motor, sits under that one). Motors are circles with the tag inside,
// everything else a box; each description is centred under its device. Cable text is written up the cable, centred on it: the cable
// number just left of the line, cores x size just right of it, then type and length.
// A cable to another panel ends at a label (LINK TO / SUPPLY FROM ... SEE SHEET n).
// Locations (HV room, pump hall, wet well ...) from the equipment list are dashed area boxes, each named top left; devices in the same
// place sit side by side. A dashed scope box goes round it all, the site named top left; anything by others (DNO / ICP) is left outside it.
function layoutPanelBcd(spec, model, opts = {}) {
  // a cable drawn on two sheets (panel to panel, or through a device shown on both) is labelled in full on one sheet only, the other
  // sheet gives its number and SEE SHEET n: on the sheet where it does not end at a link label, else on its source panel's sheet
  const ABBR = new Map();
  // the whole BCD on ONE sheet (Tom: as simple as it can be); split one sheet per panel only when it will not fit even on A0
  if (!opts._dry && !opts._single && !opts._split && spec.layout !== 'per-panel') {
    const saved = spec._warnings, one = layoutPanelBcd(spec, model, { ...opts, _single: true });
    if (one) return one;
    spec._warnings = saved;
    const tight = layoutPanelBcd(spec, model, { ...opts, _single: true, _tight: true });   // closed up before giving up on one sheet
    if (tight) return tight;
    spec._warnings = saved;
  }
  if (!opts._dry && !opts._single) {
    const saved = spec._warnings, on = layoutPanelBcd(spec, model, { ...opts, _dry: true }); spec._warnings = saved;
    for (const [no, list] of on.drawnOn) if (list.length > 1) {
      const c = model.cables.find(x => String(x.no) === no), src = list.find(e => !e.link) || list.find(e => e.si === on.panels.indexOf(c.from)) || list[0];
      for (const e of list) if (e !== src) ABBR.set(e.si + '|' + no, src.si + 1);
    }
  }
  const drawnOn = new Map(); let curSi = 0;
  const { nodes, cables } = model, H = 2.5, LH = H * 1.7, wrapH = (t, w) => wrap(t, w * TH / (H * HOUSE_WF)), CP = 25, MOTOR_R = 12.5, BOX_H = 16, DESC_W = 40, COL_MIN = opts._tight ? 46 : 54;   // tight: columns closed up so a big job still goes on one A0
  const warn = (m) => { spec._warnings = [...(spec._warnings || []), m]; };
  const loc = (t) => String((nodes.get(t) || {}).location || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const hasAreas = [...nodes.values()].some(n => n.location);
  const AP = 4, BAND = H + 3, AREA_PAD = hasAreas ? 4 : 0;
  const others = (t) => !!(nodes.get(t) || {}).byOthers;
  const tw = (s) => String(s).length * H * 0.92 * HOUSE_WF;
  const order = new Map(cables.map((c, i) => [c, i]));
  const outs = (t) => cables.filter(c => c.from === t), ins = (t) => cables.filter(c => c.to === t);
  // the panels: anything feeding two or more different things (a board, an MCC, a DB), in the order they first appear
  const firstSeen = []; for (const c of cables) for (const t of [c.from, c.to]) if (!firstSeen.includes(t)) firstSeen.push(t);
  const isPanel = (t) => new Set(outs(t).map(c => c.to)).size >= 2;
  let panels = firstSeen.filter(isPanel);
  if (!panels.length) panels = [firstSeen.find(t => outs(t).length) || firstSeen[0]];
  // one sheet: everything hangs off the main panel: the board (not a transformer or a JB) with the most cables downstream of it
  if (opts._single) { const reach = (t, seen = new Set()) => { if (seen.has(t)) return 0; seen.add(t); return outs(t).reduce((n, c) => n + 1 + reach(c.to, seen), 0); };
    const boardy = panels.filter(t => !/^(device|jb|motor|rio)$/i.test((nodes.get(t) || {}).type || '') || /\b(MSB|SWB|MCC|DB|PSB|LVB|BOARD|PANEL)\b/i.test(t + ' ' + ((nodes.get(t) || {}).label || '')));
    const cands = boardy.length ? boardy : panels; panels = [[...cands].sort((a, b) => reach(b) - reach(a) || panels.indexOf(a) - panels.indexOf(b))[0]]; }
  const sheetOf = (t) => panels.indexOf(t);
  const isMotor = (t) => { const n = nodes.get(t) || {}; return /^M[-_]/i.test(t) || /\bmotor\b|\bpump\b|\bfan\b|\bdrive motor\b/i.test(n.label || '') && !/control|isolator|starter|panel|board|centre|center|\bMCC\b|switch/i.test(n.label || '') && !isPanel(t); };
  const label = (t) => { const n = nodes.get(t) || {}, T = String(t).toUpperCase(); let l = units(String(n.label || '').toUpperCase()).trim(); if (l.startsWith(T)) l = l.slice(T.length).replace(/^[\s,:\-–]+/, ''); return l; };   // the tag is drawn already: never twice
  // the short name (the description before its ratings): for the title block and the links to other sheets; the full text stays in the panel box
  const shortName = (t) => { const out = []; for (const w of label(t).split(',')[0].split(/\s+/)) { if (out.length && /\d/.test(w)) break; out.push(w); } return out.join(' ').trim(); };
  // cable text: number | cores x size | type - length (the length only when the schedule gives lengths)
  // cores as Atomax writes them: 4C for cores, 2PR for pairs (never 2P)
  const coresTxt = (v) => { const s = String(v || '').trim().toUpperCase(); return /^\d+$/.test(s) ? s + 'C' : s.replace(/^(\d+)\s*(?:PAIRS?|PRS?|P)$/, '$1PR').replace(/\s*CORES?$/, 'C'); };
  const sizeTxt = (c) => { const sz = String(c.size || '').trim().toUpperCase().replace(/\s*MM2?²?$/, '').trim(); return units([coresTxt(c.cores), sz ? (/^[\d.]+$/.test(sz) ? sz + 'MM²' : sz) : ''].filter(Boolean).join(' ')); };
  const anyLen = cables.some(c => String(c.length ?? '').trim());
  const lenTxt = (c) => { const v = String(c.length ?? '').trim().toUpperCase().replace(/\s*M$/, ''); return v ? v + 'm' : anyLen ? 'LENGTH TBC' : ''; };
  // a type line too long for the drop is split over two lines (type, then the rest with the length), so the drops stay short
  const LINE_MAX = 62;
  const cabLines = (c) => {
    const ab = ABBR.get(curSi + '|' + c.no); if (ab) return [String(c.no || 'TBC'), `SEE SHEET ${ab}`];   // labelled in full on that sheet only
    const blank = (v) => !String(v ?? '').trim() || /^[-–]+$/.test(String(v).trim());
    if (/^SPARE/i.test(String(c.to || '')) && blank(c.type) && blank(c.cores) && blank(c.size)) return [String(c.no || 'TBC'), 'SPARE WAY - NO CABLE'];   // a spare way: no '- -' or LENGTH TBC
    const base = [String(c.no || 'TBC'), sizeTxt(c) || 'TBC'], ty = units(String(c.type || '').toUpperCase().replace(/\s+/g, ' ').trim()), ln = lenTxt(c), one = [ty, ln].filter(Boolean).join(' - ');
    if (!one) return base; if (tw(one) <= LINE_MAX) return [...base, one];
    const words = ty.split(' '); let a = ''; while (words.length && (!a || tw(a + ' ' + words[0]) <= LINE_MAX)) a = (a + ' ' + words.shift()).trim();
    return [...base, a, [words.join(' '), ln].filter(Boolean).join(' - ')].filter(Boolean); };
  const textX = (lx, i) => i === 0 ? lx - 1.2 : lx + i * (1.2 + H);   // text up the page: its letters stand left of its baseline
  // the drop from a panel / device to the next is long enough for the longest cable text, clear of the area boxes
  // each level of a sheet (going up or down from the panel) has its own drop, long enough for the longest cable text on that level
  const dropFor = (len) => Math.max(72, Math.ceil(len + (hasAreas ? 30 : 16)));
  const textLen = (c) => Math.max(...cabLines(c).map(tw));
  // devices in the same place go side by side (first place first), so each area is one box
  const byLoc = (kids) => { if (!hasAreas) return kids; const seen = []; kids.forEach(k => { if (!seen.includes(loc(k.tag))) seen.push(loc(k.tag)); }); return kids.map((k, i) => [k, i]).sort((a, b) => seen.indexOf(loc(a[0].tag)) - seen.indexOf(loc(b[0].tag)) || a[1] - b[1]).map(x => x[0]); };
  const pad = (b) => ({ x0: b.x0 - AP, y0: b.y0 - AP, x1: b.x1 + AP, y1: b.y1 + AP + BAND });
  const uni = (bs) => bs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
  const hit = (a, b, g = 0) => a.x0 < b.x1 + g && a.x1 > b.x0 - g && a.y0 < b.y1 + g && a.y1 > b.y0 - g;
  const sheets = [], allDrawn = new Set();
  panels.forEach((PN, si) => {
    curSi = si;
    const prims = [], boxes = [], drawn = new Set(), placedHere = new Set([PN]), items = [], rows = [], pending = [], textRects = [];
    // the trees: down (what P feeds, through devices that are not panels) and up (what feeds P)
    // the trees: down (what P feeds) and up (what feeds P). On one sheet a cable to something already drawn in another branch
    // (e.g. DB-03 to FT-01, which hangs under MCC-01) ends at a short label naming where that item is shown; each cable is drawn once.
    const usedC = new Set(), placedBy = new Map([[PN, { by: '', dir: 0 }]]);
    // going up, a device's other cables (a transformer's star point earth to the MET, a generator's earth) go with it too, so none is left off
    const kidsOf = (t, dir) => { const kids = [], list = (dir < 0 ? outs(t) : [...ins(t), ...outs(t).filter(c => c.to !== PN)]).sort((a, b) => order.get(a) - order.get(b));
      for (const c of list) { if (usedC.has(c)) continue; const o = c.from === t ? c.to : c.from;
        let k = kids.find(x => x.tag === o);
        if (!k) {
          if (placedHere.has(o)) { if (!opts._single) continue; k = { tag: o, ref: true, link: true, cables: [], kids: [] }; }
          else { k = { tag: o, link: sheetOf(o) >= 0 && o !== PN, cables: [], kids: [] }; placedHere.add(o); placedBy.set(o, { by: t, dir }); }
          kids.push(k);
        }
        k.cables.push(c); usedC.add(c); }
      for (const k of kids) if (!k.link) k.kids = kidsOf(k.tag, dir);
      return byLoc(kids); };
    const downKids = (t) => kidsOf(t, -1), upKids = (t) => kidsOf(t, 1);
    const down = downKids(PN), up = upKids(PN);
    // widths: a device's column is wide enough for its own cables and description, and for everything under it
    const descOf = (t) => wrapH(label(t), DESC_W), descW = (t) => Math.min(DESC_W, Math.max(0, ...descOf(t).map(l => l.length)) * H * 0.92 * HOUSE_WF);
    const beside = (k, dir) => k.kids.length > 0 || dir > 0;   // a device with a cable going on past it: its words go inside its box
    const boxW = (k, dir) => Math.max(30, k.cables.length * CP + 6, String(k.tag).length * H * 0.95 * HOUSE_WF + 8, beside(k, dir) ? descW(k.tag) + 8 : 0);
    const ownW = (k, dir) => { const n = k.cables.length;
      if (k.link) return Math.max(COL_MIN, n * CP + 12, DESC_W + 12) + AREA_PAD;
      if (isMotor(k.tag)) return Math.max(COL_MIN, descW(k.tag) + 12, 2 * ((n - 1) * CP + 9), MOTOR_R * 2 + 14) + AREA_PAD;
      return Math.max(COL_MIN, boxW(k, dir) + 10, beside(k, dir) ? 0 : descW(k.tag) + 12) + AREA_PAD; };
    const width = (k, dir) => (k.w = Math.max(ownW(k, dir), k.kids.reduce((n, x) => n + width(x, dir), 0)));
    const dW = down.reduce((n, k) => n + width(k, -1), 0), uW = up.reduce((n, k) => n + width(k, 1), 0);
    const PW = Math.max(dW, uW, 160) + 20, px0 = 0, px1 = PW, pTop = 0, pH = 22, pBot = -pH;
    // the panel
    const i0 = prims.length;
    prims.push(P([[px0, pBot], [px1, pBot], [px1, pTop], [px0, pTop]], true, 'BCD-BLOCK'));
    prims.push({ t: 'mtext', x: (px0 + px1) / 2, y: pTop - pH / 2, w: PW - 10, h: H, text: [PN, label(PN)].filter(Boolean).join(' ').trim(), attach: 5, layer: 'BCD-TEXT' });
    const panelItem = { tag: PN, loc: loc(PN), others: others(PN), bb: primsBounds(prims.slice(i0)), parent: null };
    items.push(panelItem); rows.push([panelItem]);
    // one cable: its line now, its text once the area boxes are known (centred in the clear part of its run)
    const cableRun = (c, pts, lx) => { prims.push(P(pts, false, 'BCD-CABLE')); pending.push({ c, lx, ya: pts[0][1], yb: pts[1][1] }); drawn.add(c); allDrawn.add(c); };
    const refText = (k, dir) => { const pb = placedBy.get(k.tag) || {}, toIt = (k.cables || []).some(c => c.to === k.tag); return [`${(k.cables && k.cables.length ? toIt : dir < 0) ? 'TO' : 'FROM'} ${[k.tag, shortName(k.tag)].filter(Boolean).join(' ')}`, pb.by ? `(SHOWN ${pb.dir < 0 ? 'UNDER' : 'ABOVE'} ${pb.by})` : '(SHOWN ABOVE)'].join('\n'); };
    const linkText = (k, dir) => k.ref ? refText(k, dir) : [dir < 0 ? 'LINK TO' : 'SUPPLY FROM', [k.tag, shortName(k.tag)].filter(Boolean).join(' '), `SEE SHEET ${sheetOf(k.tag) + 1}`].join('\n');
    // a device (or a link label) whose near edge is at yEdge (top when going down, bottom when going up), centred at cx.
    // Returns where each of its cables lands, and where cables going on past it leave from.
    const drawNode = (k, cx, yEdge, dir) => {
      const n = k.cables.length;
      if (k.link) {
        const ls = wrapH(linkText(k, dir), DESC_W + 6), h = ls.length * LH;
        prims.push({ t: 'mtext', x: cx, y: dir < 0 ? yEdge - 1.5 : yEdge + 1.5 + h, w: DESC_W + 6, h: H, text: ls.join('\n'), attach: 2, layer: 'BCD-TEXT' });
        return { lands: k.cables.map((c, i) => [cx + (i - (n - 1) / 2) * CP, yEdge]) };
      }
      const desc = descOf(k.tag), side = beside(k, dir);
      let near, far, lands;   // near: the edge the cables land on; far: the other edge (cables going on leave from it)
      if (isMotor(k.tag)) {
        const cy = yEdge + dir * MOTOR_R;
        prims.push(C(cx, cy, MOTOR_R, 'BCD-BLOCK')); prims.push({ t: 'mtext', x: cx, y: cy, w: MOTOR_R * 2 - 2, h: H, text: k.tag, attach: 5, layer: 'BCD-TEXT' });
        near = yEdge; far = cy + dir * MOTOR_R;
        lands = k.cables.map((c, i) => i === 0 ? [cx, near] : [cx + i * CP, cy, cx + MOTOR_R]);   // the next cables come down beside it and turn in to its side
      } else {
        // a device with a cable going on past it carries its description inside the box, under the tag (clear of every cable)
        // a board feeding several things spans them all, so every cable leaves its box
        const kidsW = k.kids.reduce((n, q) => n + q.w, 0), bw = k.kids.length > 1 ? Math.max(boxW(k, dir), kidsW - 20) : boxW(k, dir), inner = side ? [k.tag, ...desc] : [k.tag], bh = Math.max(BOX_H, inner.length * LH + 5), top = dir < 0 ? yEdge : yEdge + bh, bot = top - bh;
        prims.push(P([[cx - bw / 2, bot], [cx + bw / 2, bot], [cx + bw / 2, top], [cx - bw / 2, top]], true, 'BCD-BLOCK'));
        prims.push({ t: 'mtext', x: cx, y: (top + bot) / 2, w: bw - 4, h: H, text: inner.join('\n'), attach: 5, layer: 'BCD-TEXT' });
        near = dir < 0 ? top : bot; far = dir < 0 ? bot : top;
        lands = k.cables.map((c, i) => [cx + (i - (n - 1) / 2) * CP, near]);
      }
      const low = Math.min(near, far);   // the device's lower edge: words go under it
      const outside = desc.length && !(side && !isMotor(k.tag));
      if (outside) prims.push(side ? { t: 'mtext', x: cx + 4, y: low - 2, w: DESC_W, h: H, text: desc.join('\n'), attach: 1, layer: 'BCD-TEXT' } : { t: 'mtext', x: cx, y: low - 2, w: DESC_W, h: H, text: desc.join('\n'), attach: 2, layer: 'BCD-TEXT' });
      return { lands, far };
    };
    // a row of a tree, going down (dir -1) or up (dir +1); each child's cables start at startY directly over (or under) it
    const levels = {}; const measure = (kids, dir, depth) =>  /* a level crossing the scope boundary (by others) needs room for that edge and its name too */ { for (const k of kids) { const key = dir + ':' + depth; levels[key] = Math.max(levels[key] || 0, ...k.cables.map(c => textLen(c) + (others(k.tag) || c.byOthers ? 18 : 0))); if (!k.link) measure(k.kids, dir, depth + 1); } };
    measure(down, -1, 0); measure(up, 1, 0);
    const placeRow = (kids, x0, startY, dir, parent, depth = 0) => {
      const DROP = dropFor(levels[dir + ':' + depth] || 0);
      const row = []; rows.push(row);
      let x = x0;
      for (const k of kids) {
        const cx = x + k.w / 2, j0 = prims.length, r = drawNode(k, cx, startY + dir * DROP, dir);
        const it = { tag: k.tag, loc: loc(k.tag), others: others(k.tag), bb: primsBounds(prims.slice(j0)), parent, link: !!k.link }; items.push(it); row.push(it);
        k.cables.forEach((c, i) => {
          const no = String(c.no || ''); drawnOn.set(no, [...(drawnOn.get(no) || []), { si, link: !!k.link }]);
          const [lx, ly, sideX] = r.lands[i];
          if (sideX !== undefined) cableRun(c, [[lx, startY], [lx, ly], [sideX, ly]], lx);   // beside a motor, turning in to its side
          else cableRun(c, [[lx, startY], [lx, ly]], lx);
        });
        if (k.kids.length && !k.link) placeRow(k.kids, x + (k.w - k.kids.reduce((n, q) => n + q.w, 0)) / 2, r.far, dir, it, depth + 1);
        x += k.w;
      }
    };
    placeRow(down, px0 + (PW - dW) / 2, pBot, -1, panelItem);
    placeRow(up, px0 + (PW - uW) / 2, pTop, 1, panelItem);
    // the areas: neighbours in the same place are one box; a row joins the row (or panel) feeding it when the bigger box covers nothing else
    const clusters = [];
    if (hasAreas) {
      for (const row of rows) { let cur = null; for (const it of row) { const key = it.loc + '|' + it.others; if (cur && it.loc && cur.key === key) cur.items.push(it); else { cur = { key, loc: it.loc, others: it.others, items: [it] }; clusters.push(cur); } } }
      const boxOf = (its) => pad(uni(its.map(i => i.bb)));
      clusters.forEach(c => { c.box = boxOf(c.items); });
      for (let changed = true; changed;) {
        changed = false;
        // all the rows it feeds in the same place at once (e.g. a row of isolators and the motors under each), else one at a time
        outer: for (const A of clusters) { if (!A.loc) continue;
          const kids = clusters.filter(B => B !== A && B.key === A.key && B.items.every(i => A.items.includes(i.parent)));
          for (const group of [kids, ...kids.map(B => [B])]) { if (!group.length) continue;
            const u = boxOf([...A.items, ...group.flatMap(B => B.items)]); if (clusters.some(Cl => Cl !== A && !group.includes(Cl) && hit(u, Cl.box, 3))) continue;
            A.items.push(...group.flatMap(B => B.items)); A.box = u; group.forEach(B => clusters.splice(clusters.indexOf(B), 1)); changed = true; break outer; } }
      }
      // a row in the same place that cannot join as a rectangle (other areas beside it) still joins: its box and a strip up (or down)
      // to the part of the area holding what feeds it are added, so the outline steps round it (a link label to a board in the same
      // room, e.g. DB-03 to MCC-01, stays inside the room)
      clusters.forEach(c => { c.rects = [c.box]; });
      for (let changed = true; changed;) {
        changed = false;
        tabs: for (const A of clusters) { if (!A.loc) continue; for (const B of clusters) {
          if (A === B || B.key !== A.key || !B.items.every(i => A.items.includes(i.parent))) continue;
          const b = B.box, over = A.rects.filter(R => R.x0 < b.x1 - 1 && R.x1 > b.x0 + 1);
          const above = over.filter(R => R.y0 >= b.y1).sort((p, q) => p.y0 - q.y0)[0], below = over.filter(R => R.y1 <= b.y0).sort((p, q) => q.y1 - p.y1)[0], R = above || below;
          if (!R) continue;
          const strip = above ? { x0: Math.max(b.x0, R.x0), x1: Math.min(b.x1, R.x1), y0: b.y1, y1: R.y0 } : { x0: Math.max(b.x0, R.x0), x1: Math.min(b.x1, R.x1), y0: R.y1, y1: b.y0 };
          if (clusters.some(Cl => Cl !== A && Cl !== B && (Cl.rects || [Cl.box]).some(r => hit(strip, r, 3) || hit(b, r, 3)))) continue;
          A.rects.push(strip, b); A.items.push(...B.items); clusters.splice(clusters.indexOf(B), 1); changed = true; break tabs; } }
      }
      // a link label on its own is not boxed: that panel's area is drawn on its own sheet
      clusters.forEach(c => { if (c.items.every(i => i.link)) c.loc = ''; });
      const shown = clusters.filter(c => c.loc);
      shown.forEach((a, i) => shown.slice(i + 1).forEach(b => { if (a.rects.some(r => b.rects.some(q => hit(r, q)))) warn(`sheet ${si + 1}: the ${a.loc} and ${b.loc} areas overlap`); }));
    }
    const areas = clusters.filter(c => c.loc);
    // an area's outline: the edge of the union of its rectangles (its box plus any rows joined below / above it)
    const segsOfArea = (c) => {
      const rs = c.rects || [c.box], xs = [...new Set(rs.flatMap(r => [r.x0, r.x1]))].sort((a, b) => a - b), ys = [...new Set(rs.flatMap(r => [r.y0, r.y1]))].sort((a, b) => a - b);
      const inside = (i, j) => i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 && rs.some(r => (xs[i] + xs[i + 1]) / 2 > r.x0 && (xs[i] + xs[i + 1]) / 2 < r.x1 && (ys[j] + ys[j + 1]) / 2 > r.y0 && (ys[j] + ys[j + 1]) / 2 < r.y1);
      const out = [];
      for (let j = 0; j < ys.length; j++) { let run = null; for (let i = 0; i < xs.length - 1; i++) { const e = inside(i, j) !== inside(i, j - 1); if (e && run) run.x1 = xs[i + 1]; else if (e) run = { x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j] }; if (!e && run) { out.push(run); run = null; } } if (run) out.push(run); }
      for (let i = 0; i < xs.length; i++) { let run = null; for (let j = 0; j < ys.length - 1; j++) { const e = inside(i, j) !== inside(i - 1, j); if (e && run) run.y1 = ys[j + 1]; else if (e) run = { x0: xs[i], y0: ys[j], x1: xs[i], y1: ys[j + 1] }; if (!e && run) { out.push(run); run = null; } } if (run) out.push(run); }
      return out; };
    const outlineRects = (c) => segsOfArea(c);
    const hEdgesOf = (c) => segsOfArea(c).filter(g => g.y0 === g.y1).map(g => ({ x0: g.x0, x1: g.x1, y: g.y0 }));
    const drawArea = (c, layer) => { for (const g of segsOfArea(c)) dashPath(prims, [[g.x0, g.y0], [g.x1, g.y1]], layer, true); };
    const boxesOf = (c) => c.rects || [c.box];
    // the scope: dashed round everything that is ours; items by others (DNO / ICP) stay outside it
    const site = String(spec.area || (opts.fill && (opts.fill.site || opts.fill.project)) || '').toUpperCase();
    const mine = items.filter(i => !i.others), theirs = items.filter(i => i.others);
    let scope = null;
    if (mine.length) {
      const u = uni([...mine.map(i => i.bb), ...areas.filter(c => !c.others).flatMap(boxesOf)]), m = hasAreas ? 6 : 12;
      scope = { x0: u.x0 - m, y0: u.y0 - m, x1: u.x1 + m, y1: u.y1 + m + (site ? BAND + 2 : 0) };
      if ([...theirs.map(i => i.bb), ...areas.filter(c => c.others).map(c => c.box)].some(b => hit(scope, b))) warn(`sheet ${si + 1}: an item by others sits inside the scope box`);
    }
    // cable text: centred in the longest clear part of its run (between the area / scope box edges it passes)
    const hEdges = [...areas.flatMap(hEdgesOf), ...(scope ? hEdgesOf({ box: scope }) : [])];
    for (const q of pending) {
      const lo = Math.min(q.ya, q.yb), hi = Math.max(q.ya, q.yb);
      const cuts = [lo, ...hEdges.filter(e => e.x0 < q.lx && q.lx < e.x1 && e.y > lo && e.y < hi).map(e => e.y), hi].sort((a, b) => a - b);
      let best = [lo, hi], bl = -1; for (let i = 1; i < cuts.length; i++) if (cuts[i] - cuts[i - 1] > bl) { bl = cuts[i] - cuts[i - 1]; best = [cuts[i - 1], cuts[i]]; }
      const ls = cabLines(q.c), len = Math.max(...ls.map(tw)), yc = (best[0] + best[1]) / 2;
      if (len + 2 > bl) warn(`sheet ${si + 1}: cable ${q.c.no} text is longer than its clear run`);
      ls.forEach((l, i) => { const x = textX(q.lx, i); prims.push({ t: 'text', x, y: yc, h: H, text: l, rot: 90, align: 'center', layer: 'BCD-TEXT' }); textRects.push({ x0: x - H, y0: yc - tw(l) / 2, x1: x, y1: yc + tw(l) / 2 }); });
      boxes.push({ no: String(q.c.no || ''), x0: q.lx - 1.5 - H, y0: yc - len / 2 - 1, x1: textX(q.lx, ls.length - 1) + 0.3, y1: yc + len / 2 + 1 });
    }
    // names: top left of each box, in the band left for them, clear of every cable and word
    const rects = () => { const out = [...textRects]; for (const p of flatPrims(prims)) {
      if (p.t === 'line') out.push({ x0: Math.min(p.x1, p.x2), y0: Math.min(p.y1, p.y2), x1: Math.max(p.x1, p.x2), y1: Math.max(p.y1, p.y2) });
      else if (p.pts) { const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts; for (let i = 1; i < pts.length; i++) out.push({ x0: Math.min(pts[i - 1][0], pts[i][0]), y0: Math.min(pts[i - 1][1], pts[i][1]), x1: Math.max(pts[i - 1][0], pts[i][0]), y1: Math.max(pts[i - 1][1], pts[i][1]) }); }
      else if (p.t === 'circle') out.push({ x0: p.x - p.r, y0: p.y - p.r, x1: p.x + p.r, y1: p.y + p.r });
      else if ((p.t === 'text' && !p.rot) || p.t === 'mtext') out.push(primsBounds([p])); } return out; };
    const edgeRects = (b) => [{ x0: b.x0, y0: b.y1, x1: b.x1, y1: b.y1 }, { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y0 }, { x0: b.x0, y0: b.y0, x1: b.x0, y1: b.y1 }, { x0: b.x1, y0: b.y0, x1: b.x1, y1: b.y1 }];
    const tryName = (b, w, obs, hh = H) => { const yb = b.y1 - 1.6 - hh; for (let x = b.x0 + 2.5; x + w <= b.x1 - 2.5; x += 0.5) { const r = { x0: x - 0.6, y0: yb - 0.6, x1: x + w + 0.6, y1: yb + hh + 0.6 }; if (!obs.some(o => hit(r, o))) return { x, y: yb }; } return null; };
    // a name that will not fit beside the cables: its box is widened left or right into clear space, when there is room
    const nameBox = (c, name, others2) => {
      const b = c.box, w = tw(name) * 1.05, obs = [...rects(), ...others2.filter(o => o !== c).flatMap(outlineRects)], boxesNow = others2.filter(o => o !== c).flatMap(boxesOf);
      let at = tryName(b, w, obs);
      for (let d = 1; !at && d <= w + 10; d += 1) for (const nb of [{ ...b, x1: b.x1 + d }, { ...b, x0: b.x0 - d }]) {
        const strip = nb.x1 > b.x1 ? { x0: b.x1, y0: b.y0, x1: nb.x1, y1: b.y1 } : { x0: nb.x0, y0: b.y0, x1: b.x0, y1: b.y1 };
        if (obs.some(o => hit(strip, o, 1)) || boxesNow.some(o => hit(nb, o, 3))) continue;
        const a = tryName(nb, w, obs); if (a) { Object.assign(b, nb); at = a; break; } }
      if (at) { prims.push({ t: 'text', x: at.x, y: at.y, h: H, text: name, layer: 'BCD-TEXT' }); return; }
      // a narrow box (a cable down its middle): the name on two lines beside the cable, as MTEXT, rather than left off
      const ws = name.split(' '); if (ws.length > 1) {
        let best = null; for (let i = 1; i < ws.length; i++) { const l = [ws.slice(0, i).join(' '), ws.slice(i).join(' ')], m = Math.max(...l.map(tw)); if (!best || m < best.m) best = { l, m }; }
        const hh = H * 2 + H * 0.6, a2 = tryName(b, best.m * 1.05, obs, hh);
        if (a2) { prims.push({ t: 'mtext', x: a2.x, y: a2.y + hh, h: H, w: best.m * 1.1, text: best.l.join('\n'), attach: 1, layer: 'BCD-TEXT' }); return; } }
      warn(`sheet ${si + 1}: no clear place for the name ${name}`);
    };
    for (const c of areas) nameBox(c, c.loc, areas);   // the scope box is redrawn round them afterwards
    for (const c of areas) drawArea(c, 'BCD-AREA');
    if (scope) {   // the scope takes in any area box that widened
      const m = hasAreas ? 6 : 12, inA = areas.filter(c => !c.others).map(c => c.box);
      if (inA.length) { scope.x0 = Math.min(scope.x0, ...inA.map(b => b.x0 - m)); scope.x1 = Math.max(scope.x1, ...inA.map(b => b.x1 + m)); }
      dashBox(prims, scope.x0, scope.y0, scope.x1, scope.y1, hasAreas || theirs.length ? 'BCD-SCOPE' : 'BCD-AREA');
      if (site) nameBox({ box: scope }, site, areas);
    }
    if (opts.diff) for (const b of boxes) if (opts.diff.added.includes(b.no) || opts.diff.changed.includes(b.no)) revCloud(prims, b, spec.revision);
    const clash = cableClashes(prims); if (clash.length && !process.env.AMO_NOCLASH) throw new Error('BCD layout has cables that overlap or cross (' + clash.slice(0, 3).join('; ') + '). Not saved.');
    sheets.push({ P: PN, prims, boxes, cables: [...drawn].map(c => String(c.no || '')) });
  });
  // every cable on a sheet (a cable between two devices that are on no panel's sheet is reported, never left off quietly)
  const missing = cables.filter(c => !allDrawn.has(c));
  if (missing.length) warn(`NOT DRAWN (NO PANEL): ${missing.map(c => c.no).join(', ')}`);
  if (opts._dry) return { drawnOn, panels };
  const baseTitle = String(spec.title || 'BLOCK CABLE DIAGRAM').split('\n');
  spec._used = usedWords(sheets.flatMap(sh => sh.prims));   // the abbreviations key is the same on every sheet
  const framed = sheets.map((sh, i) => {
    const bb = primsBounds(sh.prims), key = opts.border && opts.border.geo ? opts.border : String(opts.border || 'atomax');
    let B = opts.noTitle ? null : borderOf(key, bb.x1 - bb.x0, bb.y1 - bb.y0);
    if (opts._single && B && !(opts.border && opts.border.geo)) { const big = FAMILY[`${B.company}-A0`] || B; if (!placeIn(big, sh.prims, bb)) { if (process.env.AMO_DEBUG) console.error('single sheet: does not fit', big.page, 'needs', Math.round(bb.x1 - bb.x0), 'x', Math.round(bb.y1 - bb.y0), 'box', big.box); return null; } }
    // the smallest sheet the drawing AND its notes fit
    if (B && !(opts.border && opts.border.geo) && !/-A\d$/.test(key) && FAMILY[`${B.company}-A0`]) for (const sz of SIZES) { const Cb = FAMILY[`${B.company}-${sz}`]; if (Cb && placeIn(Cb, sh.prims, bb) && notesFit(Cb, spec)) { B = Cb; break; } }
    const sspec = opts._single ? spec : { ...spec, title: [baseTitle[0] || 'BLOCK CABLE DIAGRAM', ...baseTitle.slice(1, 2), [sh.P, shortName(sh.P)].filter(Boolean).join(' '), sheets.length > 1 ? `SHEET ${i + 1}` : ''].filter(Boolean).join('\n') };
    const f = frame(sh.prims, sspec, bb.y0 - 4, bb.y1, bb.x1, '', { fixed: true, noTitle: !!opts.noTitle, border: B, fill: { ...(opts.fill || {}), sht: String(i + 1), shtx: String(sheets.length) } });
    return { prims: sh.prims, bounds: f.bounds, content: f.content, sheet: f.sheet, page: f.page, border: f.border, label: sheets.length > 1 ? `SHEET ${i + 1} OF ${sheets.length}` : '', boxes: sh.boxes, cables: sh.cables };
  });
  return framed.some(x => !x) ? null : framed;
}
// ---------- power BCD (National Grid LVAC style): the supply chain left to right ----------
// e.g. RMU > joint bay > transformer > LV pillar > outgoing circuits; temporary generator > distribution unit > interface box.
// Each piece of equipment sits in a column by how far down the chain it is; a cable that skips columns runs straight through the gaps.
// Cables leave and enter blocks at their own port and are routed in their own lane in each gap, so no two cables ever overlap or cross.
function layoutPowerBcd(spec, model, opts = {}) {
  const { nodes, cables } = model, BW = 48, VGAP = 8, prims = [], boxes = [];
  const tags = [...nodes.keys()];
  // directed edges; back edges (a control cable returning up the chain) are turned round so the chain stays left to right
  let E = cables.map((c, i) => ({ c, i, u: c.from, v: c.to }));
  const out = (t) => E.filter(e => e.u === t), inn = (t) => E.filter(e => e.v === t);
  { const state = {}; const visit = (t) => { state[t] = 1; for (const e of out(t)) { if (state[e.v] === 1) { [e.u, e.v] = [e.v, e.u]; e.rev = true; } else if (!state[e.v]) visit(e.v); } state[t] = 2; };
    // the chain starts where the schedule starts (it lists the supply first), then any other sources
    const roots = [...new Set(cables.map(c => c.from))], free = tags.filter(t => !E.some(e => e.v === t)); for (const t of [...roots.slice(0, 1), ...free, ...roots, ...tags]) if (!state[t]) visit(t); }
  // columns: longest chain from a source; a source sits just left of what it feeds
  const layer = {}; tags.forEach(t => { layer[t] = 0; });
  for (let k = 0; k < tags.length; k++) for (const e of E) if (layer[e.v] < layer[e.u] + 1) layer[e.v] = layer[e.u] + 1;
  for (let k = 0; k < 3; k++) for (const t of tags) if (!inn(t).length && out(t).length) layer[t] = Math.max(0, Math.min(...out(t).map(e => layer[e.v])) - 1);
  // order down each column: depth-first from the sources, in schedule order, so a tree is drawn without crossings
  const order = {}; let n = 0; const seen = new Set();
  const dfs = (t) => { if (seen.has(t)) return; seen.add(t); order[t] = n++; for (const e of out(t).sort((a, b) => a.i - b.i)) dfs(e.v); };
  [...new Set([...cables.map(c => c.from), ...tags])].filter(t => !inn(t).length).forEach(dfs); tags.forEach(dfs);
  // a cable that skips columns gets a pass-through point in each column it crosses
  const pts = {}; tags.forEach(t => { pts[t] = { tag: t, node: nodes.get(t), layer: layer[t], ord: order[t], left: [], right: [] }; });
  const segs = [];
  for (const e of E) {
    let prev = e.u;
    for (let L = layer[e.u] + 1; L <= layer[e.v]; L++) {
      const to = L === layer[e.v] ? e.v : `~${e.i}~${L}`;
      if (!pts[to]) pts[to] = { tag: to, dummy: true, layer: L, ord: (order[e.u] + order[e.v]) / 2 + e.i * 1e-3, left: [], right: [] };
      const sg = { e, from: prev, to, first: prev === e.u }; segs.push(sg); pts[prev].right.push(sg); pts[to].left.push(sg); prev = to;
    }
  }
  // the cable text above the line and its note below, wrapped to the label room in the gap
  const LABEL_MAX = 58, txt = (c) => cableText(c).replace(/\n/g, '  '), note = (c) => String(c.note || '').toUpperCase();
  const labW = (sg) => Math.min(LABEL_MAX, Math.max(40, txt(sg.e.c).length * TH * 0.92 + 6));
  const slot = (sg) => { const w = LABEL_MAX - 4; return (wrap(txt(sg.e.c), w).length + (note(sg.e.c) ? wrap(note(sg.e.c), w).length : 0)) * LINE + 5; };
  const cols = []; Object.values(pts).forEach(p => { (cols[p.layer] = cols[p.layer] || []).push(p); });
  const pos = (p) => cols[p.layer].indexOf(p);
  cols.forEach((c, L) => {
    if (!c) return;
    if (L === 0) { c.sort((a, b) => a.ord - b.ord); return; }
    const key = (p) => { if (!p.left.length) return 1e6 + p.ord; const ks = p.left.map(sg => { const src = pts[sg.from], outs = src.right.map(x => x.e.i).sort((a, b) => a - b); return pos(src) + (outs.indexOf(sg.e.i) + 1) / (outs.length + 1); }); return ks.reduce((a, b) => a + b, 0) / ks.length; };
    const k = new Map(c.map(p => [p, key(p)])); c.sort((a, b) => k.get(a) - k.get(b) || a.ord - b.ord);
  });
  // ports in the order of what they connect to (keeps every gap free of crossings)
  for (const p of Object.values(pts)) { p.right.sort((a, b) => pos(pts[a.to]) - pos(pts[b.to]) || a.e.i - b.e.i); p.left.sort((a, b) => pos(pts[a.from]) - pos(pts[b.from]) || a.e.i - b.e.i); }
  const blockLines = (p) => { const nd = p.node || {}, lab = String(nd.label || ''); return wrap(lab.toUpperCase().startsWith(String(p.tag).toUpperCase()) ? lab : [p.tag, lab].filter(Boolean).join('\n'), BW - 5); };
  // a feeder's slot on its source is at least as tall as the block it feeds, so that block can sit level with it and the cable runs straight
  const slotOut = (sg) => { const t = pts[sg.to]; return !t.dummy && t.left.length === 1 && t.h ? Math.max(slot(sg), t.h + VGAP) : slot(sg); };
  const size = (side) => side === 'R' ? slotOut : slot;
  const portsH = (list, side = 'L') => list.reduce((h, sg) => h + size(side)(sg), 0);
  const byLayer = Object.values(pts).sort((a, b) => b.layer - a.layer);   // right to left: what a block feeds is sized first
  for (const p of byLayer) {
    if (p.dummy) { p.h = slot(p.left[0]); continue; }
    p.h = Math.max(blockLines(p).length * LINE + 8, portsH(p.left) + 4, portsH(p.right, 'R') + 4, 16);
  }
  // port heights inside a block: spread over its height, each in the middle of its slot
  const noteH = (sg) => note(sg.e.c) ? wrap(note(sg.e.c), LABEL_MAX - 4).length * LINE : 0;
  const single = (sg) => { const t = pts[sg.to]; return !t.dummy && t.left.length === 1; };
  const offIn = (t, sg) => (t.h - slot(sg)) / 2 + slot(sg) - 3 - noteH(sg);   // how far below its top a single-feed block takes its cable
  const portYs = (p, list, top, side = 'L') => { const tot = portsH(list, side), start = top - (p.h - tot) / 2; let y = start; return list.map(sg => { const s = size(side)(sg); if (side === 'R' && single(sg)) { const py = y - offIn(pts[sg.to], sg); y -= s; return py; } const py = y - s + 3 + (note(sg.e.c) ? wrap(note(sg.e.c), LABEL_MAX - 4).length * LINE : 0); y -= s; return py; }); };
  // place the columns left to right; each block lines up with what feeds it where it can
  const yOf = {};   // port y per segment end
  cols.forEach((c, L) => {
    let bottom = Infinity;
    for (const p of c) {
      let top;
      if (p.left.length && L > 0) { const ys = p.left.map(sg => yOf[sg.e.i + ':' + sg.from + '>R']), off = portYs(p, p.left, 0); top = ys.reduce((a, y, k) => a + (y - off[k]), 0) / ys.length; }
      else top = bottom === Infinity ? 0 : bottom - VGAP;
      if (bottom !== Infinity) top = Math.min(top, bottom - VGAP);
      p.top = top; bottom = top - p.h;
      let ly = portYs(p, p.left, top);
      // a block fed by several cables takes each one level with where it comes from, when there is room on its side
      if (!p.dummy && p.left.length > 1 && L > 0) {
        const want = p.left.map(sg => yOf[sg.e.i + ':' + sg.from + '>R']), hi = top - 2, lo = top - p.h + 2, out2 = [];
        want.forEach((y, k) => { out2.push(Math.min(y, hi, k ? out2[k - 1] - 3.5 : Infinity)); });
        if (out2[out2.length - 1] >= lo - 1e-6) ly = out2;
      }
      const ry = p.dummy ? ly : portYs(p, p.right, top, 'R');
      p.left.forEach((sg, k) => { yOf[sg.e.i + ':' + sg.to + '>L'] = ly[k]; }); p.right.forEach((sg, k) => { yOf[sg.e.i + ':' + sg.from + '>R'] = p.dummy ? ly[0] : ry[k]; });
    }
  });
  const colX = []; { let x = 0; cols.forEach((c, L) => { colX[L] = x; const gs = segs.filter(sg => pts[sg.from].layer === L); const lanes = gs.filter(sg => Math.abs(yOf[sg.e.i + ':' + sg.from + '>R'] - yOf[sg.e.i + ':' + sg.to + '>L']) > 1e-6).length; x += BW + Math.max(40, ...gs.map(labW)) + 10 + lanes * 3.5; }); }
  // blocks
  for (const p of Object.values(pts)) if (!p.dummy) block(prims, colX[p.layer], p.top, BW, p.h, blockLines(p), p.node);
  // cables: in each gap, out of the source port, along its label, then its own lane down/up to the target port
  const draw = (pts2, c) => { const col = BSTYLE.ng ? ngCableColour(c) : 0; for (let k = 1; k < pts2.length; k++) { const [x1, y1] = pts2[k - 1], [x2, y2] = pts2[k]; if (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9) continue; if (col === 82) dashedSeg(prims, x1, y1, x2, y2, col); else prims.push({ ...L(x1, y1, x2, y2, 'BCD-CABLE'), colour: col }); } };
  cols.forEach((c, Lr) => {
    const gs = segs.filter(sg => pts[sg.from].layer === Lr); if (!gs.length) return;
    const xl = colX[Lr] + BW, xr = colX[Lr + 1], labRoom = Math.max(...gs.map(labW), 40);
    const S = gs.map(sg => ({ sg, a: yOf[sg.e.i + ':' + sg.from + '>R'], b: yOf[sg.e.i + ':' + sg.to + '>L'] }));
    const downs = S.filter(q => q.b < q.a - 1e-6).sort((p, q) => p.a - q.a), ups = S.filter(q => q.b > q.a + 1e-6).sort((p, q) => q.a - p.a);
    const lane0 = xl + labRoom + 5; [...downs, ...ups].forEach((q, k) => { q.lx = lane0 + k * 3.5; });
    for (const q of S) {
      const fromDummy = pts[q.sg.from].dummy, toDummy = pts[q.sg.to].dummy, x0 = fromDummy ? colX[Lr] : xl, x1 = xr;
      draw(q.lx ? [[x0, q.a], [q.lx, q.a], [q.lx, q.b], [x1, q.b]] : [[x0, q.a], [x1, q.b]], q.sg.e.c);
      if (q.sg.first) {   // the cable's text, once, on its first run out of the source
        const c = q.sg.e.c, w = labRoom - 2, tl = wrap(txt(c), w), nl = note(c) ? wrap(note(c), w) : [];
        prims.push({ t: 'mtext', x: xl + 2, y: q.a + 1 + tl.length * LINE, w, h: TH, text: tl.join('\n'), attach: 1, layer: 'BCD-TEXT', ...(BSTYLE.ng ? { colour: 5 } : {}) });
        if (nl.length) prims.push({ t: 'mtext', x: xl + 2, y: q.a - 1, w, h: TH, text: nl.join('\n'), attach: 1, layer: 'BCD-TEXT' });
        boxes.push({ no: String(c.no || ''), x0: xl + 1, y0: q.a - 1 - nl.length * LINE, x1: xl + 1 + w, y1: q.a + 1 + tl.length * LINE });
      }
    }
  });
  // the legend, as on the National Grid template, right of the last column
  // the legend (key) goes in the notes column under the notes, as on the National Grid drawings
  if (BSTYLE.ng) { const used = new Set(cables.map(ngCableColour)), st = new Set([...nodes.values()].map(nd => NG[String(nd.status || 'energised').toLowerCase()] || 3));
    spec.ngLegend = [...(used.has(82) ? [['dash82', 'EXISTING BY OTHERS']] : []), ...(used.has(1) ? [['line1', 'NEW BY BGEN']] : []), ...(used.has(5) ? [['line5', 'CURRENT SUPPLY CABLING']] : []), ...(st.has(3) ? [['fill3', 'ENERGISED']] : []), ...(st.has(1) ? [['fill1', 'DE-ENERGISED / NEW']] : [])]; }
  if (opts.diff) for (const b of boxes) if (opts.diff.added.includes(b.no) || opts.diff.changed.includes(b.no)) revCloud(prims, b, spec.revision);
  const clash = cableClashes(prims); if (clash.length && !process.env.AMO_NOCLASH) throw new Error('BCD layout has cables that overlap or cross (' + clash.slice(0, 3).join('; ') + '). Not saved.');
  const bb = primsBounds(prims); if (process.env.AMO_DBG) console.error('power bcd size', Math.round(bb.x1 - bb.x0), Math.round(bb.y1 - bb.y0)); const key = opts.border && opts.border.geo ? opts.border : (String(opts.border || 'atomax'));
  let B = opts.noTitle ? null : borderOf(key, bb.x1 - bb.x0, bb.y1 - bb.y0);
  if (B && !(opts.border && opts.border.geo) && !/-A\d$/.test(key) && FAMILY[`${B.company}-A0`]) for (const sz of SIZES) { const C = FAMILY[`${B.company}-${sz}`]; if (C && placeIn(C, prims, bb) && notesFit(C, spec)) { B = C; break; } }
  const f = frame(prims, spec, bb.y0 - 4, bb.y1, bb.x1, '', { fixed: true, noTitle: !!opts.noTitle, border: B, fill: { ...(opts.fill || {}), sht: '1', shtx: '1' } });
  return { prims, bounds: f.bounds, content: f.content, sheet: f.sheet, page: f.page, border: f.border, label: '', boxes, cables: cables.map(c => String(c.no || '')) };
}
function dashedSeg(prims, x1, y1, x2, y2, colour) { const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len; for (let d = 0; d < len; d += 4.5) { const e = Math.min(len, d + 3); prims.push({ ...L(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e, 'BCD-CABLE'), colour }); } }
// revision clouds round the cable boxes that changed, with the revision triangle beside them
function revCloud(prims, b, rev) {
  const pad = 2, x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad, r = 2;
  const edge = (ax, ay, bx, by) => { const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / (2 * r))); const ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI; for (let i = 0; i < n; i++) { const cx = ax + (bx - ax) * (i + 0.5) / n, cy = ay + (by - ay) * (i + 0.5) / n; prims.push({ t: 'arc', x: cx, y: cy, r: len / n / 2, a0: ang, a1: ang + 180, layer: 'BCD-REVISION' }); } };
  edge(x0, y0, x1, y0); edge(x1, y0, x1, y1); edge(x1, y1, x0, y1); edge(x0, y1, x0, y0);
  const tx = x1 + 4, ty = y1;
  prims.push(P([[tx, ty - 3], [tx + 7, ty - 3], [tx + 3.5, ty + 3]], true, 'BCD-REVISION'));
  prims.push({ t: 'mtext', x: tx + 3.5, y: ty - 1, w: 8, h: TH, text: String(rev || '').replace(/^[A-Z]0*/, '') || '1', attach: 5, layer: 'BCD-REVISION' });
}
// what changed between two BCD specs, by cable number
function bcdDiff(oldSpec, newSpec) {
  const key = (c) => [c.from, c.to, c.type, c.cores, c.size].map(v => String(v || '').trim().toUpperCase()).join('|');
  const o = new Map((oldSpec.cables || []).map(c => [String(c.no || ''), c])), n = new Map((newSpec.cables || []).map(c => [String(c.no || ''), c]));
  const added = [...n.keys()].filter(k => !o.has(k)), removed = [...o.keys()].filter(k => !n.has(k)), changed = [...n.keys()].filter(k => o.has(k) && key(o.get(k)) !== key(n.get(k)));
  return { added, removed, changed };
}

// ---------- DXF writer (R2010, appended to a template made with ezdxf) ----------
const ATOMAX_TPL = path.join(__dirname, 'cad', 'atomax-template.dxf');
const TEMPLATE = () => fs.readFileSync(fs.existsSync(ATOMAX_TPL) ? ATOMAX_TPL : path.join(__dirname, 'dxf-template-r2010.dxf'), 'utf8');
const n = (v) => (Math.round(v * 1000) / 1000).toString();
const LAYERS = [['SLD-BUS', 1], ['SLD-CABLE', 3], ['SLD-SYMBOL', 7], ['SLD-TEXT', 7], ['SLD-BORDER', 8], ['SLD-NOTES', 30], ['SLD-ENCLOSURE', 8], ['BCD-BLOCK', 7], ['BCD-CABLE', 7], ['BCD-CABLEBOX', 2], ['BCD-TEXT', 7], ['BCD-REVISION', 1]];
// add any of our layers the template does not have (so a client's own title block DXF can be the template)
function ensureLayers(tpl, h0) {
  let h = h0; const tab = tpl.match(/\n\s*0\nTABLE\n\s*2\nLAYER\n\s*5\n([0-9A-Fa-f]+)\n[\s\S]*?\n\s*0\nENDTAB\n/); if (!tab) return { tpl, h };
  const body = tab[0], owner = tab[1], ref390 = (body.match(/\n390\n([0-9A-Fa-f]+)/) || [])[1], ref347 = (body.match(/\n347\n([0-9A-Fa-f]+)/) || [])[1];
  const have = new Set([...body.matchAll(/AcDbLayerTableRecord\n\s*2\n([^\n]+)/g)].map(m => m[1].trim().toUpperCase()));
  const add = LAYERS.filter(([n]) => !have.has(n)).map(([n, col]) => ['  0', 'LAYER', '  5', (h++).toString(16).toUpperCase(), '330', owner, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord', '  2', n, ' 70', '0', ' 62', String(col), '  6', 'Continuous', '370', '-3', ...(ref390 ? ['390', ref390] : []), ...(ref347 ? ['347', ref347] : [])].join('\n')).join('\n');
  if (!add) return { tpl, h };
  return { tpl: tpl.replace(body, body.replace(/\n(\s*0\nENDTAB\n)$/, '\n' + add + '\n$1')), h };
}
// the client's title block: fill {TITLE} {DWGNO} {REV} {DATE} {SHEET} placeholders and ATTRIBs tagged TITLE / DWG_NO / DRAWING_NO / REV / DATE / SHEET
function fillTitleBlock(tpl, f) {
  const val = { TITLE: f.title, DWGNO: f.drawingNumber, DWG_NO: f.drawingNumber, DRAWING_NO: f.drawingNumber, DRGNO: f.drawingNumber, REV: f.revision, REVISION: f.revision, DATE: f.date, SHEET: f.sheet, DRAWN: f.drawn };
  tpl = tpl.replace(/\{(TITLE|DWGNO|DWG_NO|REV|DATE|SHEET|DRAWN)\}/g, (_m, k) => String(val[k] ?? ''));
  return tpl.replace(/(\n\s*0\nATTRIB\n[\s\S]*?\n\s*1\n)([^\n]*)(\n[\s\S]*?\n\s*2\n)([^\n]+)/g, (m, a, oldv, b, tag) => { const k = tag.trim().toUpperCase(); return k in val && val[k] != null ? a + val[k] + b + tag : m; });
}
function templateExtents(tpl) {
  const g = (k) => { const m = tpl.match(new RegExp('\\$' + k + '\\n\\s*10\\n([^\\n]+)\\n\\s*20\\n([^\\n]+)')); return m ? [parseFloat(m[1]), parseFloat(m[2])] : null; };
  const a = g('EXTMIN'), b = g('EXTMAX'); return a && b && b[0] > a[0] && b[1] > a[1] && b[0] - a[0] < 1e5 ? { x0: a[0], y0: a[1], x1: b[0], y1: b[1] } : null;
}
function writeDxf(prims, bounds, opts = {}) {
  let tpl = (opts.template ? fs.readFileSync(opts.template, 'utf8') : TEMPLATE()).replace(/\r\n/g, '\n');
  if (opts.template && opts.fill) tpl = fillTitleBlock(tpl, opts.fill);
  const seedM = tpl.match(/\$HANDSEED\n\s*5\n([0-9A-Fa-f]+)\n/);
  let h = parseInt(seedM ? seedM[1] : '1000', 16) + 16;
  ({ tpl, h } = ensureLayers(tpl, h));
  const OWNER = (tpl.match(/BLOCK_RECORD\n\s*5\n([0-9A-Fa-f]+)\n(?:(?!\n\s*0\n)[\s\S])*?\n\s*2\n\*Model_Space\n/) || [])[1] || '17';
  const out = [];
  const g = (code, val) => out.push(String(code).padStart(3, ' '), String(val));
  let colour = 0; const head = (type, layer) => { g(0, type); g(5, (h++).toString(16).toUpperCase()); g(330, OWNER); g(100, 'AcDbEntity'); g(8, layer || '0'); if (colour) g(62, colour); };
  const uni = (s) => String(s).replace(/[^\x00-\x7F]/g, (c) => '\\U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));   // ², °, Ω ... as AutoCAD's own unicode escape
  const clean = (s) => uni(String(s).replace(/[\r\n]+/g, ' '));
  const blocks = new Set([...tpl.matchAll(/\n\s*0\nBLOCK\n[\s\S]*?\n\s*2\n([^\n]+)\n/g)].map(m => m[1].trim()));
  const list = []; const add = (p) => { if (p.t === 'insert' && !blocks.has(p.name)) flatPrims([p]).forEach(add); else list.push(p); }; prims.forEach(add);
  for (const p of list) {
    colour = p.colour || 0;
    if (p.t === 'insert') { head('INSERT', p.layer); g(100, 'AcDbBlockReference'); g(2, p.name); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); if ((p.k || 1) !== 1) { g(41, n(p.k)); g(42, n(p.k)); g(43, n(p.k)); } }
    else if (p.t === 'line') { head('LINE', p.layer); g(100, 'AcDbLine'); g(10, n(p.x1)); g(20, n(p.y1)); g(30, 0); g(11, n(p.x2)); g(21, n(p.y2)); g(31, 0); }
    else if (p.t === 'circle') { head('CIRCLE', p.layer); g(100, 'AcDbCircle'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.r)); }
    else if (p.t === 'arc') { head('ARC', p.layer); g(100, 'AcDbCircle'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.r)); g(100, 'AcDbArc'); g(50, n(p.a0)); g(51, n(p.a1)); }
    else if (p.t === 'pline') { head('LWPOLYLINE', p.layer); g(100, 'AcDbPolyline'); g(90, p.pts.length); g(70, p.closed ? 1 : 0); if (p.width) g(43, n(p.width)); for (const [x, y] of p.pts) { g(10, n(x)); g(20, n(y)); } }
    else if (p.t === 'text') { head('TEXT', p.layer); g(100, 'AcDbText'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.h)); g(1, clean(p.text)); if (p.rot) g(50, n(p.rot)); g(41, n(p.wf || HOUSE_WF)); g(7, HOUSE_STYLE); if (p.align === 'center') { g(72, 1); g(11, n(p.x)); g(21, n(p.y)); g(31, 0); } g(100, 'AcDbText'); }
    else if (p.t === 'fill' && p.pts && p.pts.length > 2) { head('HATCH', p.layer); g(100, 'AcDbHatch'); g(10, 0); g(20, 0); g(30, 0); g(210, 0); g(220, 0); g(230, 1); g(2, 'SOLID'); g(70, 1); g(71, 0); const rings = p.rings || [p.pts]; g(91, rings.length); for (const r of rings) { g(92, 2); g(72, 0); g(73, 1); g(93, r.length); for (const [x, y] of r) { g(10, n(x)); g(20, n(y)); } g(97, 0); } g(75, 0); g(76, 1); g(98, 0); }
    else if (p.t === 'mtext') { head('MTEXT', p.layer); g(100, 'AcDbMText'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.h)); g(41, n(p.w)); g(71, p.attach || 1); g(72, 5); g(1, ((p.wf || HOUSE_WF) !== 1 ? `\\W${p.wf || HOUSE_WF};` : '') + uni(String(p.text)).replace(/\r?\n/g, '\\P')); g(7, HOUSE_STYLE); }
  }
  tpl = tpl.replace(/(\n\s*0\nSECTION\n\s*2\nENTITIES\n)(\s*0\nENDSEC\n)/, (_m, a, b) => a + out.join('\n') + '\n' + b);
  tpl = tpl.replace(/(\$HANDSEED\n\s*5\n)[0-9A-Fa-f]+\n/, (_m, a) => a + (h + 16).toString(16).toUpperCase() + '\n');
  if (bounds && !opts.template) {   // so the drawing opens zoomed to the content
    tpl = tpl.replace(/(\$EXTMIN\n\s*10\n)[^\n]+(\n\s*20\n)[^\n]+/, (_m, a, b) => a + n(bounds.x0) + b + n(bounds.y0));
    tpl = tpl.replace(/(\$EXTMAX\n\s*10\n)[^\n]+(\n\s*20\n)[^\n]+/, (_m, a, b) => a + n(bounds.x1) + b + n(bounds.y1));
  }
  return tpl.replace(/\n/g, '\r\n');
}

// ---------- SVG preview for the panel ----------
function toSvg(prims, b) {
  prims = flatPrims(prims);
  const W = b.x1 - b.x0, H = b.y1 - b.y0, Y = (y) => n(b.y1 - y), X = (x) => n(x - b.x0);
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const col = (layer) => ({ 'SLD-BUS': '#e03131', 'SLD-CABLE': '#2f9e44', 'SLD-BORDER': '#868e96', 'SLD-NOTES': '#e67700' })[layer] || '#1b2a41';
  const parts = prims.map(p => {
    if (p.t === 'line') return `<line x1="${X(p.x1)}" y1="${Y(p.y1)}" x2="${X(p.x2)}" y2="${Y(p.y2)}" stroke="${col(p.layer)}" stroke-width="0.35"/>`;
    if (p.t === 'circle') return `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r}" fill="none" stroke="${col(p.layer)}" stroke-width="0.35"/>`;
    if (p.t === 'arc') { const a0 = p.a0 * Math.PI / 180, a1 = p.a1 * Math.PI / 180; return `<path d="M${X(p.x + p.r * Math.cos(a0))} ${Y(p.y + p.r * Math.sin(a0))} A${p.r} ${p.r} 0 0 0 ${X(p.x + p.r * Math.cos(a1))} ${Y(p.y + p.r * Math.sin(a1))}" fill="none" stroke="${col(p.layer)}" stroke-width="0.35"/>`; }
    if (p.t === 'pline') return `<polyline points="${p.pts.map(([x, y]) => X(x) + ',' + Y(y)).join(' ')}${p.closed ? ' ' + X(p.pts[0][0]) + ',' + Y(p.pts[0][1]) : ''}" fill="none" stroke="${col(p.layer)}" stroke-width="${p.width || 0.35}"/>`;
    if (p.t === 'text') { const tf = [p.rot ? `rotate(${-p.rot} ${X(p.x)} ${Y(p.y)})` : '', `translate(${X(p.x)} ${Y(p.y)}) scale(${p.wf || HOUSE_WF} 1) translate(${-X(p.x)} ${-Y(p.y)})`].filter(Boolean).join(' '); return `<text ${tf ? `transform="${tf}" ` : ''}x="${X(p.x)}" y="${Y(p.y)}" font-size="${(p.h / 0.774).toFixed(2)}" text-anchor="${p.align === 'center' ? 'middle' : 'start'}" font-family="Arial">${esc(p.text)}</text>`; }
    if (p.t === 'fill') return `<path fill-rule="evenodd" d="${(p.rings || [p.pts]).map(r => 'M' + r.map(([x, y]) => X(x) + ' ' + Y(y)).join(' L') + ' Z').join(' ')}" fill="${p.colour === 3 ? '#40c057' : p.colour === 1 ? '#fa5252' : '#495057'}" stroke="none"/>`;
    if (p.t === 'mtext') { const ls = String(p.text).split('\n'), mid = p.attach === 5 || p.attach === 6 || p.attach === 4; const y0 = mid ? p.y + (ls.length - 1) * LINE / 2 - p.h / 2 : p.y - p.h; return `<text transform="translate(${X(p.x)} 0) scale(${p.wf || HOUSE_WF} 1) translate(${-X(p.x)} 0)" font-size="${(p.h / 0.774).toFixed(2)}" font-family="Arial" fill="${col(p.layer)}" text-anchor="${(((p.attach || 1) - 1) % 3) === 1 ? 'middle' : (((p.attach || 1) - 1) % 3) === 2 ? 'end' : 'start'}">${ls.map((l, i) => `<tspan x="${X(p.x)}" y="${Y(y0 - i * LINE)}">${esc(l)}</tspan>`).join('')}</text>`; }
    return '';
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" style="background:#fff">${parts.join('')}</svg>`;
}

// ---------- the Claude side ----------
const SYSTEM = `You are Dex, the DXF maker in the Atomax-UK drawing room. You turn an engineer's request plus the project's files into a drawing spec. The app lays the drawing out and writes the DXF, so you never give coordinates.

You can make two kinds of drawing, both described the same way:
- "sld": single line diagrams.
- "earthing": earthing schematics / earthing design drawings. The "board" is the main earth bar (MET) or an earth bar, its feeders are the earth conductors and bonds (use "cable" for the conductor, labelled with its size and type) ending at what they earth: the equipment ("board", e.g. transformer, inverter, BESS, switchgear, fence), an earth rod ("electrode") or the earth mesh ("grid"); use "link" for disconnecting / test links. Put fault levels and earth fault currents from the documents in the notes. Conductor sizes come from the documents or the engineer; if they are not given, write TBC and say in the notes that they need sizing against the earth fault current (adiabatic check) and that soil resistivity is needed for the electrode / mesh design.
Describe them as boards (busbars), joined into ONE connected diagram: when a feeder supplies another board (e.g. MV SWB > CBL-2 > RMU-WTG2, or a transformer feeding an LV board), put that board as the LAST item of the feeder's chain as {"board": {"label": "...", "feeders": [...]}}; it is drawn underneath, joined by the feeder. Only boards with nothing above them are top-level boards. Do not repeat a name: the feeder "label" is only for something the end item does not already say (leave it out otherwise).
In earthing drawings, nest earth bars the same way: the cable screen or earth conductor feeding another substation's earth bar ends with {"board": {...}}. If an engineer's technical note in the project files gives conductor sizes or electrode design, use those values (say "per <note name>" in the notes); otherwise sizes stay TBC. Each board has incomers (chains drawn above the busbar, ending on it) and feeders (chains drawn below it). A chain is a list of items from top to bottom, each { "symbol": one of supply, generator, transformer, breaker, isolator, switchfuse, fuse, contactor, ct, meter, ups, vsd (variable speed drive), dol (DOL starter), softstarter, cable, line, link, and as the LAST item of a feeder only: board, load, motor, earth, electrode, grid, spare, spd (surge protection device), pfc (power factor correction); "label": the text beside it }. Every spare way is shown on its board (a breaker, then a spare item labelled SPARE - EQUIPPED, OFF & LOCKED, with the breaker rating if given), even when its schedule row is struck through or someone says to ignore it; never write a note saying a spare is not shown. Each source is its own incomer: the transformer feed is one incomer chain and the standby generator another, never one chain running through both. An SLD shows the power circuits only: control and instrument cables (local control stations, transmitters, e-stops, pair cables) are not drawn on it, they are on the BCD. A drive or starter is always its own item in the way (breaker, then vsd / dol / softstarter, then the isolator, then the motor), never just words in another item's label.
National Grid / BGEN SLD conventions (use them on every SLD): put the cable on the conductor as a "cable" item whose label is the cable text (e.g. "EXISTING CABLE" or "C01\\n4C 240mm² SWA"); it is drawn as a tag box with the text up the box. Give switching devices a "state" of "open" or "closed" when the drawing shows a switching arrangement or phase (drawn as "(OPEN)" / "(CLOSED)"). Only on a PHASE drawing (the works split into phases, one sheet per phase): give "phase": 1, 2, ... and give items a "status" of "new" (drawn green) or "removal" (drawn red) for what is new or removed AT THAT PHASE; everything else is existing (black, no status). The next phase's sheet is its own drawing with its own statuses (what was green in phase 1 is existing black in phase 2). Not a phase drawing: no status at all, everything is black. A board in a switchroom, kiosk or generator enclosure gets "enclosure": "EXISTING LVAC SWITCHROOM" (drawn as a dashed box named above it).
Labels: short, exactly as an engineer would write them, using what the project files say (ratings, cable sizes, tags, board names). An unknown value is just TBC: never "SEE TQ" or an RFI number in a label (questions go in "queries"). Every cable on the schedule between items on the drawing is drawn as a cable, including earthing / neutral-earth conductors such as a transformer star point to the main earth bar: never put a cable only in a note. Give "enclosure" (the room name exactly as the equipment list writes it, e.g. "LV SWITCHROOM") to the main board AND to every board fed from it that is in the same room (an MCC, DBs): the app draws one room box round them all, with what feeds them from another place (transformer compound, generator enclosure, DNO) outside and the cables to other places crossing its wall. Earthing: an earth conductor (e.g. transformer star point to the main earth bar, main earth bar to the MET) is a feeder whose chain is just the cable then an "earth" item; the app hangs it off the board's own EARTH BAR, never the phase busbar. Write prospective fault current as "PROSPECTIVE FAULT 31.5kA" (never "PFC", which is power factor correction) and frequencies as 50Hz. Use a new line (\\n) between parts of a label, e.g. "Q1\\n630A TP MCCB". Do not invent ratings, cable sizes or tags that are not in the request or the files: if one is unknown write "TBC" in the label and list it in "notes".
BCD ("bcd", block cable diagram): do NOT use boards. A spare on the schedule (a spare cable, or a spare way with a cable number) is drawn like any other cable, to its own device box (tag SPARE-1, SPARE-2 ..., label SPARE WAY plus its rating), even when its row is struck through or someone says to ignore it; never write a note saying a spare is not shown. Give "nodes" (every panel / RIO / MCC, junction box and field device, with "type" panel|rio|mcc|jb|device and a short "label" description exactly as written; the node "tag" is the equipment tag exactly as printed in the documents, and where a document gives only a description (no tag), use that description as the tag: never make up a tag) and "cables" (every cable: "no" exactly as printed, "from" and "to" node tags, "type" e.g. BS5308 / SWA / CY, "cores" e.g. 4C, or 2PR for pairs (power BCDs write pairs as PR, never P; an abbreviations note says "PR - PAIR"), "size" e.g. 0.5 or 1.5mm², "length" in metres exactly as the schedule gives it (number only, e.g. "55"; leave it out only when no document gives lengths), and "note" for interface cables such as "LINK TO X03-MCC SEE DWG ..."). Give every node its "location" exactly as the equipment list / schedule writes it (e.g. "HV Room", "Pump Hall", "Wet Well"): the app draws a dashed area box for each location. Anything the email or documents say is by others or outside our scope (e.g. DNO / ICP equipment and cables) gets "byOthers": true on the node and the cable: the app draws it outside the scope boundary. When the job context has an APPROVED MASTER DEVICE LIST, the BCD is exactly its cables and devices for the panels asked for: nothing added, nothing left out. The app lays the blocks out (panels left, JBs middle, devices right), draws each cable with its yellow cable box and splits long BCDs over sheets. For National Grid LVAC / power block diagrams (a supply chain: intake / RMU > joints > transformer > LV board > circuits, generators > distribution units) the app draws the chain left to right with every cable joined to both ends; also give "style":"ng", each node a "status" (energised, de-energised or new) and each cable a "status" (current = current supply cabling, new = new by BGEN, existing = existing by others).
If something essential is missing (which boards, how many feeders, what the supply is) and the files do not say, ask: reply with {"questions": ["...", "..."]} (max 4 short questions) and nothing else.
Otherwise reply with JSON only, no markdown:
{"kind":"sld, earthing or bcd","title":"...","drawingNumber":"... or TBC","revision":"P01","nodes":[only for bcd],"cables":[only for bcd],"boards":[{"label":"MAIN LV BOARD\\n400V 3PH 4W 50Hz","incomers":[{"label":"optional text above","chain":[...]}],"feeders":[{"label":"optional text under the feeder","chain":[...]}]}],"references":["every CLIENT / project document this drawing was made from or refers to, one short line each: NUMBER - SHORT TITLE, no revision or detail (e.g. X021126-01-SCH-0001 - CABLE SCHEDULE); never internal lists such as the master device list"],"client":"the client company exactly as its email signature or letterhead writes it, in full including Ltd / Limited / plc (e.g. PEAKDALE WATER SERVICES LTD)","notes":["note text only, no numbers in front (the border numbers them). The drawing is issued to the CLIENT: notes are short statements of fact the client needs (what is shown, scope and by-others items, standards, what lengths / sizes are based on, abbreviations). NEVER in notes: questions or anything to confirm, TQ / RFI items, how you worked something out or why you drew it a certain way, internal sources (the master device list, Dex, the app, counts of devices / cables), lists of title block fields that are TBC, who drafted it"],"_abbr":"(no key) never write an abbreviations note: Atomax drawings do not carry one","queries":["every open question, assumption to confirm or gap for the client, one per line: these go to the job's RFI register, never on the drawing"],"summary":"one line for the engineer: what you drew and what is TBC"}`;

// Claude's JSON is not always strict: real line breaks inside strings (a multi-line reply), a trailing comma, or a reply cut off at the length limit.
// Repair those, then parse.
function repairJson(raw) {
  let s = String(raw || '').replace(/^\uFEFF/, '');
  const a = s.indexOf('{'); if (a < 0) throw new Error('no JSON in the reply');
  s = s.slice(a);
  let out = '', inStr = false, esc = false; const stack = [];
  const lastSig = () => { for (let k = out.length - 1; k >= 0; k--) if (!/\s/.test(out[k])) return out[k]; return ''; };
  const nextSig = (i) => { for (let k = i + 1; k < s.length; k++) if (!/\s/.test(s[k])) return s[k]; return ''; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') {
        // a quote inside a label (e.g. Q1 "CLOSED") is part of the text; only a quote followed by , : } ] (or the end) closes the string
        const n = nextSig(i);
        let closes = n === '' || ',:}]'.includes(n);
        if (n === '"') { const j = s.indexOf('"', i + 1), after = nextSig(j); closes = !(after === '' || ',:}]'.includes(after)); }   // ""} : the first quote is text, the second closes; "a" "b" : a missing comma
        if (closes) { inStr = false; out += ch; } else out += '\\"';
        continue;
      }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      if (ch < ' ') continue;
      out += ch; continue;
    }
    // a missing comma between two items ("a" "b", } {, ] [ ...)
    if (/["{\[0-9tfn-]/.test(ch) && /["}\]0-9el]/.test(lastSig()) && !(/[0-9el]/.test(lastSig()) && /[0-9.eE+-]/.test(ch) && /[0-9.eE+-]$/.test(out))) out += ',';
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') { stack.pop(); out += ch; if (!stack.length) break; continue; }
    out += ch;
  }
  if (inStr) out += '"';                                   // cut off inside a string
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  while (stack.length) out += stack.pop();                 // cut off: close what is open
  out = out.replace(/,(\s*[}\]])/g, '$1');                 // trailing commas
  return JSON.parse(out);
}
function parseReply(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return repairJson(s);
}

// move / scale primitives (placing a drawing inside a client's title block)
function place(prims, dx, dy, k = 1) {
  const X = (x) => x * k + dx, Y = (y) => y * k + dy;
  return prims.map(p => p.t === 'insert' ? { ...p, x: X(p.x), y: Y(p.y), k: (p.k || 1) * k } : p.t === 'line' ? { ...p, x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2) } : p.pts ? { ...p, pts: p.pts.map(([x, y]) => [X(x), Y(y)]), ...(p.rings ? { rings: p.rings.map(r => r.map(([x, y]) => [X(x), Y(y)])) } : {}), ...(p.width ? { width: p.width * k } : {}) } : p.t === 'text' || p.t === 'mtext' ? { ...p, x: X(p.x), y: Y(p.y), w: p.w ? p.w * k : p.w, h: p.h * k }   /* text shrinks with the drawing: kept at 2 it ran into the next label */ : { ...p, x: X(p.x), y: Y(p.y), r: p.r * k });
}
// block inserts expanded to plain geometry (for previews, PDFs and measuring)
function flatPrims(prims) { const out = []; for (const p of prims) { if (p.t === 'insert') out.push(...flatPrims(place(p.prims.map(q => ({ ...q, layer: q.layer || p.layer })), p.x, p.y, p.k || 1))); else out.push(p); } return out; }
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60);
// older versions of a drawing (any revision, any earlier naming) move into an Archive folder beside it before the new one is written,
// so the folder only ever holds the current revision. Nothing is deleted: a name already in the archive gets a time stamp.
const ARCHIVE_EXT = /\.(dxf|pdf|spec\.json|svg)$/i;
// an older copy of the SAME revision (made again before issue) is archived as _SUPERSEDED, so there are never two different P01s side by side
function archiveOld(outDir, prefix, rev = '') {
  if (!prefix) return [];
  const moved = [], arch = path.join(outDir, 'Archive');
  let list = []; try { list = fs.readdirSync(outDir); } catch { return moved; }
  for (const f of list) {
    const full = path.join(outDir, f);
    if (!f.toUpperCase().startsWith(prefix.toUpperCase()) || !/^[_. ]/.test(f.slice(prefix.length)) || !ARCHIVE_EXT.test(f)) continue;   // this drawing only (not -00011)
    try { if (!fs.statSync(full).isFile()) continue; } catch { continue; }
    fs.mkdirSync(arch, { recursive: true });
    const m0 = f.match(ARCHIVE_EXT), same = rev && new RegExp('_' + rev + '(?![0-9])', 'i').test(f.slice(0, m0.index));
    const stamp0 = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    let dst = path.join(arch, same ? f.slice(0, m0.index) + '_SUPERSEDED_' + stamp0 + m0[0] : f);
    if (fs.existsSync(dst)) { const m = f.match(ARCHIVE_EXT), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-'); dst = path.join(arch, f.slice(0, m.index) + '_' + stamp + m[0]); }
    try { fs.renameSync(full, dst); moved.push(dst); } catch {}
  }
  return moved;
}
const uniquePath = (dir, stem, ext) => { let f = path.join(dir, stem + ext), i = 2; while (fs.existsSync(f)) f = path.join(dir, `${stem}_${i++}${ext}`); return f; };

// spec -> files on disk; returns paths and a preview. opts: { template: client title block DXF, previous: { spec } for a new revision }
// the words in the revision box for a revision: P = preliminary, A = issued for comment, C = issued for construction, X = as built
function stageWords(rev, later = false) {
  const L = String(rev || 'P').toUpperCase()[0];
  return L === 'A' ? 'ISSUED FOR COMMENT' : L === 'C' ? 'ISSUED FOR\nCONSTRUCTION' : L === 'X' ? 'AS BUILT' : later ? 'PRELIMINARY\nREVISED' : 'PRELIMINARY\nFOR CHECKING';
}
function make(spec, outDir, baseName, opts = {}) {
  delete spec._used; delete spec._warnings;   // worked out fresh each time
  if (spec.revision) spec.revision = String(spec.revision).toUpperCase().replace(/^([A-Z])(\d)$/, '$10$2');   // Atomax revisions are two digits: P01
  (spec.revHistory || []).forEach(r => { if (r.rev) r.rev = String(r.rev).toUpperCase().replace(/^([A-Z])(\d)$/, '$10$2'); });
  fs.mkdirSync(outDir, { recursive: true });
  const stem = safeName(baseName || spec.drawingNumber || spec.title || 'SLD');
  // a drawing with its real number is saved as NUMBER_REV (e.g. X021126-01-70-0001_P02), the older versions moved to Archive first
  const archived = opts.exact ? archiveOld(outDir, opts.archivePrefix || stem, spec.revision) : [];
  // a new revision: what changed against the previous spec, the history carried on, clouds round changed cable boxes (BCDs)
  let diff = null;
  if (opts.previous && opts.previous.spec) {
    const old = opts.previous.spec;
    diff = spec.kind === 'bcd' ? bcdDiff(old, spec) : null;
    const said = diff ? [diff.added.length ? 'added ' + diff.added.join(', ') : '', diff.removed.length ? 'removed ' + diff.removed.join(', ') : '', diff.changed.length ? 'changed ' + diff.changed.join(', ') : ''].filter(Boolean).join('; ') : (spec.revisionNote || 'revised');
    // each row of the revision box keeps its own description, date and initials; what changed goes in the notes
    const op = old.people || {}, np = spec.people || {};
    const first = old.revHistory && old.revHistory.length ? old.revHistory : [{ rev: old.revision || 'P01', what: stageWords(old.revision || 'P01'), date: op.date || '', by: op.drawn || '', checked: op.checked || '', approved: op.approved || '' }];
    spec.revHistory = [...first.filter(r => r.rev !== spec.revision), { rev: spec.revision, what: spec.revisionDesc || stageWords(spec.revision, true), date: np.date || '', by: np.drawn || '', checked: np.checked || '', approved: np.approved || '' }];
    const why = [spec.revisionNote, said].filter(Boolean).join('. ');
    if (why) spec.notes = [...(spec.notes || []), `${spec.revision}: ${why}`];
  }
  const sheets = spec.kind === 'bcd' ? layoutBcd(spec, { noTitle: !!opts.template, diff, fill: opts.fill, border: opts.border }) : [(() => { const r = layoutSld(spec, { fill: opts.fill, border: opts.border }); return { ...r, label: '' }; })()];
  // every sheet framed in its border; a drawing of several sheets is ONE DXF (the sheets side by side in model space, 50mm apart)
  // and ONE PDF (a page per sheet)
  const framed = sheets.map((sh) => {
    let prims = sh.prims, bounds = sh.bounds;
    if (opts.template) {   // the client's own title block: our content scaled (never up) into the space left of / above it
      const tpl = fs.readFileSync(opts.template, 'utf8'), ext = templateExtents(tpl) || { x0: 0, y0: 0, x1: 420, y1: 297 };
      const c = sh.content || bounds, W = c.x1 - c.x0, H = c.y1 - c.y0, aw = (ext.x1 - ext.x0) * 0.78, ah = (ext.y1 - ext.y0) * 0.82;
      const k = Math.min(1, aw / W, ah / H);
      prims = place(prims, ext.x0 + 15 - c.x0 * k, ext.y1 - 15 - c.y1 * k, k); bounds = ext;
    }
    return { sh, prims, bounds, page: sh.page || (opts.template ? 'A3' : 'A1') };
  });
  let all = framed[0].prims, allB = framed[0].bounds;
  if (framed.length > 1) {
    all = []; let x = 0; const y0 = Math.min(...framed.map(f => f.bounds.y0));
    for (const f of framed) { const dx = x - f.bounds.x0, dy = y0 - f.bounds.y0; all.push(...place(f.prims, dx, dy)); x += (f.bounds.x1 - f.bounds.x0) + 50; }
    allB = { x0: 0, y0, x1: x - 50, y1: y0 + Math.max(...framed.map(f => f.bounds.y1 - f.bounds.y0)) };
  }
  const label = framed.length > 1 ? `${framed.length} SHEETS` : (framed[0].sh.label || '');
  const dxf = writeDxf(all, allB, { template: framed.length > 1 ? '' : opts.template, fill: { title: spec.title || '', drawingNumber: spec.drawingNumber || 'TBC', revision: spec.revision || 'P01', date: new Date().toISOString().slice(0, 10), sheet: label, drawn: (opts.fill && opts.fill.drawn) || '' } });
  const file = opts.exact ? path.join(outDir, `${stem}.dxf`) : uniquePath(outDir, `${stem}_DRAFT`, '.dxf');
  fs.writeFileSync(file, dxf, 'utf8');
  const files = [{ path: file, svg: toSvg(framed[0].prims, framed[0].bounds), entities: all.length, label, sheets: framed.length, cables: [...new Set(framed.flatMap(f => f.sh.cables || []))], prims: all, bounds: allB, pages: framed.map(f => ({ prims: f.prims, bounds: f.bounds, page: f.page })), page: framed[0].page, border: framed[0].sh.border || '' }];
  // the spec is kept next to the drawing so the next revision can be compared with it
  try { fs.writeFileSync(files[0].path.replace(/\.dxf$/i, '.spec.json'), JSON.stringify(spec, (k, v) => k === '_used' ? undefined : v, 1)); } catch {}
  return { path: files[0].path, svg: files[0].svg, entities: files.reduce((n, f) => n + f.entities, 0), files, diff, archived };
}
// the most recent spec saved for a drawing stem in a folder (for "new revision")
function previousSpec(outDir, baseName) {
  const stem = safeName(baseName).toUpperCase(), all = [];
  for (const dir of [outDir, path.join(outDir, 'Archive')]) { try { for (const f of fs.readdirSync(dir)) if (f.toUpperCase().startsWith(stem) && f.endsWith('.spec.json')) all.push({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }); } catch {} }
  const c = all.sort((a, b) => b.t - a.t)[0];
  try { return c ? { file: path.basename(c.f), spec: JSON.parse(fs.readFileSync(c.f, 'utf8')) } : null; } catch { return null; }
}

module.exports = { fromSchedule, cleanLabels, cleanLabel, noteLines, clientNotes, isInternalNote, notesFit, primsBounds, BORDER_NAMES, flatPrims, BORDERS, cableClashes, previousSpec, layoutBcd, bcdDiff, SYSTEM, ALIASES, SYMBOLS, symbolOf, layoutSld, writeDxf, toSvg, parseReply, make };
