// Rev up a Word or Excel document the way the office does it by hand: a new row in the Document Approval and Revision History (or
// Record of Changes) tables under the last one, the Rev and Date in the running header and on the cover, nothing else in the document
// touched. Edited at the XML level so the document keeps every style, picture and field it had. An Excel register gets its new revision
// row on the cover sheet and the cover's Revision / Revision Date cells follow it.
'use strict';
const JSZip = require('jszip');
const { setCell } = require('./rfireg');

const REV = /\b([PCAX]\d{2})\b/;
const DATE = /^\d{1,2}\/\d{1,2}\/(\d{2}|\d{4})$/;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const nextOf = (rev) => String(rev).replace(/\d+$/, (n) => String(+n + 1).padStart(n.length, '0'));
// today in the shape of the date it replaces (28/10/2026 -> 05/11/2026, 28/10/26 -> 05/11/26)
function todayLike(sample, when) {
  const d = when ? new Date(when) : new Date(); const yy = String(d.getFullYear());
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${/\/\d{2}$/.test(sample || '') ? yy.slice(2) : yy}`;
}
const text = (xml) => unesc(xml.replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')).trim();
const hex8 = () => (Math.floor(Math.random() * 0x7fffffff) + 1).toString(16).toUpperCase().padStart(8, '0');

// the text of a table cell set to one value: the first text run keeps its formatting and takes the value, the others go empty
function setTc(tc, value) {
  let n = 0;
  let out = tc.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>|<w:t\/>/g, (m, attrs) => { n++; return n === 1 ? `<w:t xml:space="preserve">${esc(value)}</w:t>` : '<w:t xml:space="preserve"></w:t>'; });
  if (n) return out;
  // an empty cell: a run in its first paragraph, with the paragraph mark's own run properties
  return out.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>|<w:p\b([^>]*)\/>/, (m, a1, inner, a2) => {
    const rpr = (inner || '').match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/); const r = `<w:r>${rpr ? rpr[1] : ''}<w:t xml:space="preserve">${esc(value)}</w:t></w:r>`;
    return m.endsWith('/>') ? `<w:p${a2 || ''}>${r}</w:p>` : `<w:p${a1 || ''}>${inner}${r}</w:p>`;
  });
}
// a replacement that may straddle several text runs (Word splits "X11475-BGN-ZZ-XX-SP-E-7005" into 6 runs as it is edited): the match
// goes into the first run it starts in, the rest of it comes out of the runs that follow; a match across two paragraphs is not one
function replaceAcrossRuns(xml, re, fn) {
  const ts = [...xml.matchAll(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>|<w:t\/>/g)].map(m => ({ start: m.index, end: m.index + m[0].length, attrs: m[1] || '', text: unesc(m[2] || '') }));
  const pos = []; let S = ''; const map = []; ts.forEach((t, i) => { pos.push(S.length); for (let k = 0; k < t.text.length; k++) map.push(i); S += t.text; });
  const matches = [...S.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))].reverse(); if (!matches.length) return { xml, n: 0 };
  const out = ts.map(t => t.text); let n = 0;
  for (const m of matches) {
    if (!m[0]) continue; const a = m.index, b = a + m[0].length - 1, i0 = map[a], i1 = map[b];
    if (i0 !== i1 && /<\/w:p>/.test(xml.slice(ts[i0].end, ts[i1].start))) continue;
    const rep = fn(m[0], ...m.slice(1)), off0 = a - pos[i0], off1 = b + 1 - pos[i1];
    if (i0 === i1) out[i0] = out[i0].slice(0, off0) + rep + out[i0].slice(off1);
    else { out[i0] = out[i0].slice(0, off0) + rep; for (let i = i0 + 1; i < i1; i++) out[i] = ''; out[i1] = out[i1].slice(off1); }
    n++;
  }
  if (!n) return { xml, n: 0 };
  for (let i = ts.length - 1; i >= 0; i--) if (out[i] !== ts[i].text) xml = xml.slice(0, ts[i].start) + `<w:t xml:space="preserve">${esc(out[i])}</w:t>` + xml.slice(ts[i].end);
  return { xml, n };
}
const cellsOf = (tr) => tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
const describe = (prev, status) => {
  const p = String(prev || '').trim(); if (!p) return `Re-Issued ${status || 'For Comment'}.`;
  if (/^re-?issued/i.test(p)) return p;
  const m = p.match(/^(issued)\b(.*)$/i); if (m) return (m[1] === 'ISSUED' ? 'RE-ISSUED' : m[1][0] === 'I' ? 'Re-Issued' : 're-issued') + m[2];
  return p;
};

// a Word document: { to, date, description, renumber: { from, to } } -> { buf, from, to, changes }
async function revUpDocx(buf, opts = {}) {
  const zip = await JSZip.loadAsync(buf);
  const parts = Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  let doc = await zip.file('word/document.xml').async('string');
  // the current rev: the Rev cell of the running header, else the last row of a revision table, else what the caller says
  let cur = opts.from || '';
  if (!cur) { for (const n of parts.filter(p => /header/.test(p))) { const h = await zip.file(n).async('string'); const m = text(h).match(/Rev\.?:?\s*([PCAX]\d{2})\b/i); if (m) { cur = m[1].toUpperCase(); break; } } }
  if (!cur) { const revs = []; for (const tr of doc.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []) { const c = cellsOf(tr); if (c.length >= 2 && /^[PCAX]\d{2}$/i.test(text(c[0]))) revs.push(text(c[0]).toUpperCase()); } cur = revs.sort().pop() || ''; }
  if (!cur) throw new Error('no revision found in the document (no Rev in the header and no revision table)');
  const next = opts.to && /^[PCAX]\d{2}$/i.test(opts.to) ? opts.to.toUpperCase() : nextOf(cur);
  if (next === cur) throw new Error(`the document is already at ${cur}`);
  const changes = { rows: 0, header: 0, cover: 0, keywords: 0, renumbered: 0 };
  const tok = new RegExp(`\\b${cur}\\b`, 'g'), has = new RegExp(`\\b${cur}\\b`);
  // tables: the row that starts with the current rev (Document Approval, Revision History, Record of Changes) is followed by the new
  // one: written into the blank row the template keeps underneath when there is one, else a copy of the row
  const fillRow = (src, dst) => {
    const cells = cellsOf(src); let k = 0;
    return dst.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (tc) => {
      const i = k++, t = text(cells[i] || '');
      if (i === 0) return setTc(tc, next);
      if (DATE.test(t)) return setTc(tc, todayLike(t, opts.date));
      if (/issued|issue|comment|information|approval|construction|tender|review/i.test(t) && t.length > 8) return setTc(tc, opts.description || describe(t, opts.status));
      return i < cells.length && t ? setTc(tc, t) : tc;   // suitability codes, names and initials carry over
    });
  };
  {
    const trs = [...doc.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(m => ({ start: m.index, end: m.index + m[0].length, xml: m[0] }));
    for (let i = trs.length - 1; i >= 0; i--) {
      const tr = trs[i], cells = cellsOf(tr.xml); if (cells.length < 2 || text(cells[0]).toUpperCase() !== cur) continue;
      const nx = trs[i + 1], blank = nx && /^(\s|<w:bookmark(Start|End)\b[^>]*\/>)*$/.test(doc.slice(tr.end, nx.start)) && cellsOf(nx.xml).length === cells.length && cellsOf(nx.xml).every(c => !text(c));
      if (blank) doc = doc.slice(0, nx.start) + fillRow(tr.xml, nx.xml) + doc.slice(nx.end);
      else { const copy = tr.xml.replace(/w14:paraId="[0-9A-Fa-f]{8}"/g, () => `w14:paraId="${hex8()}"`).replace(/w14:textId="[0-9A-Fa-f]{8}"/g, () => `w14:textId="${hex8()}"`); doc = doc.slice(0, tr.end) + fillRow(tr.xml, copy) + doc.slice(tr.end); }
      changes.rows++;
    }
  }
  // the cover: the cell after a "Revision:" label carries the rev (P02 - For Comment), the cell after a "Date:" label the date
  doc = doc.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tr) => {
    const cells = cellsOf(tr); if (cells.length < 2) return tr; let k = 0, changed = false;
    const out = tr.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (tc) => {
      const i = k++; if (i === 0) return tc; const label = text(cells[i - 1]), t = text(tc);
      if (/^rev(ision)?\.?:$/i.test(label) && has.test(t)) { changed = true; return setTc(tc, t.replace(tok, next)); }
      if (/^date:$/i.test(label) && DATE.test(t)) { changed = true; return setTc(tc, todayLike(t, opts.date)); }
      return tc;
    });
    if (changed) changes.cover++;
    return out;
  });
  zip.file('word/document.xml', doc);
  // running headers and footers: Rev P02 -> P03, the date -> today
  for (const n of parts.filter(p => /header|footer/.test(p))) {
    let x = await zip.file(n).async('string'), before = x;
    x = x.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tr) => {
      const cells = cellsOf(tr); let k = 0;
      return tr.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (tc) => { const i = k++, t = text(tc), label = i ? text(cells[i - 1]) : ''; if (t.toUpperCase() === cur) return setTc(tc, next); if (/^date:?$/i.test(label) && DATE.test(t)) return setTc(tc, todayLike(t, opts.date)); return tc; });
    });
    x = replaceAcrossRuns(x, new RegExp(`(?<![A-Za-z])Rev\\.?:?\\s*${cur}(?!\\d)`, 'i'), (m) => m.replace(tok, next)).xml;
    x = replaceAcrossRuns(x, /(?<![A-Za-z])Date:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})(?!\d)/i, (m, d) => m.replace(d, todayLike(d, opts.date))).xml;
    if (x !== before) { changes.header++; zip.file(n, x); }
  }
  // a header bound to the document's Keywords property (the template's way of carrying the rev) follows it
  if (zip.file('docProps/core.xml')) { let c = await zip.file('docProps/core.xml').async('string'); const b = c; c = c.replace(/<cp:keywords>([^<]*)<\/cp:keywords>/, (m, k) => k.trim().toUpperCase() === cur ? `<cp:keywords>${next}</cp:keywords>` : m); c = c.replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}$2`); if (c !== b) { changes.keywords++; zip.file('docProps/core.xml', c); } }
  // a new document number (SP-E-7005 -> RP-E-7005): everywhere the old one is written
  if (opts.renumber && opts.renumber.from && opts.renumber.to) {
    const from = opts.renumber.from, to = opts.renumber.to;
    for (const n of parts) { const r = replaceAcrossRuns(await zip.file(n).async('string'), new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), () => to); if (r.n) { changes.renumbered += r.n; zip.file(n, r.xml); } }
    for (const n of ['docProps/core.xml', 'docProps/custom.xml'].filter(p => zip.file(p))) { let x = await zip.file(n).async('string'); const c = x.split(from).length - 1; if (c) { changes.renumbered += c; zip.file(n, x.split(from).join(to)); } }
  }
  if (!changes.rows && !changes.header && !changes.cover) throw new Error(`nothing in the document reads ${cur}: no revision row, header or cover field to move on`);
  return { buf: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), from: cur, to: next, changes };
}

