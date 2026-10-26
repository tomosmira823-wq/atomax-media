// Marked-up copies of the drawings Cal found problems on. The original is never touched: each marked PDF is a
// new file in a MARKUPS folder next to the drawings, with the page left exactly as it was and the red notes
// printed in a strip added to the right of it, upright, so nothing can overlap the drawing.
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, degrees, PDFName } = require('pdf-lib');

const RED = rgb(0.85, 0.05, 0.05);
const ascii = (s) => String(s).replace(/→/g, '->').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E -ÿ]/g, '?');

function wrap(font, text, size, maxW) {
  const out = [];
  for (const para of ascii(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(tryLine, size) <= maxW) { line = tryLine; continue; }
      if (line) out.push(line);
      // a single word wider than the strip: break it
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxW && w.length > 1) { let n = w.length - 1; while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxW) n--; out.push(w.slice(0, n)); w = w.slice(n); }
      line = w;
    }
    out.push(line);
  }
  return out;
}

// lay the notes out in a column; returns { lines: [{text,bold,gapBefore}], height } for a given font size
function layoutNotes(fonts, notes, size, width, heading) {
  const lines = []; const lh = size * 1.3;
  wrap(fonts.bold, heading, size * 1.15, width).forEach(t => lines.push({ text: t, bold: true, size: size * 1.15 }));
  notes.forEach((n, i) => {
    const wrapped = wrap(fonts.reg, `${i + 1}. ${n}`, size, width);
    wrapped.forEach((t, j) => lines.push({ text: t, size, gapBefore: j === 0 ? size * 0.5 : 0, indent: j === 0 ? 0 : size * 1.2 }));
  });
  const height = lines.reduce((h, l) => h + (l.size || size) * 1.3 + (l.gapBefore || 0), 0);
  return { lines, height, lh };
}
function drawLines(page, fonts, lines, x, yTop, color) {
  let y = yTop;
  for (const l of lines) { y -= (l.gapBefore || 0); y -= (l.size) * 1.3; page.drawText(l.text, { x: x + (l.indent || 0), y: y + l.size * 0.3, size: l.size, font: l.bold ? fonts.bold : fonts.reg, color }); }
}

