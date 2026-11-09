// PDFs the way Tom plots them: AutoCAD itself, through its command-line core (accoreconsole.exe), using the page setup saved on the
// sheet's layout ("New": DWG To PDF.pc3, ISO full bleed A1, monochrome). Nothing is guessed about paper or pens: the layout already
// knows. One PDF beside each DXF, named the same; the console output is kept in plot-console.log next to them.
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

// the newest AutoCAD on this PC
function coreConsole() {
  const roots = [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'];
  const found = [];
  for (const r of roots) { const a = path.join(r, 'Autodesk'); let es = []; try { es = fs.readdirSync(a); } catch { continue; } for (const e of es) { const m = e.match(/^AutoCAD (?:LT )?(\d{4})$/i); if (!m) continue; const exe = path.join(a, e, 'accoreconsole.exe'); if (fs.existsSync(exe)) found.push({ year: +m[1], exe, lt: /LT/i.test(e) }); } }
  found.sort((a, b) => (a.lt - b.lt) || (b.year - a.year));
  return found[0] || null;
}

// the paper-space layouts of a DXF with their saved plot device, in tab order: the one to plot is the first set up for a PDF device
function layouts(dxfPath) {
  const lines = fs.readFileSync(dxfPath, 'latin1').split(/\r?\n/); const out = [];   // code / value pairs: a value that happens to be "0" cannot be mistaken for a code
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i].trim() !== '0' || lines[i + 1].trim() !== 'LAYOUT') continue;
    let name = '', device = '', paper = '', order = 99, seen1 = 0, ctb = '', w = 0, h = 0, rot = 0;
    for (let j = i + 2; j + 1 < lines.length; j += 2) { const c = lines[j].trim(), v = lines[j + 1].trim(); if (c === '0') { i = j - 2; break; } if (c === '1') { seen1++; if (seen1 === 2) name = v; } else if (c === '2' && !device) device = v; else if (c === '4' && !paper) paper = v; else if (c === '7' && !ctb) ctb = v; else if (c === '44' && !w) w = parseFloat(v) || 0; else if (c === '45' && !h) h = parseFloat(v) || 0; else if (c === '73') rot = parseInt(v, 10) || 0; else if (c === '71') order = parseInt(v, 10) || 0; }
    if (name && name !== 'Model') out.push({ name, device, paper, order, ctb, w, h, rot });
  }
  return out.sort((a, b) => a.order - b.order);
}
function layoutToPlot(dxfPath) {
  const L = layouts(dxfPath); if (!L.length) return null;
  return L.find(l => /pdf/i.test(l.device) && !/nitro|cute|bullzip|microsoft print/i.test(l.device)) || L.find(l => /pdf/i.test(l.device)) || L[0];
}

