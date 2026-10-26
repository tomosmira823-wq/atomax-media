// Drawing checker: reads a cable schedule and a set of drawings / cross-references, extracts the cables
// from each, compares them in both directions in code, and only asks Claude for the parts that need eyes
// (reading drawings, mapping schedule columns, judging near-misses). Runs in the Electron main process.
'use strict';
const zlib = require('zlib');
const path = require('path');

// ---------- the standard skill (default rules for the drawing checker; editable in the agent's loadout) ----------
const STANDARD_SKILL = `Check a cable schedule against the drawings and cross-references supplied.
- Work only from what is written on the documents. Never infer or calculate, and never pull in tags from other drawings.
- Cables: on loop drawings only the yellow boxes are cables. On any other kind of document take cables from where the document itself labels them as cables.
- Check both ways: every live cable on the drawings is on the schedule, and every live schedule row is on a drawing.
- Ignore cancelled or hatched sheets, "LINK TO ... SEE DWG" interface cables, and schedule rows that are struck through.
- Do not check or flag cores, terminals, card types or IO.
- Ignore systemic naming differences such as _JB vs -JB, or /RIO1/ vs -RIO1/.
- The schedule must match exactly what is printed on the drawing. Obvious spelling or typing mistakes on a drawing are flagged, not copied into the schedule: say what the tag should be.
- Keep findings simple: drawing number, what needs fixing. Anything that needs confirming gets a short reason why.
- Be honest about coverage: say what was and was not checked, and list anything that could not be read.`;

// ---------- small helpers ----------
const normKey = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const colIndex = (letters) => { let n = 0; for (const ch of String(letters).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const colLetters = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function textOf(xml) { let out = ''; for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]); return out; }
function attr(s, name) { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(s); return m ? decodeXml(m[1]) : null; }

// ---------- reading .xlsx without any library (zip + XML), including which cells are struck through ----------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That is not a valid .xlsx file.');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const files = {};
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    const ln = buf.readUInt16LE(loff + 26), le = buf.readUInt16LE(loff + 28), start = loff + 30 + ln + le;
    const data = buf.subarray(start, start + csize);
    files[name] = (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
  }
  return files;
}

function readXlsx(buf) {
  const f = unzip(buf);
  if (!f['xl/workbook.xml']) throw new Error('That .xlsx has no workbook in it.');
  const sst = [];
  if (f['xl/sharedStrings.xml']) for (const m of f['xl/sharedStrings.xml'].matchAll(/<si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/si>)/g)) sst.push(m[1] ? textOf(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')) : '');
  // which cell styles are struck through
  const struckXf = [];
  if (f['xl/styles.xml']) {
    const fontsXml = (f['xl/styles.xml'].match(/<fonts\b[\s\S]*?<\/fonts>/) || [''])[0];
    const fonts = [...fontsXml.matchAll(/<font(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/font>)/g)].map(m => { const inner = m[1] || ''; const st = /<strike(?:\s[^>]*)?\/?>/.exec(inner); return !!st && !/val="(0|false)"/.test(st[0]); });
    const xfsXml = (f['xl/styles.xml'].match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
    for (const m of xfsXml.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) { const fid = attr(m[1], 'fontId'); struckXf.push(fid != null && !!fonts[+fid]); }
  }
  const rels = {};
  for (const m of (f['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) { const id = attr(m[1], 'Id'), t = attr(m[1], 'Target'); if (id && t) rels[id] = t.startsWith('/') ? t.slice(1) : 'xl/' + t; }
  const sheets = [];
  for (const m of f['xl/workbook.xml'].matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1], 'name'), rid = attr(m[1], 'r:id'), state = attr(m[1], 'state');
    if (state === 'hidden' || state === 'veryHidden') continue;
    const file = rels[rid]; if (!name || !file || !f[file]) continue;
    const rows = [];
    for (const rm of f[file].matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rnum = +(attr(rm[1], 'r') || rows.length + 1);
      const c = [], st = [];
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r') || '', letters = (ref.match(/^[A-Z]+/) || [''])[0];
        const ci = letters ? colIndex(letters) : c.length;
        const t = attr(cm[1], 't'), s = attr(cm[1], 's');
        const inner = cm[2] || '';
        const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        let val = '';
        if (t === 's') val = sst[+v] || '';
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'str') val = v != null ? decodeXml(v) : '';
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') val = '';
        else if (v != null) { const n = Number(v); val = Number.isFinite(n) ? String(n) : decodeXml(v); }
        while (c.length <= ci) { c.push(''); st.push(false); }
        c[ci] = clean(val); st[ci] = s != null && !!struckXf[+s];
      }
      if (c.some(x => x !== '')) rows.push({ n: rnum, c, st });
    }
    if (rows.length) sheets.push({ sheet: name, rows });
  }
  if (!sheets.length) throw new Error('No data found in that workbook (all sheets empty or hidden).');
  return sheets;
}

function readCsv(text) {
  const rows = []; let row = [], cur = '', q = false, n = 1;
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  const push = () => { row.push(clean(cur)); cur = ''; };
  const endRow = () => { push(); if (row.some(x => x !== '')) rows.push({ n, c: row, st: row.map(() => false) }); row = []; n++; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) push();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) endRow();
  if (!rows.length) throw new Error('That file has no rows in it.');
  return [{ sheet: 'CSV', rows }];
}

