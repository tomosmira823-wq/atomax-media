// The job desk: what every agent on a job shares.
// - Job rules: JOB RULES.md in the job folder (or kept here when there is no folder). Every agent reads them.
// - Client profile: a file in the File Room "Clients" cabinet whose name matches the job's client (title block, numbering, issue format).
// - Drawing register: the job's drawing list. An existing register in the job folder is found and read first; one is only made when there is none.
// - Inputs and RFIs: what the client has sent (with revisions) and what is still needed, as numbered questions.
// - Master device list: one sheet of devices, JBs, panels and cables built from the inputs. BCDs and the cable schedule are made from it once Tom approves it.
// - Client comments: a comment response sheet (CRS) per job.
'use strict';
const fs = require('fs');
const path = require('path');
const biz = require('./business');

let DIR = '', BIZ = null, library = null;
const RULES_FILE = 'JOB RULES.md';
const REGISTER_RE = /register|\bmdl\b|document list|drawing list|deliverables? list/i;

function init({ userDir, BIZ: b, library: l }) { DIR = path.join(userDir, 'jobdesk'); fs.mkdirSync(DIR, { recursive: true }); BIZ = b; library = l; }
const fileOf = (id) => path.join(DIR, String(id).replace(/[^\w-]/g, '') + '.json');
const blank = () => ({ rules: '', inputs: [], rfis: [], crs: [], master: null, registerFile: '', registerChecked: '' });
function load(id) { try { return { ...blank(), ...JSON.parse(fs.readFileSync(fileOf(id), 'utf8')) }; } catch { return blank(); } }
function save(id, d) { fs.writeFileSync(fileOf(id), JSON.stringify(d, null, 1)); return d; }
const jobOf = (id) => BIZ.data().jobs.find(j => j.id === id);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- job rules ----------
function rulesPath(job) { return job && job.folder && fs.existsSync(job.folder) ? path.join(job.folder, RULES_FILE) : ''; }
function getRules(id) {
  const job = jobOf(id), p = rulesPath(job);
  if (p && fs.existsSync(p)) { try { return fs.readFileSync(p, 'utf8'); } catch {} }
  return load(id).rules || '';
}
function setRules(id, text) {
  const job = jobOf(id), p = rulesPath(job), d = load(id);
  d.rules = String(text || ''); save(id, d);
  if (p) fs.writeFileSync(p, d.rules, 'utf8');
  return d.rules;
}
// a correction Tom wants kept for this job (scope 'job'), this client ('client'), or everywhere ('all', the agent's rulebook)
function addCorrection(id, { agent = '', agentName = '', text = '', scope = 'job' }) {
  const line = `- ${agentName ? '(' + agentName + ') ' : ''}${String(text).trim()}`;
  if (!String(text).trim()) throw new Error('Write the correction first');
  if (scope === 'all') { library.addCorrection(agent, String(text).trim()); return 'Saved to ' + (agentName || 'the agent') + '\'s rulebook (every job)'; }
  if (scope === 'client') {
    const job = jobOf(id), prof = clientProfile(job);
    if (!job || !job.client) throw new Error('This job has no client set');
    if (prof) { library.save('clients', prof.file, { text: prof.text.trimEnd() + '\n' + line + '\n' }); return 'Saved to the ' + prof.name + ' client profile'; }
    library.newClient({ name: job.client, text: `# ${job.client}\n\n## Corrections\n${line}\n` }); return 'Made a client profile for ' + job.client + ' with it';
  }
  const cur = getRules(id); setRules(id, (cur.trim() ? cur.trimEnd() + '\n' : '# Job rules\n\n') + line + '\n'); return 'Saved to this job\'s rules';
}

// ---------- client profile ----------
function clientProfile(job) {
  if (!job || !job.client || !library) return null;
  const words = job.client.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/^(ltd|limited|plc|the|and|group|uk)$/.test(w));
  if (!words.length) return null;
  const items = library.list('clients').filter(i => i.on !== false);
  const hit = items.find(i => words.some(w => (i.name + ' ' + i.file).toLowerCase().includes(w)) && /\.(md|txt)$/i.test(i.file));
  if (!hit) return null;
  return { name: hit.name, file: hit.file, text: library.readText('clients', hit.file) || '' };
}
// the client's title block DXF (any .dxf in the Clients cabinet whose name matches the client)
function titleBlockFor(job) {
  if (!job || !job.client || !library) return '';
  const words = job.client.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/^(ltd|limited|plc|the|and|group|uk)$/.test(w));
  const items = library.list('clients').filter(i => /\.dxf$/i.test(i.file) && words.some(w => (i.name + ' ' + i.file).toLowerCase().includes(w)));
  return items.length ? library.pathOf('clients', items[0].file) : '';
}

