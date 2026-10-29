// The business layer: jobs, hours, approvals, audit trail, issue-pack checks, document drafting and the daily/weekly brief.
// Pure data in, data out (plus a tiny JSON store), so every rule here can be tested without the app.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DRAWING_NO = /X\d{6}-\d{2}-\d{2}-\d{4}/i;
const JUNK = [/^~\$/, /\.(bak|tmp|temp|log|lnk)$/i, /^thumbs\.db$/i, /^desktop\.ini$/i, /^\.ds_store$/i, /\.dwl2?$/i, /\.sv\$$/i];
const ISSUE_EXT = new Set(['.pdf', '.dxf', '.dwg', '.docx', '.xlsx', '.xls', '.csv']);
const DEAD_WORDS = /\b(cancel+ed|superseded|void|obsolete|withdrawn|not for (issue|use)|struck|hatched)\b/i;

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = (d = new Date()) => d.toISOString().slice(0, 10);

// ---------------- store ----------------
function emptyData() {
  return { jobs: [], hours: [], approvals: [], audit: [], briefs: [], docs: [], routines: { morning: { on: false, time: '08:00' }, weekly: { on: false, day: 5, time: '16:00' } }, lastRuns: {}, people: [], tasks: [], currentJobId: '' };
}
function makeStore(file) {
  let cache = null;
  const load = () => {
    if (cache) return cache;
    try { cache = { ...emptyData(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { cache = emptyData(); }
    return cache;
  };
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cache, null, 1)); fs.renameSync(tmp, file); };
  return { load, save, reset() { cache = null; } };
}

// ---------------- audit ----------------
function audit(data, { who = 'Tom', action, jobId = '', before = '', after = '', detail = '' }) {
  const e = { id: uid('a'), at: new Date().toISOString(), who, action, jobId, before: String(before || ''), after: String(after || ''), detail: String(detail || '') };
  data.audit.unshift(e); if (data.audit.length > 5000) data.audit.length = 5000; return e;
}

// ---------------- jobs ----------------
const JOB_STATUS = ['Active', 'On hold', 'Issued', 'Closed'];
function saveJob(data, j, who = 'Tom') {
  const number = String(j.number || '').trim(); if (!number) throw new Error('A job needs a job number.');
  const old = j.id && data.jobs.find(x => x.id === j.id);
  const clean = {
    id: old ? old.id : uid('j'), number, name: String(j.name || '').trim(), client: String(j.client || '').trim(),
    status: JOB_STATUS.includes(j.status) ? j.status : 'Active', budgetHours: Math.max(0, Number(j.budgetHours) || 0), dueDate: String(j.dueDate || ''), notes: String(j.notes || ''),
    drawings: (j.drawings || []).map(d => ({ no: String(d.no || '').trim(), title: String(d.title || '').trim(), rev: String(d.rev || '').trim(), status: String(d.status || 'Live').trim() })).filter(d => d.no),
    createdAt: old ? old.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  if (!old && data.jobs.some(x => x.number.toLowerCase() === number.toLowerCase())) throw new Error('There is already a job numbered ' + number + '.');
  if (old) { Object.assign(old, clean); audit(data, { who, action: 'Job updated', jobId: old.id, detail: number + ' ' + clean.name }); return old; }
  data.jobs.push(clean); audit(data, { who, action: 'Job created', jobId: clean.id, detail: number + ' ' + clean.name }); return clean;
}
function deleteJob(data, id, who = 'Tom') {
  const j = data.jobs.find(x => x.id === id); if (!j) return false;
  data.jobs = data.jobs.filter(x => x.id !== id); data.hours = data.hours.filter(h => h.jobId !== id);
  audit(data, { who, action: 'Job deleted', jobId: id, detail: j.number + ' ' + j.name }); return true;
}
// drawing rows can be pasted as lines: "X123456-10-20-0042 | Loop diagram | P02"
function parseDrawingLines(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(DRAWING_NO); if (!m) return null;
    const rest = l.replace(m[0], '').replace(/\s+-\s+|[\t|;,]+/g, '|').replace(/^\|+/, '');
    const cols = rest.split('|').map(s => s.trim()).filter(Boolean);
    const isRev = (c) => /^(rev\.?\s*)?([A-Z]{1,2}\d{1,2}|[A-Z])$/i.test(c) && c.length <= 8;
    const isStatus = (c) => /^(cancel+ed|void|superseded|struck( off| through)?|live)$/i.test(c);
    const stCol = cols.find(isStatus);
    const revCol = [...cols].reverse().find(c => c !== stCol && isRev(c));
    const status = stCol ? (/live/i.test(stCol) ? 'Live' : stCol[0].toUpperCase() + stCol.slice(1).toLowerCase()) : 'Live';
    return { no: m[0].toUpperCase(), title: cols.filter(c => c !== revCol && c !== stCol).join(' - '), rev: revCol ? revCol.replace(/^rev\.?\s*/i, '').toUpperCase() : '', status };
  }).filter(Boolean);
}