// pageNotes: Map(pageNumber(1-based) -> [note strings]); heading: e.g. the drawing number
async function markupFile({ buf, kind, name, pageNotes, headings }) {
  const out = await PDFDocument.create();
  const fonts = { reg: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) };
  const overflow = [];
  const addStrip = (page, w, h, stripW, notes, heading) => {
    const pad = Math.max(8, Math.min(w, h) / 120);
    let size = Math.max(7, Math.min(22, Math.min(w, h) / 70));
    let lay;
    for (; size >= 7; size -= 1) { lay = layoutNotes(fonts, notes, size, stripW - pad * 2, heading); if (lay.height <= h - pad * 2) break; }
    if (size < 7) size = 7;
    lay = layoutNotes(fonts, notes, size, stripW - pad * 2, heading);
    page.drawRectangle({ x: w, y: 0, width: stripW, height: h, color: rgb(1, 1, 1), borderColor: RED, borderWidth: Math.max(1.5, size / 6) });
    // if even the smallest size does not fit, print what fits and push the rest to a continuation page
    let fit = lay.lines, rest = [];
    if (lay.height > h - pad * 2) { let used = 0; fit = []; for (const l of lay.lines) { const hh = l.size * 1.3 + (l.gapBefore || 0); if (used + hh > h - pad * 2 - size * 2) { rest.push(l); continue; } used += hh; fit.push(l); } }
    drawLines(page, fonts, fit, w + pad, h - pad, RED);
    if (rest.length) { page.drawText('continued on the last page', { x: w + pad, y: pad, size, font: fonts.reg, color: RED }); overflow.push({ heading, lines: rest }); }
  };

  if (kind === 'pdf') {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const n = src.getPageCount();
    for (let i = 0; i < n; i++) {
      const sp = src.getPage(i), notes = pageNotes.get(i + 1) || (i === 0 ? pageNotes.get(0) : null);
      const rot = sp.getRotation().angle % 360;
      if (rot !== 0) {
        // rotated page: keep it byte-for-byte as it was and put its notes on the page after it
        const [cp] = await out.copyPages(src, [i]); out.addPage(cp);
        if (notes && notes.length) overflow.push({ heading: `Page ${i + 1}: ${headings.get(i + 1) || ''}`, lines: null, notes });
        continue;
      }
      let emb;
      try { if (!sp.node.get(PDFName.of('Contents'))) throw new Error('blank page'); emb = await out.embedPage(sp); }
      catch {
        // a page pdf-lib cannot embed (for example one with no content stream): keep it as it was and put its notes on a page after it
        const [cp] = await out.copyPages(src, [i]); out.addPage(cp);
        if (notes && notes.length) overflow.push({ heading: `Page ${i + 1}: ${headings.get(i + 1) || ''}`, lines: null, notes });
        continue;
      }
      const { width: w, height: h } = emb;
      if (!notes || !notes.length) { const pg = out.addPage([w, h]); pg.drawPage(emb, { x: 0, y: 0 }); continue; }
      const stripW = Math.max(240, Math.round(w * 0.24));
      const pg = out.addPage([w + stripW, h]); pg.drawPage(emb, { x: 0, y: 0 });
      addStrip(pg, w, h, stripW, notes, `CHECK NOTES ${headings.get(i + 1) || ''}`.trim());
    }
  } else {
    let img; const isPng = /\.png$/i.test(name);
    try { img = isPng ? await out.embedPng(buf) : await out.embedJpg(buf); } catch { throw new Error('Only PNG and JPG pictures can be marked up. Convert it to PDF first.'); }
    const w = img.width, h = img.height, notes = [...pageNotes.values()].flat(), stripW = Math.max(260, Math.round(w * 0.3));
    const pg = out.addPage([w + stripW, h]); pg.drawImage(img, { x: 0, y: 0, width: w, height: h });
    addStrip(pg, w, h, stripW, notes, `CHECK NOTES ${[...headings.values()][0] || ''}`.trim());
  }
  // notes that did not fit (or belong to rotated pages): one A4 notes page at the end
  if (overflow.length) {
    const W = 595, H = 842, pad = 40; let page = out.addPage([W, H]); let y = H - pad;
    const heading = (t) => { page.drawText(ascii(t), { x: pad, y: y - 14, size: 14, font: fonts.bold, color: RED }); y -= 24; };
    for (const o of overflow) {
      heading(o.heading || 'CHECK NOTES (continued)');
      const lines = o.lines || layoutNotes(fonts, o.notes, 11, W - pad * 2, '').lines.slice(0);
      for (const l of lines) { if (y < pad + 20) { page = out.addPage([W, H]); y = H - pad; } y -= (l.gapBefore || 0) + l.size * 1.3; page.drawText(l.text, { x: pad + (l.indent || 0), y: y + l.size * 0.3, size: l.size, font: l.bold ? fonts.bold : fonts.reg, color: RED }); }
      y -= 14;
    }
  }
  return Buffer.from(await out.save());
}

