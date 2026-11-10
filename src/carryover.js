// A document handed over from earlier work under another number (Gwrhyd 10 Nov: the P01 studies made as X281026, the job set up as
// X101126): Make takes that Word / Excel file as it is (every result, table, figure and assumption) and issues it under the row's own
// number. The old numbers are changed everywhere they are written, cross-references to the other handed-over documents included
// ("06-09-0001/2/3/7" becomes the new numbers of those documents), the project reference follows, and the P01 row, header and cover are
// dated today. Nothing else in the file is touched. An RFI register carried over brings its RFIs onto the job, so the documents' RFI
// references and the register agree.
'use strict';
const fs = require('fs'), path = require('path');
const JSZip = require('jszip');
const DR = require('./docrev');

const QS = /X\d{4,6}(?:-[A-Z0-9]{2,4}){2,5}-\d{4}/i;
// a title as words, so "EREC G5-5" and "EREC G5/5", "RFI Register" and "Request for Information Register" are the same title
const norm = (t) => String(t || '').toLowerCase()
  .replace(/\brequest for information\b/g, 'rfi').replace(/\brequests? for information\b/g, 'rfi')
  .replace(/\b[pcax]\d{2}\b/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const titleOfFile = (name) => norm(path.basename(name).replace(/\.[^.]+$/, '').replace(QS, ' ').replace(/^[\s_-]+/, ''));

// the earlier version of a row's document: a Word file (Excel for a register or schedule) whose title is the row's title and whose
// number is not the row's; Archive / Superseded copies never count
function earlierVersion(row, files) {
  const want = norm(row.title), wantShort = norm(String(row.title || '').replace(/\([^)]*\)/g, ''));
  if (!want) return null;
  const exts = /register|schedule|list/i.test(row.title) ? /\.(xlsx|xlsm)$/i : /\.docx$/i;
  const cands = files.filter(f => exts.test(f.name) && !/(^|\/)[^\/]*(archive|superseded)[^\/]*\//i.test(f.rel) && !/^~\$/.test(f.name))
    .map(f => { const no = (f.name.match(QS) || [])[0] || ''; return { ...f, no, t: titleOfFile(f.name) }; })
    .filter(f => f.no && f.no.toUpperCase() !== String(row.no).toUpperCase() && (f.t === want || f.t === wantShort));
  if (!cands.length) return null;
  cands.sort((a, b) => (DR.revOfName(b.name) || '').localeCompare(DR.revOfName(a.name) || '') || (b.mtime || 0) - (a.mtime || 0));
  return cands[0];
}

// every handed-over document on the job: old number -> the row's number
function numberMap(rows, files) {
  const map = {};
  for (const r of rows) { const e = earlierVersion(r, files); if (e) map[e.no.toUpperCase()] = r.no; }
  // the same document's other copies (its PDF, the register's own Excel) carry the same old number: nothing more to add
  return map;
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the replacements for one file's text, longest first: full numbers, then the short forms the documents use between themselves
// ("06-09-0001", "06-09-0001/2/3/7" expanded to each document's new short number), then the bare project reference
function replacements(map) {
  const out = [], short = {};
  let oldProj = '', newProj = '';
  for (const [from, to] of Object.entries(map)) {
    out.push([new RegExp(escRe(from), 'gi'), () => to]);
    const pf = from.match(/^(X\d{4,6})-([A-Z0-9]{2,4})-(\d{2}-\d{2}-\d{4})$/i), pt = to.match(/^(X\d{4,6})-([A-Z0-9]{2,4})-(\d{2}-\d{2}-\d{4})$/i);
    if (pf && pt) { short[pf[3]] = pt[3]; oldProj = pf[1].toUpperCase(); newProj = pt[1].toUpperCase(); }
  }
  if (Object.keys(short).length) {
    // "06-09-0001/2/3/7": the first number and the sequence numbers after it, each the same type as the first
    out.push([/\b(\d{2})-(\d{2})-(\d{4})((?:\/\d{1,4})+)/g, (m, a, b, c, rest) => {
      const all = [`${a}-${b}-${c}`, ...rest.split('/').filter(Boolean).map(n => `${a}-${b}-${String(n).padStart(4, '0')}`)];
      if (!all.every(x => short[x])) return m;
      return all.map(x => short[x]).join(', ');
    }]);
    // "X281026-0000-06-09-0001 to -0007": the range, written out as the new numbers (they are no longer one run)
    out.unshift([/\b(X\d{4,6}-[A-Z0-9]{2,4}-)?(\d{2})-(\d{2})-(\d{4}) to -(\d{4})\b/g, (m, pre, a, b, c, d) => {
      const all = []; for (let i = +c; i <= +d && all.length < 50; i++) { const k = `${a}-${b}-${String(i).padStart(4, '0')}`; if (!short[k]) return m; all.push(short[k]); }
      return (pre ? (newProj ? pre.replace(/^X\d{4,6}/i, newProj) : pre) : '') + all.join(', ');
    }]);
    out.push([new RegExp(`\\b(${Object.keys(short).map(escRe).join('|')})\\b`, 'g'), (m) => short[m] || m]);
  }
  if (oldProj && newProj && oldProj !== newProj) out.push([new RegExp(`\\b${escRe(oldProj)}\\b`, 'g'), () => newProj]);
  // the number was provisional under the old reference; under the job's own number it is not
  if (oldProj && newProj && oldProj !== newProj) out.push([new RegExp(`\\b${escRe(newProj)}\\s*\\((provisional|tbc|to be allocated)\\)`, 'gi'), () => newProj]);
  return out;
}

// page breaks the way a person would set them (Tom 10 Nov: "no need to have two empty tables carrying onto the next page"): a table
// of up to 25 rows stays on one page (each row kept with the next), a "Table n" caption stays with its table, a picture with its
// "Figure n" caption. A longer table may run on, and its header row already repeats. Only paragraph and row properties change.
const KEEP_ROWS = 25;
function keepNext(p) {
  if (/<w:keepNext\/>/.test(p)) return p;
  if (/<w:pPr>/.test(p) || /<w:pPr\s[^>]*>/.test(p)) return p.replace(/(<w:pPr(?:\s[^>]*)?>)(\s*<w:pStyle\b[^>]*\/>)?/, (m, a, st) => `${a}${st || ''}<w:keepNext/>`);
  return p.replace(/^<w:p\b[^>]*>/, (m) => `${m}<w:pPr><w:keepNext/></w:pPr>`);
}
function tidyPagination(doc, changes = {}) {
  let n = 0;
  // tables: every paragraph of every row but the last kept with the next, so the table moves to the next page whole
  doc = doc.replace(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<\/w:tbl>/g, (tbl) => {
    const rows = tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []; if (rows.length < 2 || rows.length > KEEP_ROWS) return tbl;
    let i = 0; n++;
    return tbl.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tr) => (i++ < rows.length - 1 ? tr.replace(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g, keepNext) : tr));
  });
  // captions: "Table n" before a table, a picture before its "Figure n", a "Figure n" before its picture
  const paras = [...doc.matchAll(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>|<w:tbl>/g)];
  const marks = [];
  for (let k = 0; k < paras.length - 1; k++) {
    const a = paras[k][0], b = paras[k + 1][0]; if (a === '<w:tbl>') continue;
    const ta = DR.text(a), tb = b === '<w:tbl>' ? '' : DR.text(b), pic = (x) => /<w:drawing\b|<w:pict\b/.test(x);
    if ((b === '<w:tbl>' && /^table\s+\d+/i.test(ta)) || (pic(a) && /^figure\s+\d+/i.test(tb)) || (/^figure\s+\d+/i.test(ta) && pic(b))) marks.push(paras[k]);
  }
  for (const m of marks.reverse()) { const p = keepNext(m[0]); if (p !== m[0]) { doc = doc.slice(0, m.index) + p + doc.slice(m.index + m[0].length); n++; } }
  changes.pagination = n;
  return doc;
}

