// The house checks on any drawing (one Dex made, or a real one from a job), as a plain list an agent can work through:
// cable runs clashing, text overlapping text or linework, text smaller than 2, stacked single-line labels that should be one MTEXT,
// mixed fonts, labels out of line, spares, every cable on the master list / schedule present, symbols with gaps.
// Works from dxfread's primitives in sheet units. Border and title-block items are left out of the drawing-content checks.
'use strict';
const { boxOf, clipSeg } = require('./dxfread');

const BORDERISH = /BORDER|TITLE|FRAME|REVISION|SHEET|LOGO|DRAWING_TITLE|CLOUD|^DEFPOINTS$/i;
const isBorder = (p) => BORDERISH.test(p.layer || '') || BORDERISH.test(p.blk || '');
const r1 = (v) => Math.round(v * 10) / 10;
const where = (x, y) => `${r1(x)},${r1(y)}`;
const isText = (p) => p.t === 'text' || p.t === 'mtext';

function segsOf(prims, test = () => true) {
  const out = [];
  for (const p of prims) {
    if (!test(p)) continue;
    if (p.t === 'line') out.push({ a: [p.x1, p.y1], b: [p.x2, p.y2], p });
    else if (p.t === 'pline') for (let i = 1; i < p.pts.length; i++) out.push({ a: p.pts[i - 1], b: p.pts[i], p });
  }
  return out.filter(s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 1e-6);
}

// cable runs: never overlapping or crossing (layers with CABLE in the name)
function cableClashes(prims) {
  const segs = segsOf(prims, p => /CABLE/i.test(p.layer || '') && !isBorder(p)), e = 0.05, out = [];
  const between = (v, a, b) => v > Math.min(a, b) + e && v < Math.max(a, b) - e;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j]; if (A.p === B.p) continue;
    const [ax1, ay1] = A.a, [ax2, ay2] = A.b, [bx1, by1] = B.a, [bx2, by2] = B.b;
    const ha = Math.abs(ay1 - ay2) < e, hb = Math.abs(by1 - by2) < e, va = Math.abs(ax1 - ax2) < e, vb = Math.abs(bx1 - bx2) < e;
    if (ha && hb && Math.abs(ay1 - by1) < e && Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2)) - Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2)) > e) out.push(`cable runs on top of each other along y=${r1(ay1)} (x ${r1(Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2)))} to ${r1(Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2)))})`);
    else if (va && vb && Math.abs(ax1 - bx1) < e && Math.min(Math.max(ay1, ay2), Math.max(by1, by2)) - Math.max(Math.min(ay1, ay2), Math.min(by1, by2)) > e) out.push(`cable runs on top of each other along x=${r1(ax1)}`);
    else if (ha && vb && between(bx1, ax1, ax2) && between(ay1, by1, by2)) out.push(`cable runs cross at ${where(bx1, ay1)}`);
    else if (va && hb && between(ax1, bx1, bx2) && between(by1, ay1, ay2)) out.push(`cable runs cross at ${where(ax1, by1)}`);
  }
  return [...new Set(out)];
}

