// Pictures of a drawing for the agents to look at: the whole sheet with a light A-H / 1-6 grid to point at, a zoom on any part of it,
// and two drawings side by side. SVG drawn from dxfread's primitives, turned into PNG by resvg (no browser, no AutoCAD needed).
'use strict';
const fs = require('fs'), path = require('path');
const FONT = path.join(__dirname, 'assets', 'fonts', 'LiberationSans-Regular.ttf');
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = (v) => Math.round(v * 1000) / 1000;
const COLS = 'ABCDEFGH'.split(''), ROWS = 6;

// a grid cell ("C4"), a span of cells ("B2:D4"), a named part of the sheet, or x0,y0,x1,y1 in drawing units
function regionOf(region, b) {
  const W = b.x1 - b.x0, H = b.y1 - b.y0, s = String(region || '').trim();
  const cell = (c) => { const m = c.match(/^([A-H])([1-6])$/i); if (!m) return null; const i = COLS.indexOf(m[1].toUpperCase()), j = +m[2] - 1; return [b.x0 + W * i / 8, b.y1 - H * (j + 1) / ROWS, b.x0 + W * (i + 1) / 8, b.y1 - H * j / ROWS]; };
  const named = { 'title block': [0.72, 0, 1, 0.2], title: [0.72, 0, 1, 0.2], 'revision box': [0.72, 0.18, 1, 0.4], revisions: [0.72, 0.18, 1, 0.4], notes: [0.72, 0.35, 1, 1], 'top left': [0, 0.5, 0.5, 1], 'top right': [0.5, 0.5, 1, 1], 'bottom left': [0, 0, 0.5, 0.5], 'bottom right': [0.5, 0, 1, 0.5], centre: [0.25, 0.25, 0.75, 0.75], center: [0.25, 0.25, 0.75, 0.75], left: [0, 0, 0.5, 1], right: [0.5, 0, 1, 1], top: [0, 0.5, 1, 1], bottom: [0, 0, 1, 0.5] };
  if (named[s.toLowerCase()]) { const [a, c, d, e] = named[s.toLowerCase()]; return { x0: b.x0 + W * a, y0: b.y0 + H * c, x1: b.x0 + W * d, y1: b.y0 + H * e }; }
  const span = s.match(/^([A-H][1-6])\s*[:\-]\s*([A-H][1-6])$/i);
  if (span) { const A = cell(span[1]), B = cell(span[2]); return { x0: Math.min(A[0], B[0]), y0: Math.min(A[1], B[1]), x1: Math.max(A[2], B[2]), y1: Math.max(A[3], B[3]) }; }
  const c1 = cell(s); if (c1) return { x0: c1[0], y0: c1[1], x1: c1[2], y1: c1[3] };
  const nums = s.split(/[\s,;]+/).map(Number).filter(Number.isFinite);
  if (nums.length === 4) return { x0: Math.min(nums[0], nums[2]), y0: Math.min(nums[1], nums[3]), x1: Math.max(nums[0], nums[2]), y1: Math.max(nums[1], nums[3]) };
  throw new Error(`Region "${s}" not understood: use a grid cell like C4, a span like B2:D4, a name (title block, revision box, notes, top left, centre ...) or x0,y0,x1,y1 in drawing units`);
}