// Everything that cannot sit on a drawing (schedule rows, duplicates, drawings that were not supplied, files that were not read)
// goes on one notes sheet, so nothing that is still to be confirmed is left unmarked.
async function scheduleNotes({ report }) {
  const items = report.findings.filter(f => f.fi == null).map(f => `${f.text}${f.confirm ? ` [CONFIRM${f.reason ? ': ' + f.reason : ''}]` : ''}`);
  const unread = (report.notChecked || []).map(n => `NOT CHECKED: ${n}`);
  if (!items.length && !unread.length) return null;
  const out = await PDFDocument.create();
  const fonts = { reg: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) };
  const W = 595, H = 842, pad = 40;
  let page = out.addPage([W, H]), y = H - pad;
  const put = (lines) => { for (const l of lines) { if (y < pad + 20) { page = out.addPage([W, H]); y = H - pad; } y -= (l.gapBefore || 0) + l.size * 1.3; page.drawText(l.text, { x: pad + (l.indent || 0), y: y + l.size * 0.3, size: l.size, font: l.bold ? fonts.bold : fonts.reg, color: RED }); } };
  put(layoutNotes(fonts, [], 15, W - pad * 2, `CABLE SCHEDULE CHECK NOTES: ${report.schedule}`).lines);
  put(layoutNotes(fonts, [], 10, W - pad * 2, 'Items that could not be marked on a drawing. The schedule itself has not been changed.').lines.map(l => ({ ...l, bold: false })));
  y -= 8;
  if (items.length) put(layoutNotes(fonts, items, 11, W - pad * 2, 'Schedule items').lines);
  if (unread.length) { y -= 8; put(layoutNotes(fonts, unread, 11, W - pad * 2, 'Not read').lines); }
  return { buf: Buffer.from(await out.save()), count: items.length + unread.length };
}

// report.findings carry fi (index into drawings) and page; drawings carry { name, base64, path? }
async function makeMarkups({ report, drawings, fallbackDir }) {
  const res = { dir: '', made: [], failed: [], untouched: 0 };
  const byFile = new Map();
  for (const f of report.findings) {
    if (f.fi == null) continue;
    if (!byFile.has(f.fi)) byFile.set(f.fi, []);
    byFile.get(f.fi).push(f);
  }
  const firstWithPath = drawings.find(d => d.path);
  const dir = path.join(firstWithPath ? path.dirname(firstWithPath.path) : fallbackDir, 'MARKUPS');
  for (const [fi, list] of byFile) {
    const d = drawings[fi]; if (!d) continue;
    const ext = path.extname(d.name).toLowerCase();
    const kind = ext === '.pdf' ? 'pdf' : (['.png', '.jpg', '.jpeg'].includes(ext) ? 'image' : null);
    if (!kind) { if (/\.(gif|webp)$/i.test(ext)) res.failed.push({ name: d.name, reason: 'Only PDF, PNG and JPG drawings can be marked up.' }); continue; }
    const pageNotes = new Map(), headings = new Map();
    for (const f of list) {
      const pg = Number.isInteger(f.page) && f.page > 0 ? f.page : 1;
      if (!pageNotes.has(pg)) pageNotes.set(pg, []);
      pageNotes.get(pg).push(f.text + (f.confirm ? ` [CONFIRM${f.reason ? ': ' + f.reason : ''}]` : ''));
      if (!headings.has(pg)) headings.set(pg, f.group);
    }
    try {
      const buf = await markupFile({ buf: Buffer.from(d.base64, 'base64'), kind, name: d.name, pageNotes, headings });
      fs.mkdirSync(dir, { recursive: true });
      const base = path.basename(d.name, path.extname(d.name)) + '_MARKUP.pdf';
      let target = path.join(dir, base);
      if (fs.existsSync(target)) target = path.join(dir, path.basename(base, '.pdf') + '_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16) + '.pdf');
      fs.writeFileSync(target, buf);
      res.made.push({ name: d.name, out: target, notes: list.length });
    } catch (e) { res.failed.push({ name: d.name, reason: String(e.message || e).slice(0, 160) }); }
  }
  try {
    const n = await scheduleNotes({ report });
    if (n) {
      fs.mkdirSync(dir, { recursive: true });
      let target = path.join(dir, path.basename(String(report.schedule || 'schedule'), path.extname(String(report.schedule || ''))) + '_NOTES.pdf');
      if (fs.existsSync(target)) target = path.join(dir, path.basename(target, '.pdf') + '_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16) + '.pdf');
      fs.writeFileSync(target, n.buf); res.notes = { out: target, count: n.count };
    }
  } catch (e) { res.failed.push({ name: 'schedule notes sheet', reason: String(e.message || e).slice(0, 160) }); }
  res.dir = (res.made.length || res.notes) ? dir : '';
  res.untouched = drawings.length - byFile.size;
  return res;
}

module.exports = { makeMarkups, markupFile };
