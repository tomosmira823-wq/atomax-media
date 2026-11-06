// Report charts drawn by the app, not by the model: clean white background, faint grid, thin lines, legend along the top, the x labels
// (dates, hours) along the bottom, the unit on the y axis. One palette for the whole report so a circuit keeps its colour from chart to
// chart. SVG first; a PNG for the Word document through Electron's own renderer (ImageMagick when running outside Electron).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#7f7f7f', '#393b79', '#ad494a', '#637939', '#e6550d', '#3182bd', '#756bb1'];
// a colour per series name, the same name -> the same colour across every chart of the report
const baseName = (n) => String(n).replace(/\s*[-–(:]?\s*(average|avg|mean|peak|max(imum)?|min(imum)?|total|daily average|daily peak)\)?\s*(\(kVA\)|\(A\))?\s*$/i, '').trim() || String(n);
function palette(charts) {
  const map = new Map(), byBase = new Map(); let i = 0;
  for (const c of charts) for (const s of c.series || []) { if (map.has(s.name)) continue; const b = baseName(s.name); if (!byBase.has(b)) byBase.set(b, s.color || PALETTE[i++ % PALETTE.length]); map.set(s.name, s.color || byBase.get(b)); }
  return map;
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nice = (v) => { if (v === 0) return '0'; const a = Math.abs(v); return a >= 100 ? String(Math.round(v)) : a >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, ''); };
// axis ticks: a step of 1, 2, 2.5, 5 x 10^n so there are 4..8 of them
function ticks(min, max, n = 6) {
  if (!(max > min)) { max = min + 1; }
  const raw = (max - min) / n, p = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => (max - min) / s <= n) || 10 * p;
  const t0 = Math.floor(min / step) * step, out = []; for (let v = t0; v <= max + step * 0.001; v += step) out.push(+v.toFixed(10));
  return { step, ticks: out, lo: out[0], hi: out[out.length - 1] };
}

