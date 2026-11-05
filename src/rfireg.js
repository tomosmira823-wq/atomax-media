// The RFI register on the Atomax house template (XXXXXXXX-0000-01-01-0003 - RFI REGISTER.xlsx): the header block filled in for the job,
// one row per RFI from the job desk, the template's own formulas, styles and summary left exactly as they are. The workbook is edited at
// the XML level so nothing of the template is lost. A copy of the template ships with the app; one in the Template Project Directory wins.
'use strict';
const fs = require('fs'), path = require('path'), JSZip = require('jszip');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ddmmyy = (d) => { const t = d ? new Date(d) : new Date(); if (Number.isNaN(t.getTime())) return String(d || ''); return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getFullYear()).slice(2)}`; };

// the template: the Template Project Directory's copy (any .xlsx whose name says RFI register) first, else the app's own
const isXlsx = (f) => { try { const b = Buffer.alloc(2); const fd = fs.openSync(f, 'r'); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd); return b.toString('latin1') === 'PK' && fs.statSync(f).size > 4096; } catch { return false; } };   // a real workbook, not a placeholder
function templatePath(templateDir) {
  const walk = (p, depth) => { if (depth > 4) return ''; let es = []; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return ''; } for (const e of es) { if (e.name.startsWith('~$')) continue; const f = path.join(p, e.name); if (e.isDirectory()) { const r = walk(f, depth + 1); if (r) return r; } else if (/rfi.*register.*\.xlsx$/i.test(e.name) && isXlsx(f)) return f; } return ''; };
  const t = templateDir && fs.existsSync(templateDir) ? walk(templateDir, 0) : '';
  return t || path.join(__dirname, 'assets', 'RFI REGISTER template.xlsx');
}

// set one cell to a string (inline), keeping the cell's style; the cell is created in the row if the template has none
function setCell(sheetXml, ref, value) {
  const col = ref.match(/^[A-Z]+/)[0], row = ref.match(/\d+$/)[0];
  const v = value === '' || value === null || value === undefined ? '' : `<is><t xml:space="preserve">${esc(value)}</t></is>`;
  const re = new RegExp(`<c r="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const m = sheetXml.match(re);
  if (m) {
    const attrs = m[1].replace(/\s+t="[^"]*"/, '');
    return sheetXml.replace(re, v ? `<c r="${ref}"${attrs} t="inlineStr">${v}</c>` : `<c r="${ref}"${attrs}/>`);
  }
  if (!v) return sheetXml;
  // no such cell: put it in its row in column order
  const rowRe = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const rm = sheetXml.match(rowRe); if (!rm) return sheetXml;
  const cells = rm[2].match(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
  const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  let out = '', placed = false; const cell = `<c r="${ref}" t="inlineStr">${v}</c>`;
  for (const c of cells) { const cc = c.match(/<c r="([A-Z]+)/)[1]; if (!placed && colNum(cc) > colNum(col)) { out += cell; placed = true; } out += c; }
  if (!placed) out += cell;
  return sheetXml.replace(rowRe, `$1${out}$3`);
}

// job: { number, name, client }, head: { docNo, compiledBy, revision, issueDate, discipline, issuedBy, issueTo }, rfis: [{ no, q, status, answer, raised, closed, priority, to, attachments }]
async function fill(templateFile, job, head, rfis) {
  const zip = await JSZip.loadAsync(fs.readFileSync(templateFile));
  const name = 'xl/worksheets/sheet1.xml'; let x = await zip.file(name).async('string');
  const H = { B3: job.client || '', B4: `${job.number} ${job.name || ''}`.trim(), B5: head.title || 'Request for Information (RFI) Register', B6: head.docNo || '', B7: head.compiledBy || '', B8: head.revision || 'P01', B9: head.issueDate || ddmmyy() };
  for (const [ref, val] of Object.entries(H)) x = setCell(x, ref, val);
  const first = 13, max = 1061;
  rfis.slice(0, max - first + 1).forEach((r, i) => {
    const row = first + i, open = !/closed|answered/i.test(r.status || '');
    const q = String(r.q || '').replace(/^please send:\s*/i, '').trim();
    const cells = { B: head.discipline || 'Electrical', C: q, D: head.issuedBy || 'Atomax-UK', E: r.to || head.issueTo || job.client || '', F: ddmmyy(r.raised), G: r.requiredBy || '', H: (r.priority || 'Medium').toUpperCase(), I: r.attachments || '', J: r.answer || '', M: open ? '' : ddmmyy(r.closed || r.answeredAt || new Date()), N: open ? 'OPEN' : 'CLOSED' };
    for (const [col, val] of Object.entries(cells)) x = setCell(x, `${col}${row}`, val);
  });
  // rows beyond the RFIs stay as the template left them (RFI-0nn with nothing against it)
  zip.file(name, x);
  // formulas (counts in the summary) recalculate when Excel opens the file
  try { const wb = await zip.file('xl/workbook.xml').async('string'); if (!/fullCalcOnLoad/.test(wb)) zip.file('xl/workbook.xml', wb.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')); } catch {}
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { fill, templatePath, setCell };
