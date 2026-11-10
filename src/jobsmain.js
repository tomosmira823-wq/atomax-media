// The Jobs screen: one place per job. Each deliverable on the job's drawing list is made by the right agent, checked by Cal,
// issued, and revised when comments come back. "Waiting on you" gathers everything across jobs that needs Tom.
'use strict';
const fs = require('fs');
const path = require('path');

// which agent makes a deliverable, from its QS 006 type code (or its title)
const EARTH_DOC = /\b(study|studies|assessment|report|design basis|calculations?|epr|analysis|specification)\b/i;
const RFI_REG = /\b(rfi|request for information|technical quer(y|ies))\b.*\b(register|log|list|schedule)\b|\b(register|log)\b.*\b(rfis?|requests? for information)\b/i;
function kindOf(d) {
  const t = (String(d.no).match(/-(\d{2})-\d{4}(?:\b|_)/) || [])[1] || '';
  const s = (d.title || '') + ' ' + t;
  if (t === '71' || /\bbcd\b|block cable/i.test(s)) return { agent: 'Dex', kind: 'bcd', verb: 'Draw the BCD' };
  if (t === '70' || /single line|\bsld\b/i.test(s)) return { agent: 'Dex', kind: 'sld', verb: 'Draw the SLD' };
  // QS 006 74 is "earthing report & calculation": a study or report on earthing is a document for Wren, only an earthing drawing / layout is Dex's
  if ((t === '74' || /earthing/i.test(s)) && !EARTH_DOC.test(d.title || '')) return { agent: 'Dex', kind: 'earthing', verb: 'Draw the earthing drawing' };
  if (RFI_REG.test(d.title || '')) return { agent: 'Eli', kind: 'rfi', verb: 'Write the' };   // the RFI register is written from the job's RFIs, not from the master list
  if (/\b(survey|site visit|point cloud|laser scan|3d model|modelling|inspection|attendance|witness|package)\b/i.test(s)) return { agent: '', kind: 'manual', verb: '' };   // site work and models: nobody in the office makes those
  if (t === '23' || /\b(schedules?|registers?|lists?)\b/i.test(s)) return { agent: 'Lex', kind: 'schedule', verb: 'Make the' };   // whole words: a "registered point cloud" is not a register
  if (['00', '03', '05', '08', '09', '15', '20', '21', '22'].includes(t) || /report|spec|calc|method|rams|itp|query|stud(y|ies)|assessment|analysis|design basis/i.test(s) || (t === '74' && EARTH_DOC.test(d.title || ''))) return { agent: 'Wren', kind: 'document', verb: 'Write the' };
  return { agent: '', kind: 'manual', verb: '' };   // termination / interconnection / layouts: not made by an agent yet
}