// an Excel register (BGEN cover sheet): the revision rows read upwards (P01 at the bottom, the latest on top, an empty row above for the
// next); the new rev goes in that row, and the cover's Revision / Revision Date formulas follow it
async function revUpXlsx(buf, opts = {}) {
  const zip = await JSZip.loadAsync(buf);
  let strs = []; try { const ss = await zip.file('xl/sharedStrings.xml').async('string'); strs = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unesc(m[1].replace(/<[^>]+>/g, ''))); } catch {}
  const sheets = Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  const cellText = (x, ref) => { const m = x.match(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`)); if (!m) return ''; const a = m[1] || '', inner = m[2] || ''; if (/t="s"/.test(a)) { const v = inner.match(/<v>(\d+)<\/v>/); return v ? (strs[+v[1]] || '').trim() : ''; } if (/t="inlineStr"/.test(a)) return unesc(inner.replace(/<[^>]+>/g, '')).trim(); const v = inner.match(/<v>([^<]*)<\/v>/); return v ? v[1].trim() : ''; };
  const changes = { rows: 0, formulas: 0 }; let cur = opts.from || '', next = '';
  for (const n of sheets) {
    let x = await zip.file(n).async('string'); const before = x;
    // the revision rows: column A reads like a rev, column B a date
    const rows = [...x.matchAll(/<row r="(\d+)"/g)].map(m => +m[1]);
    const revRows = rows.filter(r => /^[PCAX]\d{2}$/i.test(cellText(x, `A${r}`)) && DATE.test(cellText(x, `B${r}`)));
    if (!revRows.length) continue;
    const top = Math.min(...revRows); const topRev = cellText(x, `A${top}`).toUpperCase();
    if (cur && topRev !== cur) continue; cur = topRev; next = opts.to && /^[PCAX]\d{2}$/i.test(opts.to) ? opts.to.toUpperCase() : nextOf(cur);
    if (next === cur) throw new Error(`the register is already at ${cur}`);
    const at = top - 1; if (at < 1 || ['A', 'B', 'D', 'F', 'G', 'H'].some(c => cellText(x, `${c}${at}`))) throw new Error(`no empty row above the ${cur} row on the cover sheet for ${next}`);
    const vals = { A: next, B: todayLike(cellText(x, `B${top}`), opts.date) };
    for (const c of ['C', 'D', 'E', 'F', 'G', 'H', 'I']) { const v = cellText(x, `${c}${top}`); if (v) vals[c] = c === 'D' && opts.description ? opts.description : v; }
    for (const [c, v] of Object.entries(vals)) x = setCell(x, `${c}${at}`, v);
    // formulas that read the top row (=A31, =B31) now read the new one
    x = x.replace(/<f>([A-I])(\d+)<\/f>/g, (m, c, r) => +r === top ? (changes.formulas++, `<f>${c}${at}</f>`) : m);
    x = x.replace(/<f>([A-I])(\d+)<\/f><v>[^<]*<\/v>/g, (m, c, r) => +r === at ? `<f>${c}${at}</f>` : m);   // cached values go, Excel recalculates
    changes.rows++; if (x !== before) zip.file(n, x);
  }
  // cells that read the cover's revision by formula (the risk sheet's own header) still cache the old value: those go, Excel recalculates
  if (cur) for (const n of sheets) { let x = await zip.file(n).async('string'); const b = x; x = x.replace(/(<c r="[A-Z]+\d+"[^>]*>)(<f>[^<]*<\/f>)<v>([^<]*)<\/v>/g, (m, c, f, v) => v.trim().toUpperCase() === cur || DATE.test(v.trim()) ? c + f : m); if (x !== b) zip.file(n, x); }
  if (!changes.rows) throw new Error('no revision rows found on a cover sheet (a rev in column A with a date beside it)');
  try { const wb = await zip.file('xl/workbook.xml').async('string'); if (!/fullCalcOnLoad/.test(wb)) zip.file('xl/workbook.xml', wb.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')); } catch {}
  return { buf: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), from: cur, to: next, changes };
}

// the file's new name: the rev token moved on, the number changed when asked
function revName(name, from, to, renumber) {
  let n = name.replace(new RegExp(`\\b${from}\\b`), to);
  if (renumber && renumber.from && renumber.to) n = n.split(renumber.from).join(renumber.to);
  return n;
}
const revOfName = (name) => { const m = String(name).match(/\b([PCAX]\d{2})\b(?!.*\b[PCAX]\d{2}\b)/); return m ? m[1].toUpperCase() : ''; };

module.exports = { revUpDocx, revUpXlsx, revName, revOfName, nextOf, todayLike };