// ---------------- hours ----------------
function addHours(data, { jobId, date, hours, who = 'Tom', note = '' }) {
  const job = data.jobs.find(j => j.id === jobId); if (!job) throw new Error('Pick a job first.');
  const h = Number(hours); if (!(h > 0) || h > 24) throw new Error('Hours must be more than 0 and no more than 24.');
  const e = { id: uid('h'), jobId, date: date || today(), hours: Math.round(h * 100) / 100, who: String(who || 'Tom'), note: String(note || '') };
  data.hours.unshift(e); audit(data, { who, action: 'Hours logged', jobId, after: h + ' h', detail: note }); return e;
}
function removeHours(data, id, who = 'Tom') {
  const e = data.hours.find(h => h.id === id); if (!e) return false;
  data.hours = data.hours.filter(h => h.id !== id); audit(data, { who, action: 'Hours removed', jobId: e.jobId, before: e.hours + ' h', detail: e.note }); return true;
}
function jobHours(data, jobId) { return Math.round(data.hours.filter(h => h.jobId === jobId).reduce((n, h) => n + h.hours, 0) * 100) / 100; }
function jobSummary(data, job) {
  const used = jobHours(data, job.id), pct = job.budgetHours ? Math.round(used / job.budgetHours * 100) : null;
  const live = job.drawings.filter(d => !/cancel|void|supersed/i.test(d.status));
  return { used, budget: job.budgetHours, pct, over: pct !== null && pct > 100, drawings: job.drawings.length, live: live.length, pending: data.approvals.filter(a => a.jobId === job.id && a.status === 'pending').length };
}
function hoursByWho(data, sinceISO) { const m = {}; for (const h of data.hours) if (!sinceISO || h.date >= sinceISO) m[h.who] = Math.round(((m[h.who] || 0) + h.hours) * 100) / 100; return m; }