function sheetsAsText(sheets, maxChars = 60000) {
  let out = '';
  for (const s of sheets) {
    out += `=== SHEET: ${s.sheet} ===\n`;
    for (const r of s.rows) {
      const cells = r.c.map((v, i) => v === '' ? '' : `${colLetters(i)}:${r.st[i] ? '[STRUCK THROUGH] ' : ''}${v.slice(0, 80)}`).filter(Boolean);
      if (cells.length) out += `R${r.n} | ${cells.join(' | ')}\n`;
      if (out.length > maxChars) return out + '...[table cut off here]\n';
    }
  }
  return out;
}

// ---------- file kinds ----------
function kindOf(name) {
  const ext = path.extname(name || '').slice(1).toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['xlsx', 'xlsm'].includes(ext)) return 'xlsx';
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'csv';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (['dwg', 'dxf'].includes(ext)) return 'cad';
  if (ext === 'xls') return 'xls';
  return 'other';
}
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const MAX_FILE_BYTES = 24 * 1024 * 1024; // the API takes about 32 MB per request, base64 included

function unreadReason(kind, bytes) {
  if (kind === 'cad') return 'DWG/DXF cannot be read yet. Export it to PDF and drop that in.';
  if (kind === 'xls') return 'Old .xls files cannot be read. Save it as .xlsx and drop that in.';
  if (kind === 'other') return 'This file type is not supported (use PDF, image, .xlsx or .csv).';
  if (bytes > MAX_FILE_BYTES) return `File is ${(bytes / 1048576).toFixed(1)} MB. Over about 24 MB per file, so split it into smaller PDFs.`;
  return '';
}

function contentBlock(kind, name, buf) {
  const b64 = buf.toString('base64');
  if (kind === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
  const ext = path.extname(name).slice(1).toLowerCase();
  return { type: 'image', source: { type: 'base64', media_type: IMAGE_MIME[ext], data: b64 } };
}

// ---------- Claude plumbing ----------
function parseJson(text) {
  const start = text.indexOf('{'); const startArr = text.indexOf('[');
  const s = start < 0 ? startArr : (startArr < 0 ? start : Math.min(start, startArr));
  if (s < 0) throw new Error('Claude did not return JSON:\n' + text.slice(0, 300));
  const src = text.slice(s);
  try { return { value: JSON.parse(src.slice(0, src.lastIndexOf(src[0] === '[' ? ']' : '}') + 1)), repaired: false }; } catch {}
  // reply cut off: keep what is complete and close the brackets
  let inStr = false, esc = false, lastGood = -1; const stack = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') { inStr = false; lastGood = i; } continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') { stack.pop(); lastGood = i; }
    else if (/[0-9el]/.test(c)) lastGood = i;
  }
  let fixed = src.slice(0, lastGood + 1).replace(/,\s*$/, '');
  if (stack[stack.length - 1] === '{') fixed = fixed.replace(/(^|[{,])\s*"[^"]*"\s*(:\s*)?$/, '$1').replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) fixed += stack[i] === '{' ? '}' : ']';
  try { return { value: JSON.parse(fixed), repaired: true }; } catch { throw new Error('Claude did not return usable JSON:\n' + text.slice(0, 300)); }
}

