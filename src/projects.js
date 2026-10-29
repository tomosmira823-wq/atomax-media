// Project folders: every job can point at its real folder (OneDrive / SharePoint / a drive). The app can find it from the job number and name,
// read it into a context summary the agents get with the job, pick the right PDFs for a request, and say where an agent's output goes.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

let DIR = null, getSettings = () => ({});
function init(userDir, settingsFn) { DIR = path.join(userDir, 'projects'); fs.mkdirSync(DIR, { recursive: true }); if (settingsFn) getSettings = settingsFn; }

const SKIP = /^(\.|\$|node_modules$|appdata$|application data$|windows$|program files|programdata$|library$|temp$|tmp$|cache$)/i;
const TEXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.eml']);

// where to look for project folders: the folders Tom set, otherwise his OneDrive / SharePoint / Documents / Desktop
function searchRoots() {
  const set = (getSettings().projectRoots || []).filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  if (set.length) return set;
  const home = os.homedir(), out = [];
  try { for (const e of fs.readdirSync(home, { withFileTypes: true })) if (e.isDirectory() && /onedrive|atomax|sharepoint|documents|desktop|projects|jobs|dropbox/i.test(e.name)) out.push(path.join(home, e.name)); } catch {}
  return out.length ? out : [home];
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !['site', 'job', 'project', 'the', 'and', 'with', 'from', 'drawing', 'drawings'].includes(w));

// find likely folders for a job (or any text such as a site name from an email); best first
function suggest({ number = '', name = '', client = '', text = '' } = {}, { limitMs = 4000, maxDirs = 8000 } = {}) {
  const t0 = Date.now(), num = String(number || '').toLowerCase().trim(), keys = [...new Set([...words(name), ...words(client), ...words(text)])];
  if (!num && !keys.length) return [];
  const hits = []; let seen = 0;
  const walk = (dir, depth) => {
    if (depth > 5 || seen > maxDirs || Date.now() - t0 > limitMs) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || SKIP.test(e.name)) continue;
      seen++;
      const full = path.join(dir, e.name), low = e.name.toLowerCase();
      let score = 0; const why = [];
      if (num && low.includes(num)) { score += 10; why.push('job number'); }
      const k = keys.filter(w => low.includes(w)); if (k.length) { score += k.length * 3; why.push(k.join(', ')); }
      if (score) hits.push({ path: full, name: e.name, score: score - depth * 0.2, why: why.join(' + ') });
      walk(full, depth + 1);
    }
  };
  for (const r of searchRoots()) walk(r, 0);
  // a parent and its child both matching: keep the deeper one only if it scores higher
  return hits.sort((a, b) => b.score - a.score).slice(0, 6).map(h => ({ ...h, score: Math.round(h.score * 10) / 10 }));
}

function zipEntry(buf, re) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen); p += 46 + nlen + elen + clen;
    if (!re.test(name)) continue;
    const ln = buf.readUInt16LE(loff + 26), le = buf.readUInt16LE(loff + 28), st = loff + 30 + ln + le, data = buf.subarray(st, st + csize);
    try { return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8'); } catch { return null; }
  }
  return null;
}

// the readable text of one file (short), or '' when it is not something we can read without Claude
function extract(full, { checker, dxffix } = {}) {
  const ext = path.extname(full).toLowerCase();
  try {
    const st = fs.statSync(full); if (st.size > 25 * 1024 * 1024) return '';
    if (TEXT.has(ext)) return fs.readFileSync(full, 'utf8').slice(0, 4000);
    if (ext === '.docx') { const x = zipEntry(fs.readFileSync(full), /^word\/document\.xml$/); return x ? x.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 4000) : ''; }
    if ((ext === '.xlsx' || ext === '.xlsm') && checker) return checker.sheetsAsText(checker.readXlsx(fs.readFileSync(full)), 4000);
    if (ext === '.dxf' && dxffix) { const d = dxffix.parseDxf(fs.readFileSync(full)); return [...new Set(d.ents.filter(e => e.plain).map(e => e.plain.trim()))].join(' | ').slice(0, 3000); }
  } catch {}
  return '';
}

