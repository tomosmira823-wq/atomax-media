// PDFs of Word and Excel documents the way the office makes them: Word and Excel themselves, driven through PowerShell on this PC, so the
// PDF is exactly what Tom would get from File > Export. Fields (page numbers, the table of contents) are updated first; the document is
// opened read-only and nothing is saved back to it.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');

const ps1 = (s) => `'${String(s).replace(/'/g, "''")}'`;
function script(src, pdf) {
  if (/\.docx?$/i.test(src)) return `
$ErrorActionPreference = 'Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false; $w.DisplayAlerts = 0
try {
  $d = $w.Documents.Open(${ps1(src)}, $false, $true)
  try { $d.Fields.Update() | Out-Null } catch {}
  try { foreach ($t in $d.TablesOfContents) { $t.Update() | Out-Null } } catch {}
  $d.ExportAsFixedFormat(${ps1(pdf)}, 17)
  $d.Close(0)
} finally { $w.Quit() }
Write-Output 'done'`;
  return `
$ErrorActionPreference = 'Stop'
$x = New-Object -ComObject Excel.Application
$x.Visible = $false; $x.DisplayAlerts = $false
try {
  $wb = $x.Workbooks.Open(${ps1(src)}, 0, $true)
  $x.Calculate()
  $wb.ExportAsFixedFormat(0, ${ps1(pdf)})
  $wb.Close($false)
} finally { $x.Quit() }
Write-Output 'done'`;
}

// one document to a PDF; resolves { pdf } or throws with PowerShell's own words. Word and Excel cannot open a path over 259 characters (deep
// OneDrive job folders with long titles get there): such a file is converted from a short copy in the temp folder and the PDF copied back
function toPdf(src, pdf, opts = {}) {
  if (process.platform === 'win32' && (src.length > 240 || pdf.length > 240)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amo-')), s2 = path.join(tmp, 'doc' + path.extname(src)), p2 = path.join(tmp, 'doc.pdf');
    fs.copyFileSync(src, s2);
    return toPdfShort(s2, p2, opts).then(() => { fs.copyFileSync(p2, pdf); return { pdf }; }).finally(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
  }
  return toPdfShort(src, pdf, opts);
}
function toPdfShort(src, pdf, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Word and Excel PDFs need Windows'));
    const scr = path.join(os.tmpdir(), `amo-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.ps1`);
    fs.writeFileSync(scr, '﻿' + script(src, pdf), 'utf8');
    try { if (fs.existsSync(pdf)) fs.unlinkSync(pdf); } catch { try { fs.unlinkSync(scr); } catch {} return reject(new Error(`${path.basename(pdf)} is open in another program (a PDF viewer?). Close it and try again.`)); }
    const t0 = Date.now();
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scr], { windowsHide: true });
    let out = ''; child.stdout.on('data', (b) => { out += b.toString(); }); child.stderr.on('data', (b) => { out += b.toString(); });
    const t = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); try { fs.unlinkSync(scr); } catch {} reject(new Error(`could not start PowerShell (${e.message})`)); });
    child.on('close', () => {
      clearTimeout(t); try { fs.unlinkSync(scr); } catch {}
      if (fs.existsSync(pdf) && fs.statSync(pdf).size > 1024 && fs.statSync(pdf).mtimeMs >= t0 - 2000) return resolve({ pdf });   // only a PDF this run wrote
      const why = out.replace(/\s+/g, ' ').trim().slice(-300);
      reject(new Error(`${path.basename(src)}: ${/\.docx?$/i.test(src) ? 'Word' : 'Excel'} did not write the PDF${why ? ` (${why})` : ''}`));
    });
  });
}

module.exports = { toPdf };