const shrink = (b, m) => [b[0] + m, b[1] + m, b[2] - m, b[3] - m];
const ov = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function textOverlaps(prims, { max = 40 } = {}) {
  const texts = prims.filter(p => isText(p) && !isBorder(p) && String(p.text).trim()).map(p => { const b = boxOf(p); const m = Math.min(0.3, p.h * 0.15); return { p, b: b && shrink(b, m) }; }).filter(t => t.b && t.b[2] > t.b[0] && t.b[3] > t.b[1]);
  const out = [];
  // text on text (a grid of cells keeps this quick on big sheets)
  const cell = 20, grid = new Map(), key = (i, j) => i + ',' + j;
  texts.forEach((t, k) => { for (let i = Math.floor(t.b[0] / cell); i <= Math.floor(t.b[2] / cell); i++) for (let j = Math.floor(t.b[1] / cell); j <= Math.floor(t.b[3] / cell); j++) { const kk = key(i, j); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(k); } });
  const seen = new Set();
  for (const list of grid.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    const a = texts[list[x]], b = texts[list[y]], id = list[x] < list[y] ? list[x] + '-' + list[y] : list[y] + '-' + list[x]; if (seen.has(id)) continue; seen.add(id);
    if (a.p.text === b.p.text && Math.abs(a.p.x - b.p.x) < 0.01 && Math.abs(a.p.y - b.p.y) < 0.01) { out.push(`"${short(a.p.text)}" is there twice, one on top of the other, at ${where(a.p.x, a.p.y)}`); continue; }
    if (ov(a.b, b.b)) out.push(`text "${short(a.p.text)}" overlaps text "${short(b.p.text)}" at ${where(a.p.x, a.p.y)}`);
  }
  // text on linework (drawing linework only, not the border's)
  const segs = segsOf(prims, p => !isBorder(p) && !/HATCH/i.test(p.type || ''));
  for (const t of texts) {
    for (const s of segs) {
      if (s.p.blk && s.p.blk === t.p.blk && s.p.blk !== '' && t.p.type === 'ATTRIB') continue;   // a symbol's own tag box
      if (clipSeg(s.a[0], s.a[1], s.b[0], s.b[1], t.b)) { out.push(`text "${short(t.p.text)}" has a line through it at ${where(t.p.x, t.p.y)} (line on ${s.p.layer})`); break; }
    }
    if (out.length > max * 3) break;
  }
  return cap([...new Set(out)], max);
}
const short = (s) => String(s).replace(/\n/g, ' | ').slice(0, 40);
const cap = (list, max) => list.length > max ? [...list.slice(0, max), `... and ${list.length - max} more like these`] : list;

function smallText(prims, min = 2) {
  const small = prims.filter(p => isText(p) && !isBorder(p) && p.h < min - 0.05 && String(p.text).trim());
  if (!small.length) return [];
  const byH = {}; for (const p of small) { const k = r1(p.h); (byH[k] = byH[k] || []).push(p); }
  return Object.entries(byH).map(([h, ps]) => `${ps.length} text item${ps.length > 1 ? 's' : ''} at height ${h} (standard is ${min}), e.g. "${short(ps[0].text)}" at ${where(ps[0].x, ps[0].y)}`);
}

// single-line texts stacked under each other with the same left edge and height: one label, should be one MTEXT
function stackedText(prims) {
  const ts = prims.filter(p => p.t === 'text' && !isBorder(p) && p.type === 'TEXT' && !p.rot).sort((a, b) => a.x - b.x || b.y - a.y), used = new Set(), out = [];
  for (let i = 0; i < ts.length; i++) {
    if (used.has(i)) continue; const run = [ts[i]];
    for (let j = i + 1; j < ts.length && Math.abs(ts[j].x - ts[i].x) < 0.05; j++) { const last = run[run.length - 1], gap = last.y - ts[j].y; if (Math.abs(ts[j].h - last.h) < 0.01 && gap > last.h * 0.9 && gap < last.h * 2.2 && ts[j].layer === last.layer) { run.push(ts[j]); used.add(j); } }
    if (run.length >= 2) out.push(`${run.length} single-line texts stacked as one label at ${where(run[0].x, run[0].y)} ("${short(run.map(r => r.text).join(' / '))}"): make it one MTEXT`);
  }
  return cap(out, 25);
}

function fonts(prims, styles = {}) {
  const used = {}; for (const p of prims) { if (!isText(p) || isBorder(p)) continue; const f = String(p.font || (styles[String(p.style || '').toUpperCase()] || {}).font || p.style || '?').toLowerCase(); used[f] = (used[f] || 0) + 1; for (const g of p.inlineFonts || []) { const k = 'inline ' + g.toLowerCase(); used[k] = (used[k] || 0) + 1; } }
  const list = Object.entries(used).sort((a, b) => b[1] - a[1]);
  if (list.length <= 1) return [];
  return [`text in ${list.length} different fonts: ${list.map(([f, n]) => `${f} (${n})`).join(', ')}; the drawing's text should all be in ${list[0][0]}`];
}