// ---------- drawing register ----------
function walk(dir, depth, out, max = 4000) {
  if (depth < 0 || out.length > max) return out;
  let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (!/^(\.|node_modules|\$)/.test(e.name)) walk(p, depth - 1, out, max); } else out.push(p); }
  return out;
}
function findRegisters(job) {
  if (!job || !job.folder || !fs.existsSync(job.folder)) return [];
  // the document register (9.1 Document Register in an Atomax folder), not the RFI, transmittal, vendor, risk or variation registers
  // the older Atomax folders keep the drawing register inside the master transmittal workbook ("013 Transmittals & Drawing Register \ Document
  // Transmittal (master ...)"): in a Drawing Register folder the master workbook is the register; elsewhere a transmittal is not
  const inRegFolder = (p) => /[\\/](9\.1 Document Register|[^\\/]*Drawing Register)[\\/][^\\/]+$/i.test(p);
  return walk(job.folder, 4, []).filter(p => { const n = path.basename(p); if (!/\.(xlsx|xlsm|csv)$/i.test(n) || /^~\$/.test(n) || /document request/i.test(n)) return false; if (inRegFolder(p)) return REGISTER_RE.test(n) || /master/i.test(n); return REGISTER_RE.test(n) && !/rfi|transmittal|vendor|risk|variation|action|comment/i.test(n); })
    .map(p => ({ path: p, name: path.basename(p), mtime: fs.statSync(p).mtimeMs, inReg: inRegFolder(p) ? 1 : 0, master: /master/i.test(path.basename(p)) ? 1 : 0, numbered: /^X\d/i.test(path.basename(p)) ? 1 : 0 }))
    .sort((a, b) => b.inReg - a.inReg || b.master - a.master || b.numbered - a.numbered || b.mtime - a.mtime);
}
// read rows out of a register workbook: any row with a drawing number; title / rev / status from the other cells
function readRegister(file, checker) {
  const buf = fs.readFileSync(file);
  const sheets = /\.csv$/i.test(file) ? checker.readCsv(buf.toString('utf8')) : checker.readXlsx(buf);
  const rows = [];
  for (const sh of sheets) for (const r of (sh.rows || [])) {
    const cells = (Array.isArray(r) ? r : Array.isArray(r.c) ? r.c : Object.values(r)).map(c => String(c ?? '').trim());
    const struck = !!(r && Array.isArray(r.st) && r.st.some(Boolean));   // a struck-through row is a cancelled drawing
    const i = cells.findIndex(c => biz.DRAWING_NO.test(c)); if (i < 0) continue;
    const no = cells[i].match(biz.DRAWING_NO)[0].toUpperCase(); if (rows.some(x => x.no === no) || /-DIR-\d+$/.test(no) || cells.some(c => /transmittal register/i.test(c))) continue;   // the transmittal register sheets themselves are not deliverables
    const rest = cells.filter((c, k) => k !== i && c);
    const revs = rest.filter(c => /^(rev\.?\s*)?([PCA]\d{1,2}|[A-Z]\d{1,2}|[A-Z])$/i.test(c) && c.length <= 6), rev = revs.length ? revs[revs.length - 1] : '';   // one column per issue: the last filled is the current revision
    const status = struck || rest.find(c => /cancel|void|supersed|struck|withdrawn/i.test(c)) ? 'Cancelled' : 'Live';
    const title = rest.filter(c => !revs.includes(c) && !/^\d+([./-]\d+)*$/.test(c) && !/^\d{2}_[A-Z]{2}_\d{4}$/i.test(c) && !biz.DRAWING_NO.test(c) && !/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(c) && c.length > 3).sort((a, b) => b.length - a.length)[0] || '';
    const ours = rest.find(c => /^\d{2}_[A-Z]{2}_\d{4}$/i.test(c)) || '';   // Atomax's own number alongside the client's (42_BG_0055)
    rows.push({ no, title: title.slice(0, 160), rev: rev.replace(/^rev\.?\s*/i, '').toUpperCase(), status, ...(ours ? { alt: ours.toUpperCase() } : {}) });
  }
  return rows;
}
// check for a register: found → its drawings go onto the job's drawing list (existing rows kept). None → say so (Tom can make one).
function checkRegister(id, checker) {
  const job = jobOf(id); if (!job) throw new Error('No such job');
  const d = load(id), found = findRegisters(job);
  d.registerChecked = new Date().toISOString();
  if (!found.length) { d.registerFile = ''; save(id, d); return { found: false, folder: job.folder || '', drawings: job.drawings.length }; }
  const rows = readRegister(found[0].path, checker);
  const merged = [...job.drawings];
  for (const r of rows) { const old = merged.find(x => x.no.toUpperCase() === r.no || (r.alt && x.no.toUpperCase() === r.alt)); if (old) { if (r.rev) old.rev = r.rev; if (r.title && !old.title) old.title = r.title; if (r.status === 'Cancelled') old.status = 'Cancelled'; if (r.alt) old.alt = r.alt; if (old.no.toUpperCase() === r.alt) old.no = r.no; } else merged.push(r); }   // a row under our own number takes the client's number from the register
  biz.saveJob(BIZ.data(), { ...job, drawings: merged }, 'Eli'); BIZ.store.save();
  d.registerFile = found[0].path; save(id, d);
  BIZ.log({ who: 'Eli', action: 'Read the drawing register', jobId: id, detail: `${found[0].name} · ${rows.length} drawings` });
  return { found: true, file: found[0].path, others: found.slice(1).map(f => f.name), read: rows.length, drawings: merged.length };
}
// a new register workbook from the job's drawing list (never over an existing file)
function makeRegister(id, writeXlsx) {
  const job = jobOf(id); if (!job) throw new Error('No such job');
  const dir = BIZ.outputDirFor(id, 'register') || path.join(DIR, 'registers'); fs.mkdirSync(dir, { recursive: true });
  let p = path.join(dir, `${job.number} Drawing Register.xlsx`), k = 2; while (fs.existsSync(p)) p = path.join(dir, `${job.number} Drawing Register (${k++}).xlsx`);
  fs.writeFileSync(p, writeXlsx([{ name: 'Register', columns: [{ header: 'Document number' }, { header: 'Title' }, { header: 'Revision' }, { header: 'Status' }], rows: job.drawings.map(r => [r.no, r.title, r.rev, r.status]) }]));
  const d = load(id); d.registerFile = p; save(id, d);
  BIZ.log({ who: 'Eli', action: 'Made the drawing register', jobId: id, detail: path.basename(p) + ' · ' + job.drawings.length + ' rows' });
  return p;
}
// the next number for a kind of deliverable, per Atomax QS 006 (project ref - area - discipline - type - sequence); '' when the area code is not known yet
const DN = require('./docnumber');
// a number for a deliverable: grounded in the register, the job desk's area or numbered files in the job folder. With nothing to go on the row
// stays TBC (the register may still say otherwise) unless `assume` is set, which the make does so a drawing never goes out numbered TBC.
function proposeNumber(job, type, taken, id, seen = [], assume = false) { const d = id ? load(id) : {}; const r = DN.next(job, type, { area: d.area, disc: d.disc, taken, seen: seen.length ? seen : seenNumbers(job) }); return r.assumed && !assume ? '' : r.no; }
// numbered files already in the job folder (the client's schedules, registers): they say how this job is numbered
function seenNumbers(job) {
  try { const p = require('./projects').load(job.id); if (p && p.files && p.files.length) return p.files.map(f => f.rel.split(/[\\/]/).pop()); } catch {}
  // the folder not read yet (a job Eli has just made): a quick look at the file names themselves
  const out = []; const walk = (dir, depth) => { if (depth > 4 || out.length > 2000) return; let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { if (e.isDirectory()) { if (!/^(archive|superseded|node_modules|\.)/i.test(e.name)) walk(path.join(dir, e.name), depth + 1); } else out.push(e.name); } };
  if (job && job.folder) walk(job.folder, 0); return out;
}
function setNumbering(id, { area, disc }) { const d = load(id); if (area != null) d.area = String(area).trim().toUpperCase().slice(0, 4); if (disc != null) d.disc = /^\d{2}$/.test(disc) ? disc : ''; return save(id, d); }
// the kind of a drawing (by its QS 006 code, else its words): used to match emails and register rows to the row that already exists
const QSNO = /X\d{4,6}(?:-[A-Z0-9]{2,4}){2,5}-\d{4}/i;
function kindKey(no, title) { const t = (String(no || '').match(/-(\d{2})-\d{4}(?:\b|_)/) || [])[1] || '', s = `${title || ''} ${no || ''}`;
  if (t === '71' || /\bbcd\b|block cable/i.test(s)) return 'bcd'; if (t === '70' || /single.?line|\bsld\b/i.test(s)) return 'sld'; if ((t === '74' || /earthing/i.test(s)) && !/\b(study|studies|assessment|report|design basis|calculations?|epr|analysis|specification)\b/i.test(title || '')) return 'earthing';
  if (t === '72' || t === '23' || /cable schedule/i.test(s)) return 'schedule'; if (/\bloop\b/i.test(s)) return 'loop'; return ''; }
