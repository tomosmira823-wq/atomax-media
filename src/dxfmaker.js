// Dex's DXF maker: Claude describes a drawing (for now: single line diagrams) as boards, incomers and feeder chains, and this file lays it out
// and writes a real AutoCAD R2010 DXF. Layout is done here, not by Claude, so symbols are always joined, labels never overlap and text is height 2 (MTEXT for labels).
'use strict';
const fs = require('fs');
const path = require('path');

const TH = 2;            // standard text height (Tom's house rule: 2, never smaller)
const LINE = TH * 1.7;   // MTEXT line pitch at height 2
const FEED = 40;         // spacing between feeders on a busbar
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
const symbolOf = (name) => { const n = String(name || '').toLowerCase().trim(); return SYMBOLS[n] ? n : ALIASES[n] || (SYMBOLS[n.replace(/s$/, '')] ? n.replace(/s$/, '') : 'line'); };

const moved = (p, dx, dy) => {
  if (p.t === 'line') return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
  if (p.t === 'pline') return { ...p, pts: p.pts.map(([x, y]) => [x + dx, y + dy]) };
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
    sym.prims.forEach(p => prims.push(moved(p, x, y)));
    if (label.length) {
      if (sym.inside) prims.push({ t: 'mtext', x: x, y: y - 6, w: 17, h: TH, text: label.join('\n'), attach: 5, layer: 'SLD-TEXT' });
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
    else { prims.push({ t: 'mtext', x: busR + 3, y: y + (bl.length * LINE) / 2, w: 44, h: TH, text: bl.join('\n'), attach: 1, layer: 'SLD-TEXT' }); maxX = Math.max(maxX, busR + 50); }
    maxY = Math.max(maxY, y + 2 + bl.length * LINE);
  }
  return { minY, maxY, maxX, w };
}

