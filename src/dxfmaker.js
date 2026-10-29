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
  line: () => ({ len: 8, w: 1, prims: [L(0, 0, 0, -8)] }),
};
const ALIASES = { mcb: 'breaker', mccb: 'breaker', acb: 'breaker', cb: 'breaker', vcb: 'breaker', rcbo: 'breaker', 'circuit breaker': 'breaker', switch: 'isolator', disconnector: 'isolator', 'switch disconnector': 'isolator', 'fuse switch': 'switchfuse', 'fused switch': 'switchfuse', tx: 'transformer', 'current transformer': 'ct', kwh: 'meter', 'distribution board': 'board', db: 'board', panel: 'board', mcc: 'board', dno: 'supply', incomer: 'supply', 'mains supply': 'supply', gen: 'generator', genset: 'generator', 'diesel generator': 'generator', conductor: 'line' };
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

// ---------- layout: boards left to right, each with incomers above its busbar and feeders below ----------
function layoutSld(spec) {
  const prims = [], boards = spec.boards || spec.busbars || [];
  if (!boards.length) throw new Error('The drawing has no boards');
  let x0 = 0, minY = 0, maxY = 0;
  for (const b of boards) {
    const feeders = b.feeders || [], inc = b.incomers || [];
    // the busbar runs past the last feeder's labels so they never meet the board name
    const width = 15 + (Math.max(1, feeders.length) - 1) * FEED + LABEL_W + 10;
    const bx0 = x0, bx1 = x0 + width, by = 0;
    prims.push(P([[bx0, by], [bx1, by]], false, 'SLD-BUS', 0.8));
    const bl = wrap(b.label || 'BOARD', 44);
    prims.push({ t: 'mtext', x: bx1 + 3, y: by + (bl.length * LINE) / 2, w: 44, h: TH, text: bl.join('\n'), attach: 1, layer: 'SLD-TEXT' });
    // incomers drop onto the busbar, spaced across it
    inc.forEach((c, i) => {
      // incomers land between feeders, never in line with one (it would look like a straight-through circuit)
      const nF = Math.max(1, feeders.length), slot = Math.min(nF - 1, Math.floor((nF - 1) / 2) + i - Math.floor((inc.length - 1) / 2));
      const ix = feeders.length > 1 ? bx0 + 15 + (Math.max(0, slot) + 0.5) * FEED : bx0 + 15 + FEED * 0.5 + i * FEED, h = chainHeight(c.chain);
      if (c.label) { const tl = wrap(c.label, 40); prims.push({ t: 'mtext', x: ix - 20, y: by + h + 3 + tl.length * LINE, w: 40, h: TH, text: tl.join('\n'), attach: 1, layer: 'SLD-TEXT' }); maxY = Math.max(maxY, by + h + 3 + tl.length * LINE); }
      const r = drawChain(c.chain, ix, by + h); prims.push(...r.prims); maxY = Math.max(maxY, by + h);
    });
    // feeders drop from the busbar
    feeders.forEach((f, i) => {
      const fx = bx0 + 15 + i * FEED;
      const r = drawChain(f.chain, fx, by); prims.push(...r.prims); minY = Math.min(minY, r.y - (f.chain || []).length * 0);
      if (f.label) { const tl = wrap(f.label, FEED - 4); prims.push({ t: 'mtext', x: fx - (FEED - 4) / 2, y: r.y - 3, w: FEED - 4, h: TH, text: tl.join('\n'), attach: 1, layer: 'SLD-TEXT' }); minY = Math.min(minY, r.y - 4 - tl.length * LINE); }
      else minY = Math.min(minY, r.y);
    });
    x0 = bx1 + 3 + 44 + 25;   // room for the busbar label, then a gap before the next board
  }
  // notes, title box and border
  const right = x0 - 25, notes = (spec.notes || []).map(String).filter(Boolean);
  let y = minY - 12;
  if (notes.length) { const nl = notes.flatMap((n, i) => wrap((i + 1) + '. ' + n, 150)); prims.push({ t: 'mtext', x: 0, y, w: 150, h: TH, text: ['NOTES', ...nl].join('\n'), attach: 1, layer: 'SLD-NOTES' }); y -= (nl.length + 1) * LINE + 8; }
  const tbW = 130, tbH = 32, tbx = Math.max(right - tbW, 160), tby = y - tbH;
  prims.push(P([[tbx, tby], [tbx + tbW, tby], [tbx + tbW, tby + tbH], [tbx, tby + tbH]], true, 'SLD-BORDER'));
  prims.push(L(tbx, tby + 14, tbx + tbW, tby + 14, 'SLD-BORDER'));
  prims.push({ t: 'mtext', x: tbx + 3, y: tby + tbH - 3, w: tbW - 6, h: 3.5, text: wrap(spec.title || 'SINGLE LINE DIAGRAM', 70).join('\n'), attach: 1, layer: 'SLD-TEXT' });
  prims.push({ t: 'mtext', x: tbx + 3, y: tby + 11, w: tbW - 6, h: TH, text: [`DWG No: ${spec.drawingNumber || 'TBC'}   REV: ${spec.revision || 'P01'}`, `DRAWN: Dex (Atomax Media Office) · ${new Date().toISOString().slice(0, 10)}`, 'DRAFT FOR CHECKING'].join('\n'), attach: 1, layer: 'SLD-TEXT' });
  const m = 15, bx = -m - 10, bxr = Math.max(right, tbx + tbW) + m, byb = tby - m, byt = maxY + m + 10;
  prims.push(P([[bx, byb], [bxr, byb], [bxr, byt], [bx, byt]], true, 'SLD-BORDER'));
  return { prims, bounds: { x0: bx, y0: byb, x1: bxr, y1: byt } };
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

Today you can make SINGLE LINE DIAGRAMS. Describe them as boards (busbars). Each board has incomers (chains drawn above the busbar, ending on it) and feeders (chains drawn below it). A chain is a list of items from top to bottom, each { "symbol": one of supply, generator, transformer, breaker, isolator, switchfuse, fuse, contactor, ct, meter, ups, cable, line, and as the LAST item of a feeder only: board, load, motor, earth, spare; "label": the text beside it }.
Labels: short, exactly as an engineer would write them, using what the project files say (ratings, cable sizes, tags, board names). Use a new line (\\n) between parts of a label, e.g. "Q1\\n630A TP MCCB". Do not invent ratings, cable sizes or tags that are not in the request or the files: if one is unknown write "TBC" in the label and list it in "notes".
If something essential is missing (which boards, how many feeders, what the supply is) and the files do not say, ask: reply with {"questions": ["...", "..."]} (max 4 short questions) and nothing else.
Otherwise reply with JSON only, no markdown:
{"kind":"sld","title":"...","drawingNumber":"... or TBC","revision":"P01","boards":[{"label":"MAIN LV BOARD\\n400V 3PH 4W 50Hz","incomers":[{"label":"optional text above","chain":[...]}],"feeders":[{"label":"optional text under the feeder","chain":[...]}]}],"notes":["..."],"summary":"one line for the engineer: what you drew and what is TBC"}`;

function parseReply(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Dex did not reply with a drawing spec');
  return JSON.parse(s.slice(a, b + 1));
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

module.exports = { SYSTEM, SYMBOLS, symbolOf, layoutSld, writeDxf, toSvg, parseReply, make };
