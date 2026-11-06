// Attached data (a logger CSV, a schedule workbook) as a table the agents can reason about and the analysis code can compute over.
// The model never gets 28,000 raw rows pasted into its context: it gets a profile (columns, types, ranges, a few rows) and writes
// code; the app runs the code over the whole table. Nothing is silently cut.
'use strict';

const DATE_RE = /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/, TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/, ISO_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

// CSV / TSV text -> { columns, rows } with rows as arrays of strings; quotes, embedded commas and newlines handled; delimiter sniffed
function parseDelimited(text) {
  text = String(text).replace(/^﻿/, '');
  const head = text.split(/\r?\n/, 5).join('\n');
  const delim = [',', ';', '\t', '|'].map(d => ({ d, n: (head.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(v => v !== '')) rows.push(row); row = []; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(v => v !== '')) rows.push(row); }
  if (!rows.length) return { columns: [], rows: [] };
  const columns = rows[0].map((h, i) => String(h).trim() || `Column ${i + 1}`);
  return { columns, rows: rows.slice(1).map(r => columns.map((_, i) => (r[i] === undefined ? '' : String(r[i]).trim()))) };
}

// a sheet from checker.readXlsx ({ sheet, rows: [{ n, c: [...], st }] }, or plain arrays) -> the same shape: the first row with 2+ filled
// cells is the header
function fromSheet(sheet) {
  const rs = (sheet.rows || []).map(r => (Array.isArray(r) ? r : (r && Array.isArray(r.c) ? r.c : [])).map(v => (v === null || v === undefined ? '' : String(v).trim())));
  // the header: within the first 15 rows, the row with the most filled cells (a title row above a table has one or two)
  let h = -1, best = 1; rs.slice(0, 15).forEach((r, i) => { const n = r.filter(Boolean).length; if (n > best) { best = n; h = i; } }); if (h < 0) return { columns: [], rows: [] };
  const columns = rs[h].map((c, i) => c || `Column ${i + 1}`);
  return { columns, rows: rs.slice(h + 1).filter(r => r.some(Boolean)).map(r => columns.map((_, i) => r[i] === undefined ? '' : r[i])) };
}

const asNum = (v) => { const s = String(v).replace(/,/g, '').trim(); if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?%?$/.test(s)) return NaN; return parseFloat(s); };
// dd/mm/yyyy (UK) with an optional time, or ISO -> ms since epoch (UTC)
function toDate(dateStr, timeStr) {
  const d = String(dateStr || '').trim(), t = String(timeStr || '').trim();
  let m = d.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let y, mo, da, hh = 0, mi = 0, ss = 0;
  if (m) { da = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; if (m[4]) { hh = +m[4]; mi = +m[5]; ss = +(m[6] || 0); } }
  else { m = d.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/); if (!m) return NaN; y = +m[1]; mo = +m[2]; da = +m[3]; if (m[4]) { hh = +m[4]; mi = +m[5]; ss = +(m[6] || 0); } }
  const tm = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/); if (tm) { hh = +tm[1]; mi = +tm[2]; ss = +(tm[3] || 0); }
  return Date.UTC(y, mo - 1, da, hh, mi, ss);
}
const ukDate = (ms) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };

// what the model is told about a table: enough to write the analysis, never the whole thing
function profile(table, name, { sampleRows = 12 } = {}) {
  const { columns, rows } = table; const L = [`TABLE "${name}": ${rows.length} rows, ${columns.length} columns.`];
  columns.forEach((c, i) => {
    const vals = rows.map(r => r[i]).filter(v => v !== ''); const nums = vals.map(asNum).filter(n => !Number.isNaN(n));
    let kind = 'text', note = '';
    if (vals.length && nums.length >= vals.length * 0.95) { kind = 'number'; note = `min ${Math.min(...nums)} max ${Math.max(...nums)}`; }
    else if (vals.length && vals.every(v => DATE_RE.test(v) || ISO_RE.test(v))) { kind = 'date'; const ms = vals.map(v => toDate(v)).filter(n => !Number.isNaN(n)); if (ms.length) note = `${ukDate(Math.min(...ms))} to ${ukDate(Math.max(...ms))}`; }
    else if (vals.length && vals.every(v => TIME_RE.test(v))) { kind = 'time'; note = `${vals[0]} .. ${vals[vals.length - 1]}`; }
    else { const set = new Map(); for (const v of vals) set.set(v, (set.get(v) || 0) + 1); note = set.size <= 40 ? `${set.size} distinct: ${[...set.entries()].map(([k, n]) => `${k} (${n})`).join(', ')}` : `${set.size} distinct, e.g. ${[...set.keys()].slice(0, 5).join(', ')}`; }
    L.push(`  - ${c} [${kind}${vals.length < rows.length ? `, ${rows.length - vals.length} empty` : ''}]${note ? ': ' + note : ''}`);
  });
  L.push(`First ${Math.min(sampleRows, rows.length)} rows:`); L.push(columns.join(' | ')); for (const r of rows.slice(0, sampleRows)) L.push(r.join(' | '));
  if (rows.length > sampleRows) { L.push('...'); L.push('Last row: ' + rows[rows.length - 1].join(' | ')); }
  return L.join('\n');
}

// the rows as objects keyed by column, for the analysis code
const objects = (table) => table.rows.map(r => { const o = {}; table.columns.forEach((c, i) => { o[c] = r[i]; }); return o; });
const tableName = (fileName) => String(fileName).replace(/\.[^.]+$/, '').trim();

// the whole text of a Word document (body, with tables as rows of cells), for an attached study or spec: nothing cut at 4,000 characters
async function docxText(buf) {
  const JSZip = require('jszip'); const zip = await JSZip.loadAsync(buf); const f = zip.file('word/document.xml'); if (!f) return '';
  let x = await f.async('string');
  x = x.replace(/<w:tab\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n');
  x = x.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (tc) => tc.replace(/<\/w:p>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() + ' | ');   // a table cell on one line
  x = x.replace(/<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
  x = x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
  return x.replace(/[ \t]+\|/g, ' |').replace(/\n{3,}/g, '\n\n').trim();
}
module.exports = { parseDelimited, fromSheet, profile, objects, tableName, asNum, toDate, ukDate, docxText };