// what a deliverable is, from its type and title: the tag goes in its TBC number (TBC-GA-03), the group heads it on the Deliverables tab
const KIND_TAGS = [
  ['site', 'SITE', /\b(survey|laser scan|point cloud|site visit|inspection|attendance|witness|commissioning|meeting)\b/i],
  ['site', 'MODEL', /\b(3d model|modelling|plant 3d|model review)\b/i],
  ['drawing', 'SLD', /single.?line|\bsld\b/i], ['drawing', 'BCD', /\bbcd\b|block cable/i], ['drawing', 'EARTH', /earthing|bonding/i],
  ['drawing', 'LOOP', /\bloop\b/i], ['drawing', 'PID', /p&id|\bpid\b/i], ['drawing', 'GA', /\bgas?\b|general arrangement|layout|location plan|destruct|removal drawing|tie-in/i], ['drawing', 'ISO', /isometric|\biso\b|spool/i],
  ['drawing', 'SCH', /schematic|circuit|wiring|termination|interconnection|containment|architecture|hazardous area|block diagram|drawing/i],
  ['document', 'PKG', /\bpackage\b/i],
  ['schedule', 'CABLES', /cable schedule/i], ['schedule', 'IO', /\bi\/?o\b.*(schedule|list|count)/i],
  ['schedule', 'LIST', /\b(schedules?|registers?|lists?|take-?off|mto|index)\b/i],
  ['document', 'CALC', /calc|stress|analysis|sizing|verification/i], ['document', 'DS', /datasheet|data sheet/i], ['document', 'SPEC', /specification|\bspec\b|standard\b/i],
  ['document', 'RPT', /report|study|assessment|philosophy/i], ['document', 'PROC', /procedure|test pack|method|rams|\bitp\b|plan\b/i], ['document', 'RFI', /query|\brfi\b|\btq\b|question/i],
  ['document', 'DOC', /./]
];
function kindTag(type, title) {
  const t = String(type || '').toLowerCase(), s = `${type || ''} ${title || ''}`;
  const earthDoc = /\b(study|studies|assessment|report|design basis|calculations?|epr|analysis|specification)\b/i.test(String(title || ''));   // an earthing study is a document, not a drawing
  if (/^(sld|bcd|earthing|loop)$/.test(t) && !(t === 'earthing' && earthDoc)) return { group: 'drawing', tag: t === 'earthing' ? 'EARTH' : t.toUpperCase() };
  if (earthDoc && /earthing|bonding/i.test(s)) return { group: 'document', tag: 'RPT' };
  if (t === 'cable schedule') return { group: 'schedule', tag: 'CABLES' };
  if (t === 'calculation') return { group: 'document', tag: 'CALC' };
  if (/\b(stud(y|ies)|report|assessment|analysis|calculations?|specification|philosophy|proposal|technical note|design basis)\b/i.test(String(title || '')) && !/\b(drawing|diagram|layout|schematic|sld|bcd|arrangement)\b/i.test(String(title || ''))) {   // a study or report is a document, whatever else its title says ("Short Circuit Study")
    for (const [group, tag, re] of KIND_TAGS) if (group === 'document' && re.test(s)) return { group, tag };
    return { group: 'document', tag: 'RPT' }; }
  if (/\b(schedules?|registers?|lists?|index)\b/i.test(String(title || '')) && !/\b(drawing|diagram|layout|schematic)\b/i.test(String(title || ''))) return { group: 'schedule', tag: /cable schedule/i.test(s) ? 'CABLES' : 'LIST' };   // "Circuit schedule" is a schedule, not a circuit drawing
  for (const [group, tag, re] of KIND_TAGS) if (re.test(s)) return { group, tag };
  return { group: 'document', tag: 'DOC' };
}
const GROUPS = { drawing: 'Drawings', schedule: 'Schedules & lists', document: 'Documents & calculations', site: 'Site work & models' };
// one row per drawing: a TBC row and a numbered row of the same kind (the email's deliverable and the register's row, or a "Rev P02" the
// email asked for) are the same drawing. The row with work done keeps its work; it takes the real number; the other row goes, and the
// comments logged against it move across. Returns the renames made ({from, to}).
function tidyRows(id) {
  const job = jobOf(id); if (!job) return []; const d = load(id), dl = d.deliv || {}, moves = [];
  const rows = job.drawings; const hasWork = (r) => !!(dl[r.no] && (dl[r.no].files || dl[r.no].status));
  // the same email read twice (before files were fingerprinted) left its rows and comments twice: a TBC row saying the same as an
  // earlier one in other words ("Quotation / fee proposal" = "Fee proposal / quotation"), with no work on it, goes; so does a comment
  // repeating an earlier one word for word against the same drawing
  let dups = 0;
  const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');   // the sheet number counts: sheet 1 and sheet 2 of a set are two drawings
  for (const r of [...rows]) { if (!/^TBC-/i.test(r.no) || hasWork(r)) continue; const first = rows.find(x => x !== r && rows.indexOf(x) < rows.indexOf(r) && words(x.title) === words(r.title)); if (!first) continue;
    for (const c of d.crs || []) if (String(c.doc).toUpperCase() === r.no.toUpperCase()) c.doc = first.no; rows.splice(rows.indexOf(r), 1); moves.push({ from: r.no, to: first.no }); dups++; }
  const seenC = new Set(); d.crs = (d.crs || []).filter(c => { const k = `${String(c.doc || '').toUpperCase()}|${String(c.comment || '').trim().toLowerCase()}|${String(c.by || '').trim().toLowerCase()}`; if (seenC.has(k) && !c.response) { dups++; return false; } seenC.add(k); return true; });
  for (const kind of ['sld', 'bcd', 'earthing']) {
    const same = rows.filter(r => kindKey(r.no, r.title) === kind && !/cancel|superseded/i.test(r.status || '')); if (same.length < 2) continue;
    const distinct = (r) => /\b(sheet|phase|area|zone|stage|rio\s*\d|mcc\s*\d|\d+\s+of\s+\d+)\b/i.test(r.title || '') || /\(\s*sheet/i.test(r.title || '');   // a second drawing of the kind, not a duplicate
    const real = same.filter(r => QSNO.test(r.no)), tbc = same.filter(r => /^TBC-/i.test(r.no) && !distinct(r)); if (!real.length || !tbc.length || real.some(distinct)) continue;
    const same2 = [...real, ...tbc]; same.length = 0; same.push(...same2);
    const numbers = [...new Set(real.map(r => r.no.toUpperCase()))]; if (numbers.length > 1) continue;   // two numbered drawings of one kind: leave alone
    const keepNo = real[0].no, keep = same.find(hasWork) || real[0], drop = same.filter(r => r !== keep);
    if (keep.no !== keepNo) { if (dl[keep.no]) { dl[keepNo] = dl[keep.no]; delete dl[keep.no]; } moves.push({ from: keep.no, to: keepNo }); keep.no = keepNo; }
    for (const r of drop) { const rev = real.find(x => x === r) ? r.rev : ''; if (rev && !keep.rev) keep.rev = rev; if (!/\bP\d\d\b|rev/i.test(keep.title) && /single|block|earthing/i.test(r.title) && !/\bP\d\d\b|rev/i.test(r.title) && r.title.length > keep.title.length) keep.title = r.title;
      for (const c of d.crs || []) if (String(c.doc).toUpperCase() === r.no.toUpperCase()) c.doc = keepNo; moves.push({ from: r.no, to: keepNo }); }
    for (const r of drop) rows.splice(rows.indexOf(r), 1);
  }
  // a comment logged against a number that is no longer a row (a TBC row since merged or renumbered) goes to the one row of that kind
  let repointed = 0;
  for (const c of d.crs || []) { if (!c.doc || rows.some(r => r.no.toUpperCase() === String(c.doc).toUpperCase())) continue;
    const k = kindKey(c.doc, c.doc), of = k ? rows.filter(r => kindKey(r.no, r.title) === k && !/cancel|superseded/i.test(r.status || '')) : []; if (of.length === 1) { c.doc = of[0].no; repointed++; } }
  if (moves.length || repointed || dups) { d.deliv = dl; save(id, d); biz.saveJob(BIZ.data(), { ...job, drawings: rows }, 'Eli'); BIZ.store.save(); BIZ.log({ who: 'Eli', action: 'Tidied the drawing list', jobId: id, detail: [...moves.map(m => `${m.from} -> ${m.to}`), repointed ? `${repointed} comment(s) put on their drawing` : ''].filter(Boolean).join(', ') }); }
  return moves;
}
// a row gets its real number (Dex numbered a TBC drawing from the register / QS 006 when he made it): its work and comments follow it
function renameRow(id, from, to) {
  const job = jobOf(id); if (!job || !from || !to || from === to) return false; const r = job.drawings.find(x => x.no === from); if (!r) return false;
  if (job.drawings.some(x => x !== r && x.no.toUpperCase() === String(to).toUpperCase())) return false;   // that number is another row: tidyRows merges those
  const d = load(id); if (d.deliv && d.deliv[from]) { d.deliv[to] = d.deliv[from]; delete d.deliv[from]; } for (const c of d.crs || []) if (c.doc === from) c.doc = to; save(id, d);
  r.no = to; biz.saveJob(BIZ.data(), job, 'Dex'); BIZ.store.save(); BIZ.log({ who: 'Dex', action: 'Numbered the drawing', jobId: id, detail: `${from} -> ${to}` }); return true;
}
// Eli's deliverables onto the drawing list: numbered like the existing ones of that kind, otherwise "TBC-<kind>-n" for Tom to number.
// A deliverable that is a drawing the list already has (same number, or a revision / reissue of a kind the list has one of) adds nothing.
// the count of a set when Eli left it in the title ("IS loop drawings (16 off)", "8 x Rotork schematics", "15 spool GAs"), and the title without it
const COUNT_IN = [/\((\d{1,2})\s*(?:off|no\.?|nr|sheets?|drawings?|circuits?|loops?)\)/i, /\b(\d{1,2})\s*(?:off|no\.|nr)\b/i, /[x×]\s*(\d{1,2})\b/i, /\b(\d{1,2})\s*[x×]\s/i, /^(\d{1,2})\s+(?=[a-z])/i];
function setCount(title, qty) {
  const t = String(title || ''); const n = parseInt(qty, 10) || 1;
  if (n > 1) return { qty: n, title: t.replace(COUNT_IN[0], '').replace(/\s{2,}/g, ' ').trim() };
  for (const re of COUNT_IN) { const m = t.match(re); if (m && +m[1] > 1 && !/calcs?|cases?|days?|digesters?|pots?|circuits? per|per\b/i.test(t.slice(m.index, m.index + m[0].length + 14))) return { qty: +m[1], title: t.replace(m[0], ' ').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim() }; }
  return { qty: 1, title: t };
}
const cap = (t) => t.replace(/^[a-z]/, (c) => c.toUpperCase());
const setBase = (title) => String(title || '').toLowerCase().replace(/\s*\(sheet \d+\)\s*$/, '').replace(COUNT_IN[0], '').replace(/\s{2,}/g, ' ').trim();
// a title worth reading: never the number again, never a stray digit from a five-digit sequence; the file name with its number and rev
// removed, else the folder it lives in ("7.6 Interconnection Diagrams" -> "Interconnection diagram")
function titleFor(no, title, file) {
  const t = String(title || '').trim(), numLike = (x) => /^[\d .:-]*$/.test(x) || x.toLowerCase() === String(no).toLowerCase() || x.length < 4;
  if (t && !numLike(t)) return t;
  const f = String(file || '').replace(/\\/g, '/'), base = f.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const rest = base.replace(/X\d{5,6}(?:-[A-Z0-9]{1,5}){1,6}/ig, '').replace(/\b\d{2}_[A-Z]{2}_\d{4}(_[PCAX]\d{2})?\b/ig, '').replace(/[-_ ]*\b[PCAX]\d{2}\b/ig, '').replace(/^[\s\-_.]+|[\s\-_.]+$/g, '').replace(/[_]+/g, ' ').trim();
  if (rest && !numLike(rest)) return rest;
  for (const dir of f.split('/').slice(0, -1).reverse()) { const folder = dir.replace(/^[\d.]+\s*/, '').replace(/s$/i, '');   // the nearest folder that names a kind of drawing (not DXF / Archive / a numbered job folder)
    if (folder && !numLike(folder) && !/^(archive|dxf|dwg|pdf|claude|to be checked|issue \d+|superseded|old|markup|electrical|transmittal|document control|drawing|native|cad)$/i.test(folder) && !/^X\d{5,6}/i.test(dir)) return folder.charAt(0).toUpperCase() + folder.slice(1).toLowerCase(); }
  return t || 'Drawing';
}
// two titles for one deliverable: their key words (standards like G5/5, P28, G99 kept whole) mostly the same and nothing that tells them apart
const DSTOP = new Set(['the', 'and', 'of', 'for', 'to', 'a', 'an', 'in', 'on', 'at', 'new', 'study', 'studies', 'assessment', 'report', 'document', 'review', 'design', 'drawing', 'diagram', 'final', 'updated', 'revised', 'draft', 'issue', 'erec', 'ena', 'including', 'with']);
const dwords = (t) => new Set(String(t || '').toLowerCase().replace(/\b([gp]\d{2,3})\s*[\/-]\s*(\d)\b/g, '$1_$2').replace(/&/g, ' and ').replace(/\([^)]*\)/g, (m) => ' ' + m.slice(1, -1) + ' ').split(/[^a-z0-9_]+/).filter(w => (w.length > 1 || /^\d$/.test(w)) && !DSTOP.has(w) && !/^x\d{5,6}$|^\d{4}$/.test(w)));
function sameDeliverable(a, b) {
  const A = dwords(a), B = dwords(b); if (A.size < 2 || B.size < 2) return false;
  const tell = /^(sheet|phase|stage|area|zone|rio\d*|mcc\d*|jb\d*|\d)$/;   /* a lone digit (sheet 2, phase 1) tells them apart; 33 kV does not */   // a set's sheets and a job's phases are different drawings
  if ([...A, ...B].some(w => tell.test(w) && !(A.has(w) && B.has(w)))) return false;
  let both = 0; for (const w of A) if (B.has(w)) both++;
  const small = Math.min(A.size, B.size), big = Math.max(A.size, B.size);
  return both >= 2 && both === small && small / big >= 0.5;
}
function addDeliverables(id, list, opts = {}) {
  const job = jobOf(id); if (!job || !Array.isArray(list) || !list.length) return [];
  const added = [], taken = []; let renamed = false;
  for (const dl0 of list) {
    if (dl0.no) {   // a document Atomax already has in the job folder (matched by Eli): its own number, title and latest revision
      const no = String(dl0.no).trim(), up = no.toUpperCase(); if (!no || job.drawings.some(d => d.no.toUpperCase() === up || (d.alt && d.alt.toUpperCase() === up)) || added.some(a => a.no.toUpperCase() === up)) continue;   // on the list already, under this number or as our number beside the client's
      const kt = kindTag(dl0.type, dl0.title); added.push({ no, title: titleFor(no, dl0.title, dl0.file || dl0.path || ''), rev: String(dl0.rev || ''), status: 'To do', type: String(dl0.type || ''), group: kt.group }); continue;
    }
    const sc = setCount(dl0.title || dl0.type, dl0.qty), dl = { ...dl0, title: cap(sc.title) };
    const qty = Math.max(1, Math.min(60, sc.qty));
    // a set the list already holds as one row ("IS loop drawings (16 off)" from an earlier read, no work on it): that row becomes sheet 1
    if (qty > 1) { const one = job.drawings.find(d => /^TBC-/i.test(d.no) && !/\(sheet \d+\)/i.test(d.title) && setBase(d.title) === setBase(dl.title)); if (one) { const d0 = load(id); if (!(d0.deliv && d0.deliv[one.no])) { one.title = `${dl.title} (sheet 1)`; renamed = true; } } }
    for (let i = 0; i < qty; i++) {
      const title = qty > 1 ? `${dl.title || dl.type} (sheet ${i + 1})` : (dl.title || dl.type);
      if (job.drawings.some(d => d.title.toLowerCase() === String(title).toLowerCase())) continue;
      if (qty === 1 && job.drawings.some(d => !/cancel|superseded/i.test(d.status || '') && sameDeliverable(d.title, title))) continue;   // the same deliverable in other words (a follow-up email's "harmonic study (G5/5)" for our "Harmonic Assessment to EREC G5/5"): not a second row
      const num = (String(`${dl.number || ''} ${dl.title || ''}`).match(QSNO) || [])[0], kind = kindKey(num || '', `${dl.type || ''} ${dl.title || ''}`);
      if (num && job.drawings.some(d => d.no.toUpperCase() === num.toUpperCase())) continue;   // already on the list
      const sameKind = kind && ['sld', 'bcd', 'earthing'].includes(kind) ? job.drawings.filter(d => kindKey(d.no, d.title) === kind && !/cancel|superseded/i.test(d.status || '')) : [];
      if (num && sameKind.length === 1 && /^TBC-/i.test(sameKind[0].no)) { const r = sameKind[0], d0 = load(id); if (d0.deliv && d0.deliv[r.no]) { d0.deliv[num] = d0.deliv[r.no]; delete d0.deliv[r.no]; save(id, d0); } for (const c of (d0.crs || [])) if (c.doc === r.no) c.doc = num; save(id, d0); r.no = num; renamed = true; BIZ.log({ who: 'Eli', action: 'Numbered a drawing from the email', jobId: id, detail: `${title}: ${num}` }); continue; }   // the TBC row IS this drawing
      if (sameKind.length && (opts.commentReturn || /\brev(ision)?\b|reissue|re-issue|\b[PC]\d\d\b|updated?\b/i.test(title))) continue;   // a revision of a drawing we have is not a new drawing
      const kt = kindTag(dl.type, dl.title);
      const no = proposeNumber(job, dl.title + ' ' + dl.type, taken, id) || (() => { const used = new Set([...job.drawings.map(d => d.no), ...added.map(a => a.no)].map(x => String(x).toUpperCase())); let n = job.drawings.filter(d => /^TBC-/.test(d.no)).length + added.length + 1, c; do { c = `TBC-${kt.tag}-${String(n++).padStart(2, '0')}`; } while (used.has(c.toUpperCase())); return c; })();
      taken.push(no); added.push({ no, title, rev: '', status: 'To do', type: String(dl.type || ''), group: kt.group });
    }
  }
  if (renamed && !added.length) { biz.saveJob(BIZ.data(), job, 'Eli'); BIZ.store.save(); }
  if (added.length) { biz.saveJob(BIZ.data(), { ...job, drawings: [...job.drawings, ...added] }, 'Eli'); BIZ.store.save(); BIZ.log({ who: 'Eli', action: 'Added deliverables to the drawing list', jobId: id, detail: added.map(a => a.no).join(', ') }); }
  return added;
}