const SHEETS = [['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
function layoutSld(spec) {
  const prims = [], boards = spec.boards || spec.busbars || [];
  if (!boards.length) throw new Error('The drawing has no boards');
  let x0 = 0, minY = 0, maxY = 0, maxX = 0;
  for (const b of boards) { const d = drawBoard(b, x0, 0, prims, true); minY = Math.min(minY, d.minY); maxY = Math.max(maxY, d.maxY); maxX = Math.max(maxX, d.maxX); x0 = d.maxX + 25; }
  // notes and title block under the drawing, then the smallest A-size sheet that holds it all
  const notes = (spec.notes || []).map(String).filter(Boolean);
  const nl = notes.flatMap((n, i) => wrap((i + 1) + '. ' + n, 150)), notesH = nl.length ? (nl.length + 1) * LINE + 8 : 0;
  const tbW = 130, tbH = 32, m = 15;
  const needW = Math.max(maxX + 2 * m + 10, 150 + tbW + 3 * m), needH = (maxY - minY) + Math.max(notesH, tbH) + 3 * m + 10;
  const sheet = SHEETS.find(([, W, H]) => W >= needW && H >= needH) || ['', needW, needH];
  const [sheetName, SW, SH] = sheet;
  const left = -m - 5, top = maxY + m, right = left + SW, bottom = top - SH;
  prims.push(P([[left, bottom], [right, bottom], [right, top], [left, top]], true, 'SLD-BORDER'));
  prims.push(P([[left + 5, bottom + 5], [right - 5, bottom + 5], [right - 5, top - 5], [left + 5, top - 5]], true, 'SLD-BORDER'));
  if (nl.length) prims.push({ t: 'mtext', x: left + m, y: bottom + m + notesH, w: 150, h: TH, text: ['NOTES', ...nl].join('\n'), attach: 1, layer: 'SLD-NOTES' });
  const tbx = right - 10 - tbW, tby = bottom + 10;
  prims.push(P([[tbx, tby], [tbx + tbW, tby], [tbx + tbW, tby + tbH], [tbx, tby + tbH]], true, 'SLD-BORDER'));
  prims.push(L(tbx, tby + 14, tbx + tbW, tby + 14, 'SLD-BORDER'));
  prims.push({ t: 'mtext', x: tbx + 3, y: tby + tbH - 3, w: tbW - 6, h: 3.5, text: wrap(spec.title || (spec.kind === 'earthing' ? 'EARTHING SCHEMATIC' : 'SINGLE LINE DIAGRAM'), 70).join('\n'), attach: 1, layer: 'SLD-TEXT' });
  prims.push({ t: 'mtext', x: tbx + 3, y: tby + 11, w: tbW - 6, h: TH, text: [`DWG No: ${spec.drawingNumber || 'TBC'}   REV: ${spec.revision || 'P01'}${sheetName ? '   SHEET: ' + sheetName : ''}`, `DRAWN: Dex (Atomax Media Office) · ${new Date().toISOString().slice(0, 10)}`, 'DRAFT FOR CHECKING'].join('\n'), attach: 1, layer: 'SLD-TEXT' });
  return { prims, bounds: { x0: left, y0: bottom, x1: right, y1: top }, sheet: sheetName || 'oversize' };
}

// ---------- DXF writer (R2010, appended to a template made with ezdxf) ----------
const TEMPLATE = () => fs.readFileSync(path.join(__dirname, 'dxf-template-r2010.dxf'), 'utf8');
const n = (v) => (Math.round(v * 1000) / 1000).toString();
function writeDxf(prims, bounds) {
  let tpl = TEMPLATE().replace(/\r\n/g, '\n');
  const seedM = tpl.match(/\$HANDSEED\n\s*5\n([0-9A-Fa-f]+)\n/);
  let h = parseInt(seedM ? seedM[1] : '1000', 16) + 16;
  const OWNER = (tpl.match(/BLOCK_RECORD\n\s*5\n([0-9A-Fa-f]+)\n(?:(?!\n\s*0\n)[\s\S])*?\n\s*2\n\*Model_Space\n/) || [])[1] || '17';
  const out = [];
  const g = (code, val) => out.push(String(code).padStart(3, ' '), String(val));
  const head = (type, layer) => { g(0, type); g(5, (h++).toString(16).toUpperCase()); g(330, OWNER); g(100, 'AcDbEntity'); g(8, layer || '0'); };
  const clean = (s) => String(s).replace(/[\r\n]+/g, ' ');
  for (const p of prims) {
    if (p.t === 'line') { head('LINE', p.layer); g(100, 'AcDbLine'); g(10, n(p.x1)); g(20, n(p.y1)); g(30, 0); g(11, n(p.x2)); g(21, n(p.y2)); g(31, 0); }
    else if (p.t === 'circle') { head('CIRCLE', p.layer); g(100, 'AcDbCircle'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.r)); }
    else if (p.t === 'arc') { head('ARC', p.layer); g(100, 'AcDbCircle'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.r)); g(100, 'AcDbArc'); g(50, n(p.a0)); g(51, n(p.a1)); }
    else if (p.t === 'pline') { head('LWPOLYLINE', p.layer); g(100, 'AcDbPolyline'); g(90, p.pts.length); g(70, p.closed ? 1 : 0); if (p.width) g(43, n(p.width)); for (const [x, y] of p.pts) { g(10, n(x)); g(20, n(y)); } }
    else if (p.t === 'text') { head('TEXT', p.layer); g(100, 'AcDbText'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.h)); g(1, clean(p.text)); g(7, 'Standard'); if (p.align === 'center') { g(72, 1); g(11, n(p.x)); g(21, n(p.y)); g(31, 0); } g(100, 'AcDbText'); }
    else if (p.t === 'mtext') { head('MTEXT', p.layer); g(100, 'AcDbMText'); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(p.h)); g(41, n(p.w)); g(71, p.attach || 1); g(72, 5); g(1, String(p.text).replace(/\r?\n/g, '\\P')); g(7, 'Standard'); }
  }
  tpl = tpl.replace(/(\n\s*0\nSECTION\n\s*2\nENTITIES\n)(\s*0\nENDSEC\n)/, (_m, a, b) => a + out.join('\n') + '\n' + b);
  tpl = tpl.replace(/(\$HANDSEED\n\s*5\n)[0-9A-Fa-f]+\n/, (_m, a) => a + (h + 16).toString(16).toUpperCase() + '\n');
  if (bounds) {   // so the drawing opens zoomed to the content
    tpl = tpl.replace(/(\$EXTMIN\n\s*10\n)[^\n]+(\n\s*20\n)[^\n]+/, (_m, a, b) => a + n(bounds.x0) + b + n(bounds.y0));
    tpl = tpl.replace(/(\$EXTMAX\n\s*10\n)[^\n]+(\n\s*20\n)[^\n]+/, (_m, a, b) => a + n(bounds.x1) + b + n(bounds.y1));
  }
  return tpl.replace(/\n/g, '\r\n');
}

