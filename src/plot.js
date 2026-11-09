// PDFs the way Tom plots them: AutoCAD itself, through its command-line core (accoreconsole.exe), using the page setup saved on the
// sheet's layout ("New": DWG To PDF.pc3, ISO full bleed A1, monochrome). Nothing is guessed about paper or pens: the layout already
// knows. One PDF beside each DXF, named the same; the console output is kept in plot-console.log next to them.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
// scripts and console logs live in the app's own folder, never in the issue folder that goes to the client (Tom 9 Nov)
function workDir() { let d = ''; try { d = path.join(require('electron').app.getPath('userData'), 'plot-logs'); } catch { d = path.join(os.tmpdir(), 'atomax-plot-logs'); } try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; }
const logLine = (title, log) => { try { fs.appendFileSync(path.join(workDir(), 'plot-console.log'), `\n===== ${new Date().toISOString()} ${title}\n${log}\n`); } catch {} };
const q = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// the newest AutoCAD on this PC
function coreConsole() {
  if (process.env.AMO_FAKE_PLOT) return { year: 0, exe: '', lt: false, fake: true };   // the test suite's stand-in for AutoCAD (no AutoCAD on the test box)
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

// The copy AutoCAD plots from. A DXF opened by the core console rebuilds every associative hatch from its boundary objects
// ("Hatch boundary associativity removed") and gets the islands wrong: the Atomax logo's white top faces came out solid green on every
// Five Fords P03 (9 Nov). Tested on Tom's PC: the same DXF with the hatches marked non-associative (group 71 = 0) plots exactly like the
// DWG did. Only this throwaway copy is changed; the DXF that is issued stays byte for byte as written.
function plotCopy(dxfPath) {
  const text = fs.readFileSync(dxfPath).toString('latin1'), eol = /\r\n/.test(text.slice(0, 4000)) ? '\r\n' : '\n', L = text.split(/\r?\n/);
  let inHatch = false, n = 0;
  for (let i = 0; i + 1 < L.length; i += 2) {
    const c = L[i].trim();
    if (c === '0') inHatch = L[i + 1].trim() === 'HATCH';
    else if (inHatch && c === '71' && L[i + 1].trim() === '1') { L[i + 1] = L[i + 1].replace('1', '0'); n++; }
  }
  const out = path.join(workDir(), `plotcopy-${Date.now()}-${path.basename(dxfPath).replace(/[^A-Za-z0-9_.-]+/g, '_')}`);
  fs.writeFileSync(out, Buffer.from(L.join(eol), 'latin1'));
  return { path: out, hatches: n };
}

// plot one DXF to <same name>.pdf beside it; resolves { pdf, log } or throws with the console's own words
function plotOne(dxfPath, { console: core, timeoutMs = 90000, layoutName = '' } = {}) {   // a plot takes seconds; a console stuck on a prompt holds the DXF open, so it is cut off well before Tom presses again
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dxfPath), base = path.basename(dxfPath).replace(/\.dxf$/i, ''), pdf = path.join(dir, base + '.pdf');
    const lay = layoutName || (layoutToPlot(dxfPath) || {}).name; if (!lay) return reject(new Error(`${base}: no paper-space layout found on the sheet`));
    if (core && core.fake) { const L0 = layoutToPlot(dxfPath) || {}, mm = (v) => (v || 0) * 72 / 25.4, W = mm(Math.max(L0.w || 420, L0.h || 297)), H = mm(Math.min(L0.w || 420, L0.h || 297)); fs.writeFileSync(pdf, `%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}]>>endobj\n` + ' '.repeat(1100) + '\n%%EOF\n'); return resolve({ pdf, layout: lay, log: 'fake plot' }); }
    const scr = path.join(workDir(), `plot-${base.replace(/[^A-Za-z0-9_-]+/g, '_')}-${Date.now()}.scr`);
    // the old PDF must go first: if it cannot (open in a viewer), stop now rather than pass the old one off as new
    try { if (fs.existsSync(pdf)) fs.unlinkSync(pdf); } catch { return reject(new Error(`${base}.pdf is open in another program (a PDF viewer?). Close it and try again.`)); }
    const t0 = Date.now();
    // a layout already set up for a PDF device plots with its own page setup; one set up for a plotter (A0 BORDER -> HP Designjet) gets
    // the house PDF setup spelled out: DWG To PDF.pc3, ISO full bleed A1, extents fitted and centred, monochrome.ctb (what Tom's plot logs show)
    const L = (layoutToPlot(dxfPath) || {}); const pdfSetup = /pdf/i.test(L.device || '') && L.name === lay;
    // the plot as one AutoLISP (command ...) line: every answer is a quoted string, so a path with spaces in it (OneDrive - Atomax-UK Ltd)
    // arrives whole. In a plain script a space is an Enter and the file name was cut at the first one (Five Fords, 9 Nov).
    // a sheet set up for PDF already: the same sheet size, full bleed (the core console's own PDF config lacks the "expand" sizes and
    // silently dropped to A3 with margins, 3.5% smaller: Five Fords 9 Nov), extents at 1:1 centred, the layout's own style table
    const iso = { '841x1189': 'A0', '594x841': 'A1', '420x594': 'A2', '297x420': 'A3', '210x297': 'A4' };
    const sz = pdfSetup && L.w && L.h ? `${Math.round(Math.min(L.w, L.h))}x${Math.round(Math.max(L.w, L.h))}` : '';
    const paperName = iso[sz] ? `ISO full bleed ${iso[sz]} (${Math.max(L.w, L.h).toFixed(2)} x ${Math.min(L.w, L.h).toFixed(2)} MM)` : '';
    const answers = pdfSetup && paperName
      ? ['_Y', lay, 'DWG To PDF.pc3', paperName, '_M', (L.rot === 1 || L.rot === 3) ? '_L' : '_P', '_N', '_E', '_F', '_C', '_Y', /^(acad|monochrome|grayscale|screening \d+%)\.ctb$/i.test(L.ctb || '') ? L.ctb : 'acad.ctb', '_Y', '_N', '_N', '_N', pdf, '_N', '_Y']   // only a style table the core console is sure to have (acadlt.ctb is not: the plot ended there, Five Fords 9 Nov); acad.ctb is the same colour-for-colour mapping
      : pdfSetup ? ['_N', lay, '', 'DWG To PDF.pc3', pdf, '_N', '_Y']   // not detailed: layout, page setup (none), device, file, save setup N, proceed Y
      : ['_Y', lay, 'DWG To PDF.pc3', 'ISO full bleed A1 (841.00 x 594.00 MM)', '_M', '_L', '_N', '_E', '_F', '_C', '_Y', 'monochrome.ctb', '_Y', '_N', '_N', '_N', pdf, '_N', '_Y'];
    const lines = ['FILEDIA 0', 'CMDDIA 0', 'BACKGROUNDPLOT 0', `(command "_.-PLOT" ${answers.map(q).join(' ')})`, '_.DELAY 2000', '_.QUIT', '_Y'];
    fs.writeFileSync(scr, lines.join('\r\n') + '\r\n', 'latin1');
    let src = dxfPath, copy = null; try { copy = plotCopy(dxfPath); src = copy.path; } catch (e) { logLine(`${base} plot copy`, String(e && e.message || e)); }
    const child = spawn(core.exe, ['/i', src, '/s', scr, '/l', 'en-US'], { cwd: workDir(), windowsHide: true });   /* the console writes plot.log into its working folder: never the issue folder (it went out with ISSUE 8, 9 Nov) */
    let out = ''; child.stdout.on('data', (b) => { out += b.toString('latin1'); }); child.stderr.on('data', (b) => { out += b.toString('latin1'); });
    const t = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); try { fs.unlinkSync(scr); } catch {} reject(new Error(`${base}: could not start AutoCAD core console (${e.message})`)); });
    child.on('close', () => {
      clearTimeout(t); try { fs.unlinkSync(scr); } catch {} if (copy) { try { fs.unlinkSync(copy.path); } catch {} }
      const log = out.replace(/\r/g, '').split('\n').filter(l => l.trim()).slice(-60).join('\n');
      logLine(`${base} (layout ${lay})`, log);
      // the PDF can land a moment after the console exits; only one written by THIS plot counts
      const waitFor = (n) => { if (fs.existsSync(pdf) && fs.statSync(pdf).size > 1024 && fs.statSync(pdf).mtimeMs >= t0 - 2000) return resolve({ pdf, layout: lay, log }); if (n <= 0) return reject(new Error(`${base}: AutoCAD did not write the PDF (layout "${lay}"). Last console lines: ${log.split('\n').slice(-6).join(' | ')}`)); setTimeout(() => waitFor(n - 1), 500); };
      waitFor(20);
    });
  });
}

