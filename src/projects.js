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
  // the folders Tom listed (server shares, SharePoint sync) first, then the usual ones in his home folder
  const set = (getSettings().projectRoots || []).filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  const home = os.homedir(), out = [];
  try { for (const e of fs.readdirSync(home, { withFileTypes: true })) if (e.isDirectory() && /onedrive|atomax|sharepoint|documents|desktop|projects|jobs|dropbox/i.test(e.name)) out.push(path.join(home, e.name)); } catch {}
  const all = [...set, ...out.filter(o => !set.some(r => o.toLowerCase().startsWith(r.toLowerCase())))];
  return all.length ? all : [home];
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
// the file list only, kept fresh: the Deliverables tab and Dex read it, and a file Tom has just saved must be seen without pressing ↻
// (9 Nov: rows said "no file" until the folder was read again). Cheap: names and dates, no text extracts; at most once a minute per job.
function refreshFiles(jobId, folder, { maxAgeMs = 60000 } = {}) {
  const cur = load(jobId); if (!folder || !fs.existsSync(folder)) return cur;
  if (cur && cur.folder === folder && Date.now() - Date.parse(cur.listedAt || cur.at || 0) < maxAgeMs) return cur;
  const files = [], t0 = Date.now();
  const walk = (dir, depth) => { if (depth > 6 || files.length > 6000 || Date.now() - t0 > 8000) return; let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { const full = path.join(dir, e.name); if (e.isDirectory()) { if (!SKIP.test(e.name)) walk(full, depth + 1); continue; } if (/^~\$|\.(tmp|bak|lnk|dwl2?)$/i.test(e.name)) continue; let st; try { st = fs.statSync(full); } catch { continue; } files.push({ rel: path.relative(folder, full), ext: path.extname(e.name).toLowerCase(), size: st.size, mtime: st.mtimeMs }); } };
  walk(folder, 0); files.sort((a, b) => b.mtime - a.mtime);
  const out = { ...(cur || {}), jobId, folder, at: (cur && cur.at) || new Date().toISOString(), listedAt: new Date().toISOString(), files: files.slice(0, 6000), counts: countByExt(files), extracts: (cur && cur.extracts) || [] };
  try { fs.writeFileSync(path.join(DIR, jobId + '.json'), JSON.stringify(out)); } catch {}
  return out;
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
// Atomax files are named by their QS 006 number only (X140726-0000-06-23-0001-P01.xlsx): the type code says what the file is, and a workbook's sheet names say which schedule it is
const TYPE_WORDS = { '23': 'schedule schedules', '70': 'single line diagram', '71': 'block cable diagram', '72': 'interconnection diagram', '73': 'cable routing layout', '74': 'earthing', '06': 'bom material take', '07': 'data sheet datasheet', '08': 'calculations', '12': 'p&id', '24': 'general arrangement', '01': 'register' };
const sheetNames = new Map();
function namesOf(full, f) {
  if (!/\.xls[xm]$/i.test(full)) return '';
  const k = full + ':' + f.mtime; if (sheetNames.has(k)) return sheetNames.get(k);
  let n = ''; try { n = require('./checker').readXlsx(fs.readFileSync(full)).map(x => x.sheet + ' ' + (x.rows || []).slice(0, 6).map(r => (r.c || r || []).join(' ')).join(' ')).join(' ').toLowerCase(); } catch {}
  sheetNames.set(k, n); return n;
}
function relevantFiles(jobId, request, { exts = ['.pdf'], max = 3 } = {}) {
  const p = load(jobId); if (!p) return [];
  const keys = words(request), DN = require('./docnumber');
  const score = (f) => {
    const base = path.basename(f.rel).replace(/\.[^.]+$/, '').replace(/[-_ ]?(?:REV[-_ ]?)?[PACXZ]\d{1,2}$/i, ''), qs = DN.parse(base), tw = qs ? words(TYPE_WORDS[qs.type] || '') : [];
    let s = keys.filter(k => f.rel.toLowerCase().includes(k)).length + (/sld|single.?line/i.test(f.rel) && /sld|single.?line/i.test(request) ? 3 : 0);
    if (qs) { s += keys.filter(k => tw.includes(k)).length; if (s > 0) { const nm = namesOf(path.join(p.folder, f.rel), f); s += keys.filter(k => nm.includes(k)).length * 0.5; } }
    return s;
  };
  // inputs are the client's documents: never Atomax's own outputs (drawings Dex made, older versions, markups)
  const ours = (f) => /(^|[\\/])(archive|superseded|markups?)([\\/]|$)/i.test(f.rel) || /_DRAFT(_\d+)?\.[a-z]+$/i.test(f.rel) || /X\d{4,6}(?:-[A-Z0-9]{2,4}){2,5}-\d{4}_[PACX]\d{2}(_SH\d+)?(_\d{8}-\d{6})?\.[a-z]+$/i.test(f.rel);
  return p.files.filter(f => exts.includes(f.ext) && f.size < 20 * 1024 * 1024 && !ours(f))
    .map(f => ({ f, s: score(f) }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.f.mtime - a.f.mtime).slice(0, max).map(x => path.join(p.folder, x.f.rel));
}

// where an agent's output goes inside the project folder.
// Atomax project folders (made from the Template Project Directory) have numbered sections: each kind of output has its own place there.
// Other folders: an existing subfolder that fits, otherwise a new one.
const KIND = { dxf: [/^(dxf|cad|drawings?|dwg)/i, 'DXF'], markups: [/^markups?/i, 'MARKUPS'], documents: [/^(documents?|docs|reports?)/i, 'Documents'], models: [/^(3d|models?)/i, '3D Models'], email: [/^(emails?|correspondence|mail)/i, 'Correspondence'] };
const ATOMAX = {
  sld: ['7.4', 'Single Line Diagrams'], bcd: ['7.3', 'Block Diagrams'], 'bcd-instrument': ['6.3', 'Block Diagrams'], earthing: ['7.5', 'Routings and Layouts'], loop: ['6.4', 'Loop Diagrams'], dxf: ['7.13', 'Misc'],
  markups: ['7.13', 'Misc', 'MARKUPS'], documents: ['7.12', 'Reports'], reports: ['7.12', 'Reports'], calcs: ['7.11', 'Calculations'], schedules: ['7.8', 'Schedules'], datasheets: ['7.1', 'Datasheets'],
  email: ['7.0', 'Incoming Correspondance'], register: ['9.1', 'Document Register'], transmittals: ['9.2', 'Transmittals'], rfi: ['9.3', 'RFI'], issued: ['9.7', 'Issued'], crs: ['9.8', 'Document Client Comment Tracker'],
  models: ['4.15', 'Misc'], 'site-data': ['10.1', 'Existing Site Data'],
};
const SECTIONS = { 4: '4. Piping and Mechanical', 6: '6. Instrument', 7: '7. Electrical', 9: '9. Document Control', 10: '10. Site Data' };
const isAtomax = (folder) => { try { return fs.readdirSync(folder).some(n => /^(7\. Electrical|9\. Document Control)/i.test(n)); } catch { return false; } };
const findDir = (parent, prefix) => { try { const e = fs.readdirSync(parent, { withFileTypes: true }).find(d => d.isDirectory() && (d.name.startsWith(prefix + ' ') || d.name.startsWith(prefix + '. ') || d.name === prefix)); return e ? path.join(parent, e.name) : null; } catch { return null; } };   // "10.1 Existing" and "10.1. Existing" (the template has both spellings)
// older Atomax template: flat 001-020 sections (001 Incoming Correspondence ... 006 Atomax-UK Drawings ... 020 Issued)
const OLD = {
  sld: ['006', 'Atomax-UK Drawings'], bcd: ['006', 'Atomax-UK Drawings'], 'bcd-instrument': ['006', 'Atomax-UK Drawings'], earthing: ['006', 'Atomax-UK Drawings'], loop: ['006', 'Atomax-UK Drawings'], dxf: ['006', 'Atomax-UK Drawings'], models: ['006', 'Atomax-UK Drawings'],
  markups: ['006', 'Atomax-UK Drawings', 'MARKUPS'], documents: ['007', 'Atomax-UK Prepared Scopes & Specifications'], reports: ['007', 'Atomax-UK Prepared Scopes & Specifications'],
  calcs: ['008', 'Schedules & Calculations'], schedules: ['008', 'Schedules & Calculations'], datasheets: ['015', 'Technical Information & Suppliers Literature'],
  email: ['001', 'Incoming Correspondence'], register: ['013', 'Transmittals & Drawing Register'], transmittals: ['013', 'Transmittals & Drawing Register'], rfi: ['003', 'Technical Queries'], crs: ['003', 'Technical Queries'],
  issued: ['020', 'Issued'], 'site-data': ['005', 'Client Drawings & Specifications'],
};
const isOldAtomax = (folder) => { try { return fs.readdirSync(folder).filter(n => /^0(0[1-9]|1\d|20) [A-Za-z]/.test(n)).length >= 3; } catch { return false; } };
// a job folder with the real one inside it (unzipped into a folder of the same name, "X041126 \\ X041126 \\ 7. Electrical"): the inner one
function innerJob(folder) {
  if (isAtomax(folder) || isOldAtomax(folder)) return folder;
  try { const subs = fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isDirectory() && !/^(\.|~\$)/.test(e.name)).map(e => path.join(folder, e.name)).filter(p => isAtomax(p) || isOldAtomax(p)); if (subs.length === 1) return subs[0]; } catch {}
  return folder;
}
function outputDir(folder, kind) {
  if (!folder || !fs.existsSync(folder)) return null;
  folder = innerJob(folder);
  if (OLD[kind] && !isAtomax(folder) && isOldAtomax(folder)) {
    const [num, name, sub] = OLD[kind];
    let dir = findDir(folder, num) || path.join(folder, `${num} ${name}`);
    if (sub) dir = path.join(dir, sub);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  if (ATOMAX[kind] && isAtomax(folder)) {
    const [num, name, sub] = ATOMAX[kind], top = num.split('.')[0];
    const sec = findDir(folder, top + '.') || path.join(folder, SECTIONS[top] || top + '. Misc');
    let dir = findDir(sec, num) || path.join(sec, `${num} ${name}`);
    if (sub) dir = path.join(dir, sub);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const [re, made] = KIND[kind] || KIND[{ sld: 'dxf', bcd: 'dxf', 'bcd-instrument': 'dxf', earthing: 'dxf', loop: 'dxf', reports: 'documents', calcs: 'documents', schedules: 'documents', register: 'documents', rfi: 'documents', crs: 'documents', transmittals: 'documents', issued: 'documents', datasheets: 'documents', 'site-data': 'documents' }[kind]] || [/^output/i, 'Output'];
  let found = null;
  try { const e = fs.readdirSync(folder, { withFileTypes: true }).find(d => d.isDirectory() && re.test(d.name)); if (e) found = path.join(folder, e.name); } catch {}
  const dir = found || path.join(folder, made);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
// the Atomax Template Project Directory: from Settings, or found in the OneDrive "Projects - Documents" library
function templateDir() {
  const s = getSettings ? getSettings() : {};
  if (s.templateDir && fs.existsSync(s.templateDir)) return s.templateDir;
  for (const r of searchRoots()) { for (const p of [path.join(r, 'Projects - Documents', 'Template Project Directory'), path.join(r, 'Template Project Directory')]) if (fs.existsSync(p)) return p; }
  return '';
}

// what a job folder name looks like: built from Tom's real job numbers (e.g. X11475 -> one letter X + 5 digits); default one letter + 5 digits
function jobPattern(known = []) {
  const parts = known.map(n => String(n).trim().match(/^([A-Za-z]{0,3})(\d{4,6})$/)).filter(Boolean);
  if (!parts.length) return /^([A-Za-z])(\d{5})\b/;
  const prefixes = [...new Set(parts.map(m => m[1].toUpperCase()))].map(x => x.replace(/[^A-Z]/g, '')), lens = [...new Set(parts.map(m => m[2].length))];
  return new RegExp('^(' + prefixes.map(x => x || '').join('|') + ')(\\d{' + Math.min(...lens) + ',' + Math.max(...lens) + '})\\b', 'i');
}
const NOT_JOBS = /receipt|invoice|expense|finance|account|payroll|personal|photo|picture|music|video|download|backup|archive|tax|bank/i;
// best guess at the folder that holds the job folders: the parent with the most folders named like a job number (needs at least 2)
function jobParent(known = []) {
  const re = jobPattern(known), t0 = Date.now(), parents = {};
  const walk = (dir, depth) => {
    if (depth > 4 || Date.now() - t0 > 3000) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || SKIP.test(e.name) || NOT_JOBS.test(e.name)) continue;
      if (re.test(e.name)) parents[dir] = (parents[dir] || 0) + 1; else walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const r of searchRoots()) walk(r, 0);
  const best = Object.entries(parents).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : '';
}
// the next free job number: highest of Tom's jobs and the job folders in the jobs folder, plus one
function nextJobNumber(known = [], jobsFolder = '') {
  // Atomax QS 006: the project reference is X + the date (DDMMYY); jobs already in the jobs folder count as taken
  const taken = [...known];
  if (jobsFolder) { try { for (const e of fs.readdirSync(jobsFolder, { withFileTypes: true })) if (e.isDirectory()) { const m = e.name.match(/^X\d{4,6}(?:-\d{2})?/i); if (m) taken.push(m[0]); } } catch {} }
  return require('./docnumber').jobNumber(taken);
}
// make a project folder for a new job: a copy of the Atomax Template Project Directory (folders and template files, the XXXXXXXX
// placeholders in file names become the job number); without the template to hand, the same folders empty
const SKIP_COPY = /-DESKTOP-[A-Z0-9]+\.|\.bak$|^~\$|^thumbs\.db$|^desktop\.ini$|^_DXF FOR CLAUDE/i;
function copyTemplate(src, dst, number) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY.test(e.name)) continue;
    const from = path.join(src, e.name);
    if (e.isDirectory()) { copyTemplate(from, path.join(dst, e.name), number); continue; }
    const name = e.name.replace(/^(X{6,8}|x{6,8}|AAAAAAAA|XXXXXX001)(?=[-_ ])/, number);
    const to = path.join(dst, name); if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}
function createJobFolder(parent, number, name) {
  if (!parent || !fs.existsSync(parent)) throw new Error('The folder to create it in does not exist');
  const base = (String(number || '').trim() + ' ' + String(name || '').trim()).trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'New job';
  let dir = path.join(parent, base), i = 2; while (fs.existsSync(dir)) dir = path.join(parent, base + ' (' + i++ + ')');
  const tpl = templateDir();
  if (tpl) { try { copyTemplate(tpl, dir, String(number || '').trim() || 'XXXXXXXX'); return dir; } catch {} }
  let folders = []; try { folders = JSON.parse(fs.readFileSync(path.join(__dirname, 'cad', 'project-folders.json'), 'utf8')); } catch {}
  if (!folders.length) folders = ['Drawings', 'Documents', 'Correspondence'];
  for (const sub of folders) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}

// the folder that holds the job folders: the one Tom set (Settings / new job from an email), else the best guess
function jobsFolder(known = []) {
  const s = getSettings ? getSettings() : {};
  if (s.jobsFolder && fs.existsSync(s.jobsFolder)) return s.jobsFolder;
  return jobParent(known);
}
// the folders the Jobs screen lists: the Projects folders set in Settings (and the new-jobs folder), not just where new jobs go
function projectsRoots(known = []) {
  const s = getSettings ? getSettings() : {}, ok = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  // the Projects folders Tom set; only when there are none, the folder new jobs go in (never a guess: this is his live work)
  const rs = (s.projectRoots || []).filter(Boolean).filter(ok);
  return rs.length ? [...new Set(rs)] : [s.jobsFolder].filter(Boolean).filter(ok);
}
// the next issue folder for a job: ISSUE n+1 under the transmittals folder (013 Transmittals & Drawing Register / 9.2 Transmittals), n being
// the highest ISSUE n already there or under the drawings folder. Issue 12 on file -> ISSUE 13. A job with no issue yet starts at ISSUE 1.
function issueDirs(jobFolder) {
  const found = []; const look = (dir) => { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { if (!e.isDirectory()) continue; const m = e.name.match(/^ISSUE[ _-]*(\d{1,3})\b/i); if (m) found.push({ n: +m[1], path: path.join(dir, e.name) }); } };
  for (const k of ['transmittals', 'register', 'sld']) { const d = outputDir(jobFolder, k); if (d && fs.existsSync(d)) look(d); }
  look(jobFolder);
  return found.sort((a, b) => a.n - b.n);
}
function nextIssueDir(jobFolder) {
  const all = issueDirs(jobFolder), n = all.length ? all[all.length - 1].n + 1 : 1;
  const base = outputDir(jobFolder, 'transmittals') || path.join(jobFolder, '013 Transmittals & Drawing Register');
  return { n, path: path.join(base, `ISSUE ${n}`), previous: all.length ? all[all.length - 1] : null };
}
// a job number anywhere in a folder name ("X021126 Hollins Lane", "Five Fords - X130726")
const JOBNO = /(?:^|[^A-Za-z0-9])([A-Za-z]{1,3}\d{4,6}(?:-\d{2})?)(?![A-Za-z0-9])/;
const jobNoIn = (name) => { const m = String(name || '').match(JOBNO); return m ? m[1].toUpperCase() : ''; };
const jobNameOf = (name, no) => String(name || '').replace(new RegExp('[\\s_\\-–.]*' + no.replace(/[-]/g, '\\-') + '[\\s_\\-–.]*', 'i'), ' ').replace(/\s+/g, ' ').trim();
// a folder holding the numbered Atomax sections (1. Safety, 2. Project Management ... 10. Site Data) is a job, number or not
// a job folder holds top-level sections ("1. Safety", "10. Site Data", "001 Incoming Correspondence"); a discipline folder inside one holds
// sub-sections ("7.0 Incoming Correspondance", "7.3 Block Diagrams") and is not a job
const JOB_SECTION = /^\d{1,3}\.?[\s_-]+[A-Za-z]/;
// a job folder holds numbered sections (1. Safety ... 10. Site Data, or 001 Incoming Correspondence ... 020 Issued). A folder whose numbered
// children are themselves job folders (BGEN\National Grid: 001 - Telford 132kV, 002 - Telford 400kV, 003 - Bustleholm, each with its own
// sections) is a folder OF jobs, not a job
const numberedIn = (full) => { try { return fs.readdirSync(full).filter(n => JOB_SECTION.test(n)); } catch { return []; } };
function folderOfJobs(full) { let n = 0; for (const k of numberedIn(full).slice(0, 8)) if (numberedIn(path.join(full, k)).length >= 3 && ++n >= 2) return true; return false; }   // two numbered children that are each set out as a job: these are jobs
function looksLikeJob(full) { return numberedIn(full).length >= 3 && !folderOfJobs(full); }   // one numbered child with numbered folders inside can happen (7. Electrical / 7.1 ...)
const isDirEnt = (dir, e) => { if (e.isDirectory()) return true; try { return fs.statSync(path.join(dir, e.name)).isDirectory(); } catch { return !!(e.isSymbolicLink && e.isSymbolicLink() && !path.extname(e.name)); } };
// every job folder under the Projects folders: Projects \\ job, Projects \\ client \\ job, Projects \\ year \\ client \\ job (never the template)
function allJobFolders(known = []) {
  const out = [], seen = new Set();
  const walk = (dir, depth) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (/template/i.test(e.name) || SKIP.test(e.name) || /^(~\$|\.)/.test(e.name) || !isDirEnt(dir, e)) continue;
      const full = path.join(dir, e.name), no = jobNoIn(e.name);
      if (no || looksLikeJob(full)) { const k = full.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ number: no || e.name.toUpperCase(), name: no ? jobNameOf(e.name, no) : e.name, folder: full }); } continue; }
      if (depth < 3 && out.length < 3000) walk(full, depth + 1);
    }
  };
  for (const r of projectsRoots(known)) { const no = jobNoIn(path.basename(r)); if (no || looksLikeJob(r)) out.push({ number: no || path.basename(r).toUpperCase(), name: no ? jobNameOf(path.basename(r), no) : path.basename(r), folder: r }); else walk(r, 1); }
  return out;
}
// the job folders directly inside one folder (number anywhere in the name, or the numbered sections inside)
function jobFolders(root, known = []) {
  if (!root) return [];
  let ents = []; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return ents.filter(e => !/template/i.test(e.name) && !SKIP.test(e.name) && isDirEnt(root, e)).map(e => {
    const full = path.join(root, e.name), no = jobNoIn(e.name);
    return no || looksLikeJob(full) ? { number: no || e.name.toUpperCase(), name: no ? jobNameOf(e.name, no) : e.name, folder: full } : null;
  }).filter(Boolean);
}
// one level of a job folder, for the Jobs screen: folders first, then files, in natural order (1.1, 1.2 ... 10.1)
function listDir(folder, rel = '') {
  const base = path.resolve(folder), dir = path.resolve(base, rel || '.');
  if (dir !== base && !dir.startsWith(base + path.sep)) throw new Error('Outside the job folder');
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { throw new Error('Cannot open ' + (rel || 'the job folder') + ': ' + e.code); }
  const out = [];
  for (const e of ents) {
    if (/^(~\$|\.|desktop\.ini$|thumbs\.db$)/i.test(e.name)) continue;
    const full = path.join(dir, e.name); let st = null; try { st = fs.statSync(full); } catch { try { st = fs.lstatSync(full); } catch { st = { isDirectory: () => e.isDirectory(), size: 0, mtimeMs: 0 }; } }
    out.push({ name: e.name, rel: path.relative(base, full), dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, count: st.isDirectory() ? (() => { try { return fs.readdirSync(full).filter(n => !/^(~\$|\.|desktop\.ini$|thumbs\.db$)/i.test(n)).length; } catch { return 0; } })() : 0 });
  }
  return out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

// where a client's file belongs in the job folder, by its name and type: schedules in 7.8 / 008, datasheets in 7.1, drawings and site
// information in site data, emails in correspondence, anything else in correspondence too (Tom can move it)
function fileKind(name) {
  const n = String(name || ''), ext = (n.match(/\.(\w+)$/) || ['', ''])[1].toLowerCase();
  if (/^(eml|msg)$/.test(ext)) return 'email';
  if (/schedule|equipment list|cable list|load list|protection|breaker|setting|io list|i\/o list|instrument list|register/i.test(n) && /^(xlsx|xlsm|xls|csv)$/.test(ext)) return 'schedules';
  if (/datasheet|data sheet|catalogue|brochure|manual/i.test(n)) return 'datasheets';
  if (/^(dxf|dwg|dgn)$/.test(ext) || /dno|letter|survey|existing|site|as[- ]?built|layout|drawing|sld|bcd|diagram|photo|img_|dsc_|scan/i.test(n) || /^(jpg|jpeg|png|heic)$/.test(ext)) return 'site-data';
  return 'email';
}
const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store|~\$.*|.*\.(tmp|lnk|bak|dwl|dwl2))$/i;
// every file under the dropped paths (folders walked, junk and hidden files skipped), with the path relative to what was dropped
function filesUnder(paths, maxFiles = 2000) {
  const out = [];
  const walk = (p, rel, depth) => {
    if (out.length >= maxFiles || depth > 8) return; let st; try { st = fs.statSync(p); } catch { return; }
    const base = path.basename(p); if (base.startsWith('.') || JUNK.test(base)) return;
    if (st.isDirectory()) { let es = []; try { es = fs.readdirSync(p); } catch { return; } for (const e of es) walk(path.join(p, e), rel ? path.join(rel, e) : e, depth + 1); }
    else out.push({ path: p, rel: rel || base, name: base, size: st.size });
  };
  for (const p of [].concat(paths || [])) { let st; try { st = fs.statSync(p); } catch { continue; } walk(p, st.isDirectory() ? '' : '', 0); }
  return out;
}
// file the client's files into a job folder. Returns what went where. Files already there (same name and size) are left alone; a
// different file with the same name is kept beside it with (2). Folders dropped keep their own sub-folders under site data.
function fileIn(folder, paths) {
  const filed = [], skipped = [];
  const list = Array.isArray(paths) && paths.length && typeof paths[0] === 'object' ? paths : filesUnder(paths);   // paths, or entries from filesUnder (keeps the dropped folder's sub-paths)
  for (const f of list) {
    const kind = fileKind(f.name), out = outputDir(folder, kind); if (!out) { skipped.push(f.rel); continue; }
    const keepTree = kind === 'site-data' && f.rel.includes(path.sep), dstDir = keepTree ? path.join(out, path.dirname(f.rel)) : out;
    fs.mkdirSync(dstDir, { recursive: true });
    let dst = path.join(dstDir, f.name);
    try { const st = fs.statSync(dst); if (st.size === f.size) { skipped.push(f.rel); continue; } const ext = path.extname(f.name); let n = 2; while (fs.existsSync(dst)) dst = path.join(dstDir, `${path.basename(f.name, ext)} (${n++})${ext}`); } catch {}
    fs.copyFileSync(f.path, dst); filed.push({ from: f.rel, to: path.relative(folder, dst), kind });
  }
  return { filed, skipped };
}
module.exports = { refreshFiles, issueDirs, nextIssueDir, folderOfJobs, fileKind, filesUnder, fileIn, isOldAtomax, jobNoIn, jobNameOf, looksLikeJob, projectsRoots, allJobFolders, jobsFolder, jobFolders, listDir, templateDir, isAtomax, jobParent, nextJobNumber, jobPattern, createJobFolder, init, suggest, gather, load, contextBlock, relevantFiles, outputDir, searchRoots, extract };
