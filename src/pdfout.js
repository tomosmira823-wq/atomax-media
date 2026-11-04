// A monochrome PDF of a drawing Dex made, from the same primitives as its DXF (issue drawings go out as DXF and PDF, in black and white).
// The sheet is printed to fit an A3 landscape page by default (the A0 border scales down; text at height 2 x the drawing scale stays readable).
'use strict';
const { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = require('pdf-lib');
const PAGES = { A3: [1190.55, 841.89], A2: [1683.78, 1190.55], A1: [2383.94, 1683.78], A0: [3370.39, 2383.94] };

// one PDF, one page per sheet (a drawing of several sheets goes out as one combined PDF)
async function toPdfPages(pages, { title = '' } = {}) {
  const doc = await PDFDocument.create(); if (title) doc.setTitle(title); doc.setProducer('Atomax Media Office (Dex)');
  let font; try { doc.registerFontkit(require('@pdf-lib/fontkit')); font = await doc.embedFont(require('fs').readFileSync(require('path').join(__dirname, 'assets', 'fonts', 'LiberationSans-Regular.ttf')), { subset: true }); } catch { font = await doc.embedFont(StandardFonts.Helvetica); }
  for (const pgd of pages) drawPage(doc, font, pgd.prims, pgd.bounds, pgd.page);
  return Buffer.from(await doc.save());
}
async function toPdf(prims, b, { page = 'A3', title = '' } = {}) { return toPdfPages([{ prims, bounds: b, page }], { title }); }
function drawPage(doc, font, prims, b, page) {
  prims = require('./dxfmaker').flatPrims(prims);
  const [PW, PH] = PAGES[page] || PAGES.A3, pg = doc.addPage([PW, PH]);
  const m = 14, s = Math.min((PW - 2 * m) / (b.x1 - b.x0), (PH - 2 * m) / (b.y1 - b.y0));
  const ox = m + ((PW - 2 * m) - (b.x1 - b.x0) * s) / 2, oy = m + ((PH - 2 * m) - (b.y1 - b.y0) * s) / 2;
  const X = (x) => ox + (x - b.x0) * s, Y = (y) => oy + (y - b.y0) * s, black = rgb(0, 0, 0), lw = (p) => Math.max(0.35, (p.width || 0) * s) * (p.layer === 'SLD-BUS' ? 2 : 1) * (p.colour === 1 ? 2.4 : 1);   // red (new) runs print thick in black and white
  const arcPts = (p, a0, a1) => { let e = a1; while (e <= a0) e += 360; const n = Math.max(8, Math.ceil((e - a0) / 10)), out = []; for (let i = 0; i <= n; i++) { const a = (a0 + (e - a0) * i / n) * Math.PI / 180; out.push([p.x + p.r * Math.cos(a), p.y + p.r * Math.sin(a)]); } return out; };
  // a scalloped polyline (a revision cloud): every segment is an arc, bowing to the right of travel for a positive bulge, flattened to short lines
  const bulged = (p) => { const th = 4 * Math.atan(p.bulge), pts = p.closed ? [...p.pts, p.pts[0]] : p.pts, out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], c = Math.hypot(bx - ax, by - ay); if (!c) continue; const r = c / (2 * Math.sin(th / 2)), mx = (ax + bx) / 2, my = (ay + by) / 2, d = Math.sqrt(Math.max(0, r * r - c * c / 4)), nx = (by - ay) / c, ny = -(bx - ax) / c, sgn = p.bulge > 0 ? -1 : 1, cx = mx + sgn * d * nx, cy = my + sgn * d * ny; let a0 = Math.atan2(ay - cy, ax - cx), a1 = Math.atan2(by - cy, bx - cx); if (p.bulge > 0) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; } const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18))); for (let k = 1; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } } return out; };
  const poly = (pts, closed, p) => { for (let i = 1; i < pts.length; i++) pg.drawLine({ start: { x: X(pts[i - 1][0]), y: Y(pts[i - 1][1]) }, end: { x: X(pts[i][0]), y: Y(pts[i][1]) }, thickness: lw(p), color: black }); if (closed && pts.length > 2) pg.drawLine({ start: { x: X(pts[pts.length - 1][0]), y: Y(pts[pts.length - 1][1]) }, end: { x: X(pts[0][0]), y: Y(pts[0][1]) }, thickness: lw(p), color: black }); };
  const clean = (t) => String(t).replace(/[\r\t]/g, ' ').replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2126\u03A9\u00B5]/g, '');   // the embedded font has ², °, Ω, µ
  // fills first (grey in black and white), then lines, then text on top
  for (const p of prims) if (p.t === 'fill' && p.pts && p.pts.length > 2) pg.drawSvgPath((p.rings || [p.pts]).map(r => 'M' + r.map(([x, y]) => `${X(x) - X(b.x0)} ${-(Y(y) - Y(b.y0))}`).join(' L') + ' Z').join(' '), { x: X(b.x0), y: Y(b.y0), color: p.rgb ? rgb(p.rgb[0] / 255, p.rgb[1] / 255, p.rgb[2] / 255) : p.layer === 'SLD-BORDER' ? rgb(0, 0, 0) : p.colour === 1 ? rgb(0.55, 0.55, 0.55) : rgb(0.82, 0.82, 0.82), borderWidth: 0 });
  for (const p of prims) {
    if (p.t === 'line') pg.drawLine({ start: { x: X(p.x1), y: Y(p.y1) }, end: { x: X(p.x2), y: Y(p.y2) }, thickness: lw(p), color: black });
    else if (p.t === 'pline') poly(p.bulge ? bulged(p) : p.pts, p.closed && !p.bulge, p);
    else if (p.t === 'circle') pg.drawEllipse({ x: X(p.x), y: Y(p.y), xScale: p.r * s, yScale: p.r * s, borderColor: black, borderWidth: lw(p) });
    else if (p.t === 'arc') poly(arcPts(p, p.a0, p.a1), false, p);
  }
  for (const p of prims) {
    if (p.t !== 'text' && p.t !== 'mtext') continue;
    const size = Math.max(2, p.h * s / 0.774), pitch = p.t === 'mtext' ? p.h * 1.7 * s : 0;
    // MTEXT wraps at its width, as AutoCAD does
    const maxW = p.t === 'mtext' && p.w ? p.w * s : 0, rows = [];
    for (const line of String(p.text).split('\n').map(clean)) { if (!maxW || font.widthOfTextAtSize(line, size) <= maxW) { rows.push(line); continue; } let cur = ''; for (const w of line.split(' ')) { const t = cur ? cur + ' ' + w : w; if (cur && font.widthOfTextAtSize(t, size) > maxW) { rows.push(cur); cur = w; } else cur = t; } if (cur) rows.push(cur); }
    rows.forEach((row, i) => {
      if (!row) return;
      const wf = p.wf || 0.9, w = font.widthOfTextAtSize(row, size) * wf;   // house lettering: letters at 0.9 width
      let x = X(p.x), y = Y(p.y);
      if (p.t === 'text') { const sh = p.align === 'center' ? w / 2 : p.align === 'right' ? w : 0, r = (p.rot || 0) * Math.PI / 180; x -= sh * Math.cos(r); y -= sh * Math.sin(r); }
      else {
        const H = rows.length * pitch, att = p.attach || 1, col = (att - 1) % 3, rowA = Math.floor((att - 1) / 3);
        if (col === 1) x -= w / 2; else if (col === 2) x -= w;
        const top = rowA === 0 ? Y(p.y) : rowA === 1 ? Y(p.y) + H / 2 : Y(p.y) + H;
        y = top - (i + 1) * pitch + (pitch - p.h * s) / 2;
      }
      // squeezed (and turned) about its own start point
      const r0 = (p.t === 'text' ? p.rot || 0 : 0) * Math.PI / 180, cs = Math.cos(r0), sn = Math.sin(r0);
      pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(cs * wf, sn * wf, -sn, cs, x, y)); pg.drawText(row, { x: 0, y: 0, size, font, color: black }); pg.pushOperators(popGraphicsState());
    });
  }
}
// the PDF next to each DXF of a make() result (same name, .pdf)
async function writePdfs(res, opts = {}) {
  const fs = require('fs'), out = [];
  for (const f of res.files || []) { if (!f.prims && !f.pages) continue; const p = f.path.replace(/\.dxf$/i, '.pdf'); fs.writeFileSync(p, await toPdfPages(f.pages || [{ prims: f.prims, bounds: f.bounds, page: f.page }], opts)); out.push(p); f.pdf = p; delete f.prims; delete f.pages; }
  return out;
}
module.exports = { toPdf, toPdfPages, writePdfs };