// ---------------- tasks (set from the project whiteboard, handed to an agent) ----------------
const TASK_STATUS = ['todo', 'doing', 'done'];
function saveTask(data, t, who = 'Tom') {
  const title = String(t.title || '').trim(); if (!title) throw new Error('A task needs a title.');
  if (!data.jobs.some(j => j.id === t.jobId)) throw new Error('Pick a job for the task.');
  const old = t.id && data.tasks.find(x => x.id === t.id);
  const now = new Date().toISOString();
  const status = TASK_STATUS.includes(t.status) ? t.status : (old ? old.status : 'todo');
  const clean = { id: old ? old.id : uid('t'), jobId: t.jobId, title, detail: String(t.detail || ''), agentId: String(t.agentId || ''), agentName: String(t.agentName || ''), status,
    note: String(t.note !== undefined ? t.note : (old ? old.note : '') || ''), lastActivity: old ? old.lastActivity || '' : '', createdAt: old ? old.createdAt : now, updatedAt: now,
    doneAt: status === 'done' ? (old && old.doneAt) || now : '' };
  if (old) { const was = old.status; Object.assign(old, clean); audit(data, { who, action: was !== status ? (status === 'done' ? 'Task done' : 'Task moved to ' + status) : 'Task updated', jobId: old.jobId, detail: title + (clean.agentName ? ' · ' + clean.agentName : '') }); return old; }
  data.tasks.unshift(clean); audit(data, { who, action: 'Task set', jobId: clean.jobId, detail: title + (clean.agentName ? ' · for ' + clean.agentName : '') }); return clean;
}
function deleteTask(data, id, who = 'Tom') {
  const t = data.tasks.find(x => x.id === id); if (!t) return false;
  data.tasks = data.tasks.filter(x => x.id !== id); audit(data, { who, action: 'Task deleted', jobId: t.jobId, detail: t.title }); return true;
}
// an agent finished something on a job: remember it on that agent's open task
function noteActivity(data, e) {
  if (!e || !e.jobId || !e.who) return;
  const t = data.tasks.find(x => x.jobId === e.jobId && x.status === 'doing' && x.agentName === e.who);
  if (t) t.lastActivity = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' · ' + e.action + (e.detail ? ': ' + String(e.detail).slice(0, 140) : '');
}
// what every agent is told about the job it is working on
function jobContext(data, jobId, forWho = '') {
  const j = data.jobs.find(x => x.id === jobId); if (!j) return '';
  const s = jobSummary(data, j), L = [];
  L.push(`JOB: ${j.number}${j.name ? ' ' + j.name : ''}${j.client ? ' · client ' + j.client : ''} · ${j.status}${j.dueDate ? ' · due ' + j.dueDate : ''}${s.budget ? ` · hours ${s.used} of ${s.budget}` : ''}`);
  if (j.notes && j.notes.trim()) L.push('Job notes from the engineer:\n' + j.notes.trim().slice(0, 3000));
  if (j.drawings.length) L.push(`Drawings on this job (${j.drawings.length}):\n` + j.drawings.slice(0, 40).map(d => `- ${d.no}${d.title ? ' ' + d.title : ''}${d.rev ? ' ' + d.rev : ''}${d.status && d.status !== 'Live' ? ' [' + d.status + ']' : ''}`).join('\n'));
  const mine = data.tasks.filter(t => t.jobId === jobId && t.status !== 'done' && (!forWho || !t.agentName || t.agentName === forWho));
  if (mine.length) L.push('Open tasks on this job:\n' + mine.slice(0, 12).map(t => `- [${t.status}] ${t.title}${t.agentName ? ' (' + t.agentName + ')' : ''}${t.detail ? ': ' + t.detail.slice(0, 200) : ''}`).join('\n'));
  const act = data.audit.filter(a => a.jobId === jobId && !/^Task /.test(a.action)).slice(0, 8);
  if (act.length) L.push('Recent work on this job:\n' + act.map(a => `- ${a.at.slice(0, 10)} ${a.who}: ${a.action}${a.detail ? ' ' + String(a.detail).slice(0, 120) : ''}`).join('\n'));
  return 'JOB CONTEXT (use it as background for the request; do not repeat it back; the request itself comes first)\n' + L.join('\n\n');
}

// ---------------- approvals ----------------
// kind: 'document' | 'issue-pack' | 'other'. payload carries what runs when it is approved.
function queueApproval(data, { agent, jobId = '', kind = 'other', title, detail = '', payload = {} }) {
  const a = { id: uid('p'), at: new Date().toISOString(), agent, jobId, kind, title, detail, payload, status: 'pending' };
  data.approvals.unshift(a); audit(data, { who: agent, action: 'Waiting for approval', jobId, detail: title }); return a;
}
function decideApproval(data, id, decision, who = 'Tom', note = '') {
  const a = data.approvals.find(x => x.id === id); if (!a) throw new Error('That item is no longer in the queue.');
  if (a.status !== 'pending') throw new Error('That item was already ' + a.status + '.');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Unknown decision.');
  a.status = decision; a.decidedAt = new Date().toISOString(); a.decidedBy = who; a.note = note;
  audit(data, { who, action: decision === 'approved' ? 'Approved' : 'Rejected', jobId: a.jobId, detail: a.title + (note ? ' (' + note + ')' : '') });
  return a;
}

// ---------------- issue pack: what is in the folder vs the job ----------------
const baseName = (n) => n.replace(/\.[^.]+$/, '');
const ext = (n) => path.extname(n).toLowerCase();
function parseName(name) {
  const m = baseName(name).match(DRAWING_NO); if (!m) return { no: '', rev: '' };
  const rest = baseName(name).slice(m.index + m[0].length);
  const r = rest.match(/(?:^|[\s_\-.]+)(?:rev\.?\s*)?([A-Z]{1,2}\d{1,2}|[A-Z])(?=$|[\s_\-.])/i);
  return { no: m[0].toUpperCase(), rev: r ? r[1].toUpperCase() : '' };
}
const sameRev = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
const revRank = (r) => { const m = String(r || '').toUpperCase().match(/^([A-Z]*)(\d*)$/); return m ? [m[1], parseInt(m[2] || '0', 10)] : [String(r), 0]; };
const newer = (a, b) => { const [al, an] = revRank(a), [bl, bn] = revRank(b); return al > bl || (al === bl && an > bn); };

