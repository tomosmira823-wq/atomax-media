// The check every revision has to pass before the row may say "made": the output is compared with the working file it came from, by
// what is actually in the files, not by what the code meant to do. A failure is reported in plain words and the row says "needs you".
'use strict';
const fs = require('fs');
const D = require('./dxffix'), R = require('./revup');

const norm = (t) => String(t || '').toUpperCase().replace(/\s+/g, ' ').trim();
const texts = (dx) => dx.ents.filter(e => e.plain && e.section !== 'BLOCKS').map(e => norm(e.plain));
const bag = (arr) => { const m = new Map(); for (const t of arr) m.set(t, (m.get(t) || 0) + 1); return m; };
function lev(a, b) { if (Math.abs(a.length - b.length) > 3) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const highBytes = (buf) => { let n = 0; for (const b of buf) if (b >= 0x80) n++; return n; };
function colourOf(dx, e) { for (let i = e.at + 1; i < e.end; i++) { const p = dx.pairs[i]; if (p.code === 101) break; if (p.code === 62) return p.val.trim(); } return 'bylayer'; }

// src: the working file; edited: after Dex's text edits; out: the file written to the issue folder
// fixes: what Dex was going to do; results: what applyFixes reports; asked: the instruction text; next: the revision expected
function revision({ src, edited, out, fixes = [], results = [], asked = '', next = '', wantBlack = false }) {
  const fail = [], note = [];
  let S, E, O; try { S = D.parseDxf(src); E = D.parseDxf(edited); O = D.parseDxf(out); } catch (e) { return { ok: false, fail: ['the file written does not open as a DXF: ' + e.message], note }; }

  // 1. every edit Dex made is one somebody asked for: the new text is in the instruction, or it is a typo-sized correction of the old
  const A = norm(asked);
  results.forEach((r, i) => { const f = fixes[i] || {}; if (r.status !== 'applied' || f.action !== 'replace_text') return;
    const after = norm(f.after), before = norm(f.before);
    if (!A.includes(after) && lev(before, after) > 2) fail.push(`"${f.before}" was changed to "${f.after}", but "${f.after}" is not in anything asked for on this drawing`); });

  // 2. the text edits changed only what they said: the edited copy differs from the working file in exactly those texts
  const bs = bag(texts(S)), be = bag(texts(E));
  const gone = [...bs].filter(([k, v]) => (be.get(k) || 0) < v).map(([k]) => k), added = [...be].filter(([k, v]) => (bs.get(k) || 0) < v).map(([k]) => k);
  const explained = (t) => fixes.some(f => (f.action === 'replace_text' && (norm(t).includes(norm(f.before)) || norm(t).includes(norm(f.after)))) || (f.action === 'delete_text' && norm(t) === norm(f.before)) || (f.action === 'add_text' && norm(t) === norm(f.text)));
  for (const t of [...gone, ...added]) if (!explained(t)) fail.push(`"${t}" changed on the drawing and no edit explains it`);

  // 3. the rev up added one issue box and moved the revision on, nothing more
  const bo = bag(texts(O)), extra = [...bo].reduce((n, [k, v]) => n + Math.max(0, v - (be.get(k) || 0)), 0), lost = [...be].filter(([k, v]) => (bo.get(k) || 0) < v).map(([k]) => k).filter(k => !/^[PCAX]\d{2}$/.test(k));
  if (lost.length) fail.push(`the rev up lost text from the drawing: ${lost.slice(0, 5).join(', ')}`);
  const ib = R.issueBoxes(O.pairs, R.entities(O.pairs));
  if (!ib) fail.push('no issue boxes found on the revised sheet');
  else if (next && ib.rev !== next) fail.push(`the newest issue box reads ${ib.rev}, not ${next}`);
  if (ib && extra > ib.box.length + 2) fail.push(`the rev up added ${extra} text items, more than one issue box`);

  // 4. the boxes are drawn straight and the special characters survived (² ° ±)
  if (R.repairBoxes(out).fixed) fail.push('the new issue box texts are skewed or the characters are double-encoded (Ã‚Â²)');
  if (highBytes(out) < highBytes(src)) fail.push('special characters (² ° ±) were lost on the way through');

  // 5. "all text black" means it: no text on the drawing in another colour, inline colour codes included
  if (wantBlack) { const left = O.ents.filter(e => e.plain && e.section !== 'BLOCKS' && (colourOf(O, e) !== '7' || e.refs.some(r => /\\[Cc]\d+;/.test(O.pairs[r].val)))); if (left.length) fail.push(`${left.length} text item(s) are still not black, e.g. ${left.slice(0, 3).map(e => '"' + e.plain.slice(0, 30) + '"').join(', ')}`); const inBlocks = O.ents.filter(e => e.plain && e.section === 'BLOCKS').length; if (inBlocks) note.push(`${inBlocks} text items inside symbols (logo, title-block blocks) were left as drawn`); }

  return { ok: !fail.length, fail, note };
}

// the PDF: written by this plot, one page, the sheet size the layout is set up for
function pdf(file, { since = 0, w = 0, h = 0 } = {}) {
  const fail = [];
  if (!fs.existsSync(file)) return { ok: false, fail: ['there is no PDF'] };
  const st = fs.statSync(file); if (since && st.mtimeMs < since - 2000) fail.push('the PDF is an old one, not from this plot');
  const head = fs.readFileSync(file).toString('latin1'); const pages = (head.match(/\/Type\s*\/Page(?!s)/g) || []).length; if (pages !== 1) fail.push(`the PDF has ${pages} pages, not 1`);
  const mb = head.match(/\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/);
  if (mb && w && h) { const pw = (+mb[3] - +mb[1]) * 25.4 / 72, ph = (+mb[4] - +mb[2]) * 25.4 / 72; const ok = (Math.abs(pw - w) < 3 && Math.abs(ph - h) < 3) || (Math.abs(pw - h) < 3 && Math.abs(ph - w) < 3); if (!ok) fail.push(`the PDF page is ${Math.round(pw)} x ${Math.round(ph)} mm, the sheet is ${w} x ${h}`); }
  return { ok: !fail.length, fail };
}
module.exports = { revision, pdf };