// ---------- inputs and RFIs ----------
function addInputs(id, { inputs = [], missing = [], questions = [], fromEmail = '' }) {
  const d = load(id);
  for (const x of inputs) { if (!x || !x.name) continue; const old = d.inputs.find(i => i.name.toLowerCase() === String(x.name).toLowerCase()); if (old) { if (x.rev) old.rev = x.rev; old.received = today(); } else d.inputs.push({ name: String(x.name), rev: String(x.rev || ''), what: String(x.what || ''), received: today(), from: fromEmail }); }
  const ask = [...missing.map(m => 'Please send: ' + m), ...questions];
  for (const q of ask) { const t = String(q || '').trim(); if (!t || d.rfis.some(r => sameAsk(r.q, t))) continue; d.rfis.push({ no: nextRfiNo(d.rfis), q: t, status: 'Draft', raised: today(), answer: '', from: fromEmail }); }
  return save(id, d);
}
// the next RFI number in the job's own style: after the highest, padded the way the register already pads them (RFI-24 -> RFI-25, RFI-011 -> RFI-012)
function nextRfiNo(rfis) { const nums = (rfis || []).map(r => String(r.no || '').match(/^RFI-(\d+)$/i)).filter(Boolean); const pad = nums.length ? Math.max(...nums.map(m => m[1].length)) : 3; return 'RFI-' + String(Math.max(0, ...nums.map(m => +m[1])) + 1).padStart(pad, '0'); }
// the same question asked twice in other words ("Please send: Bustleholm deliverables list" / "Please send the Bustleholm deliverables
// list from 19 Oct") is one RFI: the words that carry meaning mostly overlap
const askWords = (q) => new Set(String(q || '').toLowerCase().replace(/please (send|confirm|provide|advise)|can you|could you|at its latest revision|if (possible|you can)/g, ' ').split(/[^a-z0-9&]+/).filter(w => w.length > 1 && !/^(the|and|for|of|to|a|an|in|on|from|is|are|be|it|its|this|that|with|any|do|does|not|have|has|we|you|your|our|us|what|which|do|yet|one|list)$/.test(w)));
function sameAsk(a, b) { const A = askWords(a), B = askWords(b); if (!A.size || !B.size) return String(a).toLowerCase() === String(b).toLowerCase(); let both = 0; for (const w of A) if (B.has(w)) both++; const small = Math.min(A.size, B.size); return both >= 2 && both / small >= 0.75; }
// what the client was asked for has turned up (on file, or sent): the RFI closes itself
function closeRfisFor(id, need, where = '') {
  const d = load(id); let n = 0; const want = String(need || '').trim(); if (!want) return 0;
  for (const r of d.rfis || []) { if (/closed|answered/i.test(r.status || '')) continue; if (sameAsk(r.q, want) || sameAsk(r.q, 'Please send: ' + want) || r.q.toLowerCase().includes(want.toLowerCase())) { r.status = 'Closed'; r.answer = r.answer || `On file${where ? ': ' + where : ''}`; r.closed = today(); n++; } }
  if (n) save(id, d); return n;
}
function saveRfi(id, rfi) { const d = load(id), r = d.rfis.find(x => x.no === rfi.no); if (!r) throw new Error('No such RFI'); Object.assign(r, { status: rfi.status || r.status, answer: rfi.answer ?? r.answer, q: rfi.q || r.q }); save(id, d); return d; }