// files: [{name, size}]. job: {number, drawings:[{no,title,rev,status}]}. transmittal: null | [{no, rev, title}].
// reads: { [fileName]: { no, rev, title, dead: bool, deadWhy, colour: true|false|null, read: bool } } from title block reading and the colour scan.
function issueCheck({ job, files, transmittal = null, reads = {} }) {
  const out = []; const add = (level, check, text, file = '') => out.push({ id: out.length + 1, level, check, text, file });
  const cov = [];
  const names = files.map(f => f.name);
  // 1. junk and odd files
  const junk = names.filter(n => JUNK.some(r => r.test(n)));
  junk.forEach(n => add('fail', 'Folder contents', 'Working or temporary file in the folder: remove it before issue.', n));
  names.filter(n => !JUNK.some(r => r.test(n)) && !ISSUE_EXT.has(ext(n))).forEach(n => add('warn', 'Folder contents', 'File type is not one that is normally issued (' + (ext(n) || 'no extension') + ').', n));
  names.filter(n => /markup|redline|mark-up|\bdraft\b|\bold\b|copy of|superseded/i.test(baseName(n))).forEach(n => add('warn', 'Folder contents', 'The name suggests a markup, draft or old copy.', n));
  cov.push('File names and file types in the folder');
  // 2. names -> drawing number + revision
  const parsed = files.filter(f => !JUNK.some(r => r.test(f.name))).map(f => ({ ...f, ...parseName(f.name) }));
  const drawingFiles = parsed.filter(f => ['.pdf', '.dxf', '.dwg'].includes(ext(f.name)));
  drawingFiles.filter(f => !f.no).forEach(f => add('warn', 'Naming', 'No drawing number in the file name (expected X######-##-##-####).', f.name));
  drawingFiles.filter(f => f.no && !f.rev).forEach(f => add('warn', 'Naming', 'No revision in the file name.', f.name));
  // 3. several revisions of one drawing in the folder (same file type)
  const byKey = new Map();
  drawingFiles.filter(f => f.no).forEach(f => { const k = f.no + ext(f.name); (byKey.get(k) || byKey.set(k, []).get(k)).push(f); });
  for (const [k, list] of byKey) if (list.length > 1) {
    const revs = list.map(f => f.rev || '(none)');
    add('fail', 'Revisions', `${list[0].no} appears ${list.length} times (${revs.join(', ')}). Only the latest revision should be issued.`, list.map(f => f.name).join(', '));
  }
  // 4. register (the job's drawing list) vs folder, both ways
  const reg = (job && job.drawings || []).filter(d => d.no);
  if (reg.length) {
    const live = reg.filter(d => !/cancel|void|supersed|struck/i.test(d.status || ''));
    const dead = reg.filter(d => /cancel|void|supersed|struck/i.test(d.status || ''));
    for (const d of live) {
      const hit = drawingFiles.filter(f => f.no === d.no.toUpperCase());
      if (!hit.length) { add('fail', 'Register vs folder', `Missing from the folder: ${d.no}${d.title ? ' (' + d.title + ')' : ''}.`); continue; }
      if (d.rev && !hit.some(f => sameRev(f.rev, d.rev)) && hit.every(f => f.rev)) add('fail', 'Revisions', `${d.no}: register says rev ${d.rev}, folder has ${hit.map(f => f.rev).join(', ')}.`, hit.map(f => f.name).join(', '));
    }
    for (const f of drawingFiles.filter(f => f.no && !reg.some(d => d.no.toUpperCase() === f.no))) add('warn', 'Register vs folder', 'In the folder but not on the job\'s drawing list.', f.name);
    for (const d of dead) drawingFiles.filter(f => f.no === d.no.toUpperCase()).forEach(f => add('fail', 'Struck-off', `${d.no} is ${d.status} on the register but is in the folder.`, f.name));
    cov.push('Job drawing list against the folder, both ways (' + live.length + ' live drawings, ' + dead.length + ' struck or cancelled)');
  } else add('warn', 'Register vs folder', 'This job has no drawing list, so the folder could not be checked against one. Add the drawings to the job first.');
  // 5. transmittal vs folder, both ways
  if (transmittal && transmittal.length) {
    for (const t of transmittal) {
      const no = String(t.no || '').toUpperCase(); if (!no) continue;
      const hit = drawingFiles.filter(f => f.no === no);
      if (!hit.length) add('fail', 'Transmittal vs folder', `On the transmittal but not in the folder: ${no}${t.rev ? ' rev ' + t.rev : ''}.`);
      else if (t.rev && hit.every(f => f.rev) && !hit.some(f => sameRev(f.rev, t.rev))) add('fail', 'Transmittal vs folder', `${no}: transmittal says rev ${t.rev}, folder has ${hit.map(f => f.rev).join(', ')}.`, hit.map(f => f.name).join(', '));
    }
    for (const f of drawingFiles.filter(f => f.no && !transmittal.some(t => String(t.no || '').toUpperCase() === f.no))) add('fail', 'Transmittal vs folder', 'In the folder but not on the transmittal.', f.name);
    cov.push('Transmittal against the folder, both ways (' + transmittal.length + ' lines)');
  } else cov.push('Transmittal NOT checked (none supplied)');
  // 6. what the drawings themselves say (title block read + colour scan)
  const readFiles = Object.keys(reads);
  let nRead = 0, nColour = 0, unread = [];
  for (const f of drawingFiles.filter(f => ext(f.name) === '.pdf')) {
    const r = reads[f.name];
    if (!r) { unread.push(f.name); continue; }
    if (r.read) {
      nRead++;
      if (r.no && f.no && r.no.toUpperCase() !== f.no) add('fail', 'Title block', `Title block says ${r.no.toUpperCase()} but the file name says ${f.no}.`, f.name);
      if (r.rev && f.rev && !sameRev(r.rev, f.rev)) add('fail', 'Revisions', `Title block says rev ${r.rev} but the file name says rev ${f.rev}.`, f.name);
      const rg = f.no && reg.find(d => d.no.toUpperCase() === f.no);
      if (rg && rg.rev && r.rev && !sameRev(r.rev, rg.rev)) add('fail', 'Revisions', `Title block says rev ${r.rev} but the job's drawing list says rev ${rg.rev}.`, f.name);
      if (rg && rg.title && r.title && String(r.title).trim().toUpperCase().replace(/\s+/g, ' ') !== rg.title.trim().toUpperCase().replace(/\s+/g, ' ')) add('warn', 'Title block', `Title differs: drawing says "${r.title}", job list says "${rg.title}".`, f.name);
      if (r.dead) add('fail', 'Struck-off', 'The drawing itself is marked ' + (r.deadWhy || 'cancelled / superseded / hatched') + '. Do not issue.', f.name);
    } else unread.push(f.name);
    if (r.colour === true) { nColour++; add('fail', 'Monochrome', 'Colour found in this PDF. Issue drawings in black and white.', f.name); }
    else if (r.colour === null || r.colour === undefined) { /* not scanned */ }
  }
  if (unread.length) add('warn', 'Coverage', `${unread.length} PDF${unread.length === 1 ? ' was' : 's were'} not read for title block details: ${unread.slice(0, 6).join(', ')}${unread.length > 6 ? '...' : ''}`);
  cov.push(readFiles.length ? `Title block, revision and cancelled/hatched marks read on ${nRead} of ${drawingFiles.filter(f => ext(f.name) === '.pdf').length} PDFs` : 'Title blocks NOT read (no Claude key or reading skipped)');
  const scanned = Object.values(reads).filter(r => r.colour === true || r.colour === false).length;
  cov.push(scanned ? `Colour scan of the drawing content on ${scanned} PDF${scanned === 1 ? '' : 's'} (raster images inside a PDF are not scanned)` : 'Colour NOT scanned');
  const fails = out.filter(o => o.level === 'fail').length, warns = out.filter(o => o.level === 'warn').length;
  return { findings: out, fails, warns, ok: fails === 0, coverage: cov, filesChecked: files.length, drawingFiles: drawingFiles.map(f => ({ name: f.name, no: f.no, rev: f.rev, size: f.size })) };
}