// plot one DXF to <same name>.pdf beside it; resolves { pdf, log } or throws with the console's own words
function plotOne(dxfPath, { console: core, timeoutMs = 90000, layoutName = '' } = {}) {   // a plot takes seconds; a console stuck on a prompt holds the DXF open, so it is cut off well before Tom presses again
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dxfPath), base = path.basename(dxfPath).replace(/\.dxf$/i, ''), pdf = path.join(dir, base + '.pdf');
    const lay = layoutName || (layoutToPlot(dxfPath) || {}).name; if (!lay) return reject(new Error(`${base}: no paper-space layout found on the sheet`));
    const scr = path.join(dir, `.plot-${base.replace(/[^A-Za-z0-9_-]+/g, '_')}.scr`);
    try { if (fs.existsSync(pdf)) fs.unlinkSync(pdf); } catch {}
    // a layout already set up for a PDF device plots with its own page setup; one set up for a plotter (A0 BORDER -> HP Designjet) gets
    // the house PDF setup spelled out: DWG To PDF.pc3, ISO full bleed A1, extents fitted and centred, monochrome.ctb (what Tom's plot logs show)
    const L = (layoutToPlot(dxfPath) || {}); const pdfSetup = /pdf/i.test(L.device || '') && L.name === lay;
    // the plot as one AutoLISP (command ...) line: every answer is a quoted string, so a path with spaces in it (OneDrive - Atomax-UK Ltd)
    // arrives whole. In a plain script a space is an Enter and the file name was cut at the first one (Five Fords, 9 Nov).
    const q = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    // a sheet set up for PDF already: the same sheet size, full bleed (the core console's own PDF config lacks the "expand" sizes and
    // silently dropped to A3 with margins, 3.5% smaller: Five Fords 9 Nov), extents at 1:1 centred, the layout's own style table
    const iso = { '841x1189': 'A0', '594x841': 'A1', '420x594': 'A2', '297x420': 'A3', '210x297': 'A4' };
    const sz = pdfSetup && L.w && L.h ? `${Math.round(Math.min(L.w, L.h))}x${Math.round(Math.max(L.w, L.h))}` : '';
    const paperName = iso[sz] ? `ISO full bleed ${iso[sz]} (${Math.max(L.w, L.h).toFixed(2)} x ${Math.min(L.w, L.h).toFixed(2)} MM)` : '';
    const answers = pdfSetup && paperName
      ? ['_Y', lay, 'DWG To PDF.pc3', paperName, '_M', (L.rot === 1 || L.rot === 3) ? '_L' : '_P', '_N', '_E', '1:1', '_C', '_Y', L.ctb || 'acad.ctb', '_Y', '_N', '_N', '_N', pdf, '_N', '_Y']
      : pdfSetup ? ['_N', lay, '', 'DWG To PDF.pc3', pdf, '_N', '_Y']   // not detailed: layout, page setup (none), device, file, save setup N, proceed Y
      : ['_Y', lay, 'DWG To PDF.pc3', 'ISO full bleed A1 (841.00 x 594.00 MM)', '_M', '_L', '_N', '_E', '_F', '_C', '_Y', 'monochrome.ctb', '_Y', '_N', '_N', '_N', pdf, '_N', '_Y'];
    const lines = ['FILEDIA 0', 'CMDDIA 0', 'BACKGROUNDPLOT 0', `(command "_.-PLOT" ${answers.map(q).join(' ')})`, '_.DELAY 2000', '_.QUIT', '_Y'];
    fs.writeFileSync(scr, lines.join('\r\n') + '\r\n', 'latin1');
    const child = spawn(core.exe, ['/i', dxfPath, '/s', scr, '/l', 'en-US'], { cwd: dir, windowsHide: true });
    let out = ''; child.stdout.on('data', (b) => { out += b.toString('latin1'); }); child.stderr.on('data', (b) => { out += b.toString('latin1'); });
    const t = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); try { fs.unlinkSync(scr); } catch {} reject(new Error(`${base}: could not start AutoCAD core console (${e.message})`)); });
    child.on('close', () => {
      clearTimeout(t); try { fs.unlinkSync(scr); } catch {}
      const log = out.replace(/\r/g, '').split('\n').filter(l => l.trim()).slice(-60).join('\n');
      try { fs.appendFileSync(path.join(dir, 'plot-console.log'), `\n===== ${new Date().toISOString()} ${base} (layout ${lay})\n${log}\n`); } catch {}
      // the PDF can land a moment after the console exits
      const waitFor = (n) => { if (fs.existsSync(pdf) && fs.statSync(pdf).size > 1024) return resolve({ pdf, layout: lay, log }); if (n <= 0) return reject(new Error(`${base}: AutoCAD did not write the PDF (layout "${lay}"). Last console lines: ${log.split('\n').slice(-6).join(' | ')}`)); setTimeout(() => waitFor(n - 1), 500); };
      waitFor(20);
    });
  });
}

// a DWG saved as DXF beside it (same name), by the same core console: SAVEAS DXF, 2010 format, full precision. Resolves the DXF path or
// throws with the console's own words. Nothing in the DWG is changed.
function dwgToDxf(dwgPath, { console: core, timeoutMs = 180000, out = '' } = {}) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dwgPath), base = path.basename(dwgPath).replace(/\.dwg$/i, ''), dxf = out || path.join(dir, base + '.dxf');
    const scr = path.join(dir, `.dxf-${base.replace(/[^A-Za-z0-9_-]+/g, '_')}.scr`);
    try { if (fs.existsSync(dxf)) fs.unlinkSync(dxf); } catch {}
    fs.writeFileSync(scr, ['FILEDIA 0', 'CMDDIA 0', '_.SAVEAS', 'DXF', '16', '2010', dxf, '_.DELAY 1000', '_.QUIT', '_Y'].join('\r\n') + '\r\n', 'latin1');   // SAVEAS DXF: decimal places 16, R2010, path
    const child = spawn(core.exe, ['/i', dwgPath, '/s', scr, '/l', 'en-US'], { cwd: dir, windowsHide: true });
    let o = ''; child.stdout.on('data', (b) => { o += b.toString('latin1'); }); child.stderr.on('data', (b) => { o += b.toString('latin1'); });
    const t = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); try { fs.unlinkSync(scr); } catch {} reject(new Error(`${base}: could not start AutoCAD core console (${e.message})`)); });
    child.on('close', () => {
      clearTimeout(t); try { fs.unlinkSync(scr); } catch {}
      const log = o.replace(/\r/g, '').split('\n').filter(l => l.trim()).slice(-40).join('\n');
      try { fs.appendFileSync(path.join(dir, 'plot-console.log'), `\n===== ${new Date().toISOString()} ${base} -> DXF\n${log}\n`); } catch {}
      const waitFor = (n) => { if (fs.existsSync(dxf) && fs.statSync(dxf).size > 1024) return resolve({ dxf, log }); if (n <= 0) return reject(new Error(`${base}: AutoCAD did not write the DXF. Last console lines: ${log.split('\n').slice(-6).join(' | ')}`)); setTimeout(() => waitFor(n - 1), 500); };
      waitFor(20);
    });
  });
}
module.exports = { coreConsole, layouts, layoutToPlot, plotOne, dwgToDxf };
