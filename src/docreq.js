// National Grid document numbers come from BGEN document control, asked for on the Document Request form ("Document Request -
// Bustleholme n.xlsx"): NG category, description, revision, sheet no. Document control returns the NG and BGEN numbers. Nothing goes out
// on an NG job under our own number: a deliverable without an NG number goes on the next request before the issue.
'use strict';
const fs = require('fs'), path = require('path'), JSZip = require('jszip');
const { setCell } = require('./rfireg');

const NG_NO = /^X\d{5,6}-[A-Z]{2,4}-[A-Z0-9]{1,4}-[A-Z0-9]{1,4}-[A-Z]{2}-[A-Z]-\d{4}$/i;   // X11475-BGN-ZZ-XX-DR-E-7153
const hasNgNumber = (no) => NG_NO.test(String(no || '').trim());
// a job numbers its drawings the NG way when most of its numbered rows do
const ngJob = (rows) => { const n = rows.filter(r => !/^TBC-/i.test(r.no)); return n.length > 0 && n.filter(r => hasNgNumber(r.no)).length >= Math.max(1, Math.ceil(n.length / 2)); };
const needsRequest = (rows) => rows.filter(r => !hasNgNumber(r.no) && !hasNgNumber(r.alt) && !/cancel|superseded/i.test(r.status || '') && r.group !== 'reserved' && r.group !== 'site');

// the NG category (the first two digits of the NG drawing number, from the NG classification): our own number carries it (42_BG_0055 -> 42)
function category(row) {
  const m = String(row.alt || row.no || '').match(/^(\d{2})_[A-Z]{2}_\d{4}$/i); if (m) return m[1];
  const t = `${row.type || ''} ${row.title || ''}`.toLowerCase();
  if (/single.?line|\bsld\b|earthing|bonding/.test(t)) return '42';
  if (/block (cable )?diagram|\bbcd\b/.test(t)) return '72';
  if (/wiring|schematic|interconnection|intertrip|loop|termination/.test(t)) return '43';
  if (/cable schedule|schedule/.test(t)) return '72';
  if (/cable rout|equipment location|site layout|layout of|routing/.test(t)) return '70';
  if (/switchroom|building|floor plan/.test(t)) return '32';
  if (/foundation|civil/.test(t)) return '15';
  if (/calc|report|spec|intent|document|register|philosophy|study|procedure|manual|package|list/.test(t)) return '09';
  return '09';   // a document of some kind until document control say otherwise
}
const isDrawing = (row) => row.group === 'drawing' || /drawing|diagram|layout|schematic|sld|bcd/i.test(`${row.type || ''} ${row.title || ''}`);
const dmy = (d = new Date()) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function templatePath(templateDir) {
  const isXlsx = (f) => { try { const b = Buffer.alloc(2); const fd = fs.openSync(f, 'r'); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd); return b.toString('latin1') === 'PK' && fs.statSync(f).size > 4096; } catch { return false; } };
  const walk = (p, depth) => { if (depth > 4) return ''; let es = []; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return ''; } for (const e of es) { if (e.name.startsWith('~$')) continue; const f = path.join(p, e.name); if (e.isDirectory()) { const r = walk(f, depth + 1); if (r) return r; } else if (/document request.*\.xlsx$/i.test(e.name) && isXlsx(f)) return f; } return ''; };
  return (templateDir && fs.existsSync(templateDir) ? walk(templateDir, 0) : '') || path.join(__dirname, 'assets', 'Document Request template.xlsx');
}

// where things are on a sheet, read from its labels (the two forms in the workbook are not laid out on the same rows)
const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function cellsWithText(sheetXml, strs) {
  const out = [];
  for (const m of sheetXml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[3] || '', inner = m[4] || ''; let text = '';
    if (/t="s"/.test(attrs)) { const v = inner.match(/<v>(\d+)<\/v>/); if (v) text = strs[+v[1]] || ''; }
    else if (/t="inlineStr"/.test(attrs)) text = inner.replace(/<[^>]+>/g, '');
    if (text) out.push({ col: m[1], row: +m[2], text: text.trim() });
  }
  return out;
}
// one form: drawings on the Drawing No. sheet, documents on the Document No. sheet; the header block on both
async function fill(templateFile, { projectTitle, projectNumber, submittedBy, contractor = 'ATOMAX', date }, rows) {
  const zip = await JSZip.loadAsync(fs.readFileSync(templateFile));
  let strs = []; try { const ss = await zip.file('xl/sharedStrings.xml').async('string'); strs = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => m[1].replace(/<[^>]+>/g, '')); } catch {}
  const sheets = ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].filter(n => zip.file(n));
  const drawings = rows.filter(isDrawing), documents = rows.filter(r => !isDrawing(r));
  for (const [i, name] of sheets.entries()) {
    let x = await zip.file(name).async('string');
    const cells = cellsWithText(x, strs);
    const valueCellFor = (label) => { const c = cells.find(k => new RegExp('^' + label, 'i').test(k.text)); return c ? `${colName(colNum(c.col) + 1)}${c.row}` : ''; };
    const H = { 'Project Title': projectTitle || '', 'Project Number': projectNumber || '', 'Submitt?e?d? By': submittedBy || '', 'Submission Date': date || dmy(), 'Contractor': contractor, 'Signature': '', 'Returned By': '', 'Return Date': '' };
    for (const [label, val] of Object.entries(H)) { const ref = valueCellFor(label); if (ref) x = setCell(x, ref, val); }
    const head = cells.find(k => /^NATIONAL GRID CATEGORY/i.test(k.text)); if (!head) { zip.file(name, x); continue; }
    const first = head.row + 1, foot = cells.find(k => k.row > head.row && /^\* Please complete/i.test(k.text)), last = foot ? foot.row - 1 : first + 31;
    const cols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((_, j) => colName(colNum(head.col) + j));   // category, description, revision, NG no, BGEN no, sheet, site, date
    for (let r = first; r <= last; r++) for (const c of cols) x = setCell(x, `${c}${r}`, '');   // the template's example rows (and an earlier form's) go
    const list = i === 0 ? drawings : documents;
    list.slice(0, last - first + 1).forEach((row, k) => { const r = first + k; const vals = [category(row), String(row.title || '').trim(), row.rev || 'P01', '', '', String(row.sheet || 1), '', date || dmy()]; vals.forEach((v, j) => { if (v) x = setCell(x, `${cols[j]}${r}`, v); }); });
    zip.file(name, x);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// the next form number in the transmittals folder: "Document Request - <site> 7.xlsx" on file -> 8
function nextFormPath(dir, site) {
  let n = 0; try { for (const f of fs.readdirSync(dir)) { const m = f.match(/^Document Request - (.+?) (\d+)\.(xlsx|pdf)$/i); if (m) n = Math.max(n, +m[2]); } } catch {}
  return path.join(dir, `Document Request - ${site} ${n + 1}.xlsx`);
}

module.exports = { fill, templatePath, nextFormPath, needsRequest, ngJob, hasNgNumber, category };