// Colour scan of a PDF's content streams: any RGB/CMYK/ICC colour that is not grey. Returns true / false / null (could not scan).
function pdfColourScan(buf) {
  let colour = false, scanned = 0;
  const text = buf.toString('latin1');
  const objRe = /stream\r?\n/g; let m;
  const num = '(-?\\d*\\.?\\d+)';
  const rgbRe = new RegExp(num + '\\s+' + num + '\\s+' + num + '\\s+(?:rg|RG|sc|SC|scn|SCN)\\b', 'g');
  const cmykRe = new RegExp(num + '\\s+' + num + '\\s+' + num + '\\s+' + num + '\\s+(?:k|K)\\b', 'g');
  while ((m = objRe.exec(text)) && !colour) {
    const start = m.index + m[0].length, end = text.indexOf('endstream', start); if (end < 0) break;
    const dictStart = text.lastIndexOf('obj', m.index), dict = text.slice(Math.max(0, dictStart), m.index);
    if (/\/Subtype\s*\/Image|\/Length1|\/FontFile|\/Type\s*\/XRef|\/Type\s*\/ObjStm|\/ICCBased|\/N\s+\d\s*\/Alternate/.test(dict)) { objRe.lastIndex = end; continue; }
    let raw = Buffer.from(text.slice(start, end), 'latin1');
    if (/\/FlateDecode/.test(dict)) { try { raw = zlib.inflateSync(raw); } catch { try { raw = zlib.inflateSync(raw.subarray(0, raw.length - 1)); } catch { objRe.lastIndex = end; continue; } } }
    else if (/\/Filter/.test(dict)) { objRe.lastIndex = end; continue; }
    const s = raw.toString('latin1'); objRe.lastIndex = end;
    const printable = (s.slice(0, 2000).match(/[\x20-\x7E\r\n\t]/g) || []).length / Math.max(1, Math.min(2000, s.length));
    if (printable < 0.9 || !/\b(re|m|l|Tf|Tj|TJ|cm|f|S|B)\b/.test(s)) continue;
    scanned++;
    for (const r of s.matchAll(rgbRe)) { const a = +r[1], b = +r[2], c = +r[3]; if (Math.abs(a - b) > 0.02 || Math.abs(b - c) > 0.02) { colour = true; break; } }
    if (!colour) for (const r of s.matchAll(cmykRe)) { if (+r[1] > 0.02 || +r[2] > 0.02 || +r[3] > 0.02) { colour = true; break; } }
  }
  if (colour) return true;
  return scanned ? false : null;
}

