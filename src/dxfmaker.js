// Dex's DXF maker: Claude describes a drawing (for now: single line diagrams) as boards, incomers and feeder chains, and this file lays it out
// and writes a real AutoCAD R2010 DXF. Layout is done here, not by Claude, so symbols are always joined, labels never overlap and text is height 2 (MTEXT for labels).
'use strict';
const fs = require('fs');
const path = require('path');

const TH = 2;            // standard text height (Tom's house rule: 2, never smaller)
const LINE = TH * 1.7;   // MTEXT line pitch at height 2
const FEED = 50;         // spacing between feeders on a busbar (house symbols carry an operating handle to the left)
const LABEL_W = 30;      // label width beside a symbol

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
  transformer: () => ({ len: 21, w: 5.5, prims: [L(0, 0, 0, -2), C(0, -7, 5), C(0, -14, 5), L(0, -19, 0, -21)] }),
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
};
const ALIASES = { mcb: 'breaker', mccb: 'breaker', acb: 'breaker', cb: 'breaker', vcb: 'breaker', rcbo: 'breaker', 'circuit breaker': 'breaker', switch: 'isolator', disconnector: 'isolator', 'switch disconnector': 'isolator', 'fuse switch': 'switchfuse', 'fused switch': 'switchfuse', tx: 'transformer', 'current transformer': 'ct', kwh: 'meter', 'distribution board': 'board', db: 'board', panel: 'board', mcc: 'board', dno: 'supply', incomer: 'supply', 'mains supply': 'supply', gen: 'generator', genset: 'generator', 'diesel generator': 'generator', conductor: 'line', rod: 'electrode', 'earth rod': 'electrode', 'earth electrode': 'electrode', 'test link': 'link', 'disconnecting link': 'link', 'earth link': 'link', mesh: 'grid', 'earth mesh': 'grid', 'earth mat': 'grid', 'earth grid': 'grid', equipment: 'board', inverter: 'board', switchgear: 'board', 'earth conductor': 'cable', bond: 'cable' };
// Atomax / BGEN house symbols, taken from the SLD symbol template (Template_MCCB.dxf): top terminal at (0,0), drawn downwards, at the template's own scale (text height 2)
const HOUSE = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'cad', 'symbols-sld.json'), 'utf8')); } catch { return {}; } })();
// each house symbol is written as an INSERT of the real block (the block definitions are in the Atomax DXF template); previews draw the same geometry
const house = (name, extra = {}) => () => { const s = HOUSE[name]; const ins = { t: 'insert', name, x: 0, y: 0, layer: 'SLD-SYMBOL', prims: s.prims }; return { len: -s.bbox[1], w: Math.max(2, s.bbox[2]), house: name, ...extra, prims: extra.text ? [ins, T(0, s.bbox[1] / 2 - 0.9, extra.text, 3)] : [ins] }; };
if (HOUSE.MCCB) Object.assign(SYMBOLS, {
  breaker: house('MCCB'), mcb: house('MCB'), isolator: house('ISOLATOR DISCONNECTOR'), switch: house('SWITCH DISCONNECTOR'), switchfuse: house('FUSED SWITCH DISCONNECTOR'),
  fuse: house('FUSE'), contactor: house('CONTACTOR1'), motor: house('MOTOR', { end: true, text: 'M' }), load: house('LOAD', { end: true }), transformer: house('HV-LV TRANSFORMER'),
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
function drawChain(chain, x, y) {
  const prims = [];
  for (const item of chain || []) {
    const sym = SYMBOLS[symbolOf(item.symbol)]();
    const label = wrap(item.label, sym.inside ? 16 : LABEL_W);
    const need = sym.inside ? 0 : label.length * LINE + 2.8;
    if (sym.inside && label.length > 2) {   // a board name over two lines: the box grows to hold it
      const bh = label.length * LINE + 3; sym.prims = [L(0, 0, 0, -2), P([[-9, -2], [9, -2], [9, -2 - bh], [-9, -2 - bh]], true)]; sym.len = 2 + bh;
    }
    sym.prims.forEach(p => prims.push(moved(p, x, y)));
    if (label.length) {
      if (sym.inside) prims.push({ t: 'mtext', x: x, y: y - 2 - (sym.len - 2) / 2, w: 17, h: TH, text: label.join('\n'), attach: 5, layer: 'SLD-TEXT' });
      else prims.push({ t: 'mtext', x: x + sym.w + 2, y: y - 1.8, w: LABEL_W, h: TH, text: label.join('\n'), attach: 1, layer: 'SLD-TEXT' });
    }
    y -= sym.len;
    if (sym.end) return { y, prims, ended: true };
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

function drawBoard(b, x0, y, prims, top) {
  const w = boardWidth(b), bx1 = x0 + w;
  let minY = y, maxY = y, maxX = bx1; const ixs = [];
  // feeders, left to right in their slots
  let cx = x0 + 5; const fxs = [];
  for (const f of b.feeders || []) {
    const fw = feederWidth(f), fx = cx + 10; fxs.push(fx);
    const { items, sub } = chainParts(f.chain);
    const r = drawChain(items, fx, y); prims.push(...r.prims);
    let yEnd = r.y;
    if (sub && !r.ended) {
      // the conductor carries on down to the board it feeds; that board's name sits beside the conductor in the gap
      const sl = wrap(sub.label || 'BOARD', Math.max(24, fw - 20));
      const gap = Math.max(SUB_GAP_MIN, sl.length * LINE + 4);
      prims.push(L(fx, yEnd, fx, yEnd - gap, 'SLD-CABLE'));
      prims.push({ t: 'mtext', x: fx + 3, y: yEnd - 1.5, w: Math.max(24, fw - 20), h: TH, text: sl.join('\n'), attach: 1, layer: 'SLD-TEXT' });
      const subX0 = Math.min(cx, fx - 6), d = drawBoard({ ...sub, label: '' }, subX0, yEnd - gap, prims, false);
      yEnd = d.minY; maxX = Math.max(maxX, d.maxX);
    } else if (feederLabelAdds(f)) {
      const tl = wrap(f.label, FEED - 6); prims.push({ t: 'mtext', x: fx - 3, y: yEnd - 3, w: FEED - 6, h: TH, text: tl.join('\n'), attach: 1, layer: 'SLD-TEXT' });
      yEnd -= 4 + tl.length * LINE;
    }
    minY = Math.min(minY, yEnd);
    cx += fw;
  }
  // incomers (top-level boards only) land on the bus clear of every feeder
  (b.incomers || []).forEach((c, i) => {
    let ix = (fxs.length ? (fxs[0] + fxs[fxs.length - 1]) / 2 : x0 + 20) + i * FEED; while (fxs.some(fx => Math.abs(fx - ix) < 8)) ix += 8; ixs.push(ix);
    const h = chainHeight(c.chain);
    if (c.label) { const tl = wrap(c.label, 40); prims.push({ t: 'mtext', x: ix - 20, y: y + h + 3 + tl.length * LINE, w: 40, h: TH, text: tl.join('\n'), attach: 1, layer: 'SLD-TEXT' }); maxY = Math.max(maxY, y + h + 3 + tl.length * LINE); }
    const r = drawChain(c.chain, ix, y + h); prims.push(...r.prims); maxY = Math.max(maxY, y + h);
  });
  // the busbar spans its own feeders and incomers only
  const xs = [...fxs, ...ixs], busL = xs.length ? Math.min(...xs) - 8 : x0, busR = Math.max(xs.length ? Math.max(...xs) + 14 : x0 + 30, busL + 30);
  prims.push(P([[busL, y], [busR, y]], false, 'SLD-BUS', 0.8));
  // a top-level board's name: above the bus at the left when there is room, otherwise past its right end
  if (top && b.label) {
    const room = (busR - busL) / 2 - 14, bl = wrap(b.label, room >= 30 ? Math.min(44, room) : 44);
    if (room >= 30) prims.push({ t: 'mtext', x: busL + 1, y: y + 1.5 + bl.length * LINE, w: Math.min(44, room), h: TH, text: bl.join('\n'), attach: 1, layer: 'SLD-TEXT' });
    else prims.push({ t: 'mtext', x: busL - 3, y, w: 44, h: TH, text: bl.join('\n'), attach: 6, layer: 'SLD-TEXT' });   // left of the busbar, clear of the feeder labels on the right
    maxY = Math.max(maxY, y + 2 + bl.length * LINE);
  }
  return { minY, maxY, maxX, w };
}

const SHEETS = [['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
function layoutSld(spec, opts = {}) {
  const prims = [], boards = spec.boards || spec.busbars || [];
  if (!boards.length) throw new Error('The drawing has no boards');
  let x0 = 0, minY = 0, maxY = 0, maxX = 0;
  for (const b of boards) { const d = drawBoard(b, x0, 0, prims, true); minY = Math.min(minY, d.minY); maxY = Math.max(maxY, d.maxY); maxX = Math.max(maxX, d.maxX); x0 = d.maxX + 25; }
  const f = frame(prims, spec, minY, maxY, maxX, '', { fill: opts.fill });
  return { prims: f.prims || prims, bounds: f.bounds, sheet: f.sheet };
}


// ---------- BCD (block cable diagram): panels / RIOs on the left, junction boxes in the middle, field devices on the right.
// Every cable is a line between two blocks carrying a yellow cable box (number, type, cores x size). One A3 sheet per file; long BCDs run onto more sheets.
const BCD_PITCH = 22, BCD_X = { panel: 0, jb: 150, device: 280 }, BCD_W = { panel: 50, jb: 40, device: 60 };
function bcdModel(spec) {
  const nodes = new Map();
  const typeOf = (t) => /panel|rio|mcc|plc|cabinet|\bio\b|marshall/i.test(t || '') ? 'panel' : /jb|junction/i.test(t || '') ? 'jb' : 'device';
  for (const n of (spec.nodes || [])) if (n && n.tag) nodes.set(String(n.tag), { tag: String(n.tag), label: String(n.label || ''), status: n.status || '', type: n.type ? typeOf(n.type) : typeOf(n.tag) });
  const cables = (spec.cables || []).filter(c => c && c.from && c.to).map(c => ({ ...c, from: String(c.from), to: String(c.to) }));
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
const BORDERS = {
  atomax: (() => { const g = readJson('border-atomax-a1.json'); return g && {
    geo: g, block: 'ATOMAX_A1_FRAME', page: 'A1', box: { x0: 24, y0: 24, x1: 730, y1: 572 }, maxScale: 1, textLayer: 'E-020___T-E-Drawing Frame Text', notesLayer: 'Z-903___T-E-Notes Text',
    attrs: { CLIENT_1: [741.4, 91.9], PROJECT_1: [741.4, 76.9], PROJECT_2: [741.4, 71.9], TITLE1: [741.4, 60.9], TITLE2: [741.4, 55.9], TITLE3: [741.4, 50.9], TITLE4: [741.4, 45.9], DRN: [741.4, 36.9], CHKD: [741.4, 29.9], APRVD: [783.4, 29.9], DATE: [786.3, 36.9], SCALE: [813.4, 36.9], SHT: [797.7, 26.0], SHTX: [807.7, 26.0], DRAWING_NUMBER: [748.5, 17.2, 4], REV: [814.2, 18.0, 3.6, 'center'] },
    titleWidth: 76, rev: { y: 135.2, pitch: 8, x0: 736.2, x1: 820.2, cols: [736.2, 745.2, 755.2, 797.2, 803.2, 813.2, 820.2], REV: 740.2, DATE: 750.2, DESC: 776.2, DRAWN: 800.2, CHECKED: 808.2, APPROVED: 816.2, h: 2, descH: 1.7, max: 7 },
    notes: { x: 738.4, tx: 744.3, y: 568.5, pitch: 3.35, w: 76, bottom: 410 }, legend: { x: 744.6, tx: 756.4, y: 398, bottom: 222 }, refs: { x: 738.3, y: 211.7, pitch: 3.2, h: 1.75, bottom: 150 },
  }; })(),
  bgen: (() => { const g = readJson('border-bgen-a0.json'); return g && {
    geo: g, block: '', page: 'A0', box: { x0: 15, y0: 15, x1: 1060, y1: 806 }, maxScale: 1, textLayer: 'SLD-TEXT', notesLayer: 'SLD-NOTES',
    attrs: Object.fromEntries(Object.entries(g.attrs).map(([k, a]) => [k, [a.x, a.y, a.h, a.align]])), titleWidth: 84,
    revbox: g.revbox, rev: { y: 121, pitch: 8, x0: 1070, max: 20 }, notes: { x: 1072, tx: 1072, y: 806, pitch: LINE, w: 80, bottom: 140 },
  }; })(),
};
const BORDER = BORDERS.atomax || BORDERS.bgen;
const LEGEND_TEXT = { MCCB: 'MCCB. TEXT: RATING, FRAME', MCB: 'MCB / RCBO. TEXT: RATING, POLES, TYPE', 'SWITCH DISCONNECTOR': 'SWITCH DISCONNECTOR / MAIN SWITCH / ISOLATOR', 'ISOLATOR DISCONNECTOR': 'ISOLATOR', 'FUSED SWITCH DISCONNECTOR': 'FUSED SWITCH DISCONNECTOR', FUSE: 'FUSE', CONTACTOR1: 'CONTACTOR', MOTOR: 'MOTOR', LOAD: 'FINAL CIRCUIT / LOAD', 'HV-LV TRANSFORMER': 'TRANSFORMER' };
function primsBounds(prims) {
  prims = flatPrims(prims);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const p of prims) {
    if (p.t === 'line') { add(p.x1, p.y1); add(p.x2, p.y2); }
    else if (p.pts) p.pts.forEach(([x, y]) => add(x, y));
    else if (p.t === 'circle' || p.t === 'arc') { add(p.x - p.r, p.y - p.r); add(p.x + p.r, p.y + p.r); }
    else if (p.t === 'mtext') { const n = String(p.text).split('\n').length, h = n * LINE, w = p.w || 30; const col = ((p.attach || 1) - 1) % 3, xl = col === 1 ? p.x - w / 2 : col === 2 ? p.x - w : p.x; const yt = p.attach >= 4 && p.attach <= 6 ? p.y + h / 2 : p.y; add(xl, yt); add(xl + w, yt - h); }
    else if (p.t === 'text') { const w = String(p.text).length * p.h * 0.9; add(p.align === 'center' ? p.x - w / 2 : p.x, p.y); add(p.align === 'center' ? p.x + w / 2 : p.x + w, p.y + p.h); }
  }
  return { x0, y0, x1, y1 };
}
function borderFrame(prims, spec, sheetLabel, opts) {
  const B = opts.border || BORDER, cb = B.box, f = opts.fill || {};
  const c = primsBounds(prims), W = c.x1 - c.x0, H = c.y1 - c.y0;
  const k = Math.min(B.maxScale || 1, (cb.x1 - cb.x0) / W, (cb.y1 - cb.y0) / H);   // 1:1 like the Atomax drawings; only reduced if it cannot fit (then said in the notes)
  const dx = cb.x0 + ((cb.x1 - cb.x0) - W * k) / 2 - c.x0 * k, dy = cb.y1 - ((cb.y1 - cb.y0) - H * k) / 2 - c.y1 * k;
  const out = place(prims, dx, dy, k);
  // the frame: the real block in the DXF, its geometry in previews
  out.push({ t: 'insert', name: B.block || '__border', x: 0, y: 0, layer: 'SLD-BORDER', prims: [...B.geo.prims.map(p => ({ ...p, layer: 'SLD-BORDER' })), ...B.geo.texts.map(t => t.t === 'mtext' ? { ...t, layer: 'SLD-BORDER' } : { t: 'text', x: t.x, y: t.y, h: t.h, text: t.text, align: t.align, rot: t.rot || 0, layer: 'SLD-BORDER' })] });
  const title = wrap(spec.title || f.title || 'DRAWING', B.titleWidth || 76).slice(0, 4), proj = wrap(f.project || '', B.titleWidth || 76);
  const today = (() => { const d = new Date(); return [d.getDate(), d.getMonth() + 1, d.getFullYear()].map((v, i) => String(v).padStart(i < 2 ? 2 : 4, '0')).join('.'); })();
  const val = { DRAWING_NUMBER: spec.drawingNumber || f.drawingNumber || 'TBC', REV: spec.revision || 'P01', TITLE1: title[0] || '', TITLE2: title[1] || '', TITLE3: title[2] || '', TITLE4: title[3] || '', DRN: f.drawn || 'DEX', DATE: f.date || today, SCALE: 'NTS', CHKD: f.checked || '', APRVD: f.approved || '', SHT: f.sht || '1', SHTX: f.shtx || '1', CLIENT_1: f.client || '', CLIENT_2: f.client2 || '', PROJECT_1: proj[0] || '', PROJECT_2: proj[1] || f.project2 || '' };
  for (const [tag, a] of Object.entries(B.attrs)) if (val[tag]) out.push({ t: 'text', x: a[0], y: a[1], h: tag === 'DRAWING_NUMBER' && String(val[tag]).length > 18 ? Math.min(a[2] || 2, 3.4) : a[2] || 2, text: String(val[tag]).slice(0, 60), align: a[3] || 'left', layer: B.textLayer });
  // revision rows, oldest at the bottom, each above the last
  const hist = spec.revHistory && spec.revHistory.length ? spec.revHistory : [{ rev: val.REV, what: /^A/i.test(val.REV) ? 'ISSUED FOR COMMENT' : 'PRELIMINARY\nDRAFT FOR CHECKING' }];
  const R = B.rev;
  hist.slice(-(R.max || 7)).forEach((r, i) => {
    const y = R.y + i * R.pitch, desc = String(r.what || '').toUpperCase().split('\n').flatMap(l => wrap(l, 40)).slice(0, 2), by = r.by || 'DEX';
    if (B.revbox) {   // the BGEN revision block
      const ox = R.x0, oy = R.y + i * R.pitch, rv = { REV: r.rev, DATE: r.date || val.DATE, DESC1: desc[0] || '', DESC2: desc[1] || '', DRAWN: by };
      for (const p of B.revbox.prims) out.push(moved({ ...p, layer: 'SLD-BORDER' }, ox, oy));
      for (const [tag, a] of Object.entries(B.revbox.attrs)) if (rv[tag]) out.push({ t: 'text', x: ox + a.x, y: oy + a.y - a.h / 2, h: a.h, text: rv[tag], align: a.align, layer: B.textLayer });
      return;
    }
    if (i > 0) { const yt = y + R.pitch / 2, yb = y - R.pitch / 2; out.push(L(R.x0, yt, R.x1, yt, 'SLD-BORDER')); R.cols.forEach(x => out.push(L(x, yb, x, yt, 'SLD-BORDER'))); }   // the frame draws the first row; later rows are added above it
    const tx = (x, text, h = R.h, yy = y - h / 2) => out.push({ t: 'text', x, y: yy, h, text, align: 'center', layer: B.textLayer });
    tx(R.REV, r.rev); tx(R.DATE, String(r.date || val.DATE).replace(/\.(\d{2})(\d{2})$/, '.$2'), R.descH);
    if (desc.length > 1) { tx(R.DESC, desc[0], R.descH, y + 0.95); tx(R.DESC, desc[1], R.descH, y - 2.65); } else tx(R.DESC, desc[0] || '', R.descH);
    tx(R.DRAWN, by); tx(R.CHECKED, r.checked || ''); tx(R.APPROVED, r.approved || '');
  });
  // NOTES, then the LEGEND of the symbols used, then REFERENCE DOCUMENTS
  const N = B.notes, notes = [...(spec.notes || []).map(String).filter(Boolean), ...(k < 1 ? [`DRAWING REDUCED TO ${Math.round(k * 100)}% TO FIT THE SHEET.`] : []), 'DRAFT BY DEX (ATOMAX MEDIA OFFICE) FOR CHECKING.'];
  let ny = N.y;
  notes.forEach((nt, i) => { const ls = wrap(String(nt).toUpperCase(), N.w - (N.tx - N.x)); if (ny - ls.length * N.pitch < N.bottom) return; out.push({ t: 'text', x: N.x, y: ny, h: 2, text: (i + 1) + '.', layer: B.notesLayer }); ls.forEach(l => { out.push({ t: 'text', x: N.tx, y: ny, h: 2, text: l, layer: B.notesLayer }); ny -= N.pitch; }); ny -= 1.6; });
  if (B.legend) {
    const used = [...new Set(prims.filter(p => p.t === 'insert' && LEGEND_TEXT[p.name]).map(p => p.name))], Lg = B.legend; let ly = Lg.y;
    for (const name of used) { const hs = HOUSE[name]; if (!hs || ly - 18 < Lg.bottom) continue; out.push({ t: 'insert', name, x: Lg.x, y: ly, k: 0.6, layer: 'SLD-SYMBOL', prims: hs.prims }); wrap(LEGEND_TEXT[name], 60).forEach((l, j) => out.push({ t: 'text', x: Lg.tx, y: ly - 7.8 - j * 3.4, h: 2, text: l, layer: B.notesLayer })); ly -= Math.max(19, -hs.bbox[1] * 0.6 + 4); }
    const extra = [...(prims.some(p => p.layer === 'SLD-BUS') ? [['bus', 'LV BUSBAR']] : []), ...(prims.some(p => p.layer === 'BCD-CABLEBOX') ? [['box', 'CABLE: NUMBER, CORES x SIZE, TYPE']] : []), ...(spec.legend || []).map(t => ['', String(t)])];
    for (const [kind, t] of extra) { if (ly - 6 < Lg.bottom) break; if (kind === 'bus') out.push({ ...P([[Lg.x - 6, ly - 2], [Lg.x + 6, ly - 2]], false, 'SLD-BUS', 0.8) }); if (kind === 'box') out.push(P([[Lg.x - 6, ly - 4], [Lg.x + 6, ly - 4], [Lg.x + 6, ly], [Lg.x - 6, ly]], true, 'BCD-CABLEBOX')); out.push({ t: 'text', x: Lg.tx, y: ly - 3, h: 2, text: t.toUpperCase(), layer: B.notesLayer }); ly -= 6; }
  }
  if (B.refs) { let ry = B.refs.y; for (const r of (spec.references || []).map(String).filter(Boolean)) { if (ry < B.refs.bottom) break; out.push({ t: 'text', x: B.refs.x, y: ry, h: B.refs.h, text: r.toUpperCase().slice(0, 70), layer: B.notesLayer }); ry -= B.refs.pitch; } }
  if (sheetLabel && !B.attrs.SHT) out.push({ t: 'text', x: 1112, y: 128 + hist.length * 8, h: TH, text: sheetLabel, align: 'center', layer: B.textLayer });
  const g = B.geo;
  return { prims: out, bounds: { x0: g.x0 - 2, y0: g.y0 - 2, x1: g.x0 + g.w + 2, y1: g.y0 + g.h + 2 }, sheet: B.page, page: B.page, content: cb };
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
    prims.push({ t: 'mtext', x: tbx + 3, y: tby + 11, w: tbW - 6, h: TH, text: [`DWG No: ${spec.drawingNumber || 'TBC'}   REV: ${spec.revision || 'P1'}${sheetName ? '   ' + sheetName : ''}${sheetLabel ? '   ' + sheetLabel : ''}`, `DRAWN: Dex (Atomax Media Office) · ${new Date().toISOString().slice(0, 10)}`, 'DRAFT FOR CHECKING'].join('\n'), attach: 1, layer: 'SLD-TEXT' });
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
const SHEET_ROWS = BORDER ? Math.floor((BORDER.box.y1 - BORDER.box.y0 - 20) / 22) : 10;   // device rows per sheet (A0 border at 1:1, or the old A3 frame)
function layoutBcd(spec, opts = {}) {
  const model = bcdModel(spec);
  if (!model.cables.length) throw new Error('The BCD has no cables');
  BSTYLE = { ng: spec.style === 'ng' || spec.style === 'national-grid' };
  const { groups: raw, links } = bcdGroups(model);
  // a JB with more devices than a sheet holds carries on to the next sheet ("CONT.")
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
    const f = frame(prims, spec, body.minY - 8, 10, body.maxX, label, { fixed: true, noTitle: !!opts.noTitle, fill: { ...(opts.fill || {}), sht: String(i + 1), shtx: String(sheets.length) } });
    return { prims, bounds: f.bounds, content: f.content, sheet: f.sheet, label, boxes, cables: [...gs.flatMap(g => [...g.up, ...g.down.map(d => d.c)]), ...(i === sheets.length - 1 ? links : [])].map(c => String(c.no || '')) };
  });
}
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
const LAYERS = [['SLD-BUS', 1], ['SLD-CABLE', 3], ['SLD-SYMBOL', 7], ['SLD-TEXT', 7], ['SLD-BORDER', 8], ['SLD-NOTES', 30], ['BCD-BLOCK', 7], ['BCD-CABLE', 7], ['BCD-CABLEBOX', 2], ['BCD-TEXT', 7], ['BCD-REVISION', 1]];
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
  const clean = (s) => String(s).replace(/[\r\n]+/g, ' ');
  const blocks = new Set([...tpl.matchAll(/\n\s*0\nBLOCK\n[\s\S]*?\n\s*2\n([^\n]+)\n/g)].map(m => m[1].trim()));
  const list = []; const add = (p) => { if (p.t === 'insert' && !blocks.has(p.name)) flatPrims([p]).forEach(add); else list.push(p); }; prims.forEach(add);
  for (const p of list) {
    colour = p.colour || 0;
    if (p.t === 'insert') { head('INSERT', p.layer); g(100, 'AcDbBlockReference'); g(2, p.name); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); if ((p.k || 1) !== 1) { g(41, n(p.k)); g(42, n(p.k)); g(43, n(p.k)); } }
    else if (p.t === 'line') { head('LINE', p.layer); g(100, 'AcDbLine'); g(10, n(p.x1)); g(20, n(p.y1)); g(30, 0); g(11, n(p.x2)); g(21, n(p.y2)); g(31, 0); }
    else if (p.t === 'circle') { head('CIRCLE', p.layer); g(100, 'AcDbCircle'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.r)); }
    else if (p.t === 'arc') { head('ARC', p.layer); g(100, 'AcDbCircle'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.r)); g(100, 'AcDbArc'); g(50, n(p.a0)); g(51, n(p.a1)); }
    else if (p.t === 'pline') { head('LWPOLYLINE', p.layer); g(100, 'AcDbPolyline'); g(90, p.pts.length); g(70, p.closed ? 1 : 0); if (p.width) g(43, n(p.width)); for (const [x, y] of p.pts) { g(10, n(x)); g(20, n(y)); } }
    else if (p.t === 'text') { head('TEXT', p.layer); g(100, 'AcDbText'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.h)); g(1, clean(p.text)); if (p.rot) g(50, n(p.rot)); g(7, 'Standard'); if (p.align === 'center') { g(72, 1); g(11, n(p.x)); g(21, n(p.y)); g(31, 0); } g(100, 'AcDbText'); }
    else if (p.t === 'fill' && p.pts && p.pts.length > 2) { head('HATCH', p.layer); g(100, 'AcDbHatch'); g(10, 0); g(20, 0); g(30, 0); g(210, 0); g(220, 0); g(230, 1); g(2, 'SOLID'); g(70, 1); g(71, 0); const rings = p.rings || [p.pts]; g(91, rings.length); for (const r of rings) { g(92, 2); g(72, 0); g(73, 1); g(93, r.length); for (const [x, y] of r) { g(10, n(x)); g(20, n(y)); } g(97, 0); } g(75, 0); g(76, 1); g(98, 0); }
    else if (p.t === 'mtext') { head('MTEXT', p.layer); g(100, 'AcDbMText'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.h)); g(41, n(p.w)); g(71, p.attach || 1); g(72, 5); g(1, String(p.text).replace(/\r?\n/g, '\\P')); g(7, 'Standard'); }
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
    if (p.t === 'text') return `<text ${p.rot ? `transform="rotate(${-p.rot} ${X(p.x)} ${Y(p.y)})" ` : ''}x="${X(p.x)}" y="${Y(p.y)}" font-size="${p.h}" text-anchor="${p.align === 'center' ? 'middle' : 'start'}" dominant-baseline="middle" font-family="Arial">${esc(p.text)}</text>`;
    if (p.t === 'fill') return `<path fill-rule="evenodd" d="${(p.rings || [p.pts]).map(r => 'M' + r.map(([x, y]) => X(x) + ' ' + Y(y)).join(' L') + ' Z').join(' ')}" fill="${p.colour === 3 ? '#40c057' : p.colour === 1 ? '#fa5252' : '#495057'}" stroke="none"/>`;
    if (p.t === 'mtext') { const ls = String(p.text).split('\n'), mid = p.attach === 5 || p.attach === 6 || p.attach === 4; const y0 = mid ? p.y + (ls.length - 1) * LINE / 2 : p.y - p.h; return `<text font-size="${p.h}" font-family="Arial" fill="${col(p.layer)}" text-anchor="${p.attach === 5 ? 'middle' : p.attach === 6 ? 'end' : 'start'}">${ls.map((l, i) => `<tspan x="${X(p.x)}" y="${Y(y0 - i * LINE)}">${esc(l)}</tspan>`).join('')}</text>`; }
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
In earthing drawings, nest earth bars the same way: the cable screen or earth conductor feeding another substation's earth bar ends with {"board": {...}}. If an engineer's technical note in the project files gives conductor sizes or electrode design, use those values (say "per <note name>" in the notes); otherwise sizes stay TBC. Each board has incomers (chains drawn above the busbar, ending on it) and feeders (chains drawn below it). A chain is a list of items from top to bottom, each { "symbol": one of supply, generator, transformer, breaker, isolator, switchfuse, fuse, contactor, ct, meter, ups, cable, line, link, and as the LAST item of a feeder only: board, load, motor, earth, electrode, grid, spare; "label": the text beside it }.
Labels: short, exactly as an engineer would write them, using what the project files say (ratings, cable sizes, tags, board names). Use a new line (\\n) between parts of a label, e.g. "Q1\\n630A TP MCCB". Do not invent ratings, cable sizes or tags that are not in the request or the files: if one is unknown write "TBC" in the label and list it in "notes".
BCD ("bcd", block cable diagram): do NOT use boards. Give "nodes" (every panel / RIO / MCC, junction box and field device, with "type" panel|rio|mcc|jb|device and a short "label" description exactly as written) and "cables" (every cable: "no" exactly as printed, "from" and "to" node tags, "type" e.g. BS5308 / SWA / CY, "cores" e.g. 10P or 4C, "size" e.g. 0.5 or 1.5mm², and "note" for interface cables such as "LINK TO X03-MCC SEE DWG ..."). When the job context has an APPROVED MASTER DEVICE LIST, the BCD is exactly its cables and devices for the panels asked for: nothing added, nothing left out. The app lays the blocks out (panels left, JBs middle, devices right), draws each cable with its yellow cable box and splits long BCDs over sheets. For National Grid LVAC / power block diagrams also give "style":"ng", each node a "status" (energised, de-energised or new) and each cable a "status" (current = current supply cabling, new = new by BGEN, existing = existing by others).
If something essential is missing (which boards, how many feeders, what the supply is) and the files do not say, ask: reply with {"questions": ["...", "..."]} (max 4 short questions) and nothing else.
Otherwise reply with JSON only, no markdown:
{"kind":"sld, earthing or bcd","title":"...","drawingNumber":"... or TBC","revision":"P01","nodes":[only for bcd],"cables":[only for bcd],"boards":[{"label":"MAIN LV BOARD\\n400V 3PH 4W 50Hz","incomers":[{"label":"optional text above","chain":[...]}],"feeders":[{"label":"optional text under the feeder","chain":[...]}]}],"notes":["..."],"summary":"one line for the engineer: what you drew and what is TBC"}`;

// Claude's JSON is not always strict: real line breaks inside strings (a multi-line reply), a trailing comma, or a reply cut off at the length limit.
// Repair those, then parse.
function repairJson(raw) {
  let s = String(raw || '').replace(/^\uFEFF/, '');
  const a = s.indexOf('{'); if (a < 0) throw new Error('no JSON in the reply');
  s = s.slice(a);
  let out = '', inStr = false, esc = false; const stack = [];
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      if (ch < ' ') continue;
      out += ch; continue;
    }
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
  return prims.map(p => p.t === 'insert' ? { ...p, x: X(p.x), y: Y(p.y), k: (p.k || 1) * k } : p.t === 'line' ? { ...p, x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2) } : p.pts ? { ...p, pts: p.pts.map(([x, y]) => [X(x), Y(y)]), ...(p.rings ? { rings: p.rings.map(r => r.map(([x, y]) => [X(x), Y(y)])) } : {}), ...(p.width ? { width: p.width * k } : {}) } : p.t === 'text' || p.t === 'mtext' ? { ...p, x: X(p.x), y: Y(p.y), w: p.w ? p.w * k : p.w, h: Math.max(p.h * k, TH) } : { ...p, x: X(p.x), y: Y(p.y), r: p.r * k });
}
// block inserts expanded to plain geometry (for previews, PDFs and measuring)
function flatPrims(prims) { const out = []; for (const p of prims) { if (p.t === 'insert') out.push(...flatPrims(place(p.prims.map(q => ({ ...q, layer: q.layer || p.layer })), p.x, p.y, p.k || 1))); else out.push(p); } return out; }
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60);
const uniquePath = (dir, stem, ext) => { let f = path.join(dir, stem + ext), i = 2; while (fs.existsSync(f)) f = path.join(dir, `${stem}_${i++}${ext}`); return f; };

// spec -> files on disk; returns paths and a preview. opts: { template: client title block DXF, previous: { spec } for a new revision }
function make(spec, outDir, baseName, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const stem = safeName(baseName || spec.drawingNumber || spec.title || 'SLD');
  // a new revision: what changed against the previous spec, the history carried on, clouds round changed cable boxes (BCDs)
  let diff = null;
  if (opts.previous && opts.previous.spec) {
    const old = opts.previous.spec;
    diff = spec.kind === 'bcd' ? bcdDiff(old, spec) : null;
    const said = diff ? [diff.added.length ? 'added ' + diff.added.join(', ') : '', diff.removed.length ? 'removed ' + diff.removed.join(', ') : '', diff.changed.length ? 'changed ' + diff.changed.join(', ') : ''].filter(Boolean).join('; ') : (spec.revisionNote || 'revised');
    spec.revHistory = [...(old.revHistory || [{ rev: old.revision || 'P1', what: 'First issue' }]), { rev: spec.revision, what: (spec.revisionNote ? spec.revisionNote + '. ' : '') + (said || 'no cable changes') }];
    spec.notes = [...(spec.notes || []), 'REVISION HISTORY: ' + spec.revHistory.map(r => `${r.rev} ${r.what}`).join(' / ')];
  }
  const sheets = spec.kind === 'bcd' ? layoutBcd(spec, { noTitle: !!opts.template, diff, fill: opts.fill }) : [(() => { const r = layoutSld(spec, { fill: opts.fill }); return { ...r, label: '' }; })()];
  const files = [];
  sheets.forEach((sh, i) => {
    let prims = sh.prims, bounds = sh.bounds;
    if (opts.template) {   // the client's own title block: our content scaled (never up) into the space left of / above it
      const tpl = fs.readFileSync(opts.template, 'utf8'), ext = templateExtents(tpl) || { x0: 0, y0: 0, x1: 420, y1: 297 };
      const c = sh.content || bounds, W = c.x1 - c.x0, H = c.y1 - c.y0, aw = (ext.x1 - ext.x0) * 0.78, ah = (ext.y1 - ext.y0) * 0.82;
      const k = Math.min(1, aw / W, ah / H);
      prims = place(prims, ext.x0 + 15 - c.x0 * k, ext.y1 - 15 - c.y1 * k, k); bounds = ext;
    }
    const dxf = writeDxf(prims, bounds, { template: opts.template, fill: { title: spec.title || '', drawingNumber: spec.drawingNumber || 'TBC', revision: spec.revision || 'P1', date: new Date().toISOString().slice(0, 10), sheet: sh.label || '', drawn: 'Dex' } });
    const file = uniquePath(outDir, `${stem}${sheets.length > 1 ? '_SH' + (i + 1) : ''}_DRAFT`, '.dxf');
    fs.writeFileSync(file, dxf, 'utf8');
    files.push({ path: file, svg: toSvg(prims, bounds), entities: prims.length, label: sh.label, cables: sh.cables || [], prims, bounds, page: sh.page || (opts.template ? 'A3' : (BORDER && BORDER.page) || 'A3') });
  });
  // the spec is kept next to the drawing so the next revision can be compared with it
  try { fs.writeFileSync(files[0].path.replace(/\.dxf$/i, '.spec.json'), JSON.stringify(spec, null, 1)); } catch {}
  return { path: files[0].path, svg: files[0].svg, entities: files.reduce((n, f) => n + f.entities, 0), files, diff };
}
// the most recent spec saved for a drawing stem in a folder (for "new revision")
function previousSpec(outDir, baseName) {
  const stem = safeName(baseName);
  try { const c = fs.readdirSync(outDir).filter(f => f.startsWith(stem) && f.endsWith('.spec.json')).map(f => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]; return c ? { file: c.f, spec: JSON.parse(fs.readFileSync(path.join(outDir, c.f), 'utf8')) } : null; } catch { return null; }
}

module.exports = { flatPrims, BORDERS, cableClashes, previousSpec, layoutBcd, bcdDiff, SYSTEM, ALIASES, SYMBOLS, symbolOf, layoutSld, writeDxf, toSvg, parseReply, make };