// labels in a column: left-aligned ones should share one x, right-aligned ones one end point
function alignment(prims) {
  const out = [];
  for (const side of ['left', 'right']) {
    const ts = prims.filter(p => p.t === 'text' && !isBorder(p) && !p.rot && p.align === side).sort((a, b) => a.x - b.x);
    let i = 0;
    while (i < ts.length) {
      const grp = [ts[i]]; let j = i + 1; while (j < ts.length && ts[j].x - ts[i].x < 3) grp.push(ts[j++]);
      if (grp.length >= 3) {
        const xs = {}; for (const g of grp) { const k = r1(g.x); xs[k] = (xs[k] || 0) + 1; }
        const mode = +Object.entries(xs).sort((a, b) => b[1] - a[1])[0][0];
        const off = grp.filter(g => Math.abs(g.x - mode) > 0.15), ys = grp.map(g => g.y), span = Math.max(...ys) - Math.min(...ys);
        if (off.length && off.length < grp.length / 2 && span < 400) for (const g of off) out.push(`"${short(g.text)}" (${side}-aligned at x=${r1(g.x)}) is out of line with the others in its column at x=${mode}`);
      }
      i = j;
    }
  }
  // a column mixing left- and right-aligned labels (side labels should all line up the same way)
  return cap(out, 25);
}