// ---------------- brief ----------------
function weekStart(d = new Date()) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return today(x); }
function daysBetween(aISO, bISO) { return Math.round((Date.parse(bISO) - Date.parse(aISO)) / 86400000); }
function buildBrief(data, kind = 'morning', now = new Date()) {
  const t = today(now); const lines = []; const sec = (h, arr) => { if (arr.length) { lines.push({ h }); arr.forEach(x => lines.push({ t: x })); } };
  const active = data.jobs.filter(j => j.status === 'Active');
  const pend = data.approvals.filter(a => a.status === 'pending');
  const due = active.filter(j => j.dueDate).map(j => ({ j, d: daysBetween(t, j.dueDate) })).sort((a, b) => a.d - b.d);
  sec('Needs you', pend.map(a => `${a.agent}: ${a.title}${a.jobId ? ' (' + (jobNo(data, a.jobId)) + ')' : ''}`));
  sec('Deadlines', due.filter(x => x.d <= 7).map(x => x.d < 0 ? `${x.j.number} ${x.j.name}: ${-x.d} day${x.d === -1 ? '' : 's'} overdue` : x.d === 0 ? `${x.j.number} ${x.j.name}: due today` : `${x.j.number} ${x.j.name}: due in ${x.d} day${x.d === 1 ? '' : 's'}`));
  sec('Hours', active.map(j => ({ j, s: jobSummary(data, j) })).filter(x => x.s.budget && x.s.pct >= 80).map(x => `${x.j.number} ${x.j.name}: ${x.s.used} of ${x.s.budget} h used (${x.s.pct}%)${x.s.over ? ', OVER BUDGET' : ''}`));
  const quiet = active.filter(j => { const last = [j.updatedAt, ...data.audit.filter(a => a.jobId === j.id).map(a => a.at), ...data.hours.filter(h => h.jobId === j.id).map(h => h.date)].filter(Boolean).sort().pop(); return last && daysBetween(last.slice(0, 10), t) >= 7; });
  sec('Gone quiet (nothing logged for 7+ days)', quiet.map(j => `${j.number} ${j.name}`));
  if (kind === 'weekly') {
    const ws = weekStart(now);
    const byWho = hoursByWho(data, ws); const total = Object.values(byWho).reduce((n, v) => n + v, 0);
    sec('Hours this week', [`${Math.round(total * 100) / 100} h logged`, ...Object.entries(byWho).map(([w, h]) => `${w}: ${h} h`)]);
    const perJob = {}; data.hours.filter(h => h.date >= ws).forEach(h => perJob[h.jobId] = (perJob[h.jobId] || 0) + h.hours);
    sec('By job', Object.entries(perJob).map(([id, h]) => `${jobNo(data, id)}: ${Math.round(h * 100) / 100} h`));
    const done = data.audit.filter(a => a.at.slice(0, 10) >= ws && /^(Approved|Issued|Fixed|Checked|Document made)/.test(a.action));
    sec('Done this week', done.slice(0, 15).map(a => `${a.action}${a.jobId ? ' (' + jobNo(data, a.jobId) + ')' : ''}: ${a.detail}`));
  }
  sec('Active jobs', active.map(j => `${j.number} ${j.name}${j.client ? ' · ' + j.client : ''}`));
  if (!lines.length) lines.push({ t: 'Nothing on. Add a job in the Jobs tab to get started.' });
  const head = kind === 'weekly' ? 'Weekly summary' : 'Morning brief';
  return { id: uid('b'), kind, at: now.toISOString(), title: `${head} · ${t}`, lines, flags: { pending: pend.length, overdue: due.filter(x => x.d < 0).length, overBudget: active.filter(j => jobSummary(data, j).over).length } };
}
const jobNo = (data, id) => (data.jobs.find(j => j.id === id) || {}).number || '';
function briefText(b) { return b.title + '\n' + b.lines.map(l => l.h ? '\n' + l.h.toUpperCase() : '  - ' + l.t).join('\n'); }