async function ask(claude, { system, content, maxTokens = 16000 }) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await claude({ system, messages: [{ role: 'user', content }], maxTokens });
      const parsed = parseJson(r.text);
      return { value: parsed.value, cutOff: parsed.repaired || r.stop === 'max_tokens' };
    } catch (e) {
      lastErr = e;
      if (/Claude (429|5\d\d)/.test(e.message) && attempt < 3) { await sleep([2000, 6000, 15000][attempt]); continue; }
      throw e;
    }
  }
  throw lastErr;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- step 1: the schedule ----------
async function readSchedule(file, { claude, skill, note, progress }) {
  const buf = Buffer.from(file.base64, 'base64');
  const kind = kindOf(file.name);
  const bad = unreadReason(kind, buf.length);
  if (bad) throw new Error(`Cable schedule (${file.name}): ${bad}`);
  if (kind === 'pdf' || kind === 'image') {
    progress({ message: 'reading the schedule', stage: 'schedule' });
    const system = `You read a cable schedule that has been supplied as a ${kind === 'pdf' ? 'PDF' : 'picture'}. Copy its rows exactly as printed. Do not correct, tidy or infer anything. A row that is struck through (line through the text) gets "struck": true. Reply with JSON only, no fences:
{ "rows": [ { "tag": "cable number/tag exactly as printed", "from": "", "to": "", "type": "", "drawing": "drawing reference if the schedule has a column for it, else empty", "struck": false } ], "notes": "anything that could not be read" }`;
    const r = await ask(claude, { system, content: [contentBlock(kind, file.name, buf), { type: 'text', text: 'Extract every cable row of this schedule.' }] });
    const rows = (r.value.rows || []).filter(x => clean(x.tag)).map((x, i) => ({ id: 'S' + (i + 1), sheet: file.name, row: i + 1, tag: clean(x.tag), from: clean(x.from), to: clean(x.to), type: clean(x.type), drawing: clean(x.drawing), struck: !!x.struck }));
    return { rows, columns: ['(read from the picture/PDF, columns not mapped)'], warnings: [r.cutOff ? 'The schedule reply was cut off, so some rows may be missing.' : '', r.value.notes || ''].filter(Boolean) };
  }
  const sheets = kind === 'xlsx' ? readXlsx(buf) : readCsv(buf.toString('utf8'));
  progress({ message: 'mapping the schedule columns', stage: 'schedule' });
  const sample = sheets.slice(0, 8).map(s => {
    let out = `=== SHEET: ${s.sheet} (${s.rows.length} rows) ===\n`;
    for (const r of s.rows.slice(0, 30)) { const cells = r.c.map((v, i) => v === '' ? '' : `${colLetters(i)}:${v.slice(0, 50)}`).filter(Boolean); if (cells.length) out += `R${r.n} | ${cells.join(' | ')}\n`; }
    return out;
  }).join('\n');
  const system = `You map the columns of a cable schedule spreadsheet so a program can read it. Reply with JSON only, no fences:
{ "sheets": [ { "sheet": "sheet name exactly", "isSchedule": true, "headerRow": 4, "firstDataRow": 5, "cols": { "tag": "B", "from": "D", "to": "E", "type": "G", "drawing": "H" } } ] }
Column values are column letters or null. "tag" is the cable number / cable tag / cable ID column. "from" and "to" are the from/to device or location columns. "type" is the cable type/specification column. "drawing" is a column giving the drawing the cable appears on, if there is one. Do NOT map cores, sizes, colours, glands or lengths. A sheet that is not a cable schedule (cover sheet, revision history, lists) gets "isSchedule": false.`;
  const m = await ask(claude, { system, content: [{ type: 'text', text: sample }], maxTokens: 2000 });
  const rows = []; const colsUsed = [];
  for (const mp of (m.value.sheets || [])) {
    if (!mp.isSchedule || !mp.cols || !mp.cols.tag) continue;
    const sh = sheets.find(s => s.sheet === mp.sheet); if (!sh) continue;
    const ci = {}; for (const k of ['tag', 'from', 'to', 'type', 'drawing']) ci[k] = mp.cols[k] ? colIndex(mp.cols[k]) : -1;
    colsUsed.push(`${sh.sheet}: cable=${mp.cols.tag}${mp.cols.from ? ' from=' + mp.cols.from : ''}${mp.cols.to ? ' to=' + mp.cols.to : ''}${mp.cols.type ? ' type=' + mp.cols.type : ''}${mp.cols.drawing ? ' drawing=' + mp.cols.drawing : ''} (rows from ${mp.firstDataRow || '?'})`);
    for (const r of sh.rows) {
      if (mp.firstDataRow && r.n < mp.firstDataRow) continue;
      const tag = clean(r.c[ci.tag]); if (!tag) continue;
      const cells = r.c.filter(x => x !== ''); const struckCells = r.st.filter((s, i) => s && r.c[i] !== '').length;
      const struck = !!r.st[ci.tag] || (cells.length > 0 && struckCells / cells.length >= 0.5);
      const get = (k) => ci[k] >= 0 ? clean(r.c[ci[k]]) : '';
      rows.push({ id: 'S' + (rows.length + 1), sheet: sh.sheet, row: r.n, tag, from: get('from'), to: get('to'), type: get('type'), drawing: get('drawing'), struck });
    }
  }
  if (!rows.length) throw new Error(`Could not find a cable table in ${file.name}. Check it has a column of cable numbers.`);
  return { rows, columns: colsUsed, warnings: [] };
}