const QS = /X\d{4,6}(?:-[A-Z0-9]{2,4}){2,5}-\d{4}/i;   // the drawing number however the job writes it
// the files in the job folder that ARE a drawing on the list: by the client's number (X11475-BGN-ZZ-XX-DR-E-7153), our number (32_BG_0006)
// or, failing those, the title; never Archive / Superseded copies. The latest revision in the file name wins. Tells the tab what can be
// revved now (a DXF) and what needs exporting from AutoCAD first (DWG only)
function jobFiles(jobId, { exceptDir = '' } = {}) {
  try {
    const PR = require('./projects'); let p = PR.load(jobId); if (p && p.folder) p = PR.refreshFiles(jobId, p.folder) || p;
    const ex = exceptDir ? exceptDir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') + '/' : '';
    // in the issue being built, only what the app wrote there is left out (its own output is never a source); a DXF Tom put in a
    // hand-made issue folder before the app opened it is his and stays a source
    let since = 0; try { const oi = require('./jobdesk').load(jobId).openIssue; if (oi && oi.found && oi.openedAt) since = Date.parse(oi.openedAt) - 5000; } catch {}
    return (p && p.files || []).map(f => ({ rel: f.rel.replace(/\\/g, '/'), name: f.rel.split(/[\\/]/).pop(), mtime: f.mtime || 0, abs: path.join(p.folder || '', f.rel) }))
      .filter(f => !/(^|\/)(archive|superseded|markups?|old|fixed)(\/|$)/i.test(f.rel) && !(ex && f.abs.replace(/\\/g, '/').toLowerCase().startsWith(ex) && (!since || f.mtime >= since)));
  } catch (e) { console.error('jobFiles', e); return []; }
}
const revInName = (n) => { const m = String(n).match(/[\s_-]([PCAX]\d{2})(?=[\s_.)-]|$)/i); return m ? m[1].toUpperCase() : ''; };
// the drawing number as the sheet's own title block writes it, when it is this number with different zero padding in the last part
// (X130726-0000-06-72-0012 on the sheet for the register's -00012); '' when the sheet agrees or does not say
// the new issue box's remark for a revision made to comments, the way the office writes it ("Updated to incorporate SPEN comments", the
// block diagram's P02): whose comments, from the sender's email when it is a known client, else "client"
function remarkFor(comments) {
  const KNOWN = [[/spenergynetworks|scottishpower/i, 'SPEN'], [/nationalgrid/i, 'National Grid'], [/ukpowernetworks/i, 'UKPN'], [/enwl|electricitynorthwest/i, 'ENWL'], [/nationalgrid\.co\.uk|westernpower|nged/i, 'NGED'], [/ssen|sse\.com/i, 'SSEN'], [/northernpowergrid/i, 'Northern Powergrid']];
  const whose = new Set();
  for (const c of comments || []) { if (/^tom$/i.test(c.by || '')) continue; const k = KNOWN.find(([re]) => re.test(String(c.from || ''))); whose.add(k ? k[1] : 'client'); }
  if (!whose.size) return 'Updated to incorporate comments';
  return `Updated to incorporate ${[...whose].join(' / ')} comments`;
}
function sheetNumber(buf, no) {
  const canon = (t) => String(t || '').trim().toUpperCase().replace(/(\d+)$/, (m) => String(+m));
  try {
    const want = canon(no); if (!want) return '';
    for (const e of require('./dxffix').parseDxf(buf).ents) { const t = String(e.plain || '').trim(); if (t && t.toUpperCase() !== String(no).toUpperCase() && canon(t) === want && /^[A-Z0-9][A-Z0-9-]+\d$/i.test(t)) return t; }
  } catch {}
  return '';
}
function sourceFor(d, files) {
  const keys = [d.no, d.alt].filter(Boolean).map(k => String(k).toUpperCase().replace(/[^A-Z0-9]+/g, ''));
  const norm = (n) => String(n).toUpperCase().replace(/\.[A-Z0-9]+$/, '').replace(/[^A-Z0-9]+/g, '');
  // the number must be the whole drawing number in the name, not the start of a longer one: -72-0001 is not -72-00012 (Five Fords, 9 Nov)
  const has = (n, k) => { let at = n.indexOf(k); while (at >= 0) { if (!/[0-9]/.test(n.charAt(at + k.length)) && !/[0-9]/.test(n.charAt(at - 1) || '')) return true; at = n.indexOf(k, at + 1); } return false; };
  let mine = files.filter(f => { const n = norm(f.name); return keys.some(k => k.length >= 6 && has(n, k)); });
  // an NG number whose type code differs on the file (the register says RP-E-7005, the file was saved as SP-E-7005): the file is still the
  // document's; the rev up renames it to the register's number
  let fileNo = '';
  if (!mine.length) { const m = String(d.no).match(/^(X\d{5,6}(?:-[A-Z0-9]{1,4}){3})-([A-Z]{2})-([A-Z])-(\d{4})$/i); if (m) { const re = new RegExp(`${m[1]}-([A-Z]{2})-${m[3]}-${m[4]}`, 'i'); mine = files.filter(f => re.test(f.name)); const hit = mine[0] && mine[0].name.match(re); if (hit) fileNo = hit[0].toUpperCase(); } }
  // by title only when the file carries no drawing number of its own (a file numbered for another drawing is that drawing's)
  const numbered = (n) => /X\d{5,6}(?:-[A-Z0-9]{1,4}){1,6}-\d{3,4}|\b\d{2}_[A-Z]{2}_\d{4}\b/i.test(n);
  if (!mine.length && d.title) { const words = String(d.title).toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 2 && !/^(THE|AND|FOR|NEW|DIAGRAM|DRAWING|LAYOUT|PROPOSED)$/.test(w)); if (words.length >= 2) mine = files.filter(f => /\.(dxf|dwg|pdf)$/i.test(f.name) && !numbered(f.name) && words.every(w => f.name.toUpperCase().includes(w))); }
  const pick = (ext) => mine.filter(f => new RegExp('\\.' + ext + '$', 'i').test(f.name)).sort((a, b) => (revInName(b.name) > revInName(a.name) ? 1 : revInName(b.name) < revInName(a.name) ? -1 : 0) || b.mtime - a.mtime)[0];
  const dxf = pick('dxf'), dwg = pick('dwg'), pdf = pick('pdf'), docx = pick('docx'), xlsx = pick('xlsx');
  return { dxf: dxf ? dxf.rel : '', dwg: dwg ? dwg.rel : '', pdf: pdf ? pdf.rel : '', docx: docx ? docx.rel : '', xlsx: xlsx ? xlsx.rel : '', fileNo, fileRev: revInName((dxf || dwg || docx || xlsx || pdf || {}).name || '') };
}
// the group a row sits in on the Deliverables tab: a numbered drawing (QS 006 disciplines 70-79 are drawings, 23 a schedule) or by its words
const groupOf = (d) => { const t = (String(d.no).match(/-(\d{2})-\d{4,5}(?:\b|_)/) || [])[1] || ''; if (/^7\d$/.test(t) && !(t === '74' && EARTH_DOC.test(d.title || ''))) return 'drawing';   /* 74 is the earthing report too */ if (t === '23') return 'schedule'; return require('./jobdesk').kindTag(d.type || '', d.title).group; };
const realNo = (d) => /^TBC-/i.test(d.no) ? ((String(d.title).match(QS) || [])[0] || '') : d.no;
const cleanTitle = (d) => String(d.title).replace(QS, '').replace(/\(\s*\)/g, '').replace(/\s+P\d{1,2}\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
const AGENT_ID = { Dex: 'dex', Lex: 'excel', Wren: 'word' };

function register({ ipcMain, HANDLERS, BIZ, claudeFull, getAgents }) {
  const desk = require('./jobdesk');
  const call = (ch, args) => { const h = HANDLERS[ch]; if (!h) throw new Error('Not available: ' + ch); return h({ sender: null }, args); };
  const jobOf = (id) => { const j = BIZ.data().jobs.find(x => x.id === id); if (!j) throw new Error('No such job'); return j; };
  // a make or check left 'working' by an earlier run of the app (closed or updated mid-job) is stopped, so it can be made again
  const RUN = 'r' + Date.now().toString(36);
  const delivOf = (id) => { const d = desk.load(id), dl = d.deliv || {}; let fixed = false;
    for (const w of Object.values(dl)) {
      if (w.status === 'working' && w.run !== RUN) { w.status = 'failed'; w.summary = 'Stopped because the app closed or updated while this was being made. Press Make again.'; fixed = true; }
      if (w.check && w.check.status === 'working' && w.check.run !== RUN) { w.check = null; fixed = true; }
    }
    if (fixed) desk.saveRaw(id, d); return dl; };
  const setDeliv = (id, no, patch) => { const d = desk.load(id); d.deliv = d.deliv || {}; d.deliv[no] = { ...(d.deliv[no] || {}), ...patch, at: new Date().toISOString() }; desk.saveRaw(id, d); return d.deliv[no]; };
  const runs = require('./runs');
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw new Error(runs.plain(e)); } };

  function overview(jobId) {
    { // a TBC number on the list with the real drawing number written in its title: the list gets the real number
      const job = jobOf(jobId); let changed = false; const dd = desk.load(jobId);
      for (const d of job.drawings) { const real = realNo(d); if (/^TBC-/i.test(d.no) && real && !job.drawings.some(x => x !== d && x.no.toUpperCase() === real.toUpperCase())) { if (dd.deliv && dd.deliv[d.no]) { dd.deliv[real] = dd.deliv[d.no]; delete dd.deliv[d.no]; } d.no = real; d.title = cleanTitle(d) || d.title; changed = true; } }
      if (changed) { desk.saveRaw(jobId, dd); require('./business').saveJob(BIZ.data(), job, 'Office'); BIZ.store.save(); }
    }
    // the job's drawing register is read when the job opens: never checked, checked by an older version (the master transmittal was not a
    // register before 1.34.19), or the register file changed since. Cheap when nothing changed (one stat).
    try { const dd = desk.load(jobId), j0 = jobOf(jobId); if (j0.folder && fs.existsSync(j0.folder)) { const chk = Date.parse(dd.registerChecked || '') || 0; let stale = !chk || chk < Date.parse('2026-11-05T13:20:00Z'); if (!stale && dd.registerFile) { try { stale = fs.statSync(dd.registerFile).mtimeMs > chk; } catch { stale = true; } } if (!stale && !dd.registerFile && Date.now() - chk > 10 * 60e3) stale = true; if (stale) desk.checkRegister(jobId, require('./checker')); } } catch {}
    try { desk.tidyRows(jobId); } catch {}   // one row per drawing (a TBC row and the register's numbered row of the same kind are the same drawing)
    const job = jobOf(jobId), V = desk.view(jobId), dl = delivOf(jobId);
    try { if (job.folder) require('./projects').refreshFiles(jobId, job.folder); } catch {}   // a job never read, or read over a minute ago: its file list is brought up to date first
    const openDir = (V.openIssue && V.openIssue.path) || (desk.load(jobId).openIssue || {}).path || '';   // the issue being built: its files are Dex's outputs, never a row's source
    const files = jobFiles(jobId, { exceptDir: openDir }), anyIssued = job.drawings.some(x => x.rev);   // a job with issued drawings: a numbered row with no rev and no file is a reserved number, not work to do
    // a made file renamed by hand in its folder (7142_P04 -> 7142 P04) is still the row's file: the record follows it
    for (const w of Object.values(dl)) if (w && Array.isArray(w.files)) w.files = w.files.map(f => { if (!f || fs.existsSync(f)) return f; const dir = path.dirname(f), base = path.basename(f); const alt = base.replace(/_([PCAX]\d{2})(\.[a-z0-9]+)$/i, ' $1$2'); const alt2 = base.replace(/ ([PCAX]\d{2})(\.[a-z0-9]+)$/i, '_$1$2'); for (const a of [alt, alt2]) if (a !== base && fs.existsSync(path.join(dir, a))) return path.join(dir, a); return f; });
    const rows = job.drawings.filter(d => !/cancel|superseded/i.test(d.status)).map(d => { const src = sourceFor(d, files), k = kindOf(d); const reserved = !d.rev && !src.dxf && !src.dwg && !src.pdf && !dl[d.no] && !/^TBC-/i.test(d.no) && anyIssued; return { ...d, ...k, group: reserved ? 'reserved' : (k.kind === 'earthing' || k.agent !== 'Wren' ? (d.group || groupOf(d)) : groupOf(d)), num: realNo(d) || d.no, ctitle: desk.titleFor(d.no, cleanTitle(d) || d.title, src.dxf || src.dwg || src.pdf || src.docx || src.xlsx || ''), work: dl[d.no] || null, src, canRev: !reserved && !!(k.agent === 'Dex' || src.dxf || src.docx || src.xlsx) }; });   // reserved: a number in the register never issued and with no file: listed, not counted
    const DR = require('./docreq'), ng = DR.ngJob(rows), needNg = ng ? DR.needsRequest(rows).map(r => r.no) : [];
    return { job: { id: job.id, number: job.number, name: job.name, client: job.client, folder: job.folder, status: job.status }, desk: V, rows, needsMaster: rows.some(r => r.kind === 'bcd' || r.kind === 'schedule'), ngJob: ng, needNg, dex: dexSays(rows, V) };
  }
  // Dex speaks up on the job: for every drawing with changes logged against it, what he can do about them and what he needs. Plain and
  // deterministic (what is on file decides), so it is there the moment the comments are filed, before anything is pressed.
  function dexSays(rows, V) {
    const openFor = (r) => (V.crs || []).filter(c => (c.doc === r.no || (c.doc === '*' && r.group !== 'reserved')) && !/responded|closed/i.test(c.status || ''));
    const out = [];
    for (const r of rows) {
      if (!(r.group === 'drawing' || r.agent === 'Dex') || r.group === 'reserved') continue;
      const open = openFor(r); if (!open.length) continue;
      const n = open.length, what = `${n} change${n === 1 ? '' : 's'}`, num = r.num || r.no, busy = r.work && r.work.status === 'working';
      const stuck = open.filter(c => /^Dex couldn't/.test(c.response || ''));   // asked already, and said he can't by editing text
      if (busy) out.push({ no: r.no, can: 'working', say: `${num}: I'm on it now.` });
      else if (stuck.length === n) out.push({ no: r.no, can: 'needsyou', say: `${num}: ${n === 1 ? 'the change left' : `the ${n} changes left`} I can't do by editing text — ${stuck.map(c => `"${c.comment}"`).join(', ')}. Do ${n === 1 ? 'it' : 'them'} in AutoCAD and I'll rev it up, or tell me exactly what text to change.` });
      else if (r.work && r.work.status === 'needs you' && r.work.summary) out.push({ no: r.no, can: 'needsyou', say: `${num}: ${r.work.summary.replace(/^Dex: /, '')}` });
      else if (r.src && r.src.dxf) out.push({ no: r.no, can: 'edit', say: `${num}: ${what} logged. I've got ${r.src.dxf.split('/').pop()} — I'll make the text edits (tags, names, text colour) on it and rev it up into the issue folder. Press Revise.` });
      else if (r.src && r.src.dwg) out.push({ no: r.no, can: 'edit', say: `${num}: ${what} logged. Only ${r.src.dwg.split('/').pop()} is on file, so I'll save it as DXF with AutoCAD first, then make the text edits and rev it up. Press Revise.` });
      else if (r.agent === 'Dex') out.push({ no: r.no, can: 'redraw', say: `${num}: ${what} logged and there's no drawing file for it in the job folder. I'd have to draw it again from the job's inputs. Put the DXF in the folder and press ↻ if you want me to edit it instead.` });
      else out.push({ no: r.no, can: 'nothing', say: `${num}: ${what} logged, but there's no file for it in the job folder and it's not a kind I draw. Put the DXF in the folder and press ↻.` });
    }
    return out;
  }

  // make one deliverable with the agent for its kind
  // what the agent will be asked, and what it will read: shown on the row before it starts
  function plan({ jobId, no }) {
    const job = jobOf(jobId), d = job.drawings.find(x => x.no === no); if (!d) throw new Error('Not on the drawing list: ' + no);
    const k = kindOf(d), num = realNo(d), title = cleanTitle(d);
    const request = k.agent === 'Dex' ? `${k.verb}: ${title}${num ? ` (drawing ${num})` : ''}. Use the job's inputs, every item on them for this drawing and nothing else.`
      : k.agent === 'Lex' ? `${k.verb} ${title} for job ${job.number}${num ? ` (document ${num})` : ''} from the job's inputs and the approved master device list. House template from your skill.`
      : `${k.verb} ${title} for job ${job.number}${num ? ` (document ${num})` : ''} from the job's inputs.`;
    const want = k.kind === 'bcd' ? 'cable schedule instrument index io list bcd' : k.kind === 'sld' ? 'single line sld load schedule cable schedule protection' : k.kind === 'earthing' ? 'earthing cable schedule' : k.kind === 'schedule' ? 'cable schedule instrument index io list' : title;
    const inputs = job.folder ? BIZ.projects.relevantFiles(job.id, title + ' ' + want, { exts: ['.pdf', '.xlsx', '.xlsm', '.csv'], max: 6 }).map(p => path.basename(p)) : [];
    // drawn / checked / approved: this drawing's from last time, else the last ones used on the job
    const dl = delivOf(jobId), people = (dl[no] || {}).people || Object.values(dl).map(x => x.people).filter(Boolean).pop() || null;
    const rev = (dl[no] || {}).files ? ((dl[no] || {}).rev || 'P01') : '';
    return { agent: k.agent, agentId: AGENT_ID[k.agent] || '', kind: k.kind, number: num, title, request, inputs, folder: job.folder || '', people, rev, nextRev: rev ? require('./docnumber').nextRev(rev) : 'P01' };
  }
  async function make({ jobId, no, answers = [], note = '', revision = null, request: asked = '', skills, people }) {
    const job = jobOf(jobId), d = job.drawings.find(x => x.no === no); if (!d) throw new Error('Not on the drawing list: ' + no);
    const k = kindOf(d); if (!k.agent) throw new Error(`No agent makes ${d.title} yet. Do this one by hand.`);
    if (k.kind === 'rfi') {   // the job's RFIs, on the Atomax RFI register under this row's number
      if (!(desk.load(jobId).rfis || []).length) throw new Error('There are no RFIs on this job yet: raise them on Inputs & setup (or ask Eli), then make the register.');
      const file = await desk.writeRfiRegister(jobId, { templateDir: BIZ.projects.templateDir(), people: people || {} }); if (!file) throw new Error('The RFI register needs the job folder linked first.');
      return setDeliv(jobId, no, { status: 'made', rev: desk.load(jobId).rfiRegisterRev || 'P01', files: [file], by: 'Eli', summary: `RFI register written from the job's ${desk.load(jobId).rfis.length} RFIs` });
    }
    const prev = delivOf(jobId)[no] || {};
    if (answers && answers.length) answers = [...(prev.answers || []).filter(p => !answers.some(a => a.q === p.q)), ...answers]; else answers = prev.answers || [];   // answers given once are kept for remakes and revisions
    people = people || prev.people || {};   // drawn / checked / approved, kept for remakes and revisions
    // open items from Cal's check (and any other open comment) on a remake at the same revision: fixed in this make, then marked done
    let calOpen = [];
    if (!revision) { try { calOpen = (desk.load(jobId).crs || []).filter(c => c.doc === no && !/responded|closed/i.test(c.status || '')); } catch {} if (calOpen.length) note = [note, 'Fix these check findings and comments (keep everything else as it was): ' + calOpen.map(c => c.comment).join(' | ')].filter(Boolean).join(' '); }
    const R = runs.start({ kind: `${k.kind}:${revision ? 'revision' : 'make'}`, who: k.agent, jobId, no });
    setDeliv(jobId, no, { status: 'working', run: RUN, runId: R.id, agent: k.agent, summary: `${k.agent} is on it`, answers, people });
    try {
      let r, files = [], pdfs = [];
      if (k.agent === 'Dex') {
        const P = plan({ jobId, no }); r = await call('dex:make', { run: R.id, jobId, kind: P.kind, drawingNumber: P.number, request: (asked || P.request) + (note ? ' ' + note : ''), answers, revision, skills, drawn: people.drawn || '', checked: people.checked || '', approved: people.approved || '' });
        // a TBC row that Dex numbered when he made it (from the register / the job's QS 006 numbering): the row takes that number now
        if (/^TBC-/i.test(no) && QS.test(String(r.drawingNumber || '')) && desk.renameRow(jobId, no, r.drawingNumber)) no = r.drawingNumber;
        if (r.questions) { runs.finish(R.id, { ok: true }); return setDeliv(jobId, no, { status: 'needs you', questions: r.questions, summary: 'Dex has questions' }); }
        files = (r.sheets && r.sheets.length ? r.sheets.map(s => s.path) : [r.path]).filter(Boolean); pdfs = r.pdfs || [];
      } else if (k.agent === 'Lex') {
        runs.stage(R.id, 'Lex is building the workbook', 20); r = await call('o365:excel', { run: R.id, jobId, request: (asked || plan({ jobId, no }).request) + (note ? ' ' + note : ''), skills });
        files = [r.path].filter(Boolean);
      } else {
        runs.stage(R.id, 'writing the document', 20); r = await call('o365:word', { run: R.id, jobId, request: (asked || plan({ jobId, no }).request) + (note ? ' ' + note : ''), skills });
        files = [r.path].filter(Boolean);
      }
      if (calOpen.length && !r.incomplete && !r.questions) for (const c of calOpen) { try { desk.saveCrs(jobId, { no: c.no, status: 'Responded', response: `Fixed in ${r.revision || d.rev || 'the remake'}` }); } catch {} }
      runs.finish(R.id, { ok: true });
      return setDeliv(jobId, no, { status: r.incomplete ? 'needs you' : 'made', questions: null, check: null, files, pdfs, given: { file: r.givenFile || '', request: r.request || '', skills: r.skills || [], read: r.read || [], fromSchedule: r.fromSchedule || [], queries: r.queries || [], warnings: r.warnings || [], at: new Date().toISOString() }, rev: r.revision || d.rev || '', archived: r.archived || 0, summary: (r.incomplete ? 'CUT SHORT: ' : '') + (r.summary || 'Made') + (r.fromSchedule && r.fromSchedule.length ? ` · ${r.fromSchedule.length} value(s) matched to the schedule` : '') + (r.queries && r.queries.length ? ` · ${r.queries.length} question(s) to the RFI register` : '') + (r.warnings && r.warnings.length ? ' · LAYOUT: ' + r.warnings.join('; ') : ''), notes: r.notes || [], warning: r.borderWarning || '' });
    } catch (e) { const stopped = runs.aborted(R.id); runs.finish(R.id, { ok: false, error: runs.plain(e) }); setDeliv(jobId, no, { status: stopped ? 'stopped' : 'failed', summary: stopped ? 'Stopped. Nothing was changed; press Make to start again.' : runs.plain(e) }); throw e; }
  }

  // Cal checks the made drawings against the job's schedule (made by Lex, else the schedule in the job folder)
  async function check({ jobId, nos }) {
    const job = jobOf(jobId), dl = delivOf(jobId);
    const sched = job.drawings.filter(d => kindOf(d).kind === 'schedule').map(d => dl[d.no]).find(w => w && w.files && w.files[0] && fs.existsSync(w.files[0]));
    let schedule = sched && sched.files[0];
    if (!schedule) schedule = (BIZ.projects.relevantFiles(job.id, 'cable schedule', { exts: ['.xlsx', '.xlsm', '.pdf'], max: 1 }) || [])[0];
    if (!schedule) throw new Error('No cable schedule to check against: make the schedule first or put it in the job folder');
    const targets = (nos && nos.length ? nos : Object.keys(dl)).filter(n => dl[n] && dl[n].files && kindOf(job.drawings.find(d => d.no === n) || { no: n }).agent === 'Dex');
    // the DXF Dex made, not its PDF: every word exact and each cable's ends traced from the lines (a PDF of an A0 sheet is too small to read)
    const drawings = targets.flatMap(n => { const dx = (dl[n].files || []).filter(p => /\.dxf$/i.test(p) && fs.existsSync(p)); return dx.length ? dx : [...(dl[n].pdfs || []), ...(dl[n].files || [])]; }).filter(p => fs.existsSync(p));
    if (!drawings.length) throw new Error('No drawings made yet to check');
    const enc = (p) => ({ name: path.basename(p), path: p, base64: fs.readFileSync(p).toString('base64') });
    const R = runs.start({ kind: 'check', who: 'Cal', jobId, no: targets.join(',') }); runs.stage(R.id, 'Cal is reading the schedule and the drawings', 10);
    targets.forEach(n => setDeliv(jobId, n, { check: { status: 'working', run: RUN } }));
    let r; try { r = await call('check:run', { run: R.id, agent: { id: 'cal' }, schedule: enc(schedule), drawings: drawings.map(enc), jobId, note: 'Check both ways and say exactly what was covered.' });
    } catch (e) { runs.finish(R.id, { ok: false, error: runs.plain(e) }); targets.forEach(n => setDeliv(jobId, n, { check: null })); throw e; }
    runs.finish(R.id, { ok: true });
    const findings = r.findings || [], dir = r.markups && r.markups.dir || '';
    for (const n of targets) { const mine = findings.filter(f => JSON.stringify(f).includes(n)); setDeliv(jobId, n, { check: { status: findings.length ? 'needs you' : 'passed', headline: r.headline || '', count: mine.length || findings.length, markups: dir } });
      // Cal's findings go on the Comments tab against the drawing, like a client's, so Make again / Revision pick them up and Tom can close the ones he disagrees with
      try { const V = desk.load(jobId), have = new Set((V.crs || []).filter(c => c.doc === n && c.by === 'Cal').map(c => c.comment));
        const items = (mine.length ? mine : findings).map(f => String(f.text || '') + (f.confirm ? ` [CONFIRM${f.reason ? ': ' + f.reason : ''}]` : '')).filter(t => t && !have.has(t));
        if (items.length) desk.addComments(jobId, items.map(t => ({ doc: n, comment: t, by: 'Cal', agent: 'dex' })), 'Cal check'); } catch {} }
    return { headline: r.headline || '', findings: findings.length, markups: dir, schedule: path.basename(schedule) };
  }

  // everything across the jobs that needs Tom
  function waiting() {
    const out = [];
    for (const job of BIZ.data().jobs.filter(j => j.status !== 'Closed')) {
      let V; try { V = desk.view(job.id); } catch { continue; }
      const tag = { jobId: job.id, job: `${job.number} ${job.name || ''}`.trim() };
      if (V.master && V.master.status !== 'approved') out.push({ ...tag, kind: 'master', text: `Master device list to check and approve (${V.master.devices} devices, ${V.master.cables} cables)` });
      for (const [no, w] of Object.entries(delivOf(job.id))) {
        if (w.status === 'needs you' && w.questions) out.push({ ...tag, kind: 'questions', no, text: `${w.agent} has questions on ${no}` });
        else if (w.status === 'failed') out.push({ ...tag, kind: 'failed', no, text: `${no} failed: ${w.summary}` });
        if (w.check && w.check.status === 'needs you') out.push({ ...tag, kind: 'check', no, text: `Cal found ${w.check.count} thing(s) to look at on ${no}` });
      }
      const openR = (V.rfis || []).filter(r => !/answered|closed/i.test(r.status || '')); if (openR.length) out.push({ ...tag, kind: 'rfi', text: `${openR.length} RFI(s) waiting on answers` });
      const openC = (V.crs || []).filter(c => !/responded|closed/i.test(c.status || '')); if (openC.length) out.push({ ...tag, kind: 'comments', text: `${openC.length} client comment(s) to respond to` });
      if (!job.folder) out.push({ ...tag, kind: 'folder', text: 'No project folder linked' });
    }
    return out;
  }

  // a marked-up drawing (red pen, a client's PDF comments, a scan) dropped on the drawing's row: the markups read into the Comments tab
  async function readMarkup({ jobId, no, file }) {
    const job = jobOf(jobId); if (!file || !fs.existsSync(file)) throw new Error('That file is not there any more');
    const ext = path.extname(file).toLowerCase(), kind = ext === '.pdf' ? 'pdf' : ['.png', '.jpg', '.jpeg'].includes(ext) ? 'image' : '';
    if (!kind) throw new Error('Drop a PDF or a picture of the marked-up drawing');
    const buf = fs.readFileSync(file); if (buf.length > 24 * 1024 * 1024) throw new Error('That file is too big to read (over 24 MB). Save a smaller PDF.');
    const checker = require('./checker'), R = runs.start({ kind: 'markup-read', who: 'Cal', jobId, no }); runs.stage(R.id, 'Cal is reading the red pen', 20);
    const system = `You read a MARKED-UP engineering drawing: a PDF or picture of drawing ${no} with hand or digital markups on it (red pen, clouds, comment boxes, sticky notes, crossings-out, arrows with text). List every markup as a separate comment, in the words written, with the page it is on and who signed it if a name or initials are written. Markups only: do not describe the drawing itself, do not invent corrections, do not tidy the wording. A crossed-out item is "delete X". An arrow from a value to a new value is "X: change A to B". Reply with JSON only, no fences:
{ "comments": [ { "page": 1, "comment": "as written", "by": "initials or name if written, else empty" } ], "unreadable": "anything that could not be read, or empty" }`;
    let r; try { r = await claudeFull({ system, who: 'cal', skills: false, maxTokens: 6000, messages: [{ role: 'user', content: [checker.contentBlock(kind, path.basename(file), buf), { type: 'text', text: `Drawing ${no} for job ${job.number}. List the markups.` }] }], run: R.id }); } catch (e) { runs.finish(R.id, { ok: false, error: runs.plain(e) }); throw e; }
    let out = { comments: [] }; try { out = JSON.parse(String(r.text).slice(String(r.text).indexOf('{'), String(r.text).lastIndexOf('}') + 1)); } catch { runs.finish(R.id, { ok: false, error: 'reply not readable' }); throw new Error('The reply was cut off before it finished. Press the button again; it usually goes through second time.'); }
    const list = (out.comments || []).filter(c => c && c.comment).map(c => ({ doc: no, comment: String(c.comment).trim(), by: String(c.by || '').trim() || 'Markup', agent: 'dex', page: c.page }));
    const have = new Set((desk.load(jobId).crs || []).filter(c => c.doc === no).map(c => c.comment.toLowerCase()));
    const fresh = list.filter(c => !have.has(c.comment.toLowerCase()));
    const added = fresh.length ? desk.addComments(jobId, fresh, 'Markup: ' + path.basename(file)) : [];
    runs.finish(R.id, { ok: true });
    BIZ.log({ who: 'Cal', action: 'Read a markup', jobId, detail: `${path.basename(file)} on ${no}: ${added.length} comment(s)` });
    return { added: added.length, skipped: list.length - fresh.length, unreadable: out.unreadable || '' };
  }
  ipcMain.handle('jobs:readMarkup', wrap((a) => readMarkup(a)));
  ipcMain.handle('jobs:overview', wrap(({ jobId }) => overview(jobId)));
  // talk to Eli about the job: he sees the register, RFIs, comments, scope and folder; he changes things only when told to
  // one chat turn on a job, with Eli or with a lead agent (Dave, Tom): same job in front of them, same doers; the lead's chat is kept apart
  const chatOf = (d, agentId) => agentId ? ((d.leadChat || {})[agentId] || []) : (d.chat || []);
  const setChat = (d, agentId, list) => { if (agentId) { d.leadChat = { ...(d.leadChat || {}), [agentId]: list }; } else d.chat = list; };
  async function jobChat({ jobId, text = '', skills, files: attached = [], agent = null }) {
    const job = jobOf(jobId), t = String(text || '').trim(); const who = agent ? agent.name || agent.id : 'Eli', aid = agent ? agent.id : '';
    if (!t && !(attached || []).length) throw new Error('Say something to ' + who);
    // a screenshot or picture pasted into the chat goes in as a picture
    const pics = []; for (const f of (attached || []).slice(0, 6)) { try { if (/\.(png|jpe?g|gif|webp)$/i.test(f.name)) { pics.push({ type: 'text', text: `PICTURE: ${f.name}` }); pics.push(require('./checker').contentBlock('image', f.name, Buffer.from(f.base64, 'base64'))); } else if (/\.pdf$/i.test(f.name)) { pics.push({ type: 'text', text: `PDF: ${f.name}` }); pics.push(require('./checker').contentBlock('pdf', f.name, Buffer.from(f.base64, 'base64'))); } } catch {} }
    const E = require('./elichat'), L = require('./leadchat'), biz = require('./business');
    const d0 = desk.load(jobId); const hist0 = [...chatOf(d0, aid), { role: 'tom', text: t + ((attached || []).length ? ` [${attached.map(f => f.name).join(', ')}]` : ''), at: new Date().toISOString() }].slice(-200); setChat(d0, aid, hist0); desk.saveRaw(jobId, d0);
    try { if (job.folder && fs.existsSync(job.folder)) BIZ.projects.gather(job.id, job.folder, { checker: require('./checker') }); } catch {}   // the folder as it is now, not as it was: never answer from a stale file list
    const ov = overview(jobId), files = jobFiles(jobId).map(f => f.rel);
    let nextIssue = null; try { if (job.folder) { const oi = desk.load(jobId).openIssue; nextIssue = oi && oi.path && fs.existsSync(oi.path) ? { n: oi.n, previous: { n: oi.n - 1 }, open: true } : BIZ.projects.nextIssueDir(job.folder); } } catch {}
    const ctx = E.context({ job, overview: ov, desk: desk.load(jobId), files, history: hist0.slice(0, -1), nextIssue, needNg: ov.needNg });
    const R = runs.start({ kind: 'chat', who, jobId, no: 'CHAT' }); let r;   // shows as working while thinking
    try { r = await claudeFull({ system: agent ? L.system(agent) : E.SYSTEM, who: agent ? agent.id : 'email', skills, maxTokens: agent ? 6000 : 4000, messages: [{ role: 'user', content: [{ type: 'text', text: `${ctx}\n\n${agent ? 'THEY SAY NOW' : 'TOM SAYS NOW'}: ${t || '(see the attachment)'}` }, ...pics] }], run: R.id }); runs.finish(R.id); } catch (e) { runs.finish(R.id, { ok: false, error: String(e && e.message || e) }); throw e; }
    let out; try { out = require('./dxfmaker').parseReply(r.text); } catch { out = { reply: String(r.text || '').trim(), actions: [] }; }
    const reply = String(out.reply || '').trim() || `(${who} said nothing)`;
    const doers = { issueSent: () => { const d = desk.load(jobId); if (!d.openIssue) throw new Error('No issue is being built on this job.'); const n = d.openIssue.n; d.openIssue.sent = true; closeIssue(jobId, d, `Tom told ${who} it was sent`); return { n }; }, revUp: (a) => revUpOrRevise({ jobId, no: a.no, to: a.to || '', status: a.status || '', people: a.people || null }), revise: (a) => revise({ jobId, no: a.no, comments: a.note || '', status: a.status || '' }), comment: (a) => desk.addComments(jobId, [{ doc: a.no, comment: a.text, by: agent ? who : 'Tom' }]), make: (a) => make({ jobId, no: a.no, people: a.people || {}, note: a.note || '' }), rows: () => overview(jobId).rows, docRequest: (a) => docRequest({ jobId, submittedBy: a.submittedBy || '', nos: a.nos || null }), plot: (a) => plotIssue({ jobId, files: a.files || null }),
      office: (a) => require('./o365main').once({ ...a, jobId }), calc: (a) => require('./intake').adaNote({ ...a, jobId }), check: (a) => check({ jobId, nos: a.nos }) };
    const actx = { job, desk: desk.load(jobId), deskMod: desk, biz, BIZ, overview: ov, said: { who, text: t } };
    const done = agent ? await L.apply(Array.isArray(out.actions) ? out.actions : [], actx, { agent, doers }) : await E.apply(Array.isArray(out.actions) ? out.actions : [], { ...actx, doers });
    try { desk.tidyRows(jobId); } catch {}
    try { if (done.some(x => /RFI|closed/i.test(x))) await desk.writeRfiRegister(jobId, { templateDir: BIZ.projects.templateDir() }); } catch {}
    const d1 = desk.load(jobId); const hist1 = [...chatOf(d1, aid), { role: agent ? 'agent' : 'eli', name: who, text: reply, done, at: new Date().toISOString() }].slice(-200); setChat(d1, aid, hist1); desk.saveRaw(jobId, d1);
    if (done.length) BIZ.log({ who, action: 'Changed the job from the chat', jobId, detail: done.join(' · ') });
    return { reply, done, chat: hist1 };
  }
  ipcMain.handle('eli:chat', wrap((a) => jobChat({ ...a, agent: null })));
  ipcMain.handle('eli:chatLog', wrap(({ jobId }) => ({ chat: desk.load(jobId).chat || [] })));
  const leadOf = (agentId) => { const list = (getAgents && getAgents()) || []; const a = list.find(x => x.id === agentId && x.role === 'lead'); if (!a) throw new Error('No such agent: ' + agentId); return a; };
  ipcMain.handle('lead:chat', wrap(({ agentId, ...a }) => jobChat({ ...a, agent: leadOf(agentId) })));
  ipcMain.handle('lead:chatLog', wrap(({ agentId, jobId }) => ({ chat: chatOf(desk.load(jobId), agentId) })));
  ipcMain.handle('jobs:plan', wrap((a) => plan(a)));
  ipcMain.handle('jobs:make', wrap((a) => make(a)));
  ipcMain.handle('jobs:makeAll', wrap(async ({ jobId }) => { const o = overview(jobId), done = [], masterOk = o.desk.master && o.desk.master.status === 'approved'; for (const r of o.rows.filter(r => r.agent && (!r.work || ['failed'].includes(r.work.status)) && (masterOk || !['bcd', 'schedule'].includes(r.kind)))) { try { await make({ jobId, no: r.no }); done.push(r.no); } catch {} } return { done, overview: overview(jobId) }; }));
  ipcMain.handle('jobs:check', wrap((a) => check(a)));
  // Revise: the changes logged against a drawing, done by Dex. With a DXF on file he edits its text (I -> 1, LT -> CT, a rename, all text in
  // black) and revs it up into the issue folder; what he was not asked about is untouched. DWG only: he asks for a DXF. No file at all: the
  // drawing is drawn again from the inputs with the comments as instructions (the one case where a redraw is right).
  // a DWG saved as DXF beside it by AutoCAD's core console (the one that plots); the folder is read again so the row sees the DXF
  async function dwgToDxf({ jobId, job, no, rel }) {
    const PL = require('./plot'), core = PL.coreConsole(), full = path.join(job.folder, rel), name = path.basename(full);
    if (!core) throw new Error(`${no}: only ${name} is on file and Dex cannot read a DWG. AutoCAD was not found on this PC to save it as DXF: save it as DXF from AutoCAD next to the DWG, press ↻, then try again.`);
    let r; try { r = await PL.dwgToDxf(full, { console: core }); } catch (e) { throw new Error(`${no}: Dex tried to save ${name} as DXF with AutoCAD and it failed (${String(e.message || e)}). Save it as DXF by hand next to the DWG, press ↻, then try again.`); }
    BIZ.log({ who: 'Dex', action: `Saved ${name} as DXF so it can be edited and revved`, jobId, detail: r.dxf });
    try { BIZ.projects.gather(job.id, job.folder, { checker: require('./checker') }); } catch {}
    return r.dxf;
  }
  const ACTIONS = ['replace_text', 'delete_text', 'add_text', 'set_colour', 'set_color', 'match_style'];
  const refOf = (v) => Number.isInteger(v) ? v : /^\d+$/.test(String(v ?? '')) ? +v : String(v || '').toLowerCase() === 'all' ? 'all' : undefined;
  const sayEdit = (f) => f.action === 'replace_text' ? `${f.before} -> ${f.after}` : f.action === 'delete_text' ? `removed "${f.before || f.text}"` : f.action === 'add_text' ? `added "${f.text}"` : `text to ${f.colour || 'black'}`;
  async function revise({ jobId, no, comments = '', people = null, status = '' }) {
    const job = jobOf(jobId), d = job.drawings.find(x => x.no === no); if (!d) throw new Error('Not on the drawing list: ' + no);
    const issueDir = peekIssueDir(jobId), RU = require('./revup');
    let src = sourceFor(d, jobFiles(jobId, { exceptDir: issueDir })), fname = (src.dxf || src.dwg || '').split('/').pop();
    if (!src.dxf && src.dwg) { await dwgToDxf({ jobId, job, no, rel: src.dwg }); src = sourceFor(d, jobFiles(jobId, { exceptDir: issueDir })); fname = (src.dxf || src.dwg || '').split('/').pop(); if (!src.dxf) throw new Error(`${no}: Dex saved ${fname} as DXF but the folder does not show it yet. Press ↻ above the list and Revise again.`); }
    const allCrs = desk.load(jobId).crs || [], mine = allCrs.filter(c => (c.doc === no || c.doc === '*') && !/closed/i.test(c.status || ''));
    if (!src.dxf) { const open0 = mine.filter(c => !/responded/i.test(c.status || '')), asked0 = String(comments || '').trim() || open0.map(c => `${c.no ? c.no + ': ' : ''}${c.comment}`).join('\n'); if (!kindOf(d).agent) throw new Error(`${no}: there is no drawing file for it in the job folder and no agent draws this kind. Put the DXF in the folder, press ↻, then Revise.`); return make({ jobId, no, people, revision: { on: true, stage: '', note: asked0.slice(0, 2000) }, note: asked0 ? `Client comments to address: ${asked0}` : '' }); }
    // ALWAYS from the working file (never from Dex's own last output, however it went), with EVERY change logged for this issue: the open
    // ones and the ones already done in this same unissued revision. Pressed twice, it makes the same P03 twice. (Tom 9 Nov)
    const dxffix = require('./dxffix'), full = path.join(job.folder, src.dxf), buf = fs.readFileSync(full);
    let parsed; try { parsed = dxffix.parseDxf(buf); } catch (e) { throw new Error(`${no}: Dex could not read ${fname} (${String(e.message || e)}).`); }
    let next = ''; try { const ib = RU.issueBoxes(parsed.pairs, RU.entities(parsed.pairs)); next = ib ? RU.nextOf(ib.rev) : ''; } catch {}
    const open = mine.filter(c => !/responded/i.test(c.status || '') || (next && new RegExp('Revised (in|again at) ' + next + '\\b').test(c.response || '')));
    // the engineer's own lines (typed in Tell Dex, or logged by Tom) come first and are marked as the decision; the client's after
    const line = (c) => `${/^tom$/i.test(c.by || '') ? 'ENGINEER' : 'CLIENT'} ${c.no ? c.no + ': ' : ''}${c.comment}`;
    const asked = [String(comments || '').trim() ? 'ENGINEER (now): ' + String(comments).trim() : '', ...open.filter(c => /^tom$/i.test(c.by || '')).map(line), ...open.filter(c => !/^tom$/i.test(c.by || '')).map(line)].filter(Boolean).join('\n');
    if (!asked) throw new Error(`${no}: nothing is logged against it to change. Log the comments on the Comments tab (or forward the email to Eli), then press Revise.`);
    const prev = delivOf(jobId)[no] || {}; people = people || prev.people || null;
    const R = runs.start({ kind: 'revise', who: 'Dex', jobId, no });
    setDeliv(jobId, no, { status: 'working', run: RUN, runId: R.id, agent: 'Dex', summary: 'Dex is reading the comments against the drawing', people });
    try {
      runs.stage(R.id, 'Dex is working out the edits', 15);
      if (asked.length > 20000) throw new Error(`${no}: the comments logged against it are too long to send to Dex in one go (${asked.length} characters). Close the ones already dealt with on the Comments tab and press Revise again.`);
      const focus = [...new Set((asked.match(/[A-Za-z0-9][A-Za-z0-9\-\/]{1,}/g) || []).filter(w => /\d|^[A-Z]{2,}$/.test(w)))];
      const inv = dxffix.inventory(parsed, 2500, focus);
      // the same comments on the same working file give the same edits: a second press reuses the first answer instead of asking again
      const key = require('crypto').createHash('sha1').update(buf).update('\0' + asked).digest('hex');
      let items = (prev.editsKey === key && Array.isArray(prev.edits)) ? prev.edits : null;
      if (!items) {
        const r = await claudeFull({ system: dxffix.DEX_NOTE_SYSTEM, who: 'dex', skills: false, maxTokens: 8000, messages: [{ role: 'user', content: `The engineer says:\n<instruction>${asked}</instruction>\n\nText in the drawing(s):\nFILE: ${fname}\n${inv}` }], run: R.id });
        const j = require('./checker').parseJson(r.text || '').value || {}; items = Array.isArray(j.items) ? j.items : [];
      }
      const fixes = [], cannot = [], failedFor = new Map(), okFor = new Set();   // which comment each miss belongs to, so it stays open with the reason
      const forOf = (it) => String(it.for || it.comment || '').trim().toUpperCase();
      items.forEach((it, i) => {
        const action = ACTIONS.includes(it.action) ? it.action : 'none', who = forOf(it);
        const miss = (why) => { cannot.push(why); if (who) failedFor.set(who, [...(failedFor.get(who) || []), why]); };
        if (action === 'none') { miss(it.why || 'not a text change'); return; }
        const f = { id: i + 1, for: who, file: fname, action, ref: refOf(it.ref), before: it.before || '', after: it.after || '', text: it.text || '', x: it.x, y: it.y, layer: it.layer || '', height: it.height, colour: it.colour || it.color || '', like: Number.isInteger(it.like) ? it.like : (/^\d+$/.test(String(it.like ?? '')) ? +it.like : undefined) };
        if (action === 'delete_text' && Number.isInteger(f.ref) && parsed.ents[f.ref]) f.before = parsed.ents[f.ref].plain;
        let c = dxffix.checkItem(parsed, f);
        if (!c.can && f.action === 'replace_text' && f.ref !== undefined) { const f2 = { ...f, ref: undefined }; const c2 = dxffix.checkItem(parsed, f2); if (c2.can) { Object.assign(f, f2); c = c2; } }   // wrong item number from the model: the text itself decides, everywhere it is on the drawing
        if (!c.can) { miss(`${sayEdit(f)}: ${c.warn}`); return; }
        fixes.push(f);
      });
      if (!fixes.length) { const why = cannot.length ? cannot.join(' · ') : 'the comments do not say what text to change'; runs.finish(R.id, { ok: false, error: why }); setDeliv(jobId, no, { status: 'needs you', summary: `Dex: I can't do these by editing the drawing's text — ${why}. Tell me exactly what to change (or do it in AutoCAD and I'll rev it up).` }); throw new Error(`${no}: Dex can't do these by editing the text — ${why}`); }
      runs.stage(R.id, `Dex is making ${fixes.length} edit${fixes.length === 1 ? '' : 's'}`, 50);
      const out = dxffix.applyFixes(buf, fixes), applied = out.results.filter(x => x.status === 'applied'), missed = out.results.filter(x => x.status !== 'applied');
      out.results.forEach((x, i) => { const who = fixes[i] && fixes[i].for; if (!who) return; if (x.status === 'applied') okFor.add(who); else failedFor.set(who, [...(failedFor.get(who) || []), `${sayEdit(x)}: ${x.reason}`]); });
      if (!applied.length) { const why = missed.map(x => `${sayEdit(x)}: ${x.reason}`).join(' · '); runs.finish(R.id, { ok: false, error: why }); setDeliv(jobId, no, { status: 'needs you', summary: `Dex: none of the edits went in — ${why}` }); throw new Error(`${no}: ${why}`); }
      const note = `${applied.length} edit${applied.length === 1 ? '' : 's'}: ${applied.map(x => sayEdit(x) + (x.places > 1 ? ` (×${x.places})` : '')).join(', ')}`;
      runs.stage(R.id, 'Dex is revving it up and checking it', 80); const w = await revUp({ jobId, no, status, people, remarks: remarkFor(open), edited: { buf: out.buf, note, fixes, results: out.results, asked, wantBlack: fixes.some(f => /set_colou?r/.test(f.action) && /black|^7$/i.test(f.colour || 'black')) }, exceptDir: issueDir, run: R.id });
      // each comment answered: a comment closes only when an edit that came from it went in. One Dex could not do stays Open with his
      // reason; one no edit came from stays Open too (never closed on the strength of another comment's edit). Only when Dex named no
      // comment at all on any edit does the whole set close on the revision.
      const named = items.some(it => forOf(it));
      for (const c of open) { if (c.doc === '*') continue; const k = String(c.no).toUpperCase(); try {
        if (w.status !== 'made') desk.saveCrs(jobId, { no: c.no, response: `Revised in ${w.rev} but the check failed, so it stays open: ${(w.verify && w.verify.fails || []).join('; ')}` });   // a revision that failed its check answers nothing
        else if (!named || okFor.has(k)) desk.saveCrs(jobId, { no: c.no, status: 'Responded', response: `Revised in ${w.rev}: ${note}` });
        else if (failedFor.has(k)) desk.saveCrs(jobId, { no: c.no, response: `Dex couldn't do this by editing text (${failedFor.get(k).join('; ')}). Do it in AutoCAD, or tell him more.` });
        else desk.saveCrs(jobId, { no: c.no, response: `Dex couldn't do this by editing text (no edit came from it). Tell him exactly what text to change.` }); } catch {} }
      const left = [...cannot, ...missed.map(x => `${sayEdit(x)}: ${x.reason}`)]; if (inv.cut) left.push(`the drawing has ${inv.total} text items and ${inv.cut} were not shown to Dex (the ones the comments name were): check nothing was missed`);
      runs.finish(R.id, { ok: true });
      return setDeliv(jobId, no, { editsKey: key, edits: items, summary: `${w.summary}${left.length ? `. NOT DONE (needs you or AutoCAD): ${left.join(' · ')}` : ''}`, warning: [left.length ? `Dex: ${left.length} of the asks I could not do by editing text: ${left.join(' · ')}` : '', w.warning || ''].filter(Boolean).join(' · '), given: { request: asked, at: new Date().toISOString(), read: [src.dxf], skills: [], fromSchedule: [], queries: [], warnings: [] } });
    } catch (e) { const stopped = runs.aborted(R.id); runs.finish(R.id, { ok: false, error: runs.plain(e) }); const cur = delivOf(jobId)[no] || {}; if (cur.status === 'working') setDeliv(jobId, no, { status: stopped ? 'stopped' : 'failed', summary: stopped ? 'Stopped. Nothing was changed.' : runs.plain(e) }); throw e; }
  }
  ipcMain.handle('jobs:revise', wrap((a) => revise(a)));
  // the revision asked for: typed in the box (e.g. C01), or said in the note ("move to C01"), else the next one at the same stage
  const askedRev = (to, note) => { const t = String(to || '').trim().toUpperCase().replace(/^([A-Z])(\d)$/, '$10$2'); if (/^[PACX]\d{2}$/.test(t)) return t; const m = String(note || '').match(/\b(?:moved?\s+(?:up\s+)?to|go(?:ing)?\s+to|up\s+to|rev(?:ision)?|issue[d]?\s+(?:as|at))\s*([PACX])\s?0?(\d{1,2})\b/i); return m ? m[1].toUpperCase() + m[2].padStart(2, '0') : ''; };
  ipcMain.handle('jobs:revision', wrap(async ({ jobId, no, note = '', to = '', people, desc = '' }) => {
    const desk = require('./jobdesk'), V = desk.load(jobId), open = (V.crs || []).filter(c => (c.doc === no || c.doc === '*') && !/responded|closed/i.test(c.status || ''));   // '*': a change asked for on every drawing
    const said = String(note || '').trim(), rev = askedRev(to, said);
    const r = await make({ jobId, no, people, revision: { on: true, to: rev, stage: '', note: said.slice(0, 2000), desc: String(desc || '').trim() }, note: said ? `Changes for this revision: ${said}` : 'New revision: no other changes asked for.' });
    if (r && r.status === 'made') for (const c of open) { if (c.doc === '*') continue; /* asked for on every drawing: stays open until Tom closes it */ try { desk.saveCrs(jobId, { no: c.no, status: 'Responded', response: `Revised in ${r.rev}` }); } catch {} }
    return r;
  }));
  // Rev up: the next revision of a drawing that exists as a DXF in the job folder, title block only. The revision text is changed (P03 ->
  // P04), the issue status text if asked (ISSUED FOR COMMENT), the file saved as <row number>_<rev>.dxf in the drawings folder with the old
  // revision archived. The drawing's content is not touched; the comments stay open for Tom or Dex to do by hand.
  // the issue folder being built: remembered on the job desk from the first rev up until the issue goes out
  // an issue has gone out when its transmittal is on file ("Document Transmittal ISSUE 12.pdf", "TR-12.pdf", a transmittal inside the issue
  // folder) or Tom said so: then the next revision opens ISSUE n+1 and never writes into the one that went (Tom 9 Nov: he sends them himself)
  function issueSent(oi) {
    if (!oi || !oi.path) return false; if (oi.sent) return true;
    const re = new RegExp('(issue|tr)[ _-]*0?' + oi.n + '(?!\\d)', 'i');
    const look = (dir, needNo) => { try { return fs.readdirSync(dir).some(n => /\.(pdf|xlsx|xlsm|docx|msg)$/i.test(n) && /transmittal|\bTR-?\d/i.test(n) && (!needNo || re.test(n))); } catch { return false; } };
    return look(path.dirname(oi.path), true) || look(oi.path, false);
  }
  function closeIssue(jobId, d, why) { const oi = d.openIssue; d.issued = [...(d.issued || []), { ...oi, issuedAt: new Date().toISOString(), how: why }]; d.openIssue = null; desk.saveRaw(jobId, d); BIZ.log({ who: 'Dex', action: `ISSUE ${oi.n} has gone out (${why}); the next revision opens ISSUE ${oi.n + 1}`, jobId }); }
  // the issue being built, WITHOUT making anything: '' when there is none yet. Looking never creates a folder (a press that fails must not leave an empty ISSUE n behind)
  function peekIssueDir(jobId) {
    const job = jobOf(jobId), d = desk.load(jobId);
    if (d.openIssue && d.openIssue.path && fs.existsSync(d.openIssue.path)) { if (!issueSent(d.openIssue)) return d.openIssue.path; closeIssue(jobId, d, 'transmittal on file'); }
    // an issue folder made by hand that has not gone out yet (DXFs but no PDFs: issued copies always carry their PDFs) is the open one
    const all = job.folder ? BIZ.projects.issueDirs(job.folder) : [], last = all[all.length - 1];
    if (last && !(d.issued || []).some(x => x.n === last.n)) { let pdfs = 0, any = 0; try { for (const n of fs.readdirSync(last.path)) { any++; if (/\.pdf$/i.test(n)) pdfs++; } } catch {}
      if (any && !pdfs && !issueSent({ n: last.n, path: last.path })) { d.openIssue = { n: last.n, path: last.path, openedAt: new Date().toISOString(), found: true }; desk.saveRaw(jobId, d); return last.path; } }
    return '';
  }
  // the issue being built, made if there is none: called only at the moment a file is written into it
  function openIssueDir(jobId) {
    const have = peekIssueDir(jobId); if (have) return have;
    const job = jobOf(jobId), d = desk.load(jobId);
    const nx = BIZ.projects.nextIssueDir(job.folder); fs.mkdirSync(nx.path, { recursive: true }); d.openIssue = { n: nx.n, path: nx.path, openedAt: new Date().toISOString() }; desk.saveRaw(jobId, d);
    BIZ.log({ who: 'Dex', action: `Opened ISSUE ${nx.n} for the next issue`, jobId, detail: nx.path });
    return nx.path;
  }
  ipcMain.handle('jobs:issueSent', wrap(({ jobId }) => { const d = desk.load(jobId); if (!d.openIssue) throw new Error('No issue is being built on this job.'); const n = d.openIssue.n; d.openIssue.sent = true; closeIssue(jobId, d, 'marked sent by Tom'); return { n }; }));
  const issueName = (no, rev) => /^X\d{5,6}-/i.test(no) ? `${no} ${rev}` : `${no}_${rev}`;
  // a Word or Excel document: new revision rows, header and cover moved on by docrev; the native goes in ISSUE n/ISSUE n NATIVES (the PDF
  // for the issue itself is made from it by Word or Excel when the issue is plotted)
  async function revUpDocument({ jobId, job, d, src, to = '', status = '' }) {
    const DR = require('./docrev'), rel = src.docx || src.xlsx, full = path.join(job.folder, rel), name = path.basename(full), no = d.no;
    const from = DR.revOfName(name) || d.rev || ''; const want = askedRev(to, '') || '';
    const renumber = src.fileNo && src.fileNo !== no.toUpperCase() ? { from: src.fileNo, to: no } : null;
    let r; try { r = src.docx ? await DR.revUpDocx(fs.readFileSync(full), { from, to: want, status, renumber }) : await DR.revUpXlsx(fs.readFileSync(full), { from, to: want, status }); }
    catch (e) { throw new Error(`${no}: ${name} could not be revved up (${String(e.message || e)}). Rev it by hand this time.`); }
    const outDir = openIssueDir(jobId), natives = path.join(outDir, `${path.basename(outDir)} NATIVES`); fs.mkdirSync(natives, { recursive: true });
    const outPath = path.join(natives, DR.revName(name, r.from, r.to, renumber)); fs.writeFileSync(outPath, r.buf);
    d.rev = r.to; require('./business').saveJob(BIZ.data(), job, 'Wren'); BIZ.store.save();
    const who = src.docx ? 'Wren' : 'Lex', ch = r.changes;
    const { pdfs, pdfNote } = await pdfFor({ jobId, file: outPath });   // Word / Excel make the PDF now, into the issue folder
    const w = setDeliv(jobId, no, { status: 'made', rev: r.to, files: [outPath], pdfs, warning: pdfNote, archived: 0, by: who, summary: `Rev up ${r.from} -> ${r.to}: ${src.docx ? `${ch.rows} revision row${ch.rows === 1 ? '' : 's'} added, header${ch.cover ? ' and cover' : ''} to ${r.to}, dated today` : `revision row ${r.to} on the cover sheet, dated today`}${renumber ? `; renumbered ${renumber.from} -> ${renumber.to}` : ''}; content unchanged`, source: rel });
    BIZ.log({ who, action: `Revved up ${no} ${r.from} -> ${r.to} (revision tables, header${renumber ? ', renumbered' : ''})`, jobId, detail: path.basename(outPath) });
    try { BIZ.projects.gather(job.id, job.folder, { checker: require('./checker') }); } catch {}
    return w;
  }
  // the PDF of one freshly written file, named like the issue folder names them; a failure is said on the row, never swallowed
  async function pdfFor({ jobId, file, run = '' }) {
    try { const pr = await plotIssue({ jobId, files: [file], run }); if (pr.failed.length) return { pdfs: [], pdfNote: `Dex: the PDF was not made — ${pr.failed[0].error}` }; return { pdfs: pr.done.map(x => x.pdf), pdfNote: '' }; }
    catch (e) { return { pdfs: [], pdfNote: `Dex: the PDF was not made — ${String(e.message || e)}` }; }
  }
  async function revUp({ jobId, no, to = '', status = '', people = null, edited = null, exceptDir = '', run = '', remarks = '' }) {   // edited: { buf, note } when Revise changed the text first
    const job = jobOf(jobId), d = job.drawings.find(x => x.no === no); if (!d) throw new Error('No such row');
    exceptDir = exceptDir || peekIssueDir(jobId);   // the issue being built is never the source: a rev up starts from the working file every time
    let src = sourceFor(d, jobFiles(jobId, { exceptDir }));
    if (!src.dxf && (src.docx || src.xlsx)) return revUpDocument({ jobId, job, d, src, to, status });
    if (!src.dxf && src.dwg) { await dwgToDxf({ jobId, job, no, rel: src.dwg }); src = sourceFor(d, jobFiles(jobId, { exceptDir })); }
    if (!src.dxf) throw new Error(`${no} has no DXF in the job folder${src.dwg ? ` (only ${src.dwg.split('/').pop()}): save it as DXF from AutoCAD next to the DWG` : ''}.`);
    const dxffix = require('./dxffix'), full = path.join(job.folder, src.dxf), orig = fs.readFileSync(full), buf = edited && edited.buf ? edited.buf : orig, cur = d.rev || src.fileRev || '';

    const want = askedRev(to, '') || '';
    const dl0 = delivOf(jobId), pp = people || (dl0[no] || {}).people || Object.values(dl0).map(x => x && x.people).filter(Boolean).pop() || {}; let r;
    // a new issue box beside the last one (P04 next to P01 P02 P03: date, initials, status), the title block ISSUE field to the new rev
    try { r = require('./revup').revUp(buf, { to: want, status, drawn: pp.drawn || '', checked: pp.checked || '', approved: pp.approved || '', remarks }); }
    catch (e) { throw new Error(`${no}: ${src.dxf.split('/').pop()} could not be revved up (${String(e.message || e)}). Rev it by hand this time.`); }
    if (r.from !== cur && cur && !/^P0?1$/i.test(cur)) BIZ.log({ who: 'Dex', action: `Note: the register says ${no} is at ${cur} but the sheet reads ${r.from}; revved from the sheet`, jobId });
    const next = r.to;
    // the new revision goes in the issue being built: the next ISSUE n folder under 013 Transmittals & Drawing Register (ISSUE 12 on file ->
    // ISSUE 13), opened by the first rev up and used by every one after it until Tom presses Issue. The working set and the earlier issue
    // folders are never written to or moved: a rev up is a new file in the new issue folder, nothing else
    const outDir = openIssueDir(jobId); fs.mkdirSync(outDir, { recursive: true });
    // the file is named with the drawing number printed in the sheet's title block when that is the same number written another way
    // (the register said -00012, the sheet says -0012: Tom 9 Nov, "the title block is fine, rename the file")
    const onSheet = sheetNumber(r.buf, no), nameNo = onSheet || no;
    if (onSheet) BIZ.log({ who: 'Dex', action: `Named ${no} as ${onSheet}, the number in its title block`, jobId });
    const base = issueName(nameNo, next); let archived = 0;   // X11475-BGN-ZZ-XX-DR-E-7142 P04 the way the earlier issue folders name them, 70_BG_0014_P06 for our own numbers
    for (const n of fs.readdirSync(outDir)) if (new RegExp('^' + nameNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ _-][PCAX]\\d\\d\\.dxf$', 'i').test(n) && n !== base + '.dxf') { try { const a = path.join(path.dirname(outDir), 'Superseded', path.basename(outDir)); fs.mkdirSync(a, { recursive: true }); for (const ext of ['.dxf', '.pdf']) { const f = n.replace(/\.dxf$/i, ext); if (fs.existsSync(path.join(outDir, f))) fs.renameSync(path.join(outDir, f), path.join(a, f)); } archived++; } catch {} }   // only an earlier rev-up of the same drawing in this same issue moves aside, with its PDF, to Superseded\ISSUE n beside the issue folders: nothing but the issue goes inside the folder that is sent
    const outPath = path.join(outDir, base + '.dxf'); fs.writeFileSync(outPath, r.buf);
    d.rev = next; require('./business').saveJob(BIZ.data(), job, 'Dex'); BIZ.store.save();
    // the PDF straight away, by AutoCAD's core console (the same route as the Issue button): a revision without its PDF is not finished (Tom 9 Nov)
    const t0 = Date.now(); const { pdfs, pdfNote } = await pdfFor({ jobId, file: outPath, run });
    // the check: the file and its PDF are compared with the working file before the row may say made (verify.js)
    const V = require('./verify'), E = edited || {};
    const vr = V.revision({ src: orig, edited: buf, out: r.buf, fixes: E.fixes || [], results: E.results || [], asked: E.asked || '', next, wantBlack: !!E.wantBlack });
    const L = require('./plot').layoutToPlot(outPath) || {}; const vp = pdfs.length ? V.pdf(pdfs[0], { since: t0, w: Math.max(L.w || 0, L.h || 0), h: Math.min(L.w || 0, L.h || 0) }) : { ok: false, fail: [pdfNote ? pdfNote.replace(/^Dex: /, '') : 'no PDF was made'] };
    const fails = [...vr.fail, ...vp.fail.map(x => 'PDF: ' + x)], checked = fails.length ? `CHECK FAILED: ${fails.join(' · ')}` : 'checked: only the asked changes, issue box right, PDF right';
    const w = setDeliv(jobId, no, { status: fails.length ? 'needs you' : 'made', rev: next, files: [outPath], pdfs, archived, by: 'Dex', warning: [fails.length ? `Dex: don't issue this yet — ${fails.join(' · ')}` : '', ...vr.note, r.changes.remarkNotWritten ? 'Dex: ' + r.changes.remarkNotWritten : ''].filter(Boolean).join(' · '), verify: { ok: !fails.length, fails, at: new Date().toISOString() }, summary: `${edited ? 'Revised' : 'Rev up'} ${r.from} -> ${next}: new issue box (${[r.changes.date ? 'dated today' : '', r.changes.status ? status.toUpperCase() : '', r.changes.people ? 'initials' : ''].filter(Boolean).join(', ') || 'copied from ' + r.from}); ${edited && edited.note ? edited.note : 'drawing content unchanged'}${pdfs.length ? '; PDF made' : ''}. ${checked}`, source: src.dxf });
    BIZ.log({ who: 'Dex', action: `${edited ? 'Revised' : 'Revved up'} ${no} ${r.from} -> ${next} (${edited && edited.note ? edited.note + '; ' : ''}new issue box, title block)`, jobId, detail: path.basename(outPath) });
    try { BIZ.projects.gather(job.id, job.folder, { checker: require('./checker') }); } catch {}   // the folder is read again so the new file is the row's source from now on
    return w;
  }
  // Rev up on a drawing with changes for this issue (open, or already done in this same unissued revision) is a Revise: the changes
  // are made again from the working file, never lost (Tom 9 Nov: the earlier P03s had been marked done with nothing in them)
  async function revUpOrRevise(a) {
    const job = jobOf(a.jobId), d = job.drawings.find(x => x.no === a.no); if (!d) throw new Error('No such row');
    const issueDir = peekIssueDir(a.jobId), src = sourceFor(d, jobFiles(a.jobId, { exceptDir: issueDir }));
    if (src.dxf || src.dwg) { try {
      const RU = require('./revup'), dx = require('./dxffix').parseDxf(fs.readFileSync(path.join(job.folder, src.dxf || ''))), ib = src.dxf ? RU.issueBoxes(dx.pairs, RU.entities(dx.pairs)) : null, next = ib ? RU.nextOf(ib.rev) : '';
      const mine = (desk.load(a.jobId).crs || []).filter(c => (c.doc === a.no || c.doc === '*') && !/closed/i.test(c.status || '') && (!/responded/i.test(c.status || '') || (next && new RegExp('Revised (in|again at) ' + next + '\\b').test(c.response || ''))));
      if (mine.some(c => c.doc === a.no && !/^Dex couldn't/.test(c.response || ''))) return revise({ jobId: a.jobId, no: a.no, people: a.people, status: a.status });   /* a change on THIS drawing; one Dex already said he can't do by text (a cloud) stays open and does not block a plain rev up */
    } catch (e) { if (!/No such row|Not on the drawing list/.test(String(e.message || e))) { /* fall through to a plain rev up only when the look-up itself failed */ } } }
    return revUp(a);
  }
  ipcMain.handle('jobs:revUp', wrap((a) => revUpOrRevise(a)));
  async function docRequest({ jobId, submittedBy = '', nos = null }) {
    const job = jobOf(jobId), ov = overview(jobId), DR = require('./docreq');
    if (!job.folder || !fs.existsSync(job.folder)) throw new Error('This job has no folder to put the request in.');
    let rows = DR.needsRequest(ov.rows); if (Array.isArray(nos) && nos.length) rows = rows.filter(r => nos.some(n => r.no.toUpperCase() === String(n).toUpperCase() || (r.alt && r.alt.toUpperCase() === String(n).toUpperCase())));
    if (!rows.length) throw new Error('Every deliverable on this job already has its NG number; nothing to request.');
    const dir = BIZ.outputDirFor(jobId, 'transmittals') || path.join(job.folder, '013 Transmittals & Drawing Register'); fs.mkdirSync(dir, { recursive: true });
    // the site name the way the earlier request forms spell it ("Document Request - Bustleholme 7.xlsx"), else the first word of the job name
    let site = ''; try { for (const f of fs.readdirSync(dir)) { const m = f.match(/^Document Request - (.+?) \d+\.(xlsx|pdf)$/i); if (m) site = m[1]; } } catch {}
    if (!site) site = (job.name || job.number).replace(/^\d{1,3}\s*-?\s*/, '').replace(/\b(lvac|dcaar|&|and|diesel|replacement|generator|design|stage \d+)\b/gi, '').replace(/[^A-Za-z ]+/g, ' ').trim().split(/\s+/)[0] || job.number;
    site = site.charAt(0).toUpperCase() + site.slice(1).toLowerCase();
    const file = DR.nextFormPath(dir, site);
    const projNo = (job.number.match(/^X\d{5,6}/i) || [])[0] || ov.rows.map(r => (String(r.no).match(/^X\d{5,6}(?=-)/i) || [])[0]).find(Boolean) || job.number;   // the client's project number: ours when it is one, else the one the NG numbers carry (X11475)
    const buf = await DR.fill(DR.templatePath(BIZ.projects.templateDir()), { projectTitle: job.name || '', projectNumber: projNo, submittedBy }, rows.map(r => ({ ...r, rev: r.rev || 'P01' })));
    fs.writeFileSync(file, buf);
    const d = desk.load(jobId); d.docRequests = [...(d.docRequests || []), { file, at: new Date().toISOString(), rows: rows.map(r => r.no) }]; desk.saveRaw(jobId, d);
    BIZ.log({ who: 'Eli', action: `Wrote a Document Request for ${rows.length} NG number${rows.length === 1 ? '' : 's'}`, jobId, detail: path.basename(file) + ' · ' + rows.map(r => r.no + ' ' + r.title).join(', ') });
    return { file, rows: rows.map(r => ({ no: r.no, title: r.title, category: DR.category(r) })) };
  }
  ipcMain.handle('jobs:docRequest', wrap((a) => docRequest(a)));
  // PDFs for the issue being built: AutoCAD's core console plots every DXF in the open issue folder that has no PDF yet (or the ones named);
  // Word and Excel make the PDFs of the documents in ISSUE n NATIVES, named <number> <rev>.pdf in the issue folder like the earlier issues
  async function plotIssue({ jobId, files = null, run = '' }) {
    const job = jobOf(jobId), PL = require('./plot'), OP = require('./officepdf'), core = PL.coreConsole();
    const named = Array.isArray(files) && files.length;
    const dir = named ? path.dirname(files[0]) : peekIssueDir(jobId); if (!dir) throw new Error('There is no issue being built on this job: nothing to make PDFs of.');
    const natives = path.join(dir, `${path.basename(dir)} NATIVES`);
    const docPdf = (f) => { const n = path.basename(f).replace(/\.(docx?|xlsx?|xlsm)$/i, ''); const no = (n.match(/X\d{5,6}(?:-[A-Z0-9]{1,4}){1,6}-\d{3,4}/i) || [])[0], rev = revInName(n); return path.join(dir, no && rev ? `${no} ${rev}.pdf` : n + '.pdf'); };
    let list = (named ? files : [...fs.readdirSync(dir).filter(n => /\.dxf$/i.test(n)).map(n => path.join(dir, n)), ...(fs.existsSync(natives) ? fs.readdirSync(natives).filter(n => /\.(docx|xlsx|xlsm)$/i.test(n) && !n.startsWith('~$')).map(n => path.join(natives, n)) : [])]).filter(f => fs.existsSync(f));
    const pdfOf = (f) => /\.dxf$/i.test(f) ? f.replace(/\.dxf$/i, '.pdf') : docPdf(f);
    list = list.filter(f => named || !fs.existsSync(pdfOf(f)));
    if (!list.length) return { dir, done: [], failed: [], note: 'every file in the issue folder already has its PDF' };
    if (!core && list.some(f => /\.dxf$/i.test(f))) throw new Error('AutoCAD is not installed on this PC (no accoreconsole.exe under Program Files\\Autodesk), so the drawing PDFs have to be plotted by hand.');
    const done = [], failed = []; let i = 0;
    for (const f of list) {
      i++; const isDxf = /\.dxf$/i.test(f), app = isDxf ? `AutoCAD ${core.year}` : /\.docx?$/i.test(f) ? 'Word' : 'Excel';
      if (run) runs.stage(run, `${app} is making the PDF of ${path.basename(f)} (${i} of ${list.length})`, Math.round(5 + 90 * (i - 1) / list.length));
      try { const r = isDxf ? await PL.plotOne(f, { console: core }) : await OP.toPdf(f, pdfOf(f)); done.push({ src: f, dxf: isDxf ? f : '', pdf: r.pdf, layout: r.layout || '', app }); } catch (e) { failed.push({ src: f, dxf: f, error: String(e.message || e) }); }
    }
    BIZ.log({ who: 'Dex', action: `Made ${done.length} PDF${done.length === 1 ? '' : 's'} for ${path.basename(dir)}${failed.length ? `, ${failed.length} failed` : ''}`, jobId, detail: [...done.map(d => path.basename(d.pdf)), ...failed.map(f => path.basename(f.src) + ': ' + f.error)].join(' · ') });
    try { BIZ.projects.gather(job.id, job.folder, { checker: require('./checker') }); } catch {}
    return { dir, done, failed, core: core ? core.year : 0 };
  }
  ipcMain.handle('jobs:plot', wrap(async ({ jobId, files = null }) => {
    if (runs.live().some(r => r.jobId === jobId && r.no === 'PLOT')) throw new Error('Plotting is already running on this job.');
    const R = runs.start({ kind: 'plot', who: 'Dex', jobId, no: 'PLOT' });
    try { const r = await plotIssue({ jobId, files, run: R.id }); runs.finish(R.id, { ok: !r.failed.length, error: r.failed.length ? r.failed.map(f => f.error).join(' · ') : '' }); return r; } catch (e) { runs.finish(R.id, { ok: false, error: String(e && e.message || e) }); throw e; }
  }));
  ipcMain.handle('jobs:setStatus', wrap(({ jobId, no, status }) => setDeliv(jobId, no, { status })));
  ipcMain.handle('jobs:waiting', wrap(() => waiting()));
  return { overview, make, check, waiting, kindOf };
}
module.exports = { remarkFor, sheetNumber, sourceFor, register, kindOf };