// ---------- client comments (CRS) ----------
function addComments(id, comments = [], fromEmail = '') {
  const d = load(id), added = [];
  const key = (c) => `${String(c.doc || '').toUpperCase()}|${String(c.comment || '').trim().toLowerCase()}`, have = new Set(d.crs.map(key));
  for (const c of comments) { if (!c || !c.comment || have.has(key(c))) continue; have.add(key(c)); const row = { no: 'C-' + String(Math.max(0, ...d.crs.map(x => +((String(x.no || '').match(/(\d+)$/) || [])[1] || 0))) + 1).padStart(3, '0'),   /* after the highest: a tidied-away duplicate must not hand its number to the next comment */ doc: String(c.doc || ''), comment: String(c.comment), by: String(c.by || ''), response: '', agent: String(c.agent || ''), status: 'Open', raised: today(), from: fromEmail }; d.crs.push(row); added.push(row); }
  save(id, d); return added;
}
function saveCrs(id, row) { const d = load(id), r = d.crs.find(x => x.no === row.no); if (!r) throw new Error('No such comment'); Object.assign(r, { response: row.response ?? r.response, status: row.status || r.status }); save(id, d); return d; }

// ---------- master device list ----------
const MASTER_SYSTEM = `You build the MASTER DEVICE LIST for an Atomax-UK electrical / instrumentation job: one list of every field device, junction box, panel / RIO / MCC and cable, taken from the job's input documents (instrument index, IO list, tag list, P&IDs, existing BCDs and cable schedules, panel drawings). The BCDs and the cable schedule are drawn from this list, so it must be exact.
Rules (these always apply):
- Only text that is printed in a source document goes in. Copy tags, cable numbers, A-numbers and descriptions exactly as written.
- Never invent a tag, cable number, A-number, size or core count. If it is not in the documents, leave it empty and list it under "gaps".
- Every row says where it came from: document name (and revision, sheet or row if shown).
- Where two documents disagree, take the one the job rules say governs; otherwise list the disagreement under "gaps" and do not guess.
- Obvious typing mistakes in a source (e.g. a letter O for a zero) are not copied silently: give the corrected value and list it under "gaps" as a source correction.
- Follow the JOB RULES in the job context: they are specific to this job (e.g. how to match tags, which documents govern).
Reply with JSON only, no markdown:
{"devices":[{"tag":"","description":"","type":"instrument|valve|motor|switch|jb|panel|rio|mcc|other","location":"floor / area","panel":"panel or RIO it is wired to","jb":"junction box","aNumber":"","io":"channel if printed","source":"document, rev, sheet"}],
"cables":[{"no":"cable number exactly as printed","from":"tag","to":"tag","type":"e.g. BS5308 / SWA / CY","cores":"","size":"","source":"document, rev, sheet"}],
"gaps":["what is missing, disagrees or was corrected, one per line"],"summary":"one line"}`;