// a Word document under its new number: { buf, map, date } -> { buf, rev, changes }
async function reissueDocx(buf, { map, date } = {}) {
  const zip = await JSZip.loadAsync(buf);
  const parts = Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
  const reps = replacements(map || {}); const changes = { renumbered: 0, dated: 0 };
  for (const n of parts) {
    let x = await zip.file(n).async('string');
    for (const [re, fn] of reps) { const r = DR.replaceAcrossRuns(x, re, fn); if (r.n) { changes.renumbered += r.n; x = r.xml; } }
    zip.file(n, x);
  }
  for (const n of ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml'].filter(p => zip.file(p))) {
    let x = await zip.file(n).async('string'); const b = x; for (const [re, fn] of reps) x = x.replace(re, fn); if (x !== b) { changes.renumbered++; zip.file(n, x); }
  }
  // the revision it is at, from the header / the revision table; its row, the header and the cover dated today (first issue under this number)
  let rev = '';
  for (const n of parts.filter(p => /header/.test(p))) { const m = DR.text(await zip.file(n).async('string')).match(/Rev\.?:?\s*([PCAX]\d{2})\b/i); if (m) { rev = m[1].toUpperCase(); break; } }
  let doc = await zip.file('word/document.xml').async('string');
  if (!rev) { const revs = (doc.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map(tr => DR.text(DR.cellsOf(tr)[0] || '')).filter(t => /^[PCAX]\d{2}$/i.test(t)); rev = (revs.sort().pop() || '').toUpperCase(); }
  if (rev) {
    const dateCells = (tr, test) => { let k = 0; const cells = DR.cellsOf(tr); return tr.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (tc) => { const i = k++, t = DR.text(tc); if (test(i, t, cells) && DR.DATE.test(t)) { changes.dated++; return DR.setTc(tc, DR.todayLike(t, date)); } return tc; }); };
    doc = doc.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tr) => { const c = DR.cellsOf(tr); if (c.length >= 2 && DR.text(c[0]).toUpperCase() === rev) return dateCells(tr, (i) => i > 0); return dateCells(tr, (i, t, cells) => i > 0 && /^date:?$/i.test(DR.text(cells[i - 1]))); });
    // the cover's own date line (a paragraph that is only a date, before the first table): today
    { const firstTbl = doc.indexOf('<w:tbl>'), head = firstTbl > 0 ? doc.slice(0, firstTbl) : doc;
      const fixed = head.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (p) => { const t = DR.text(p); if (DR.DATE.test(t)) { const r = DR.replaceAcrossRuns(p, /\d{1,2}\/\d{1,2}\/\d{2,4}/, (d) => DR.todayLike(d, date)); if (r.n) { changes.dated++; return r.xml; } } return p; });
      doc = fixed + doc.slice(head.length); }
    doc = tidyPagination(doc, changes);
    zip.file('word/document.xml', doc);
    for (const n of parts.filter(p => /header|footer/.test(p))) {
      let x = await zip.file(n).async('string'), b = x;
      x = x.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tr) => { let k = 0; const cells = DR.cellsOf(tr); return tr.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (tc) => { const i = k++, t = DR.text(tc); if (i && /^date:?$/i.test(DR.text(cells[i - 1])) && DR.DATE.test(t)) return DR.setTc(tc, DR.todayLike(t, date)); return tc; }); });
      x = DR.replaceAcrossRuns(x, /(?<![A-Za-z])Date:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})(?!\d)/i, (m, d) => m.replace(d, DR.todayLike(d, date))).xml;
      if (x !== b) { changes.dated++; zip.file(n, x); }
    }
  }
  return { buf: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), rev: rev || 'P01', changes };
}