// should a routine run now? (minute-level check, once per day / week)
function routinesDue(data, now = new Date()) {
  const due = []; const hm = now.toTimeString().slice(0, 5); const t = today(now);
  const m = data.routines.morning, w = data.routines.weekly;
  if (m && m.on && hm >= m.time && data.lastRuns.morning !== t && [1, 2, 3, 4, 5].includes(now.getDay())) due.push('morning');
  if (w && w.on && now.getDay() === Number(w.day) && hm >= w.time && data.lastRuns.weekly !== t) due.push('weekly');
  return due;
}

// ---------------- documents: Claude drafts the content, the Atomax builder lays it out ----------------
const DOC_KINDS = {
  rams: { label: 'RAMS', title: 'Risk Assessment and Method Statement', ask: 'Sections: Scope of Works, Personnel and Responsibilities, Plant and Equipment, Sequence of Work (method statement as numbered steps in a dataTable: Step / Activity / Control measures), Hazards and Risk Assessment (dataTable: Hazard / Who is at risk / Initial risk / Controls / Residual risk), Emergency Arrangements, PPE, Permits and Isolations, Sign-off.' },
  itp: { label: 'ITP', title: 'Inspection and Test Plan', ask: 'A dataTable with columns Item / Activity / Reference or acceptance criteria / Inspection type (Hold, Witness, Review) / Record / Sign-off, grouped under headings for the phases of the work, plus a short Scope and a Definitions section.' },
  ncr: { label: 'NCR', title: 'Non-Conformance Report', ask: 'Sections: Description of the Non-Conformance, Where and When Found, Requirement Not Met, Cause (only if given), Immediate Action, Corrective Action Required (dataTable: Action / Owner / Due / Closed), Verification and Close-out.' },
  report: { label: 'Report', title: 'Report', ask: 'Sections: Introduction, Scope, Work Carried Out, Findings, Conclusions and Recommendations. Use dataTables for results.' },
  quote: { label: 'Quote', title: 'Quotation', ask: 'Sections: Scope of Works, Basis of Quotation (assumptions), Price (dataTable: Item / Description / Qty / Rate / Total, with a Total row only if numbers were supplied), Exclusions, Programme, Terms.' }
};
const DOC_SYSTEM = (kind) => `You write the body of an engineering consultancy document for Atomax-UK Ltd (electrical design, CAD and document control). Document type: ${DOC_KINDS[kind].title}.
Use ONLY the facts the engineer gives. Never invent names, dates, prices, figures, standards numbers, serial numbers or results. Where a needed fact was not given, write "TBC" in that cell or sentence. Plain, professional British English. Short sentences.
${DOC_KINDS[kind].ask}
Return ONLY JSON: {"documentTitle":"short title","projectDetails":[{"label":"","value":""}],"sections":[{"content":[ nodes ]}]}
Nodes (use exactly these shapes): {"type":"heading1","text":""} {"type":"heading2","text":""} {"type":"paragraph","text":""} {"type":"bullets","items":[""]} {"type":"infoTable","rows":[{"label":"","value":""}]} {"type":"dataTable","headers":[""],"colWeights":[0.2,0.8],"rows":[[""]]}
Headings are numbered automatically so do not put numbers in heading text. Put every node in the single sections[0].content list in reading order. Keep tables to at most 8 columns.`;