// a Word document's text (scope of works, fee proposal): what the master list is built from before any schedule exists
async function docxText(p) { try { const JSZip = require('jszip'); const z = await JSZip.loadAsync(fs.readFileSync(p)); const f = z.file('word/document.xml'); if (!f) return ''; const xml = await f.async('string'); return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n)); } catch { return ''; } }
const SCOPE_FILE = /scope|proposal|quot(e|ation)|requirement|specification|enquiry|\benq\d|tender|order|brief|works information/i;
async function masterContent(job, projects, checker, extraFiles = []) {
  const content = [], read = [];
  const pdfs = projects.relevantFiles(job.id, 'instrument index io list tag list bcd block cable diagram cable schedule p&id panel', { exts: ['.pdf'], max: 5 });
  const sheets = projects.relevantFiles(job.id, 'instrument index io list tag list cable schedule register', { exts: ['.xlsx', '.xlsm', '.csv'], max: 5 }).filter(p => !REGISTER_RE.test(path.basename(p)));
  for (const p of sheets) { try { const b = fs.readFileSync(p); content.push({ type: 'text', text: `WORKBOOK ${path.basename(p)}:\n` + checker.sheetsAsText(/\.csv$/i.test(p) ? checker.readCsv(b.toString('utf8')) : checker.readXlsx(b), 40000) }); read.push(path.basename(p)); } catch {} }
  for (const p of [...pdfs, ...extraFiles].slice(0, 6)) { try { content.push({ type: 'text', text: 'Document: ' + path.basename(p) }); content.push(checker.contentBlock('pdf', path.basename(p), fs.readFileSync(p))); read.push(path.basename(p)); } catch {} }
  // tender / early design: no index or schedule yet, so the list is built from the documents that define the job (scope of works, fee
  // proposal, requirements statement). Every device and circuit those documents count becomes a row, tags left empty for the design to fill.
  let tender = false;
  if (!read.length) {
    const docs = projects.relevantFiles(job.id, 'scope of works fee proposal quotation quote requirements statement specification enquiry order tender', { exts: ['.pdf', '.docx'], max: 8 }).filter(p => SCOPE_FILE.test(path.basename(p)) && !/superseded|\bold\b/i.test(p));
    for (const p of docs.slice(0, 6)) { try { if (/\.docx$/i.test(p)) { const t = (await docxText(p)).trim(); if (!t) continue; content.push({ type: 'text', text: `SCOPE DOCUMENT ${path.basename(p)}:\n${t.slice(0, 60000)}` }); } else { content.push({ type: 'text', text: 'Scope document: ' + path.basename(p) }); content.push(checker.contentBlock('pdf', path.basename(p), fs.readFileSync(p))); } read.push(path.basename(p)); } catch {} }
    if (read.length) { tender = true; content.unshift({ type: 'text', text: 'TENDER-STAGE LIST: there is no instrument index, I/O list or schedule on this job yet. Build the list from the scope documents: one row per device and per circuit they count (8 actuators = 8 device rows, 16 level instruments = 16 rows, 8 trace heating supplies = 8 rows, each with its power / control / instrument cable where the scope says there is one), description as the document words it with the system or area, "tag" and cable "no" left empty (they are not written anywhere yet) and a single line under "gaps" saying tags and cable numbers are to be allocated in design. I/O counts per device as the document states them.' }); }
  }
  return { content, read, tender };
}
async function buildMaster(id, { claudeFull, projects, checker, parseReply, note = '', run = '', stage = () => {} }) {
  const job = jobOf(id); if (!job) throw new Error('No such job');
  if (!job.folder) throw new Error('Link the job\'s project folder first: the master list is built from the documents in it');
  try { projects.gather(job.id, job.folder, { checker, dxffix: require('./dxffix') }); } catch {}   // read the folder fresh so new inputs are seen
  const { content, read, tender } = await masterContent(job, projects, checker);
  if (!read.length) throw new Error('No input documents found in the job folder (instrument index, IO list, BCDs, schedules, or a scope of works / fee proposal to start from)');
  content.push({ type: 'text', text: 'Build the master device list for this job from the documents above.' + (note ? '\nNote from the engineer: ' + note : '') });
  const system = MASTER_SYSTEM + '\n\n' + BIZ.contextFor(id, 'Lex');
  stage(`Lex is building the list from ${read.length} document${read.length === 1 ? '' : 's'}`, 35);
  let r = await claudeFull({ system, who: 'excel', skills: false, maxTokens: 24000, messages: [{ role: 'user', content }], run });
  if (r.stop === 'max_tokens') { stage('The list was long: Lex is building it again, shorter', 70); r = await claudeFull({ system: system + '\nKeep descriptions short.', who: 'excel', skills: false, maxTokens: 48000, messages: [{ role: 'user', content }], run }); }
  stage('Saving the list', 95);
  const m = parseReply(r.text);
  const d = load(id);
  d.master = { status: 'draft', tender: !!tender, builtAt: new Date().toISOString(), read, devices: (m.devices || []).slice(0, 3000), cables: (m.cables || []).slice(0, 5000), gaps: (m.gaps || []).map(String).slice(0, 200), summary: m.summary || '', incomplete: r.stop === 'max_tokens' };
  if (d.master.incomplete) d.master.gaps.unshift('INCOMPLETE: the list was cut off before the end. Build it again, or split the job by panel.');
  save(id, d);
  BIZ.log({ who: 'Lex', action: 'Built the master device list (draft)', jobId: id, detail: `${d.master.devices.length} devices · ${d.master.cables.length} cables · ${d.master.gaps.length} gaps · from ${read.join(', ')}` });
  return d.master;
}
const DEV_COLS = ['tag', 'description', 'type', 'location', 'panel', 'jb', 'aNumber', 'io', 'source'], CAB_COLS = ['no', 'from', 'to', 'type', 'cores', 'size', 'source'];
const HDR = { tag: 'Tag', description: 'Description', type: 'Type', location: 'Location', panel: 'Panel / RIO', jb: 'JB', aNumber: 'A-number', io: 'IO', source: 'Source', no: 'Cable no', from: 'From', to: 'To', cores: 'Cores', size: 'Size' };
function exportMaster(id, writeXlsx) {
  const job = jobOf(id), d = load(id); if (!d.master) throw new Error('No master list yet');
  const dir = BIZ.outputDirFor(id, 'schedules') || path.join(DIR, 'masters'); fs.mkdirSync(dir, { recursive: true });
  const base = `${job.number} MASTER DEVICE LIST${d.master.status === 'approved' ? '' : ' - DRAFT'}`;
  let p = path.join(dir, base + '.xlsx'), k = 2; while (fs.existsSync(p)) p = path.join(dir, `${base} (${k++}).xlsx`);
  fs.writeFileSync(p, writeXlsx([
    { name: 'Devices', columns: DEV_COLS.map(c => ({ header: HDR[c] })), rows: d.master.devices.map(x => DEV_COLS.map(c => x[c] || '')) },
    { name: 'Cables', columns: CAB_COLS.map(c => ({ header: HDR[c] })), rows: d.master.cables.map(x => CAB_COLS.map(c => x[c] || '')) },
    { name: 'Gaps', columns: [{ header: 'Gap / disagreement / source correction' }], rows: d.master.gaps.map(g => [g]) },
  ]));
  d.master.file = p; save(id, d); return p;
}
// Tom edited the exported workbook: read it back (Devices and Cables sheets)
function importMaster(id, file, checker) {
  const d = load(id); if (!d.master) d.master = { status: 'draft', devices: [], cables: [], gaps: [], read: [] };
  const sheets = checker.readXlsx(fs.readFileSync(file));
  const take = (name, cols) => { const sh = sheets.find(s => new RegExp(name, 'i').test(s.sheet || s.name)); if (!sh) return null; const rows = (sh.rows || []).map(r => Array.isArray(r) ? r : Array.isArray(r.c) ? r.c : Object.values(r)); const head = (rows[0] || []).map(h => String(h).toLowerCase()); const idx = cols.map(c => head.findIndex(h => h === HDR[c].toLowerCase())); return rows.slice(1).filter(r => r.some(Boolean)).map(r => Object.fromEntries(cols.map((c, i) => [c, idx[i] >= 0 ? String(r[idx[i]] ?? '').trim() : '']))); };
  const dv = take('device', DEV_COLS), cb = take('cable', CAB_COLS);
  if (!dv && !cb) throw new Error('That workbook has no Devices or Cables sheet');
  if (dv) d.master.devices = dv; if (cb) d.master.cables = cb;
  d.master.status = 'draft'; d.master.editedAt = new Date().toISOString(); save(id, d);
  BIZ.log({ who: 'Tom', action: 'Edited the master device list', jobId: id, detail: path.basename(file) });
  return d.master;
}
function approveMaster(id, who = 'Tom') {
  const d = load(id); if (!d.master) throw new Error('No master list yet');
  d.master.status = 'approved'; d.master.approvedAt = new Date().toISOString(); d.master.approvedBy = who; save(id, d);
  BIZ.log({ who, action: 'Approved the master device list', jobId: id, detail: `${d.master.devices.length} devices · ${d.master.cables.length} cables` });
  return d.master;
}