// ---------- SVG preview for the panel ----------
function toSvg(prims, b) {
  const W = b.x1 - b.x0, H = b.y1 - b.y0, Y = (y) => n(b.y1 - y), X = (x) => n(x - b.x0);
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const col = (layer) => ({ 'SLD-BUS': '#e03131', 'SLD-CABLE': '#2f9e44', 'SLD-BORDER': '#868e96', 'SLD-NOTES': '#e67700' })[layer] || '#1b2a41';
  const parts = prims.map(p => {
    if (p.t === 'line') return `<line x1="${X(p.x1)}" y1="${Y(p.y1)}" x2="${X(p.x2)}" y2="${Y(p.y2)}" stroke="${col(p.layer)}" stroke-width="0.35"/>`;
    if (p.t === 'circle') return `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r}" fill="none" stroke="${col(p.layer)}" stroke-width="0.35"/>`;
    if (p.t === 'arc') { const a0 = p.a0 * Math.PI / 180, a1 = p.a1 * Math.PI / 180; return `<path d="M${X(p.x + p.r * Math.cos(a0))} ${Y(p.y + p.r * Math.sin(a0))} A${p.r} ${p.r} 0 0 0 ${X(p.x + p.r * Math.cos(a1))} ${Y(p.y + p.r * Math.sin(a1))}" fill="none" stroke="${col(p.layer)}" stroke-width="0.35"/>`; }
    if (p.t === 'pline') return `<polyline points="${p.pts.map(([x, y]) => X(x) + ',' + Y(y)).join(' ')}${p.closed ? ' ' + X(p.pts[0][0]) + ',' + Y(p.pts[0][1]) : ''}" fill="none" stroke="${col(p.layer)}" stroke-width="${p.width || 0.35}"/>`;
    if (p.t === 'text') return `<text x="${X(p.x)}" y="${Y(p.y)}" font-size="${p.h}" text-anchor="${p.align === 'center' ? 'middle' : 'start'}" dominant-baseline="middle" font-family="Arial">${esc(p.text)}</text>`;
    if (p.t === 'mtext') { const ls = String(p.text).split('\n'), mid = p.attach === 5; const y0 = mid ? p.y + (ls.length - 1) * LINE / 2 : p.y - p.h; return `<text font-size="${p.h}" font-family="Arial" fill="${col(p.layer)}" text-anchor="${mid ? 'middle' : 'start'}">${ls.map((l, i) => `<tspan x="${X(p.x)}" y="${Y(y0 - i * LINE)}">${esc(l)}</tspan>`).join('')}</text>`; }
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
If something essential is missing (which boards, how many feeders, what the supply is) and the files do not say, ask: reply with {"questions": ["...", "..."]} (max 4 short questions) and nothing else.
Otherwise reply with JSON only, no markdown:
{"kind":"sld or earthing","title":"...","drawingNumber":"... or TBC","revision":"P01","boards":[{"label":"MAIN LV BOARD\\n400V 3PH 4W 50Hz","incomers":[{"label":"optional text above","chain":[...]}],"feeders":[{"label":"optional text under the feeder","chain":[...]}]}],"notes":["..."],"summary":"one line for the engineer: what you drew and what is TBC"}`;

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

// spec -> files on disk; returns paths and a preview
function make(spec, outDir, baseName) {
  const { prims, bounds } = layoutSld(spec);
  const dxf = writeDxf(prims, bounds), svg = toSvg(prims, bounds);
  fs.mkdirSync(outDir, { recursive: true });
  const safe = String(baseName || spec.drawingNumber || spec.title || 'SLD').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60);
  let file = path.join(outDir, `${safe}_DRAFT.dxf`), i = 2;
  while (fs.existsSync(file)) file = path.join(outDir, `${safe}_DRAFT_${i++}.dxf`);   // never overwrite
  fs.writeFileSync(file, dxf, 'utf8');
  return { path: file, svg, entities: prims.length };
}

module.exports = { SYSTEM, ALIASES, SYMBOLS, symbolOf, layoutSld, writeDxf, toSvg, parseReply, make };