// a DWG saved as DXF beside it (same name), by the same core console: SAVEAS DXF, 2010 format, full precision. Resolves the DXF path or
// throws with the console's own words. Nothing in the DWG is changed.
function dwgToDxf(dwgPath, { console: core, timeoutMs = 180000, out = '' } = {}) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dwgPath), base = path.basename(dwgPath).replace(/\.dwg$/i, ''), dxf = out || path.join(dir, base + '.dxf');
    if (core && core.fake) return reject(new Error('AutoCAD was not found (test stand-in): save it as DXF by hand'));
    const scr = path.join(workDir(), `dxf-${base.replace(/[^A-Za-z0-9_-]+/g, '_')}-${Date.now()}.scr`);
    // never over an existing DXF: a file of that name is somebody's, not ours to replace
    if (fs.existsSync(dxf)) return reject(new Error(`${path.basename(dxf)} already exists beside the DWG: Dex will not overwrite it.`));
    // one quoted AutoLISP line: a path with spaces in it (OneDrive - Atomax-UK Ltd) arrives whole. SAVEAS: DXF (the current release, AC1032 like the sheets on file), 16 decimals, file
    fs.writeFileSync(scr, ['FILEDIA 0', 'CMDDIA 0', `(command "_.SAVEAS" "DXF" "16" ${q(dxf)})`, '_.DELAY 1000', '_.QUIT', '_Y'].join('\r\n') + '\r\n', 'latin1');
    const t0 = Date.now();
    const child = spawn(core.exe, ['/i', dwgPath, '/s', scr, '/l', 'en-US'], { cwd: workDir(), windowsHide: true });
    let o = ''; child.stdout.on('data', (b) => { o += b.toString('latin1'); }); child.stderr.on('data', (b) => { o += b.toString('latin1'); });
    const t = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); try { fs.unlinkSync(scr); } catch {} reject(new Error(`${base}: could not start AutoCAD core console (${e.message})`)); });
    child.on('close', () => {
      clearTimeout(t); try { fs.unlinkSync(scr); } catch {}
      const log = o.replace(/\r/g, '').split('\n').filter(l => l.trim()).slice(-40).join('\n');
      logLine(`${base} -> DXF`, log);
      const waitFor = (n) => { if (fs.existsSync(dxf) && fs.statSync(dxf).size > 1024 && fs.statSync(dxf).mtimeMs >= t0 - 2000) return resolve({ dxf, log }); if (n <= 0) return reject(new Error(`${base}: AutoCAD did not write the DXF. Last console lines: ${log.split('\n').slice(-6).join(' | ')}`)); setTimeout(() => waitFor(n - 1), 500); };
      waitFor(20);
    });
  });
}
module.exports = { plotCopy, coreConsole, layouts, layoutToPlot, plotOne, dwgToDxf, workDir };