// line ends that stop just short of another line: a symbol not joined to its conductor
function gaps(prims, { tol = 0.8, max = 25 } = {}) {
  const segs = segsOf(prims, p => !isBorder(p) && !isText(p) && p.t !== 'fill');
  if (segs.length > 20000) return ['(too much linework to check for gaps)'];
  const cell = 5, grid = new Map(), key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  segs.forEach((s, k) => { const x0 = Math.min(s.a[0], s.b[0]) - tol, x1 = Math.max(s.a[0], s.b[0]) + tol, y0 = Math.min(s.a[1], s.b[1]) - tol, y1 = Math.max(s.a[1], s.b[1]) + tol; for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) { const kk = i + ',' + j; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(k); } });
  const dist = (pt, s) => { const [x, y] = pt, [ax, ay] = s.a, [bx, by] = s.b, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)); };
  const out = [], done = new Set();
  segs.forEach((s, k) => {
    for (const pt of [s.a, s.b]) {
      const near = grid.get(key(pt[0], pt[1])) || []; let best = Infinity, touch = false;
      const along = (o) => { const [ax, ay] = s.a, [bx, by] = s.b, L = Math.hypot(bx - ax, by - ay), [cx, cy] = o.a, [ex, ey] = o.b, L2 = Math.hypot(ex - cx, ey - cy); if (!L || !L2) return false; const cr = Math.abs(((bx - ax) * (ey - cy) - (by - ay) * (ex - cx)) / (L * L2)), off = Math.abs(((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / L); return cr < 0.01 && off < 0.02; };   // the next dash of a dashed line
      if (/AREA|DASH|HIDDEN|CENT(RE|ER)|BOUNDARY|ZONE|HOLD|CLOUD|SCOPE/i.test(s.p.layer || '')) continue;   // dashed outlines and clouds are meant to have gaps
      if (near.some(m => m !== k && segs[m].p.layer === s.p.layer && along(segs[m]) && dist(pt, segs[m]) < 5)) continue;   // a dash in a dashed run
      // a real gap: the line points at the next line and stops short of it (a free end of a cross or a tick is not one)
      const other = pt === s.a ? s.b : s.a, ux = pt[0] - other[0], uy = pt[1] - other[1], ul = Math.hypot(ux, uy) || 1;
      const closest = (o) => { const [ax, ay] = o.a, [bx, by] = o.b, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return [ax + t * dx, ay + t * dy]; };
      for (const m of near) { if (m === k || segs[m].p === s.p) continue; const d = dist(pt, segs[m]); if (d < 0.01) { touch = true; break; } if (d >= best || along(segs[m])) continue; const q = closest(segs[m]), cos = ((q[0] - pt[0]) * ux + (q[1] - pt[1]) * uy) / ((Math.hypot(q[0] - pt[0], q[1] - pt[1]) || 1) * ul); if (cos > 0.9) best = d; }
      if (!touch && best > 0.05 && best < tol) { const id = key(pt[0], pt[1]); if (done.has(id)) continue; done.add(id); out.push(`line end at ${where(pt[0], pt[1])} stops ${r1(best * 10) / 10 || '<0.1'} short of the next line, possibly not joined: zoom in to confirm (on ${s.p.layer}${s.p.blk ? ', in ' + s.p.blk : ''})`); }
    }
  });
  return cap(out, max);
}

// cables on the master list / schedule: each one's number must be written on the drawing; spares on the schedule shown too
function cablesPresent(prims, cables = []) {
  if (!cables.length) return [];
  const words = new Set(), all = prims.filter(isText).map(p => String(p.text).toUpperCase()).join('\n');
  for (const m of all.matchAll(/[A-Z0-9][A-Z0-9/_.\-]*/g)) words.add(m[0]);
  const norm = (s) => String(s).toUpperCase().replace(/\s+/g, '');
  const missing = cables.filter(c => { const n = norm(c.no || c); return n && !words.has(n) && !all.replace(/\s+/g, '').includes(n); });
  return missing.length ? [`${missing.length} of ${cables.length} cables on the schedule are not on the drawing: ${missing.slice(0, 30).map(c => c.no || c).join(', ')}${missing.length > 30 ? ' …' : ''}`] : [];
}
function spares(prims, cables = []) {
  const shown = prims.filter(p => isText(p) && /\bSPARE\b/i.test(p.text)).length;
  const sched = cables.filter(c => /spare/i.test(JSON.stringify(c))).length;
  if (sched && !shown) return [`the schedule has ${sched} spare${sched > 1 ? 's' : ''} but no SPARE is shown on the drawing (spares must always be shown)`];
  return [];
}

// cable numbers from a workbook read by checker.readXlsx / readCsv: the column headed cable no / number / ref / tag
function cablesFromWorkbook(wb) {
  const out = [];
  for (const sh of wb || []) {
    const raw = sh.rows || sh.data || [], rows = raw.map(r => Array.isArray(r) ? r : (r && r.c) || []), struck = raw.map(r => !!(r && r.st && r.st.length && r.st.filter(Boolean).length > r.st.length / 2)); let hi = -1, col = -1;
    for (let r = 0; r < Math.min(15, rows.length) && col < 0; r++) { const row = rows[r] || []; row.forEach((v, c) => { if (col < 0 && /^cable\s*(no\.?|number|ref(erence)?|tag|id)\b|^cable$/i.test(String(v || '').trim())) { col = c; hi = r; } }); }
    if (col < 0) continue;
    for (let r = hi + 1; r < rows.length; r++) { const row = rows[r] || [], v = String(row[col] || '').trim(); if (struck[r] || !v || /^(total|notes?)\b/i.test(v)) continue; out.push({ no: v, row: row.map(x => String(x == null ? '' : x)).join(' | ') }); }
  }
  return out;
}

function run(drawing, { cables = [] } = {}) {
  // a layout with viewports: the sheet's own linework is the border and title block; the drawing is what shows through the viewports
  const viaVp = drawing.space !== 'model' && drawing.prims.some(p => p.space === 'model');
  const P = viaVp ? drawing.prims.filter(p => p.space === 'model') : drawing.prims, sections = [
    ['Cable runs overlapping or crossing', cableClashes(P)],
    ['Text overlapping text or linework', textOverlaps(P)],
    ['Text height (standard 2)', smallText(P)],
    ['Multi-line labels as stacked single-line text (should be MTEXT)', stackedText(P)],
    ['Fonts', fonts(P, drawing.styles)],
    ['Labels out of line', alignment(P)],
    ['Spares shown', spares(P, cables)],
    ['Cables on the schedule / master list present', cablesPresent(P, cables)],
    ['Symbols joined (line ends stopping short)', gaps(P)],
  ];
  const problems = sections.reduce((n, [, l]) => n + l.length, 0);
  const text = sections.map(([name, l]) => `${l.length ? '✗' : '✓'} ${name}${l.length ? ':\n' + l.map(x => '   - ' + x).join('\n') : ''}`).join('\n')
    + (viaVp ? `\nChecked the drawing seen through the viewports of layout "${drawing.space}"; the layout's own border and title block were not checked (zoom in and look at them).` : '')
    + `\n${cables.length ? '' : '(No schedule given: cables-present and spares were not checked against one.)\n'}Coordinates are in the drawing's ${drawing.space === 'model' ? 'model-space' : 'sheet (paper)'} units.`;
  return { problems, sections: sections.map(([name, items]) => ({ name, items })), text };
}

module.exports = { run, cableClashes, textOverlaps, smallText, stackedText, fonts, alignment, gaps, cablesPresent, spares, cablesFromWorkbook, isBorder };
