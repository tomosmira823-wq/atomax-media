// A monochrome PDF of a drawing Dex made, from the same primitives as its DXF (issue drawings go out as DXF and PDF, in black and white).
// The sheet is printed to fit an A3 landscape page by default (the A0 border scales down; text at height 2 x the drawing scale stays readable).
'use strict';
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const PAGES = { A3: [1190.55, 841.89], A1: [2383.94, 1683.78], A0: [3370.39, 2383.94] };

async function toPdf(prims, b, { page = 'A3', title = '' } = {}) {
  prims = require('./dxfmaker').flatPrims(prims);
  const doc = await PDFDocument.create(); if (title) doc.setTitle(title); doc.setProducer('Atomax Media Office (Dex)');
  const [PW, PH] = PAGES[page] || PAGES.A3, pg = doc.addPage([PW, PH]), font = await doc.embedFont(StandardFonts.Helvetica);
  const m = 14, s = Math.min((PW - 2 * m) / (b.x1 - b.x0), (PH - 2 * m) / (b.y1 - b.y0));
  const ox = m + ((PW - 2 * m) - (b.x1 - b.x0) * s) / 2, oy = m + ((PH - 2 * m) - (b.y1 - b.y0) * s) / 2;
  const X = (x) => ox + (x - b.x0) * s, Y = (y) => oy + (y - b.y0) * s, black = rgb(0, 0, 0), lw = (p) => Math.max(0.35, (p.width || 0) * s) * (p.layer === 'SLD-BUS' ? 2 : 1) * (p.colour === 1 ? 2.4 : 1);   // red (new) runs print thick in black and white
  const arcPts = (p, a0, a1) => { let e = a1; while (e <= a0) e += 360; const n = Math.max(8, Math.ceil((e - a0) / 10)), out = []; for (let i = 0; i <= n; i++) { const a = (a0 + (e - a0) * i / n) * Math.PI / 180; out.push([p.x + p.r * Math.cos(a), p.y + p.r * Math.sin(a)]); } return out; };
  const poly = (pts, closed, p) => { for (let i = 1; i < pts.length; i++) pg.drawLine({ start: { x: X(pts[i - 1][0]), y: Y(pts[i - 1][1]) }, end: { x: X(pts[i][0]), y: Y(pts[i][1]) }, thickness: lw(p), color: black }); if (closed && pts.length > 2) pg.drawLine({ start: { x: X(pts[pts.length - 1][0]), y: Y(pts[pts.length - 1][1]) }, end: { x: X(pts[0][0]), y: Y(pts[0][1]) }, thickness: lw(p), color: black }); };
  const clean = (t) => String(t).replace(/[^\x20-\x7E -ÿ]/g, (c) => ({ '²': '2', '–': '-', '—': '-', '°': 'deg' })[c] || '');
  // fills first (grey in black and white), then lines, then text on top
  for (const p of prims) if (p.t === 'fill' && p.pts && p.pts.length > 2) pg.drawSvgPath((p.rings || [p.pts]).map(r => 'M' + r.map(([x, y]) => `${X(x) - X(b.x0)} ${-(Y(y) - Y(b.y0))}`).join(' L') + ' Z').join(' '), { x: X(b.x0), y: Y(b.y0), color: p.layer === 'SLD-BORDER' ? rgb(0, 0, 0) : p.colour === 1 ? rgb(0.55, 0.55, 0.55) : rgb(0.82, 0.82, 0.82), borderWidth: 0 });
  for (const p of prims) {
    if (p.t === 'line') pg.drawLine({ start: { x: X(p.x1), y: Y(p.y1) }, end: { x: X(p.x2), y: Y(p.y2) }, thickness: lw(p), color: black });
    else if (p.t === 'pline') poly(p.pts, p.closed, p);
    else if (p.t === 'circle') pg.drawEllipse({ x: X(p.x), y: Y(p.y), xScale: p.r * s, yScale: p.r * s, borderColor: black, borderWidth: lw(p) });
    else if (p.t === 'arc') poly(arcPts(p, p.a0, p.a1), false, p);
  }
  for (const p of prims) {
    if (p.t !== 'text' && p.t !== 'mtext') continue;
    const size = Math.max(2, p.h * s / 0.72), rows = String(p.text).split('\n').map(clean), pitch = p.t === 'mtext' ? p.h * 1.7 * s : 0;
    rows.forEach((row, i) => {
      if (!row) return;
      const w = font.widthOfTextAtSize(row, size);
      let x = X(p.x), y = Y(p.y);
      if (p.t === 'text') { if (p.align === 'center') x -= w / 2; else if (p.align === 'right') x -= w; }
      else {
        const H = rows.length * pitch, att = p.attach || 1, col = (att - 1) % 3, rowA = Math.floor((att - 1) / 3);
        if (col === 1) x -= w / 2; else if (col === 2) x -= w;
        const top = rowA === 0 ? Y(p.y) : rowA === 1 ? Y(p.y) + H / 2 : Y(p.y) + H;
        y = top - (i + 1) * pitch + (pitch - p.h * s) / 2;
      }
      pg.drawText(row, { x, y, size, font, color: black, ...(p.rot ? { rotate: degrees(p.rot) } : {}) });
    });
  }
  return Buffer.from(await doc.save());
}
// the PDF next to each DXF of a make() result (same name, .pdf)
async function writePdfs(res, opts = {}) {
  const fs = require('fs'), out = [];
  for (const f of res.files || []) { if (!f.prims) continue; const p = f.path.replace(/\.dxf$/i, '.pdf'); fs.writeFileSync(p, await toPdf(f.prims, f.bounds, { page: f.page, ...opts })); out.push(p); f.pdf = p; delete f.prims; }
  return out;
}
module.exports = { toPdf, writePdfs };