// chart: { type: 'line'|'area'|'bar'|'step', x: [labels or numbers], xLabel, yLabel, series: [{ name, values, dash, fill, color }], yMin }
// size in CSS px; the SVG is drawn at `scale` (2 for a crisp page-width picture)
function svg(chart, colours, { width = 620, height = 300, scale = 2 } = {}) {
  const W = width * scale, H = height * scale, S = scale;
  const series = (chart.series || []).filter(s => Array.isArray(s.values) && s.values.length);
  const x = chart.x || [], numericX = x.length && x.every(v => typeof v === 'number');
  const all = series.flatMap(s => s.values).filter(v => typeof v === 'number' && Number.isFinite(v));
  const yMin = chart.yMin !== undefined ? chart.yMin : Math.min(0, ...all), yMax = Math.max(...all, yMin + 1e-9);
  const ty = ticks(yMin, yMax * 1.05);
  // legend rows along the top
  const fs1 = 11 * S, legendItems = series.map(s => ({ name: s.name, color: colours.get(s.name) || '#444', dash: !!s.dash, fill: !!s.fill }));
  // legend items flow left to right and wrap, each as wide as its name
  const textW = (t) => String(t).length * 6.1 * S, legendPos = []; { let lx = 0, row = 0; const maxW = W - 24 * S; for (const it of legendItems) { const w = 23 * S + textW(it.name) + 16 * S; if (lx > 0 && lx + w > maxW) { lx = 0; row++; } legendPos.push({ x: lx, row }); lx += w; } }
  const legendRows = legendItems.length ? legendPos[legendPos.length - 1].row + 1 : 0, legendH = legendItems.length ? legendRows * 16 * S + 8 * S : 0;
  const mL = (chart.yLabel ? 46 : 40) * S, mR = 14 * S, mT = 10 * S + legendH, mB = (chart.xLabel ? 44 : 32) * S;
  const pw = W - mL - mR, ph = H - mT - mB;
  const Y = (v) => mT + ph - (v - ty.lo) / (ty.hi - ty.lo) * ph;
  const n = Math.max(x.length, ...series.map(s => s.values.length));
  let xMin = 0, xMax = Math.max(1, n - 1); if (numericX) { xMin = Math.min(...x); xMax = Math.max(...x); if (!(xMax > xMin)) xMax = xMin + 1; }
  const X = (i) => mL + (numericX ? (x[i] - xMin) / (xMax - xMin) : (n > 1 ? i / (n - 1) : 0.5)) * pw;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif" font-size="${fs1}">`, `<rect width="${W}" height="${H}" fill="#fff"/>`];
  // grid and y axis
  for (const t of ty.ticks) { const y = Y(t); out.push(`<line x1="${mL}" y1="${y}" x2="${mL + pw}" y2="${y}" stroke="#e6e6e6" stroke-width="${S}"/>`); out.push(`<text x="${mL - 6 * S}" y="${y + 4 * S}" text-anchor="end" fill="#444">${nice(t)}</text>`); }
  // x ticks: at most ~10 labels, evenly thinned; numeric x gets nice ticks
  if (numericX) { const tx = ticks(xMin, xMax, 10); for (const t of tx.ticks) { if (t < xMin - 1e-9 || t > xMax + 1e-9) continue; const px = mL + (t - xMin) / (xMax - xMin) * pw; out.push(`<line x1="${px}" y1="${mT}" x2="${px}" y2="${mT + ph}" stroke="#f0f0f0" stroke-width="${S}"/>`); out.push(`<text x="${px}" y="${mT + ph + 14 * S}" text-anchor="middle" fill="#444">${nice(t)}</text>`); } }
  else { const labels = chart.xTicks || x; const longest = Math.max(1, ...labels.slice(0, 400).map(l => String(l ?? '').length)); const fit = Math.max(2, Math.floor(pw / (longest * 6.1 * S * 1.25))); const every = Math.max(1, Math.ceil(n / Math.min(12, fit))); for (let i = 0; i < n; i += every) { const px = X(i), lab = labels[i]; if (lab === undefined || lab === '') continue; const half = String(lab).length * 6.1 * S / 2, anchor = px - half < 2 * S ? 'start' : px + half > W - 2 * S ? 'end' : 'middle'; out.push(`<line x1="${px}" y1="${mT}" x2="${px}" y2="${mT + ph}" stroke="#f0f0f0" stroke-width="${S}"/>`); out.push(`<text x="${px}" y="${mT + ph + 14 * S}" text-anchor="${anchor}" fill="#444">${esc(lab)}</text>`); } }
  out.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + ph}" stroke="#999" stroke-width="${S}"/>`, `<line x1="${mL}" y1="${mT + ph}" x2="${mL + pw}" y2="${mT + ph}" stroke="#999" stroke-width="${S}"/>`);
  if (chart.yLabel) out.push(`<text transform="translate(${12 * S},${mT + ph / 2}) rotate(-90)" text-anchor="middle" fill="#333">${esc(chart.yLabel)}</text>`);
  if (chart.xLabel) out.push(`<text x="${mL + pw / 2}" y="${H - 8 * S}" text-anchor="middle" fill="#333">${esc(chart.xLabel)}</text>`);
  // the series
  const lw = 1.2 * S, type = chart.type || 'line';
  if (type === 'bar') {
    const bw = pw / Math.max(1, n) / (series.length + 0.5);
    series.forEach((s, si) => { const c = colours.get(s.name) || '#444'; s.values.forEach((v, i) => { if (typeof v !== 'number' || !Number.isFinite(v)) return; const x0 = mL + (i + 0.25) * (pw / Math.max(1, n)) + si * bw; out.push(`<rect x="${x0}" y="${Math.min(Y(v), Y(0))}" width="${bw}" height="${Math.abs(Y(0) - Y(v))}" fill="${c}" fill-opacity="0.85"/>`); }); });
  } else {
    for (const s of series) {
      const c = colours.get(s.name) || '#444'; let d = '', area = '', open = false, firstX = null, lastX = null;
      s.values.forEach((v, i) => { if (typeof v !== 'number' || !Number.isFinite(v)) { open = false; return; } const px = X(i), py = Y(v); if (!open) { d += `M${px.toFixed(1)} ${py.toFixed(1)}`; open = true; if (firstX === null) firstX = px; } else d += (type === 'step' ? `H${px.toFixed(1)}V${py.toFixed(1)}` : `L${px.toFixed(1)} ${py.toFixed(1)}`); lastX = px; });
      if ((s.fill || type === 'area') && d) { area = `${d}L${lastX.toFixed(1)} ${Y(Math.max(ty.lo, 0)).toFixed(1)}L${firstX.toFixed(1)} ${Y(Math.max(ty.lo, 0)).toFixed(1)}Z`; out.push(`<path d="${area}" fill="${c}" fill-opacity="0.12" stroke="none"/>`); }
      if (d) out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${5 * S} ${4 * S}"` : ''}/>`);
    }
  }
  // legend
  legendItems.forEach((it, i) => { const lx = 12 * S + legendPos[i].x, ly = 10 * S + legendPos[i].row * 16 * S + 6 * S; out.push(`<line x1="${lx}" y1="${ly}" x2="${lx + 18 * S}" y2="${ly}" stroke="${it.color}" stroke-width="${lw * 1.3}"${it.dash ? ` stroke-dasharray="${5 * S} ${4 * S}"` : ''}/>`); if (it.fill) out.push(`<rect x="${lx}" y="${ly - 5 * S}" width="${18 * S}" height="${10 * S}" fill="${it.color}" fill-opacity="0.12"/>`); out.push(`<text x="${lx + 23 * S}" y="${ly + 4 * S}" fill="#333">${esc(it.name)}</text>`); });
  out.push('</svg>');
  return out.join('');
}

// SVG -> PNG file. In Electron: a hidden window renders it and captures the page (no extra dependency); elsewhere ImageMagick
async function toPng(svgText, outPath, { width, height } = {}) {
  const m = svgText.match(/width="(\d+)" height="(\d+)"/); const W = width || +m[1], H = height || +m[2];
  let electron = null; try { electron = require('electron'); } catch {}
  if (electron && electron.app && electron.BrowserWindow && process.type === 'browser') {
    await electron.app.whenReady();
    const win = new electron.BrowserWindow({ show: false, width: W, height: H, frame: false, webPreferences: { offscreen: true, sandbox: true } });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;background:#fff">${svgText}</body></html>`));
      await new Promise(r => setTimeout(r, 150));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
      fs.writeFileSync(outPath, img.toPNG());
    } finally { win.destroy(); }
    return outPath;
  }
  // outside Electron (tests): the same page in a headless Chromium when Playwright is about, else ImageMagick
  let pw = null; try { pw = require('playwright'); } catch {}
  if (pw && pw.chromium) {
    const browser = await pw.chromium.launch(); try { const page = await browser.newPage({ viewport: { width: W, height: H } }); await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svgText}</body></html>`); await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: W, height: H } }); } finally { await browser.close(); }
    return outPath;
  }
  const { execFileSync } = require('child_process'); const tmp = path.join(os.tmpdir(), `amo-chart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.svg`);
  fs.writeFileSync(tmp, svgText);
  try { execFileSync('convert', ['-density', '96', '-background', 'white', tmp, outPath], { stdio: 'pipe' }); } finally { try { fs.unlinkSync(tmp); } catch {} }
  return outPath;
}

module.exports = { svg, toPng, palette, PALETTE };
