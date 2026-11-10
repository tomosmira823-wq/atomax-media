// The 365 room: Lex makes Excel workbooks and Wren makes Atomax-format Word documents, from a request, attached files and the job's project folder.
// Files are saved into the job folder (Documents), never over an existing file.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Packer } = require('docx');
const biz = require('./business');
const dxfmaker = require('./dxfmaker');
const { buildAtomaxDoc } = require('./docgen/atomax-doc-builder');
const LOGO = path.join(__dirname, 'docgen', 'atomax-logo.png');

// ---------- a small zip writer and an .xlsx writer ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const xe = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// sheets: [{ name, columns: [{ header, width? }], rows: [[cell]] }]; a cell is a number, text, or a formula starting "="
function writeXlsx(sheets) {
  const files = [], used = new Set();
  const safeName = (n, i) => { let s = String(n || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet' + (i + 1); while (used.has(s.toLowerCase())) s = s.slice(0, 28) + ' ' + (i + 1); used.add(s.toLowerCase()); return s; };
  const names = sheets.map((s, i) => safeName(s.name, i));
  sheets.forEach((sh, si) => {
    const cols = sh.columns || [], rows = sh.rows || [];
    const width = (c) => { const hdr = String((cols[c] || {}).header || ''); let m = Math.min(hdr.length, 40); for (const r of rows.slice(0, 300)) { const v = r[c]; if (v != null) m = Math.max(m, String(v).length); } return Math.max(8, Math.min(60, (cols[c] && cols[c].width) || m * 1.15 + 2)); };
    const n = Math.max(cols.length, ...rows.map(r => r.length), 1);
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>';
    for (let c = 0; c < n; c++) x += `<col min="${c + 1}" max="${c + 1}" width="${width(c).toFixed(1)}" customWidth="1"/>`;
    x += '</cols><sheetData>';
    const cell = (v, ref, style) => {
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      const s = String(v);
      if (s.startsWith('=') && s.length > 1) return `<c r="${ref}"${style}><f>${xe(s.slice(1))}</f></c>`;
      if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 15 && !/^0\d/.test(s)) return `<c r="${ref}"${style}><v>${s}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xe(s)}</t></is></c>`;
    };
    let r = 1;
    if (cols.length) { x += `<row r="1">${cols.map((c, i) => cell(c.header, colName(i) + 1, ' s="1"')).join('')}</row>`; r = 2; }
    for (const row of rows) { x += `<row r="${r}">${row.map((v, i) => cell(v, colName(i) + r, ' s="2"')).join('')}</row>`; r++; }
    x += '</sheetData></worksheet>';
    files.push({ name: `xl/worksheets/sheet${si + 1}.xml`, data: x });
  });
  files.unshift(
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xe(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    // styles: 0 default, 1 header (bold, grey fill, wrapped, thin border), 2 body (thin border)
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
  );
  return zip(files);
}

const EXCEL_SYSTEM = `You are Lex, the Excel agent in the Atomax-UK 365 room (electrical engineering consultancy: cable schedules, registers, transmittals, calculations, trackers).
Build the workbook the engineer asks for from the request, the attached files and the project files. Copy data exactly as written (tags, cable numbers, sizes, revisions); never invent values: leave a cell empty or write TBC. Use formulas (strings starting "=", e.g. "=SUM(D2:D20)") where a total or calculation belongs, so the sheet stays live.
When an existing workbook is attached and the request is to change it, return the whole changed sheet(s), not only the changes.
CABLE SCHEDULES: when the job context has an APPROVED MASTER DEVICE LIST, every cable on it is one row and nothing else is added: cable number, from and to (tag and description at both ends), type, cores, size exactly as the master list says, and the drawing reference (the BCD number from the drawing list). Use the column layout from your skills (the house cable schedule template) exactly. Fill outside diameter, weight, gland size and voltage grade from the CABLE DATASHEETS supplied; if a cable type has no datasheet, leave those cells empty and say so in the summary. If the master list is only a draft, say in the summary that it is not approved yet.
Reply with JSON only, no markdown: {"filename":"short file name without extension","summary":"one or two lines: what is in it and anything TBC","sheets":[{"name":"sheet name","columns":[{"header":"..."}],"rows":[["cell", 1.5, "=B2*C2"]]}]}`;

const WORD_SYSTEM = (base) => `You are Wren, the Word agent in the Atomax-UK 365 room. The engineer's request decides the document type (report, technical note, letter, specification, method statement, minutes) and its sections; the default sections below are only a fallback. Turn any attached notes (for example a Markdown technical note) into a proper Atomax document without changing their facts.\n\n${base}`;

function register({ ipcMain, claudeFull, BIZ, checker, userDir, projects }) {
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw e && e.question ? e : new Error(require('./runs').plain(e)); } };   // a question stays whole and stays a question   // a question stays a question
  const IMG = /\.(png|jpe?g|gif|webp)$/i;
  // attached files -> Claude content: data (CSV, big workbooks) as a profile with the full table kept for the analysis code, documents
  // as text, PDFs and pictures as themselves. Nothing is cut without saying so: a text file over the limit is reported, not trimmed quietly
  const DT = require('./datatable');
  const TEXT_CAP = 40000;
  async function filesToContent(files, tables = {}, warnings = []) {
    const content = [];
    if ((files || []).length > 8) warnings.push(`Only the first 8 files are read; ${files.length - 8} left out: ${files.slice(8).map(f => f.name).join(', ')}`);
    for (const f of (files || []).slice(0, 8)) {
      const buf = Buffer.from(f.base64, 'base64'), ext = path.extname(f.name).toLowerCase(), name = DT.tableName(f.name);
      try {
        if (ext === '.xlsx' || ext === '.xlsm') {
          const sheets = checker.readXlsx(buf); const big = sheets.filter(sh => (sh.rows || []).length > 60);
          if (big.length) { let n = 0; const left = []; for (const sh of sheets) { const t = DT.fromSheet(sh); if (!t.rows.length) continue; const sn = sh.sheet || sh.name || ''; const key = sheets.length > 1 ? `${name} / ${sn}` : name; tables[key] = t; if (++n > 12) { left.push(sn); continue; } content.push({ type: 'text', text: `ATTACHED WORKBOOK ${f.name}, sheet "${sn}" (given as a table profile; the full table is available to analysis code as tables["${key}"]):\n${DT.profile(t, key).slice(0, 5000)}` }); } if (left.length) content.push({ type: 'text', text: `${f.name}: ${left.length} more sheet(s) not profiled but available to analysis code: ${left.join(', ')}` }); }
          else content.push({ type: 'text', text: `ATTACHED WORKBOOK ${f.name}:\n` + checker.sheetsAsText(sheets, TEXT_CAP) });
        }
        else if (ext === '.csv' || ext === '.tsv') { const t = DT.parseDelimited(buf.toString('utf8')); tables[name] = t; content.push({ type: 'text', text: `ATTACHED DATA ${f.name} (given as a table profile, not row by row; the full table of ${t.rows.length} rows is available to analysis code as tables["${name}"]):\n${DT.profile(t, name)}` }); }
        else if (ext === '.pdf') { content.push({ type: 'text', text: 'Attached: ' + f.name }); content.push(checker.contentBlock('pdf', f.name, buf)); }
        else if (IMG.test(f.name)) { content.push({ type: 'text', text: 'Attached: ' + f.name }); content.push(checker.contentBlock('image', f.name, buf)); }
        else if (ext === '.docx') { const t = await DT.docxText(buf); if (t.length > TEXT_CAP * 1.5) { warnings.push(`${f.name} is ${t.length.toLocaleString()} characters of text; only the first ${(TEXT_CAP * 1.5).toLocaleString()} were read`); content.push({ type: 'text', text: `ATTACHED DOCUMENT ${f.name} (CUT: ${t.length} characters, the first ${TEXT_CAP * 1.5} follow; say so if the rest matters):\n${t.slice(0, TEXT_CAP * 1.5)}` }); } else content.push({ type: 'text', text: `ATTACHED DOCUMENT ${f.name}:\n${t}` }); }
        else {
          const t = buf.toString('utf8');
          if (t.length > TEXT_CAP) {
            warnings.push(f.name + ' is ' + t.length.toLocaleString() + ' characters; only the first ' + TEXT_CAP.toLocaleString() + ' were read');
            content.push({ type: 'text', text: 'ATTACHED ' + f.name + ' (CUT: ' + t.length + ' characters, the first ' + TEXT_CAP + ' follow; say so if the rest matters):\n' + t.slice(0, TEXT_CAP) });
          } else content.push({ type: 'text', text: 'ATTACHED ' + f.name + ':\n' + t });
        }
      } catch (e) { warnings.push(`${f.name} could not be read: ${e.message}`); content.push({ type: 'text', text: `(${f.name} could not be read: ${e.message})` }); }
    }
    return content;
  }
  const outFile = (jobId, base, ext, kind = 'documents') => {
    const dir = (jobId && BIZ.outputDirFor(jobId, kind)) || path.join(userDir(), 'office365');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(base || 'Document').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^(.{0,140})(\s.*)?$/, '$1').replace(/\s*\([^)]*$/, '').trim() || 'Document';   // whole words, up to 140 characters (an 80-character cut left 'Design Specific.docx'); a bracket left open is dropped
    let p = path.join(dir, safe + ext), i = 2; while (fs.existsSync(p)) p = path.join(dir, `${safe} (${i++})${ext}`);
    return p;
  };


  // ---------- the 365 room chat: Wren and Lex talk to Tom, say what is wrong or missing, and change what they made ----------
  const AN = require('./analysis'), CH = require('./charts');
  const threadsFile = () => path.join(userDir(), 'o365-threads.json');
  const loadThreads = () => { try { return JSON.parse(fs.readFileSync(threadsFile(), 'utf8')); } catch { return {}; } };
  const saveThreads = (t) => { try { fs.writeFileSync(threadsFile(), JSON.stringify(t)); } catch {} };
  const tablesDir = (key) => path.join(userDir(), 'o365-tables', key.replace(/[^A-Za-z0-9_-]+/g, '_'));
  const CHAT_RULES = (who, what) => `You are talking to Tom in the 365 room of the Atomax Media Office app; this is a chat, and the ${what} you make lands in the job folder. Short, plain British English, like a colleague across the desk.
RULES:
- If anything you need is missing, cut, unclear or contradictory (a schedule not attached, a file the app says it CUT, a matching to confirm, a ratio you were not given), STOP and say so in "say": ask the question, name the file or value you need. Never write a ${what} around a gap and never fill it with TBC when Tom could simply tell you.
- Data files come as a table profile, not rows. You never compute figures by hand from a profile: when the ${what} needs numbers, totals, averages, peaks, gaps or charts from attached data, reply with "analysis" code (see ANALYSIS CODE); the app runs it over the whole table and comes back with the results, then you write the ${what} from those results.
- When Tom asks for a change to the ${what} you made, return the whole ${what} again with the change made, and say in "say" what you changed.
- "say" is always present: one to four short sentences. Never JSON inside "say".
Reply with JSON only, no markdown, ONE of:
  {"say":"question or problem"}
  {"say":"what you are computing","analysis":{"code":"function analyse(tables, h) { ... return {facts, tables, charts}; }"}}
  ${who === 'word' ? '{"say":"what you did","document":{"documentTitle":"","projectDetails":[{"label":"","value":""}],"sections":[{"content":[ nodes ]}]}}' : '{"say":"what you did","workbook":{"filename":"","summary":"","sheets":[{"name":"","columns":[{"header":""}],"rows":[[]]}]}}'}
${who === 'word' ? 'Document nodes may also be {"type":"table","id":"<analysis table id>"} (the whole computed table goes in) and {"type":"figure","id":"<analysis chart id>","caption":"what the figure shows"} (the chart drawn by the app, page width, captioned "Figure n: ..." in order). Put a heading or a sentence before each table and figure. Do not retype computed numbers into dataTable nodes: use table nodes.' : 'A sheet may be {"name":"","fromTable":"<analysis table id>"} to take a computed table whole.'}
${AN.GUIDE}`;

  const recentText = (thread) => (thread.messages || []).slice(-14).map(m => `${m.who === 'tom' ? 'TOM' : m.who.toUpperCase()}: ${m.text}${m.files && m.files.length ? ` [attached: ${m.files.join(', ')}]` : ''}${m.doc ? ` [made: ${m.doc}]` : ''}`).join('\n');
  const parse = (text) => { try { return dxfmaker.parseReply(text); } catch { return null; } };

  // one turn of the chat. role: 'word' | 'excel'
  async function chatTurn({ jobId = '', role = 'word', text = '', files = [], skills, prepared = '', run = '', fresh = false, keyOverride = '', row = null }) {   // row: { no, rev, title, people } when Make writes a deliverable: its own number, revision and approval, never one Wren picks
    const who = role === 'word' ? 'Wren' : 'Lex', what = role === 'word' ? 'document' : 'workbook';
    if (!String(text).trim() && !(files || []).length) throw new Error(`Say what ${who} should do`);
    const d = BIZ.data(), job = jobId && d.jobs.find(j => j.id === jobId);
    const key = keyOverride || `${role}:${jobId || 'nojob'}`, T = loadThreads(); if (fresh || !T[key]) T[key] = { messages: [], tables: [] };
    const thread = T[key];
    const warnings = [], tables = {};
    // tables attached earlier in this conversation stay available
    const tableFile = (n) => path.join(tablesDir(key), String(n).replace(/[\\/:*?"<>|]+/g, '_') + '.json');   // a sheet key has a slash in it
    try { for (const n of thread.tables || []) { const f = tableFile(n); if (fs.existsSync(f)) tables[n] = JSON.parse(fs.readFileSync(f, 'utf8')); } } catch {}
    const fileContent = await filesToContent(files, tables, warnings);
    for (const [n, t] of Object.entries(tables)) { if (!(thread.tables || []).includes(n)) { fs.mkdirSync(tablesDir(key), { recursive: true }); fs.writeFileSync(tableFile(n), JSON.stringify(t)); thread.tables = [...(thread.tables || []), n]; } }
    thread.messages.push({ who: 'tom', text: String(text).trim(), files: (files || []).map(f => f.name), at: new Date().toISOString() });
    thread.pending = { since: new Date().toISOString(), stage: `${who} is reading` }; saveThreads(T);   // leaving the room and coming back shows the turn still running
    const runs = require('./runs'); const R = run ? null : runs.start({ kind: 'chat', who, jobId, no: 'CHAT' }); run = run || R.id;
    try { return await turnBody(); } catch (e) {
      const msg = String(e && e.message || e); const T2 = loadThreads(); const th = T2[key] || thread; th.pending = null; th.messages = [...(th.messages || []), { who: role === 'word' ? 'wren' : 'lex', text: `Something went wrong and I stopped: ${msg}`, at: new Date().toISOString() }]; T2[key] = th; if (keyOverride) delete T2[key]; saveThreads(T2);
      if (R) runs.finish(R.id, { ok: false, error: msg }); throw e;
    }
    async function turnBody() {
    const base = role === 'word' ? WORD_SYSTEM(biz.DOC_SYSTEM('report')) : EXCEL_SYSTEM;
    const system = `${base}\n\n${CHAT_RULES(role, what)}` + (job ? '\n\n' + BIZ.contextFor(job.id, who) : '');
    const history = recentText({ messages: thread.messages.slice(0, -1) });
    const content = [];
    if (history) content.push({ type: 'text', text: `THE CONVERSATION SO FAR:\n${history}` });
    if (thread.lastSpec) content.push({ type: 'text', text: `THE ${what.toUpperCase()} YOU MADE LAST (change it when asked, return it whole):\n${JSON.stringify(thread.lastSpec).slice(0, 60000)}` });
    if (thread.lastResults) content.push({ type: 'text', text: `ANALYSIS RESULTS FROM EARLIER (tables and figures you may use by id):\n${AN.describe(thread.lastResults).slice(0, 30000)}` });
    if (warnings.length) content.push({ type: 'text', text: `THE APP SAYS: ${warnings.join('; ')}` });
    // cable schedules get the cable datasheets from the File Room
    if (role === 'excel' && /cable schedule|schedule of cables|\bcables?\b/i.test(text)) { try { const lib = require('./library'); for (const i of lib.list('datasheets').filter(x => x.on && /\.pdf$/i.test(x.file)).slice(0, 5)) { content.push({ type: 'text', text: 'CABLE DATASHEET: ' + i.name }); content.push(checker.contentBlock('pdf', i.file, fs.readFileSync(lib.pathOf('datasheets', i.file)))); } } catch {} }
    content.push(...fileContent, { type: 'text', text: `TOM: ${String(text).trim() || '(files attached)'}` });
    const tell = (msg) => { try { runs.stage(run, msg); } catch {} try { const T3 = loadThreads(); if (T3[key] && T3[key].pending) { T3[key].pending.stage = msg; saveThreads(T3); } } catch {} };

    const askModel = async (extra) => { const r = await claudeFull({ system, who: role, skills, maxTokens: 16000, messages: [{ role: 'user', content: [...content, ...extra] }], run }); return { reply: parse(r.text), raw: r.text, cut: r.stop === 'max_tokens', stop: r.stop, tokens: `${r.tokensIn || 0} in / ${r.tokensOut || 0} out${r.blocks ? ', blocks ' + Object.entries(r.blocks).map(([k, v]) => k + '×' + v).join(' ') : ''}` }; };
    tell(`${who} is reading`);
    let { reply, raw, cut, stop, tokens } = await askModel([]);
    const norm = (r) => { if (!r || typeof r !== 'object') return null; if (Array.isArray(r.sections)) return { say: r.say || '', document: r }; if (Array.isArray(r.sheets)) return { say: r.say || r.summary || '', workbook: r }; if (r.code && !r.analysis) return { say: r.say || '', analysis: { code: r.code } }; return r; };   // a bare document, workbook or code is taken as that
    reply = norm(reply);
    if (!reply) reply = { say: String(raw || '').slice(0, 1500) || `${who} did not answer: the model returned no text (stop reason ${stop || 'none'}, ${tokens}). Try again with fewer or smaller attachments.` };
    let results = null;
    // analysis: run the code, feed back an error once, then ask for the document from the results
    for (let attempt = 0; reply.analysis && reply.analysis.code && attempt < 2; attempt++) {
      tell(`${who} is running the numbers`);
      try { results = AN.run(reply.analysis.code, Object.fromEntries(Object.entries(tables).map(([k, t]) => [k, DT.objects(t)]))); } catch (e) {
        if (attempt === 1) { reply = { say: `${reply.say || ''} The analysis failed twice: ${e.message}`.trim() }; break; }
        ({ reply, raw, cut } = await askModel([{ type: 'text', text: `THE APP RAN YOUR ANALYSIS AND IT FAILED:\n${e.message}\nFix the code and send the analysis again (JSON only).` }])); reply = norm(reply) || { say: raw.slice(0, 1500) }; continue;
      }
      thread.lastResults = results;
      tell(`${who} is writing from the results`);
      ({ reply, raw, cut } = await askModel([{ type: 'text', text: `THE APP RAN YOUR ANALYSIS. RESULTS:\n${AN.describe(results)}\n\nNow write the ${what} from these results (JSON only). Refer to tables and figures by id; mention the headline numbers in the text.` }]));
      reply = norm(reply) || { say: raw.slice(0, 1500) };
    }
    const out = { say: String(reply.say || '').trim(), warnings, incomplete: cut };
    const spec = role === 'word' ? reply.document : reply.workbook;
    if (spec && (role === 'word' ? Array.isArray(spec.sections) : Array.isArray(spec.sheets))) {
      const R = thread.lastResults || { facts: {}, tables: [], charts: [] };
      if (role === 'word') {
        // computed tables and figures into the document
        const figDir = path.join(userDir(), 'o365-figures', key.replace(/[^A-Za-z0-9_-]+/g, '_')); fs.mkdirSync(figDir, { recursive: true });
        const pal = CH.palette(R.charts); let fig = 0; const nodes = [];
        for (const n of (spec.sections[0] && spec.sections[0].content) || []) {
          if (n.type === 'table') { const t = R.tables.find(x => x.id === String(n.id)); if (t) nodes.push({ type: 'dataTable', headers: t.headers, rows: t.rows }); else nodes.push({ type: 'paragraph', text: `(table ${n.id} was not in the analysis results)` }); }
          else if (n.type === 'figure') { const c = R.charts.find(x => x.id === String(n.id)); if (!c) { nodes.push({ type: 'paragraph', text: `(figure ${n.id} was not in the analysis results)` }); continue; } fig++; const png = path.join(figDir, `${c.id.replace(/[^A-Za-z0-9_-]+/g, '_')}.png`); tell(`drawing figure ${fig}`); await CH.toPng(CH.svg(c, pal), png); nodes.push({ type: 'image', path: png, imgType: 'png', width: 620, height: 300, caption: `Figure ${fig}: ${n.caption || c.title}` }); }
          else nodes.push(n);
        }
        spec.sections = [{ content: nodes }];
        const j = job || { number: 'TBC', name: '', client: '', drawings: [] };
        const num = (row && row.no) || thread.docNumber || (job ? biz.nextDocNumber(d, job) : 'TBC'); thread.docNumber = num;
        const rev = (row && row.rev) || 'P01', pp = (row && row.people) || {};
        const cfg = biz.docConfig({ kind: 'report', job: j, docNumber: num, revision: rev, drafted: spec, prepared: pp.drawn || prepared, checked: pp.checked || '', approved: pp.approved || '', description: row ? 'Preliminary - issued for comment' : 'Draft for review' }); cfg.logoPath = LOGO;
        let file = thread.lastFile && fs.existsSync(thread.lastFile) ? thread.lastFile : outFile(job && job.id, row ? `${num} ${rev} ${row.title || spec.documentTitle || 'Document'}` : `${num !== 'TBC' ? num + ' ' : ''}${spec.documentTitle || 'Document'} P01 DRAFT`, '.docx');
        const buf = await Packer.toBuffer(buildAtomaxDoc(cfg));
        try { fs.writeFileSync(file, buf); } catch { file = outFile(job && job.id, path.basename(file, '.docx'), '.docx'); fs.writeFileSync(file, buf); }   // open in Word: a new copy beside it
        out.path = file; out.title = spec.documentTitle || ''; out.docNumber = num; out.figures = fig;
        out.outline = nodes.filter(n => /^heading/.test(n.type)).map(n => (n.type === 'heading2' ? '   ' : '') + n.text).slice(0, 40);
        if (process.platform === 'win32' && /\bpdf\b/i.test(thread.messages.map(m => m.text).join(' '))) { try { tell('Word is making the PDF'); const pdf = file.replace(/\.docx$/i, '.pdf'); await require('./officepdf').toPdf(file, pdf); out.pdf = pdf; } catch (e) { out.say += ` (The PDF did not come out of Word: ${e.message})`; } }
        thread.lastSpec = { documentTitle: spec.documentTitle, projectDetails: spec.projectDetails, sections: [{ content: ((reply.document.sections[0] || {}).content || []) }] }; thread.lastFile = file;
        BIZ.log({ who, action: thread.messages.some(m => m.doc) ? 'Changed a document' : 'Wrote a document', jobId: job ? job.id : '', detail: path.basename(file) + (fig ? ` · ${fig} figure${fig === 1 ? '' : 's'}` : '') });
      } else {
        const sheets = spec.sheets.map(sh => { if (sh.fromTable) { const t = R.tables.find(x => x.id === String(sh.fromTable)); if (t) return { name: sh.name || t.title || t.id, columns: t.headers.map(h => ({ header: h })), rows: t.rows }; } return sh; }).filter(sh => Array.isArray(sh.rows));
        let file = thread.lastFile && fs.existsSync(thread.lastFile) ? thread.lastFile : outFile(job && job.id, row ? `${row.no} ${row.rev || 'P01'} ${row.title || spec.filename || 'Workbook'}` : (spec.filename || (job ? job.number + ' workbook' : 'Workbook')), '.xlsx', /schedule|register|list|index/i.test(text + ' ' + (spec.filename || '')) ? 'schedules' : /calc/i.test(text) ? 'calcs' : 'documents');
        const buf = writeXlsx(sheets); try { fs.writeFileSync(file, buf); } catch { file = outFile(job && job.id, path.basename(file, '.xlsx'), '.xlsx'); fs.writeFileSync(file, buf); }
        out.path = file; out.summary = spec.summary || ''; out.sheets = sheets.map(sh => ({ name: sh.name, rows: (sh.rows || []).length })); const s0 = sheets[0] || { columns: [], rows: [] }; out.preview = { columns: (s0.columns || []).map(c => c.header), rows: (s0.rows || []).slice(0, 25) };
        thread.lastSpec = spec; thread.lastFile = file;
        BIZ.log({ who, action: thread.messages.some(m => m.doc) ? 'Changed a workbook' : 'Made a workbook', jobId: job ? job.id : '', detail: path.basename(file) + ' · ' + (spec.summary || '') });
      }
    }
    if (!out.say) out.say = out.path ? `Saved ${path.basename(out.path)}.` : `${who} did not say anything.`;
    thread.messages.push({ who: role === 'word' ? 'wren' : 'lex', text: out.say, doc: out.path ? path.basename(out.path) : '', at: new Date().toISOString() });
    thread.pending = null; if (keyOverride) delete T[key]; saveThreads(T);
    if (R) runs.finish(R.id, { ok: true });
    return { ...out, messages: thread.messages.slice(-40) };
    }
  }
  ipcMain.handle('o365:chat', wrap(async (a) => { const key = `${a.role || 'word'}:${a.jobId || 'nojob'}`; if (LIVE.has(key)) throw new Error('Still working on your last message; wait for the reply.'); LIVE.add(key); try { return await chatTurn(a); } finally { LIVE.delete(key); } }));
  const LIVE = new Set();   // thread keys with a turn running in this process
  ipcMain.handle('o365:thread', wrap(({ jobId = '', role = 'word' }) => { const key = `${role}:${jobId || 'nojob'}`, T = loadThreads(), t = T[key]; if (t && t.pending && !LIVE.has(key)) { t.pending = null; t.messages = [...(t.messages || []), { who: role === 'word' ? 'wren' : 'lex', text: 'The app was restarted while I was working on that, so it did not finish. Send it again.', at: new Date().toISOString() }]; saveThreads(T); } return { messages: t ? t.messages.slice(-40) : [], file: t && t.lastFile && fs.existsSync(t.lastFile) ? t.lastFile : '', pending: t && t.pending ? t.pending : null }; }));
  ipcMain.handle('o365:newThread', wrap(({ jobId = '', role = 'word' }) => { const T = loadThreads(); delete T[`${role}:${jobId || 'nojob'}`]; saveThreads(T); return { ok: true }; }));

  // the one-shot calls (the Deliverables tab's Make for a Wren or Lex row) go through the same engine: a question or a problem comes
  // back as the run's error, in the agent's own words, instead of a document written around it
  // the same one-shot for Dave and Tom when they hand Lex or Wren a piece of work from their chat
  module.exports.once = async ({ role = 'word', jobId = '', request = '', prepared = '', run = '' }) => {
    if (!String(request).trim()) throw new Error(`Say what ${role === 'excel' ? 'Lex' : 'Wren'} should make`);
    const r = await chatTurn({ jobId, role, text: request, files: [], run, prepared, fresh: true, keyOverride: `once:${role}:${jobId}:${Date.now()}` });
    if (!r.path) throw Object.assign(new Error(r.say), { question: true }); return r;   // Wren / Lex asking, not a fault: Make shows it as a question to answer
  };
  ipcMain.handle('o365:excel', wrap(async ({ jobId = '', request = '', files = [], skills, run = '', row = null }) => {
    if (!request.trim()) throw new Error('Say what Lex should make');
    const r = await chatTurn({ jobId, role: 'excel', text: request, files, skills, run, row, fresh: true, keyOverride: `once:excel:${jobId}:${Date.now()}` });
    if (!r.path) throw Object.assign(new Error(r.say), { question: true }); return r;   // Wren / Lex asking, not a fault: Make shows it as a question to answer
  }));
  ipcMain.handle('o365:word', wrap(async ({ jobId = '', request = '', files = [], skills, prepared = '', run = '', row = null }) => {
    if (!request.trim()) throw new Error('Say what Wren should write');
    const r = await chatTurn({ jobId, role: 'word', text: request, files, skills, prepared, run, row, fresh: true, keyOverride: `once:word:${jobId}:${Date.now()}` });
    if (!r.path) throw Object.assign(new Error(r.say), { question: true }); return r;   // Wren / Lex asking, not a fault: Make shows it as a question to answer
  }));
}

module.exports = { register, writeXlsx, zip };