// ---------- step 2: one drawing / cross-reference at a time ----------
function extractionSystem(skill, note) {
  return `You are reading ONE source document for a cable schedule check at Atomax-UK, an electrical and instrumentation engineering company. Use ONLY what is printed on the document. Never infer, calculate, or add tags from anywhere else.

THE STANDARD SKILL (the checking rules):
${skill}
${note ? `\nA NOTE FOR THIS JOB FROM THE ENGINEER:\n${note}\n` : ''}
YOUR JOB IN THIS STEP IS TO EXTRACT, NOT TO COMPARE. For every sheet or page of the document report what is on it. Copy tags exactly as printed, including any spelling mistakes. Report cables only as the rules above define them. If something is too small, blurry or cut off to read, say so in "unreadable" instead of guessing.

Reply with JSON only, no fences:
{
  "docType": "loop | bcd | crossref | other",
  "sheets": [
    {
      "page": 1,
      "drawingNumber": "as printed, or empty",
      "title": "",
      "revision": "",
      "status": "live | cancelled | hatched | unreadable",
      "cables": [ { "tag": "cable number exactly as printed", "from": "only if printed", "to": "only if printed", "type": "only if printed" } ],
      "interfaceCables": [ "tags of any LINK TO ... SEE DWG interface cables, not counted as cables" ],
      "typos": [ { "text": "tag or word as printed", "shouldBe": "what it obviously should be", "where": "short location" } ],
      "unreadable": "what could not be read on this sheet, or empty"
    }
  ],
  "fileNotes": "anything the engineer should know about this document, or empty"
}`;
}

async function readDrawing(file, ctx) {
  const buf = Buffer.from(file.base64, 'base64');
  const kind = kindOf(file.name);
  const out = { name: file.name, kind, status: 'read', reason: '', sheets: [], warnings: [] };
  const bad = unreadReason(kind, buf.length);
  if (bad) { out.status = 'skipped'; out.reason = bad; return out; }
  let content;
  try {
    if (kind === 'pdf' || kind === 'image') content = [contentBlock(kind, file.name, buf), { type: 'text', text: `Document file name: ${file.name}\nExtract every sheet.` }];
    else content = [{ type: 'text', text: `Document file name: ${file.name}\nThis is a spreadsheet/table (a cross-reference). Each row that names a cable is a cable on this document. Treat the whole table as one sheet unless the sheets are clearly different drawings.\n\n${sheetsAsText(kind === 'xlsx' ? readXlsx(buf) : readCsv(buf.toString('utf8')))}` }];
    const r = await ask(ctx.claude, { system: extractionSystem(ctx.skill, ctx.note), content, maxTokens: 16000 });
    out.docType = r.value.docType || 'other';
    out.sheets = (r.value.sheets || []).map(s => ({
      page: s.page, drawingNumber: clean(s.drawingNumber), title: clean(s.title), revision: clean(s.revision), status: ['live', 'cancelled', 'hatched', 'unreadable'].includes(s.status) ? s.status : 'live',
      cables: (s.cables || []).filter(c => clean(c.tag)).map(c => ({ tag: clean(c.tag), from: clean(c.from), to: clean(c.to), type: clean(c.type) })),
      interfaceCables: (s.interfaceCables || []).map(clean).filter(Boolean),
      typos: (s.typos || []).filter(t => clean(t.text)).map(t => ({ text: clean(t.text), shouldBe: clean(t.shouldBe), where: clean(t.where) })),
      unreadable: clean(s.unreadable)
    }));
    if (r.cutOff) out.warnings.push('The reply was cut off, so cables near the end of this file may be missing. Split the file and run it again.');
    if (r.value.fileNotes) out.warnings.push(clean(r.value.fileNotes));
    if (!out.sheets.length) { out.status = 'failed'; out.reason = 'Nothing could be read from this file.'; }
  } catch (e) { out.status = 'failed'; out.reason = String(e.message || e).slice(0, 240); }
  return out;
}