function svg(prims, b, { grid = true, px = 2400, mono = false } = {}) {
  const W = b.x1 - b.x0, H = b.y1 - b.y0, k = px / Math.max(W, H), X = (x) => n((x - b.x0) * k), Y = (y) => n((b.y1 - y) * k), w = Math.round(W * k), h = Math.round(H * k);
  const sw = Math.max(0.6, 0.25 * k), stroke = (p) => mono ? '#000' : (p.hex === '#ffffff' ? '#000' : p.hex || '#000');
  const vis = (bb) => bb && bb[2] >= b.x0 && bb[0] <= b.x1 && bb[3] >= b.y0 && bb[1] <= b.y1;
  const box = require('./dxfread').boxOf;
  const out = [];
  for (const p of prims) if (p.t === 'fill' && vis(box(p))) out.push(`<path fill-rule="evenodd" d="${(p.rings || [p.pts]).map(r => 'M' + r.map(([x, y]) => X(x) + ' ' + Y(y)).join(' L') + ' Z').join(' ')}" fill="${p.hex === '#ffffff' ? '#fff' : (mono ? '#999' : p.hex)}"/>`);
  for (const p of prims) {
    if (!vis(box(p))) continue;
    if (p.t === 'line') out.push(`<line x1="${X(p.x1)}" y1="${Y(p.y1)}" x2="${X(p.x2)}" y2="${Y(p.y2)}" stroke="${stroke(p)}" stroke-width="${n(Math.max(sw, (p.width || 0) * k))}"/>`);
    else if (p.t === 'pline') out.push(`<polyline points="${p.pts.map(([x, y]) => X(x) + ',' + Y(y)).join(' ')}" fill="none" stroke="${stroke(p)}" stroke-width="${n(Math.max(sw, (p.width || 0) * k))}"/>`);
    else if (p.t === 'text') {
      const fs0 = n(p.h * k / 0.72), anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start', dy = p.valign === 'middle' ? p.h * k / 2 : p.valign === 'top' ? p.h * k : 0;
      const tf = `${p.rot ? `rotate(${n(-p.rot)} ${X(p.x)} ${Y(p.y)}) ` : ''}translate(${X(p.x)} ${n(Y(p.y) + dy)}) scale(${n(p.wf || 1)} 1)`;
      out.push(`<text transform="${tf}" font-size="${fs0}" text-anchor="${anchor}" fill="${stroke(p)}">${esc(p.text)}</text>`);
    } else if (p.t === 'mtext') {
      const ls = String(p.text).split('\n'), lh = p.h * 1.667 * (p.lineSpacing || 1), col = ((p.attach || 1) - 1) % 3, row = Math.floor(((p.attach || 1) - 1) / 3), H0 = p.h + (ls.length - 1) * lh;
      const top = row === 0 ? p.y : row === 1 ? p.y + H0 / 2 : p.y + H0, anchor = col === 1 ? 'middle' : col === 2 ? 'end' : 'start';
      const tspans = ls.map((l, i) => `<tspan x="${X(p.x)}" y="${Y(top - p.h - i * lh)}">${esc(l)}</tspan>`).join('');
      out.push(`<text ${p.rot ? `transform="rotate(${n(-p.rot)} ${X(p.x)} ${Y(p.y)})" ` : ''}font-size="${n(p.h * k / 0.72)}" text-anchor="${anchor}" fill="${stroke(p)}">${tspans}</text>`);
    }
  }
  if (grid) {   // a faint grid to point at: columns A-H left to right, rows 1-6 top to bottom
    const g = [], fsz = Math.max(14, px / 90);
    for (let i = 0; i <= 8; i++) g.push(`<line x1="${n(w * i / 8)}" y1="0" x2="${n(w * i / 8)}" y2="${h}" stroke="#4dabf7" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="6 6"/>`);
    for (let j = 0; j <= ROWS; j++) g.push(`<line x1="0" y1="${n(h * j / ROWS)}" x2="${w}" y2="${n(h * j / ROWS)}" stroke="#4dabf7" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="6 6"/>`);
    for (let i = 0; i < 8; i++) for (let j = 0; j < ROWS; j++) g.push(`<text x="${n(w * i / 8 + 4)}" y="${n(h * j / ROWS + fsz)}" font-size="${n(fsz)}" fill="#1c7ed6" fill-opacity="0.6">${COLS[i]}${j + 1}</text>`);
    out.push(...g);
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Liberation Sans"><rect width="100%" height="100%" fill="#fff"/>${out.join('')}</svg>`, w, h, k };
}

function png(svgText) {
  const { Resvg } = require('@resvg/resvg-js');
  const r = new Resvg(svgText, { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Liberation Sans' }, background: '#ffffff' });
  return r.render().asPng();
}

// the whole sheet, or one region of it, as a PNG
function picture(drawing, { region = '', px = 2000, grid } = {}) {
  const b0 = drawing.bounds, pad = Math.max(b0.x1 - b0.x0, b0.y1 - b0.y0) * 0.01, full = { x0: b0.x0 - pad, y0: b0.y0 - pad, x1: b0.x1 + pad, y1: b0.y1 + pad };
  const b = region ? regionOf(region, full) : full;
  const s = svg(drawing.prims, b, { grid: grid != null ? grid : !region, px });
  return { png: png(s.svg), width: s.w, height: s.h, bounds: b, sheet: full };
}

// two pictures side by side (each scaled to the same height), labelled
function sideBySide(a, b, { labels = ['THIS DRAWING', 'REFERENCE'], height = 1400 } = {}) {
  const enc = (buf) => 'data:image/png;base64,' + buf.toString('base64');
  const wa = Math.round(a.width * height / a.height), wb = Math.round(b.width * height / b.height), W = wa + wb + 30;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${height + 50}" font-family="Liberation Sans"><rect width="100%" height="100%" fill="#fff"/>
<text x="10" y="32" font-size="26" fill="#c92a2a">${esc(labels[0])}</text><text x="${wa + 40}" y="32" font-size="26" fill="#c92a2a">${esc(labels[1])}</text>
<image x="0" y="50" width="${wa}" height="${height}" xlink:href="${enc(a.png)}"/><line x1="${wa + 15}" y1="0" x2="${wa + 15}" y2="${height + 50}" stroke="#c92a2a" stroke-width="2"/><image x="${wa + 30}" y="50" width="${wb}" height="${height}" xlink:href="${enc(b.png)}"/></svg>`;
  return { png: png(s), width: W, height: height + 50 };
}

// a PDF page as a PNG: pdftoppm when the PC has it; otherwise the app's own window renders it (set by main.js)
let pdfRenderer = null;
function setPdfRenderer(fn) { pdfRenderer = fn; }
async function pdfPage(file, { page = 1, px = 2000 } = {}) {
  const { execFileSync } = require('child_process'), os = require('os');
  try {
    const out = path.join(os.tmpdir(), 'amo-pdf-' + process.pid + '-' + Date.now());
    execFileSync('pdftoppm', ['-png', '-f', String(page), '-l', String(page), '-scale-to', String(px), file, out], { stdio: 'ignore', timeout: 60000 });
    const made = fs.readdirSync(path.dirname(out)).filter(f => f.startsWith(path.basename(out))).map(f => path.join(path.dirname(out), f))[0];
    if (made) { const buf = fs.readFileSync(made); try { fs.unlinkSync(made); } catch {} return { png: buf, ...pngSize(buf) }; }
  } catch {}
  if (pdfRenderer) { const buf = await pdfRenderer(file, { page, px }); return { png: buf, ...pngSize(buf) }; }
  throw new Error('This PC cannot turn a PDF into a picture here. Read the PDF with the Read tool instead (it shows you its pages), or look at the DXF.');
}
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });
function cropPng(buf, frac) {   // a part of a PNG (fractions of its width and height), via an SVG wrapper
  const { width, height } = pngSize(buf), x = frac.x0 * width, y = (1 - frac.y1) * height, w = (frac.x1 - frac.x0) * width, h = (frac.y1 - frac.y0) * height, scale = 2000 / Math.max(w, h);
  const s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"><image x="${-x * scale}" y="${-y * scale}" width="${width * scale}" height="${height * scale}" xlink:href="data:image/png;base64,${buf.toString('base64')}"/></svg>`;
  const out = png(s); return { png: out, ...pngSize(out) };
}

module.exports = { svg, png, picture, sideBySide, regionOf, pdfPage, setPdfRenderer, cropPng, pngSize };