// an Excel register under its new number: the text cells (shared strings and inline strings) only
async function reissueXlsx(buf, { map } = {}) {
  const zip = await JSZip.loadAsync(buf), reps = replacements(map || {}); let n = 0;
  for (const p of Object.keys(zip.files).filter(f => /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(f))) {
    let x = await zip.file(p).async('string'); const b = x;
    x = x.replace(/(<t(?:\s[^>]*)?>)([^<]*)(<\/t>)/g, (m, a, t, c) => { let s = t; for (const [re, fn] of reps) s = s.replace(re, fn); return a + s + c; });
    if (x !== b) { n++; zip.file(p, x); }
  }
  return { buf: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), changes: { renumbered: n } };
}

// the RFIs in an Atomax RFI register workbook: the rows whose first filled cell is an RFI number
async function rfisOf(buf) {
  const sheets = require('./checker').readXlsx(buf);
  const out = [];
  for (const s of sheets) {
    const rows = (s.rows || []).map(r => Array.isArray(r) ? r : (r && r.c) || []);
    const head = rows.findIndex(r => r.some(c => /^rfi no\.?$/i.test(String(c || '').trim())));
    if (head < 0) continue;
    const H = rows[head].map(c => String(c || '').trim().toLowerCase()), col = (re) => H.findIndex(h => re.test(h));
    const cNo = col(/^rfi no/), cQ = col(/information required|question|request/), cTo = col(/^to\b|action by/), cWhy = col(/reason|impact/), cPri = col(/priority/), cSt = col(/^status/), cAns = col(/response|answer/), cRaised = col(/date raised|raised/);
    for (const r of rows.slice(head + 1)) {
      const no = String(r[cNo] || '').trim(); if (!/^RFI-\d+$/i.test(no)) continue;
      out.push({ no: no.toUpperCase(), q: String(r[cQ] || '').trim(), to: cTo >= 0 ? String(r[cTo] || '').trim() : '', why: cWhy >= 0 ? String(r[cWhy] || '').trim() : '', priority: cPri >= 0 ? String(r[cPri] || '').trim() : '', status: cSt >= 0 && /closed|answered/i.test(String(r[cSt] || '')) ? 'Closed' : 'Open', answer: cAns >= 0 ? String(r[cAns] || '').trim() : '', raised: cRaised >= 0 ? r[cRaised] : '' });
    }
  }
  return out;
}

module.exports = { tidyPagination, norm, earlierVersion, numberMap, replacements, reissueDocx, reissueXlsx, rfisOf };