// ---------- step 3: compare in code, then ask Claude to judge the near-misses ----------
async function judgeMismatches(cands, ctx) {
  const verdicts = new Map();
  for (let i = 0; i < cands.length; i += 60) {
    const batch = cands.slice(i, i + 60);
    const system = `You judge possible mismatches between a cable schedule and the drawings it should match, at Atomax-UK.
${ctx.skill}
${ctx.note ? `\nA NOTE FOR THIS JOB FROM THE ENGINEER:\n${ctx.note}\n` : ''}
Each item has the SCHEDULE value and the DRAWING value for the same attribute of the same cable. Decide:
- "real": true if they are genuinely different once formatting is ignored (spacing, case, punctuation, _ vs -, abbreviations, order of words). false if they are the same thing written differently, or one only has extra detail.
- "confirm": true if you are not sure and a person should look. If true give a short "reason" why.
- If the DRAWING value looks like an obvious spelling or typing mistake, say so in "reason" and set "confirm" true.
Reply with JSON only: { "verdicts": [ { "id": "item id", "real": true, "confirm": false, "reason": "" } ] }`;
    try {
      const r = await ask(ctx.claude, { system, content: [{ type: 'text', text: JSON.stringify(batch.map(c => ({ id: c.id, cable: c.tag, attribute: c.field, schedule: c.schedule, drawing: c.drawingVal, drawingNumber: c.drawingNo }))) }], maxTokens: 6000 });
      for (const v of (r.value.verdicts || [])) verdicts.set(v.id, v);
    } catch { /* leave unjudged; they become "confirm" below */ }
  }
  return verdicts;
}

