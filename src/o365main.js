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
Reply with JSON only, no markdown: {"filename":"short file name without extension","summary":"one or two lines: what is in it and anything TBC","sheets":[{"name":"sheet name","columns":[{"header":"..."}],"rows":[["cell", 1.5, "=B2*C2"]]}]}`;

const WORD_SYSTEM = (base) => `You are Wren, the Word agent in the Atomax-UK 365 room. The engineer's request decides the document type (report, technical note, letter, specification, method statement, minutes) and its sections; the default sections below are only a fallback. Turn any attached notes (for example a Markdown technical note) into a proper Atomax document without changing their facts.\n\n${base}`;

function register({ ipcMain, claudeFull, BIZ, checker, userDir, projects }) {
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw new Error(String(e && e.message || e)); } };
  const IMG = /\.(png|jpe?g|gif|webp)$/i;
  // attached files -> Claude content: spreadsheets and documents as text, PDFs and pictures as themselves
  function filesToContent(files) {
    const content = [];
    for (const f of (files || []).slice(0, 8)) {
      const buf = Buffer.from(f.base64, 'base64'), ext = path.extname(f.name).toLowerCase();
      try {
        if (ext === '.xlsx' || ext === '.xlsm') content.push({ type: 'text', text: `ATTACHED WORKBOOK ${f.name}:\n` + checker.sheetsAsText(checker.readXlsx(buf), 40000) });
        else if (ext === '.pdf') { content.push({ type: 'text', text: 'Attached: ' + f.name }); content.push(checker.contentBlock('pdf', f.name, buf)); }
        else if (IMG.test(f.name)) { content.push({ type: 'text', text: 'Attached: ' + f.name }); content.push(checker.contentBlock('image', f.name, buf)); }
        else if (ext === '.docx') { const tmp = path.join(userDir(), 'tmp-' + Date.now() + '.docx'); fs.writeFileSync(tmp, buf); const t = projects.extract(tmp); fs.unlinkSync(tmp); content.push({ type: 'text', text: `ATTACHED DOCUMENT ${f.name}:\n${t}` }); }
        else content.push({ type: 'text', text: `ATTACHED ${f.name}:\n` + buf.toString('utf8').slice(0, 40000) });
      } catch (e) { content.push({ type: 'text', text: `(${f.name} could not be read: ${e.message})` }); }
    }
    return content;
  }
  const outFile = (jobId, base, ext) => {
    const dir = (jobId && BIZ.outputDirFor(jobId, 'documents')) || path.join(userDir(), 'office365');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(base || 'Document').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Document';
    let p = path.join(dir, safe + ext), i = 2; while (fs.existsSync(p)) p = path.join(dir, `${safe} (${i++})${ext}`);
    return p;
  };
  // ask Claude, with room and one retry when the reply is cut off
  async function ask(system, who, skills, content, max = 16000) {
    let r = await claudeFull({ system, who, skills, maxTokens: max, messages: [{ role: 'user', content }] });
    if (r.stop === 'max_tokens') r = await claudeFull({ system: system + '\nBe concise.', who, skills, maxTokens: max * 2, messages: [{ role: 'user', content }] });
    return { spec: dxfmaker.parseReply(r.text), cut: r.stop === 'max_tokens' };
  }

  ipcMain.handle('o365:excel', wrap(async ({ jobId = '', request = '', files = [], skills }) => {
    if (!request.trim()) throw new Error('Say what Lex should make');
    const job = jobId && BIZ.data().jobs.find(j => j.id === jobId);
    const system = EXCEL_SYSTEM + (job ? '\n\n' + BIZ.contextFor(job.id, 'Lex') : '');
    const { spec, cut } = await ask(system, 'excel', skills, [...filesToContent(files), { type: 'text', text: 'REQUEST: ' + request }]);
    if (!Array.isArray(spec.sheets) || !spec.sheets.length) throw new Error('Lex did not return a workbook');
    const file = outFile(job && job.id, spec.filename || (job ? job.number + ' workbook' : 'Workbook'), '.xlsx');
    fs.writeFileSync(file, writeXlsx(spec.sheets));
    BIZ.log({ who: 'Lex', action: 'Made a workbook', jobId: job ? job.id : '', detail: path.basename(file) + ' · ' + (spec.summary || '') });
    const s0 = spec.sheets[0];
    return { path: file, summary: spec.summary || '', incomplete: cut, sheets: spec.sheets.map(s => ({ name: s.name, rows: (s.rows || []).length })), preview: { columns: (s0.columns || []).map(c => c.header), rows: (s0.rows || []).slice(0, 25) } };
  }));

  ipcMain.handle('o365:word', wrap(async ({ jobId = '', request = '', files = [], skills, prepared = '' }) => {
    if (!request.trim()) throw new Error('Say what Wren should write');
    const d = BIZ.data(), job = jobId && d.jobs.find(j => j.id === jobId);
    const system = WORD_SYSTEM(biz.DOC_SYSTEM('report')) + (job ? '\n\n' + BIZ.contextFor(job.id, 'Wren') : '');
    const { spec, cut } = await ask(system, 'word', skills, [...filesToContent(files), { type: 'text', text: 'REQUEST: ' + request }]);
    if (!Array.isArray(spec.sections)) throw new Error('Wren did not return a document');
    const j = job || { number: 'TBC', name: '', client: '', drawings: [] };
    const num = job ? biz.nextDocNumber(d, job) : 'TBC';
    const cfg = biz.docConfig({ kind: 'report', job: j, docNumber: num, revision: 'P01', drafted: spec, prepared, description: 'Draft for review' });
    cfg.logoPath = LOGO;
    const file = outFile(job && job.id, `${num !== 'TBC' ? num + ' ' : ''}${spec.documentTitle || 'Document'} P01 DRAFT`, '.docx');
    fs.writeFileSync(file, await Packer.toBuffer(buildAtomaxDoc(cfg)));
    BIZ.log({ who: 'Wren', action: 'Wrote a document', jobId: job ? job.id : '', detail: path.basename(file) });
    const nodes = (spec.sections[0] && spec.sections[0].content) || [];
    return { path: file, incomplete: cut, title: spec.documentTitle || '', outline: nodes.filter(n => /^heading/.test(n.type)).map(n => (n.type === 'heading2' ? '   ' : '') + n.text).slice(0, 40), docNumber: num };
  }));
}

module.exports = { register, writeXlsx, zip };