function docConfig({ kind, job, docNumber, revision = 'P01', date, drafted, prepared = '', checked = '', approved = '', description = 'Issued for review', history = [] }) {
  const d = date || new Date().toLocaleDateString('en-GB');
  const pd = (drafted.projectDetails && drafted.projectDetails.length ? drafted.projectDetails : []).filter(x => x && x.label);
  const base = [];
  if (job) { if (job.client) base.push({ label: 'Client', value: job.client }); base.push({ label: 'Job No.', value: job.number }); if (job.name) base.push({ label: 'Project', value: job.name }); }
  const merged = [...base, ...pd.filter(x => !base.some(b => b.label.toLowerCase() === String(x.label).toLowerCase()))];
  const prior = (history || []).filter(h => h && h.rev && h.rev !== revision);
  return {
    documentTitle: drafted.documentTitle || DOC_KINDS[kind].title, docNumber, docRef: `${DOC_KINDS[kind].title} – ${docNumber}`, revision, date: d,
    projectDetails: merged,
    approval: [...prior.map(h => ({ rev: h.rev, preparedBy: h.preparedBy || '', checkedBy: h.checkedBy || '', approvedBy: h.approvedBy || '' })), { rev: revision, preparedBy: prepared, checkedBy: checked, approvedBy: approved }],
    revisionHistory: [...prior.map(h => ({ rev: h.rev, description: h.description || '', date: h.date || '' })), { rev: revision, description, date: d }],
    sections: drafted.sections && drafted.sections.length ? drafted.sections : [{ content: [{ type: 'heading1', text: 'Details' }, { type: 'paragraph', text: 'TBC' }] }]
  };
}
// the next free document number for a job: <jobNumber>-<seq>, matching the X######-##-##-#### pattern when the job number is X######-##
function nextDocNumber(data, job) {
  const used = data.docs.filter(d => d.jobId === job.id).map(d => d.docNumber);
  const base = job.number.replace(/-\d{2}-\d{4}$/, '');
  const grp = /^X\d{6}-\d{2}$/i.test(base) ? base : job.number;
  for (let i = 1; i < 9999; i++) { const n = `${grp}-${String(i).padStart(4, '0')}`; if (!used.includes(n)) return n; }
  return job.number + '-0001';
}

// ---------------- transmittal config (Atomax format) ----------------
function transmittalConfig({ job, rows, revision = 'P01', docNumber, date, to = '', purpose = 'Issued for review', prepared = '' }) {
  const d = date || new Date().toLocaleDateString('en-GB');
  return {
    documentTitle: 'Drawing Transmittal', docNumber, docRef: 'Transmittal – ' + docNumber, revision, date: d,
    projectDetails: [{ label: 'Client', value: job.client || '' }, { label: 'Job No.', value: job.number }, { label: 'Project', value: job.name || '' }, { label: 'Issued to', value: to }, { label: 'Purpose of issue', value: purpose }],
    approval: [{ rev: revision, preparedBy: prepared, checkedBy: '', approvedBy: '' }],
    revisionHistory: [{ rev: revision, description: purpose, date: d }],
    sections: [{ content: [
      { type: 'heading1', text: 'Drawings and documents issued' },
      { type: 'dataTable', headers: ['Item', 'Drawing / document no.', 'Title', 'Rev', 'File'], colWeights: [0.07, 0.27, 0.34, 0.08, 0.24], rows: rows.map((r, i) => [String(i + 1), r.no || '', r.title || '', r.rev || '', r.name]) },
      { type: 'paragraph', text: `${rows.length} item${rows.length === 1 ? '' : 's'} issued.` }
    ] }]
  };
}

module.exports = {
  TASK_STATUS, saveTask, deleteTask, noteActivity, jobContext,
  makeStore, emptyData, audit, saveJob, deleteJob, parseDrawingLines, JOB_STATUS,
  addHours, removeHours, jobHours, jobSummary, hoursByWho,
  queueApproval, decideApproval,
  issueCheck, parseName, pdfColourScan, DRAWING_NO,
  buildBrief, briefText, routinesDue, weekStart,
  DOC_KINDS, DOC_SYSTEM, docConfig, nextDocNumber, transmittalConfig, today
};