function compare({ scheduleRows, files }) {
  const liveRows = scheduleRows.filter(r => !r.struck), struckRows = scheduleRows.filter(r => r.struck);
  const byKeyS = new Map(); liveRows.forEach(r => { const k = normKey(r.tag); if (!byKeyS.has(k)) byKeyS.set(k, []); byKeyS.get(k).push(r); });
  const byKeyStruck = new Map(); struckRows.forEach(r => byKeyStruck.set(normKey(r.tag), r));
  const sheetsRead = []; // { file, sheet }
  const ignored = { sheets: [], interface: 0 };
  const cancelledLabels = new Set(), cancelledAt = new Map();
  for (const f of files) for (const s of f.sheets) {
    const label = s.drawingNumber || f.name + (s.page ? ` p${s.page}` : '');
    if (s.status === 'cancelled' || s.status === 'hatched') { ignored.sheets.push(`${label} (${s.status})`); if (s.drawingNumber) { cancelledLabels.add(normKey(s.drawingNumber)); cancelledAt.set(normKey(s.drawingNumber), { file: f, sheet: s, label }); } continue; }
    if (s.status === 'unreadable') continue;
    ignored.interface += s.interfaceCables.length;
    sheetsRead.push({ file: f, sheet: s, label });
  }
  const dCables = new Map(); // key -> [{label, cable, sheet}]
  // a drawing tag with a typo (letter O for 0, I or L for 1, or the reader flagged it) is the schedule's tag with a typo, not a different cable
  const fold = (x) => x.replace(/O/g, '0').replace(/[IL]/g, '1');
  const schedKeys = new Map(); [...liveRows, ...struckRows].forEach(r => { const k = normKey(r.tag); if (!schedKeys.has(k)) schedKeys.set(k, r.tag); });
  const foldedSched = new Map(); for (const [k, tag] of schedKeys) { const f = fold(k); if (!foldedSched.has(f)) foldedSched.set(f, []); foldedSched.get(f).push(tag); }
  const extraTypos = [];
  for (const { sheet, label, file } of sheetsRead) for (const c of sheet.cables) {
    let k = normKey(c.tag); if (!k) continue;
    if (!schedKeys.has(k)) {
      const said = (sheet.typos || []).find(t => normKey(t.text) === k && t.shouldBe && schedKeys.has(normKey(t.shouldBe)));
      const near = foldedSched.get(fold(k));
      if (said) { k = normKey(said.shouldBe); }
      else if (near && near.length === 1) {
        k = normKey(near[0]);
        if (!(sheet.typos || []).some(t => normKey(t.text) === normKey(c.tag))) extraTypos.push({ label, file, sheet, t: { text: c.tag, shouldBe: near[0], where: 'a cable box' } });
      }
    }
    if (!dCables.has(k)) dCables.set(k, []); dCables.get(k).push({ label, cable: c, sheet, file });
  }
  const findings = [], cands = [];
  // drawings -> schedule
  for (const [k, list] of dCables) {
    const first = list[0];
    const rows = byKeyS.get(k);
    if (!rows) {
      const st = byKeyStruck.get(k);
      if (st) findings.push({ group: first.label, fi: first.file.srcIndex, page: first.sheet.page, kind: 'struck', tag: first.cable.tag, text: `${first.cable.tag} is struck through on the schedule (row ${st.row}) but still on this drawing`, confirm: false });
      else findings.push({ group: first.label, fi: first.file.srcIndex, page: first.sheet.page, kind: 'add', tag: first.cable.tag, text: `${first.cable.tag} is on the drawing but not on the schedule`, confirm: false });
      continue;
    }
    for (const d of list) for (const field of ['from', 'to', 'type']) {
      const dv = d.cable[field]; if (!dv) continue;
      const row = rows[0]; const sv = row[field]; if (!sv) continue;
      if (normKey(sv) !== normKey(dv)) cands.push({ id: 'M' + (cands.length + 1), tag: row.tag, field, schedule: sv, drawingVal: dv, drawingNo: d.label, row: row.row, fi: d.file.srcIndex, page: d.sheet.page });
    }
    // schedule says which drawing it is on: that drawing must show it
  }
  // the same cable twice on the schedule
  for (const [k, rows] of byKeyS) if (rows.length > 1) findings.push({ group: 'Schedule', kind: 'duplicate', tag: rows[0].tag, text: `${rows[0].tag} is on the schedule ${rows.length} times (rows ${rows.map(r => r.row).join(' and ')})`, confirm: false });
  // schedule -> drawings
  const readLabels = new Set(sheetsRead.map(x => normKey(x.label)));
  for (const r of liveRows) {
    const k = normKey(r.tag);
    if (r.drawing && readLabels.size) {
      const wanted = normKey(r.drawing);
      const sheet = sheetsRead.find(x => normKey(x.label) && normKey(x.label) === wanted || wanted.includes(normKey(x.label)) || normKey(x.label).includes(wanted));
      if (sheet && !(dCables.get(k) || []).some(d => d.sheet === sheet.sheet)) { findings.push({ group: sheet.label, fi: sheet.file.srcIndex, page: sheet.sheet.page, kind: 'missing_on_dwg', tag: r.tag, text: `Schedule row ${r.row} (${r.tag}) says it is on this drawing but it is not shown on it`, confirm: true, reason: dCables.has(k) ? `It is on ${dCables.get(k)[0].label} instead, so the drawing number on the schedule may be wrong` : `Not on ${sheet.label} or on any other drawing that was read` }); continue; }
    }
    if (!dCables.has(k) && r.drawing && cancelledLabels.has(normKey(r.drawing))) { { const cx = cancelledAt.get(normKey(r.drawing)); findings.push({ group: cx ? cx.label : 'Schedule', fi: cx ? cx.file.srcIndex : undefined, page: cx ? cx.sheet.page : undefined, kind: 'on_cancelled', tag: r.tag, text: `Row ${r.row}: ${r.tag} is on ${r.drawing}, which is cancelled or hatched`, confirm: true, reason: 'Remove the row or point it at the drawing that replaced it' }); } continue; }
    if (!dCables.has(k) && r.drawing && readLabels.size && !sheetsRead.some(x => normKey(x.label) && (normKey(x.label) === normKey(r.drawing) || normKey(r.drawing).includes(normKey(x.label)) || normKey(x.label).includes(normKey(r.drawing))))) { findings.push({ group: 'Schedule', kind: 'dwg_not_supplied', tag: r.tag, text: `Row ${r.row}: ${r.tag} is on ${r.drawing}, which was not supplied, so it was not checked`, confirm: true, reason: `Drop ${r.drawing} in to check it` }); continue; }
    if (!dCables.has(k)) findings.push({ group: 'Schedule', kind: 'not_on_dwg', tag: r.tag, text: `Row ${r.row}: ${r.tag} is not on any drawing that was read`, confirm: true, reason: 'Remove it or add the drawing it is on' });
  }
  // typos
  for (const x of extraTypos) x.sheet.typos = [...(x.sheet.typos || []), x.t];
  for (const { sheet, label, file } of sheetsRead) for (const t of sheet.typos) findings.push({ group: label, fi: file.srcIndex, page: sheet.page, kind: 'typo', tag: t.text, text: `Typo on the drawing: "${t.text}"${t.shouldBe ? ` should be "${t.shouldBe}"` : ''}${t.where ? ` (${t.where})` : ''}. Not copied to the schedule`, confirm: false });
  return { findings, cands, liveRows, struckRows, sheetsRead, ignored, dCableCount: [...dCables.values()].reduce((n, l) => n + l.length, 0) };
}