// read a project folder into a summary: every file name, plus short extracts of the files we can read. Saved per job.
function gather(jobId, folder, libs = {}) {
  if (!folder || !fs.existsSync(folder)) throw new Error('That folder does not exist on this computer');
  const files = [], t0 = Date.now();
  const walk = (dir, depth) => {
    if (depth > 5 || files.length > 3000 || Date.now() - t0 > 15000) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.test(e.name)) walk(full, depth + 1); continue; }
      if (/^~\$|\.(tmp|bak|lnk|dwl2?)$/i.test(e.name)) continue;
      let st; try { st = fs.statSync(full); } catch { continue; }
      files.push({ rel: path.relative(folder, full), ext: path.extname(e.name).toLowerCase(), size: st.size, mtime: st.mtimeMs });
    }
  };
  walk(folder, 0);
  files.sort((a, b) => b.mtime - a.mtime);
  // newest readable files first, up to ~30k characters of extracts
  let budget = 30000; const extracts = [];
  for (const f of files) {
    if (budget <= 0) break;
    if (!(TEXT.has(f.ext) || ['.docx', '.xlsx', '.xlsm', '.dxf'].includes(f.ext))) continue;
    const t = extract(path.join(folder, f.rel), libs).trim(); if (!t) continue;
    const cut = t.slice(0, Math.min(2500, budget)); budget -= cut.length;
    extracts.push({ rel: f.rel, text: cut });
  }
  const out = { jobId, folder, at: new Date().toISOString(), files: files.slice(0, 3000), extracts, counts: countByExt(files) };
  fs.writeFileSync(path.join(DIR, jobId + '.json'), JSON.stringify(out));
  return { files: files.length, read: extracts.length, folder, counts: out.counts, at: out.at };
}
function countByExt(files) { const c = {}; for (const f of files) c[f.ext || '(none)'] = (c[f.ext || '(none)'] || 0) + 1; return c; }
function load(jobId) { try { return JSON.parse(fs.readFileSync(path.join(DIR, jobId + '.json'), 'utf8')); } catch { return null; } }

// the text the agents get: folder, file list, extracts
function contextBlock(jobId, max = 24000) {
  const p = load(jobId); if (!p) return '';
  let out = `PROJECT FOLDER: ${p.folder} (read ${p.at.slice(0, 16).replace('T', ' ')})\nFiles (${p.files.length}, newest first):\n` + p.files.slice(0, 160).map(f => '- ' + f.rel).join('\n');
  if (p.files.length > 160) out += `\n- ... and ${p.files.length - 160} more`;
  for (const x of p.extracts) { if (out.length > max) break; out += `\n\n--- ${x.rel} ---\n${x.text}`; }
  return out.slice(0, max);
}

// PDFs and images in the project folder that look relevant to a request (by words in the file name), for sending to Claude to read
function relevantFiles(jobId, request, { exts = ['.pdf'], max = 3 } = {}) {
  const p = load(jobId); if (!p) return [];
  const keys = words(request);
  return p.files.filter(f => exts.includes(f.ext) && f.size < 20 * 1024 * 1024)
    .map(f => ({ f, s: keys.filter(k => f.rel.toLowerCase().includes(k)).length + (/sld|single.?line/i.test(f.rel) && /sld|single.?line/i.test(request) ? 3 : 0) }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.f.mtime - a.f.mtime).slice(0, max).map(x => path.join(p.folder, x.f.rel));
}

// where an agent's output goes inside the project folder: an existing subfolder that fits, otherwise a new one
const KIND = { dxf: [/^(dxf|cad|drawings?|dwg)/i, 'DXF'], markups: [/^markups?/i, 'MARKUPS'], documents: [/^(documents?|docs|reports?)/i, 'Documents'], models: [/^(3d|models?)/i, '3D Models'], email: [/^(emails?|correspondence|mail)/i, 'Correspondence'] };
function outputDir(folder, kind) {
  if (!folder || !fs.existsSync(folder)) return null;
  const [re, made] = KIND[kind] || [/^output/i, 'Output'];
  let found = null;
  try { const e = fs.readdirSync(folder, { withFileTypes: true }).find(d => d.isDirectory() && re.test(d.name)); if (e) found = path.join(folder, e.name); } catch {}
  const dir = found || path.join(folder, made);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { init, suggest, gather, load, contextBlock, relevantFiles, outputDir, searchRoots, extract };