// ---------- what every agent is told ----------
const MASTER_FOR = new Set(['Dex', 'Lex', 'Cal', 'Ada', 'Wren', 'Dot']);
function context(id, who = '') {
  if (!id || !DIR) return '';
  const job = jobOf(id); if (!job) return '';
  const L = [], d = load(id);
  L.push(DN.RULES_TEXT + (load(id).area ? ` This job's area code: ${load(id).area}${load(id).disc ? ', discipline ' + load(id).disc : ''}.` : ''));
  const rules = getRules(id).trim(); if (rules) L.push('JOB RULES (specific to this job; they override general habits):\n' + rules.slice(0, 6000));
  const prof = clientProfile(job); if (prof && prof.text.trim()) L.push(`CLIENT PROFILE (${prof.name}): title block, numbering and issue format for this client:\n` + prof.text.slice(0, 5000));
  const open = d.rfis.filter(r => !/closed|answered/i.test(r.status)); if (open.length) L.push('OPEN RFIs (still waiting on the client):\n' + open.slice(0, 15).map(r => `- ${r.no} ${r.q}`).join('\n'));
  const ans = d.rfis.filter(r => /answered/i.test(r.status) && r.answer); if (ans.length) L.push('ANSWERED RFIs:\n' + ans.slice(0, 15).map(r => `- ${r.no} ${r.q} → ${r.answer}`).join('\n'));
  if (d.master && MASTER_FOR.has(who)) {
    const m = d.master, head = m.status === 'approved' ? `MASTER DEVICE LIST (APPROVED by ${m.approvedBy || 'Tom'} ${String(m.approvedAt || '').slice(0, 10)}): the single source of truth for tags and cables. Use it exactly; anything you need that is not in it is TBC.` : 'MASTER DEVICE LIST (DRAFT, NOT YET APPROVED): use it for reference only and say that it is unapproved.';
    const dev = m.devices.map(x => DEV_COLS.slice(0, 8).map(c => x[c] || '').join(' | ')).join('\n'), cab = m.cables.map(x => CAB_COLS.slice(0, 6).map(c => x[c] || '').join(' | ')).join('\n');
    L.push(`${head}\nDevices (tag | description | type | location | panel | jb | A-number | io):\n${dev}\nCables (no | from | to | type | cores | size):\n${cab}`.slice(0, 40000));
  }
  return L.length ? L.join('\n\n') : '';
}
// what Eli took from the scope documents (summary, facts, by others, where the documents disagree): shown on the job desk
function setScopeNotes(id, notes) { const d = load(id); d.scope = { ...(notes || {}), at: new Date().toISOString() }; save(id, d); return d.scope; }
function view(id) {
  const job = jobOf(id); if (!job) throw new Error('No such job');
  const d = load(id), prof = clientProfile(job), m = d.master;
  const hb = DN.habits(job);
  const bd = borderFor(job);
  return { openIssue: d.openIssue && d.openIssue.path ? { n: d.openIssue.n, path: d.openIssue.path } : null, sheetSize: d.sheetSize || '', ng: d.ng || { site: '', investment: '' }, border: d.border || 'auto', borderUsed: bd.name, borderWarning: bd.warning || '', area: d.area || hb.area || '', disc: d.disc || hb.disc || '', project: hb.project, rules: getRules(id), rulesFile: rulesPath(job), client: job.client || '', clientProfile: prof ? prof.name : '', titleBlock: titleBlockFor(job) ? path.basename(titleBlockFor(job)) : '',
    rfiRegisterFile: d.rfiRegisterFile || '', scope: d.scope || null, flow: d.flow || null, autoFlow: !!d.autoFlow, registerFile: d.registerFile, registerChecked: d.registerChecked, drawings: job.drawings, inputs: d.inputs, rfis: d.rfis, crs: d.crs,
    master: m ? { status: m.status, tender: !!m.tender, builtAt: m.builtAt, approvedAt: m.approvedAt, devices: m.devices.length, cables: m.cables.length, gaps: m.gaps, read: m.read, file: m.file || '', summary: m.summary, preview: m.cables.slice(0, 40), incomplete: !!m.incomplete } : null };
}
// the RFI register on the house template, kept in the job folder (003 Technical Queries / 9.3 RFI) and rewritten whenever the RFIs change:
// Eli's questions from emails and scope documents land in it as soon as he raises them. Numbered <job>-<area>-01-01-0003 like the template.
async function writeRfiRegister(id, { templateDir = '', people = {} } = {}) {
  const job = jobOf(id), d = load(id); if (!job || !job.folder || !fs.existsSync(job.folder) || !(d.rfis || []).length) return '';
  const dir = BIZ.outputDirFor(id, 'rfi') || path.join(job.folder, '003 Technical Queries'); fs.mkdirSync(dir, { recursive: true });
  const area = (d.area || '').trim() || '0000';
  const row = (job.drawings || []).find(r => /\b(rfi|request for information|technical quer(y|ies))\b/i.test(r.title || '') && /\b(register|log|list|schedule)\b/i.test(r.title || ''));   // the job's own RFI register row, when it has one
  const docNo = row ? row.no : `${job.number}-${area}-01-01-0003`;
  const carried = d.rfiRegisterFile && path.dirname(d.rfiRegisterFile) === dir ? path.basename(d.rfiRegisterFile) : '';   // a register brought over from a handoff: replaced by this one, to Archive
  const prev = fs.readdirSync(dir).filter(n => (/RFI REGISTER.*\.xlsx$/i.test(n) || n === carried) && !/^~\$/.test(n));
  const rev = d.rfiRegisterRev || 'P01';
  const file = path.join(dir, `${docNo} - RFI REGISTER ${rev}.xlsx`);
  const R = require('./rfireg'), tpl = R.templatePath(templateDir);
  const buf = await R.fill(tpl, job, { docNo, compiledBy: people.drawn || d.rfiCompiledBy || 'Eli (Atomax-UK)', revision: rev, issueDate: d.rfiRegisterIssued || undefined, discipline: d.disc === '05' ? 'E&I' : 'Electrical', issueTo: job.client || '' }, d.rfis.map(r => ({ ...r, to: r.to || job.client || '' })));
  for (const n of prev) if (path.join(dir, n) !== file && !/\(archive\)/i.test(n)) { try { const a = path.join(dir, 'Archive'); fs.mkdirSync(a, { recursive: true }); fs.renameSync(path.join(dir, n), path.join(a, n)); } catch {} }   // an older copy under another name goes to Archive
  fs.writeFileSync(file, buf); d.rfiRegisterFile = file; d.rfiRegisterIssued = d.rfiRegisterIssued || new Date().toISOString(); save(id, d);
  return file;
}
function exportSheet(id, kind, writeXlsx) {
  const job = jobOf(id), d = load(id);
  const dir = BIZ.outputDirFor(id, kind === 'crs' ? 'crs' : 'rfi') || path.join(DIR, 'exports'); fs.mkdirSync(dir, { recursive: true });
  const spec = kind === 'crs'
    ? { base: `${job.number} Comment Response Sheet`, columns: ['No', 'Document', 'Comment', 'By', 'Atomax response', 'Status'], rows: d.crs.map(c => [c.no, c.doc, c.comment, c.by, c.response, c.status]) }
    : { base: `${job.number} RFI Register`, columns: ['No', 'Question', 'Raised', 'Status', 'Answer'], rows: d.rfis.map(r => [r.no, r.q, r.raised, r.status, r.answer]) };
  let p = path.join(dir, spec.base + '.xlsx'), k = 2; while (fs.existsSync(p)) p = path.join(dir, `${spec.base} (${k++}).xlsx`);
  fs.writeFileSync(p, writeXlsx([{ name: kind === 'crs' ? 'CRS' : 'RFIs', columns: spec.columns.map(h => ({ header: h })), rows: spec.rows }]));
  return p;
}
const masterOf = (id) => load(id).master;
// which border a job's drawings go on. Set per job on the job desk; "auto" goes by the client: BGEN jobs on the BGEN border, National Grid jobs on the
// National Grid border (a title block DXF for it in the File Room Clients cabinet), everything else on the Atomax border.
const BORDER_KEYS = ['auto', 'atomax', 'bgen', 'pbe', 'ng', 'client'];
function setBorder(id, key, size, ng) { const d = load(id); if (ng) d.ng = { site: String(ng.site || '').trim(), investment: String(ng.investment || '').trim() }; if (key != null) d.border = BORDER_KEYS.includes(key) ? key : 'auto'; if (size != null) d.sheetSize = /^A[0-3]$/.test(size) ? size : ''; return save(id, d); }
function borderFor(job) {
  const d = job ? load(job.id) : {}, set = d.border || 'auto', who = job ? `${job.client || ''} ${job.name || ''}` : '';
  const clientDxf = job ? titleBlockFor(job) : '';
  let key = set;
  if (set === 'auto') key = /national grid|\bnget?\b/i.test(who) ? 'ng' : /\bb-?gen\b|boulting/i.test(who) ? 'bgen' : /\bpbe\b/i.test(who) ? 'pbe' : clientDxf ? 'client' : 'atomax';
  // National Grid: the NG A0 sheet (title box with the NG and originator numbers, issue boxes along the bottom, CDM / SHE box)
  if (key === 'ng') return { key: 'ng', name: 'National Grid A0', set, size: 'A0' };
  if (key === 'client') {
    if (clientDxf) return { key: 'client', template: clientDxf, name: path.basename(clientDxf), set };
    return { key: 'atomax', name: 'Atomax A1', set, warning: 'No client border DXF found in the Clients cabinet. Drawn on the Atomax border.' };
  }
  const size = d.sheetSize || '';
  return { key: size ? `${key}-${size}` : key, name: `${{ atomax: 'Atomax', bgen: 'BGEN', pbe: 'PBE Group' }[key] || 'Atomax'} ${size || '(sheet size to fit)'}`, set, size };
}

const saveRaw = (id, d) => save(id, d);
module.exports = { sameDeliverable, dwords, titleFor, closeRfisFor, sameAsk, writeRfiRegister, kindTag, GROUPS, setCount, setBase, setScopeNotes, tidyRows, kindKey, renameRow, setBorder, borderFor, saveRaw, setNumbering, init, load, getRules, setRules, addCorrection, clientProfile, titleBlockFor, findRegisters, readRegister, checkRegister, makeRegister, proposeNumber, addDeliverables, addInputs, saveRfi, addComments, saveCrs, buildMaster, exportMaster, importMaster, approveMaster, context, view, exportSheet, masterOf, MASTER_SYSTEM, RULES_FILE };