// ---------- the whole job ----------
async function runCheck({ schedule, drawings, note = '', skill = STANDARD_SKILL, claude, progress = () => {} }) {
  if (!schedule) throw new Error('Drop the cable schedule in first.');
  if (!drawings || !drawings.length) throw new Error('Add at least one drawing or cross-reference.');
  const ctx = { claude, skill: skill || STANDARD_SKILL, note: clean(note) ? note.trim() : '', progress };
  const sch = await readSchedule(schedule, ctx);
  progress({ message: `schedule read: ${sch.rows.length} rows`, stage: 'schedule', done: 0, total: drawings.length });
  let done = 0;
  const files = await pool(drawings, 2, async (f, idx) => {
    progress({ message: `reading ${f.name}`, stage: 'drawings', done, total: drawings.length });
    const r = await readDrawing(f, ctx); r.srcIndex = idx; done++;
    progress({ message: `${r.status === 'read' ? 'read' : r.status} ${f.name}`, stage: 'drawings', done, total: drawings.length });
    return r;
  });
  progress({ message: 'comparing both ways', stage: 'compare', done, total: drawings.length });
  const cmp = compare({ scheduleRows: sch.rows, files });
  progress({ message: `judging ${cmp.cands.length} near-misses`, stage: 'judge', done, total: drawings.length });
  const verdicts = cmp.cands.length ? await judgeMismatches(cmp.cands, ctx) : new Map();
  for (const c of cmp.cands) {
    const v = verdicts.get(c.id);
    if (v && v.real === false) continue;
    cmp.findings.push({ group: c.drawingNo, fi: c.fi, page: c.page, kind: 'differs', tag: c.tag, field: c.field, before: c.schedule, after: c.drawingVal, text: `${c.tag} ${c.field}: BEFORE ${c.schedule} → AFTER ${c.drawingVal}`, confirm: !v || !!v.confirm, reason: !v ? 'Could not be judged automatically' : (v.reason || '') });
  }
  const unread = files.filter(f => f.status !== 'read');
  const unreadSheets = [];
  for (const f of files) for (const s of f.sheets) if (s.status === 'unreadable' || s.unreadable) unreadSheets.push(`${s.drawingNumber || f.name + (s.page ? ' p' + s.page : '')}: ${s.unreadable || 'could not be read'}`);
  const cutOff = files.filter(f => f.warnings.some(w => /cut off/.test(w)));
  const bothWays = !unread.length && !unreadSheets.length && !cutOff.length && !sch.warnings.some(w => /cut off/.test(w));
  const cov = [];
  cov.push(`Drawings → schedule: checked ${cmp.dCableCount} cable entries on ${cmp.sheetsRead.length} live sheets from ${files.length - unread.length} of ${files.length} files.`);
  cov.push(`Schedule → drawings: checked ${cmp.liveRows.length} live schedule rows against the drawings that were read${unread.length ? ' (rows reported as not found may be on a file that was not read)' : ''}.`);
  cov.push(`Compared: cable numbers (both ways), from, to and type where both sides print them, and spelling on the drawings. Not checked: cores, terminals, card types, IO.`);
  const ign = [];
  if (cmp.struckRows.length) ign.push(`${cmp.struckRows.length} struck-through schedule rows`);
  if (cmp.ignored.sheets.length) ign.push(`${cmp.ignored.sheets.length} cancelled/hatched sheets (${cmp.ignored.sheets.slice(0, 8).join(', ')}${cmp.ignored.sheets.length > 8 ? ', …' : ''})`);
  if (cmp.ignored.interface) ign.push(`${cmp.ignored.interface} interface cables (LINK TO … SEE DWG)`);
  if (ign.length) cov.push('Ignored: ' + ign.join('; ') + '.');
  if (sch.columns.length) cov.push('Schedule columns used: ' + sch.columns.join('; ') + '.');
  const notChecked = [...unread.map(f => `${f.name}: ${f.reason}`), ...unreadSheets, ...cutOff.map(f => `${f.name}: reply cut off, may be incomplete`), ...sch.warnings];
  const report = { ok: true, schedule: schedule.name, when: new Date().toISOString(), counts: { scheduleRows: sch.rows.length, liveRows: cmp.liveRows.length, drawingCables: cmp.dCableCount, files: files.length, unread: unread.length }, findings: cmp.findings, coverage: cov, notChecked, bothWays, note: ctx.note, noteAnswer: '' };

  if (ctx.note) {
    progress({ message: 'working through your note', stage: 'note', done, total: drawings.length });
    try {
      const system = `You are Cal, the drawing checker at Atomax-UK. An engineer left you a note for this job. The checks have already been run in code and the results are below. Answer the note using only this data (do not invent anything). If the note asks for an extra check you can do from the data, do it. If it cannot be done from this data, say so plainly. Reply with JSON only: { "answer": "short plain answer", "extra": [ { "group": "drawing number or Schedule", "text": "what needs fixing", "confirm": false, "reason": "" } ] }`;
      const data = JSON.stringify({ scheduleRows: sch.rows.map(r => ({ row: r.row, tag: r.tag, from: r.from, to: r.to, type: r.type, drawing: r.drawing, struck: r.struck })), drawings: files.map(f => ({ file: f.name, status: f.status, sheets: f.sheets.map(s => ({ drawingNumber: s.drawingNumber, status: s.status, cables: s.cables })) })), findings: cmp.findings.map(f => ({ group: f.group, text: f.text })) });
      const r = await ask(claude, { system, content: [{ type: 'text', text: `NOTE:\n${ctx.note}\n\nDATA:\n${data.slice(0, 400000)}` }], maxTokens: 4000 });
      report.noteAnswer = clean(r.value.answer);
      for (const x of (r.value.extra || [])) if (clean(x.text)) report.findings.push({ group: clean(x.group) || 'Note', kind: 'note', tag: '', text: clean(x.text), confirm: !!x.confirm, reason: clean(x.reason) });
    } catch (e) { report.noteAnswer = 'Could not work through the note: ' + String(e.message || e).slice(0, 160); }
  }
  report.headline = headline(report);
  report.text = renderText(report);
  return report;
}

function headline(r) {
  const n = r.findings.length, fix = r.findings.filter(f => !f.confirm).length, conf = n - fix;
  if (!n) return r.bothWays ? 'Nothing to fix. Both directions checked and everything read.' : 'No problems found in what was read, but not everything could be read (see below).';
  return `${n} thing${n === 1 ? '' : 's'} to look at: ${fix} to fix, ${conf} to confirm.`;
}

function renderText(r) {
  const lines = [`CABLE SCHEDULE CHECK: ${r.schedule}`, new Date(r.when).toLocaleString('en-GB'), '', r.headline, ''];
  const groups = new Map();
  for (const f of r.findings) { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); }
  const order = [...groups.keys()].sort((a, b) => (a === 'Schedule') - (b === 'Schedule') || String(a).localeCompare(String(b), 'en', { numeric: true }));
  for (const g of order) {
    lines.push(g);
    for (const f of groups.get(g)) lines.push(`  - ${f.text}${f.confirm ? ` [CONFIRM${f.reason ? ': ' + f.reason : ''}]` : ''}`);
    lines.push('');
  }
  if (r.noteAnswer) lines.push('YOUR NOTE', '  ' + r.noteAnswer, '');
  lines.push('WHAT WAS CHECKED', ...r.coverage.map(c => '  - ' + c));
  if (r.notChecked.length) lines.push('', 'NOT CHECKED / NOT READ', ...r.notChecked.map(c => '  - ' + c));
  return lines.join('\n');
}

module.exports = { STANDARD_SKILL, runCheck, readXlsx, readCsv, normKey, compare, kindOf, renderText, parseJson, sheetsAsText };
