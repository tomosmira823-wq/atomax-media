// Eli the email checker and Dex the DXF maker.
// Eli: drop an email (.eml, .msg, .txt, a screenshot or a PDF). He reads what it asks for and proposes tasks for the right agents.
// Tom says "Yes, start" per task: the job and its project folder are found (or picked), the task goes on the board, the email is filed in the
// job folder, and the agent gets going. Dex makes a new DXF (an SLD for now) from the request plus the project folder, asking questions if he must.
'use strict';
const fs = require('fs');
const path = require('path');
const biz = require('./business');
const library = require('./library');
const dxfmaker = require('./dxfmaker');

const AGENTS = {
  dex: 'Dex — DXF maker and fixer: draws NEW single line diagrams (SLDs) as DXF from the project files, and fixes text on existing DXFs',
  cal: 'Cal — drawing checker: checks drawings against cable schedules and makes red markups',
  documents: 'Dot — documents: drafts Atomax-format Word documents (reports, transmittals, RAMS, method statements, letters)',
  milo: 'Milo — 3D modeller: changes an existing 3D model (adds a pipe, a rail, moves equipment)',
  theo: 'Theo — 3D builder: builds a new 3D model from scratch',
  none: 'Tom himself: anything the agents cannot do (pricing, meetings, phone calls, site visits, replies that need a decision)'
};
const AGENT_NAME = { dex: 'Dex', cal: 'Cal', documents: 'Dot', milo: 'Milo', theo: 'Theo', none: '' };

const EMAIL_SYSTEM = `You are Eli, the email checker at the Atomax-UK reception. Atomax-UK is an electrical engineering consultancy (electrical CAD, drawings, schedules, document control).
Read the email (and any screenshots or attachments) and work out exactly what the sender is asking Atomax to do. Split it into separate tasks and give each one to the agent who can do it:
${Object.entries(AGENTS).map(([k, v]) => `- "${k}": ${v}`).join('\n')}
Only list real asks from the email. Do not invent work. Copy site names, job numbers, drawing numbers, ratings and dates exactly as written.
Reply with JSON only, no markdown:
{"from":"name <address>","subject":"...","date":"...","summary":"two lines max: what they want","site":"site or project name, as written","jobNumber":"a job number if one is written (e.g. X11475), else empty","asks":[{"title":"short task title, e.g. Draw an SLD for the Test site LV board","detail":"everything the agent needs from the email for this task","agent":"dex|cal|documents|milo|theo|none","kind":"sld|dxf-fix|drawing-check|document|model|other","due":"deadline if given, else empty"}],"reply":"a short suggested reply Tom could send back, in plain British English"}`;

// ---------- reading email files ----------
const decodeWords = (s) => String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs, enc, txt) => {
  try { const buf = /b/i.test(enc) ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'); return buf.toString(/utf-?8/i.test(cs) ? 'utf8' : 'latin1'); } catch { return txt; }
});
const qp = (s) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
function splitHead(raw) {
  const i = raw.search(/\r?\n\r?\n/); const head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
  const h = {}; head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(l => { const m = l.match(/^([\w-]+):\s*(.*)$/); if (m) h[m[1].toLowerCase()] = m[2]; });
  return { h, body };
}
function parsePart(raw, out) {
  const { h, body } = splitHead(raw);
  const ct = h['content-type'] || 'text/plain', enc = (h['content-transfer-encoding'] || '').toLowerCase();
  const bnd = (ct.match(/boundary="?([^";]+)"?/i) || [])[1];
  if (/^multipart\//i.test(ct) && bnd) { body.split('--' + bnd).slice(1).forEach(p => { if (!p.startsWith('--')) parsePart(p.replace(/^\r?\n/, ''), out); }); return; }
  const data = enc === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? qp(body) : Buffer.from(body, 'latin1');
  const fname = decodeWords(((h['content-disposition'] || '') + ';' + ct).match(/(?:file)?name\*?="?([^";]+)"?/i)?.[1] || '');
  const charset = (ct.match(/charset="?([^";]+)"?/i) || [])[1] || 'utf-8';
  if (fname || /attachment/i.test(h['content-disposition'] || '')) { out.attachments.push({ name: fname || 'attachment', mime: ct.split(';')[0].trim().toLowerCase(), data }); return; }
  const text = data.toString(/utf-?8/i.test(charset) ? 'utf8' : 'latin1');
  if (/text\/plain/i.test(ct)) out.text.push(text);
  else if (/text\/html/i.test(ct)) out.html.push(text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}
function parseEml(buf) {
  const raw = buf.toString('latin1'), { h } = splitHead(raw), out = { text: [], html: [], attachments: [] };
  parsePart(raw, out);
  return { from: decodeWords(h.from), to: decodeWords(h.to), cc: decodeWords(h.cc), subject: decodeWords(h.subject), date: h.date || '', body: (out.text.join('\n') || out.html.join('\n')).replace(/\n{3,}/g, '\n\n').trim(), attachments: out.attachments };
}
// Outlook .msg is a binary container; its text is stored as UTF-16. Pull out the readable runs (good enough for Claude to read the email).
function parseMsg(buf) {
  const runs = (buf.toString('utf16le').match(/[\x20-\x7E -ſ\r\n\t]{12,}/g) || []).map(s => s.trim()).filter(s => s.length > 12 && !/^[A-Z0-9_]+$/.test(s));
  const ascii = (buf.toString('latin1').match(/[\x20-\x7E\r\n\t]{24,}/g) || []).filter(s => /[a-z]{3,}/.test(s));
  const seen = new Set(), keep = [];
  for (const r of [...runs, ...ascii]) { const k = r.slice(0, 60); if (!seen.has(k)) { seen.add(k); keep.push(r); } }
  return { from: '', to: '', subject: '', date: '', body: keep.join('\n').slice(0, 20000), attachments: [] };
}

function register({ ipcMain, dialog, shell, getWin, userDir, claudeFull, checker, BIZ }) {
  const DIR = () => { const d = path.join(userDir(), 'emails'); fs.mkdirSync(d, { recursive: true }); return d; };
  const FILE = () => path.join(DIR(), 'emails.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return []; } };
  const save = (list) => fs.writeFileSync(FILE(), JSON.stringify(list.slice(0, 200), null, 2));
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw new Error(String(e && e.message || e)); } };
  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const IMG = /^image\/(png|jpe?g|gif|webp)$/;
  const extMime = (n) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' })[path.extname(n).toLowerCase()] || '';

  // the job an email is about: by job number first, then by words of the site / subject against job names and clients
  function matchJob(e) {
    const jobs = BIZ.data().jobs, hay = `${e.jobNumber} ${e.subject} ${e.site} ${e.summary}`.toLowerCase();
    const byNo = jobs.find(j => j.number && hay.includes(j.number.toLowerCase())); if (byNo) return byNo.id;
    const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    let best = null, score = 0;
    for (const j of jobs) { const s = words(j.name + ' ' + j.client).filter(w => hay.includes(w)).length; if (s > score) { score = s; best = j; } }
    return best ? best.id : '';
  }

  ipcMain.handle('mail:read', wrap(async ({ files = [], text = '' }) => {
    const id = uid(), dir = path.join(DIR(), id); fs.mkdirSync(dir, { recursive: true });
    const content = [], parts = [], originals = [], attach = [];
    for (const f of files) {
      const buf = Buffer.from(f.base64, 'base64'), ext = path.extname(f.name).toLowerCase(), mime = f.mime || extMime(f.name);
      fs.writeFileSync(path.join(dir, f.name.replace(/[\\/:*?"<>|]+/g, '_')), buf); originals.push(f.name);
      if (ext === '.eml') { const m = parseEml(buf); parts.push(`From: ${m.from}\nTo: ${m.to}${m.cc ? '\nCc: ' + m.cc : ''}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`); m.attachments.forEach(a => { const n = a.name.replace(/[\\/:*?"<>|]+/g, '_'); fs.writeFileSync(path.join(dir, n), a.data); attach.push({ name: n, mime: a.mime }); }); }
      else if (ext === '.msg') parts.push(parseMsg(buf).body);
      else if (IMG.test(mime)) { attach.push({ name: f.name, mime }); }
      else if (mime === 'application/pdf') { attach.push({ name: f.name, mime }); }
      else parts.push(buf.toString('utf8'));
    }
    if (text.trim()) parts.push(text.trim());
    // screenshots and PDFs (sent or attached) go to Claude to read: up to 4
    for (const a of attach.filter(a => IMG.test(a.mime) || a.mime === 'application/pdf').slice(0, 4)) content.push(checker.contentBlock(a.mime === 'application/pdf' ? 'pdf' : 'image', a.name, fs.readFileSync(path.join(dir, a.name))));
    if (!parts.length && !content.length) throw new Error('Drop an email (.eml, .msg), a screenshot of it, or paste its text');
    content.push({ type: 'text', text: `THE EMAIL:\n${parts.join('\n\n---\n\n').slice(0, 30000)}${attach.length ? '\n\nATTACHMENTS: ' + attach.map(a => a.name).join(', ') : ''}` });
    const { text: reply } = await claudeFull({ system: EMAIL_SYSTEM, who: 'email', maxTokens: 3000, messages: [{ role: 'user', content }] });
    let e; try { e = dxfmaker.parseReply(reply); } catch { throw new Error('Eli could not read that email. Try a screenshot or paste the text.'); }
    const email = { id, at: new Date().toISOString(), from: e.from || '', subject: e.subject || '', date: e.date || '', summary: e.summary || '', site: e.site || '', jobNumber: e.jobNumber || '', reply: e.reply || '',
      asks: (e.asks || []).map((a, i) => ({ i, title: String(a.title || 'Task').slice(0, 160), detail: String(a.detail || ''), agent: AGENTS[a.agent] ? a.agent : 'none', kind: a.kind || 'other', due: a.due || '', status: 'proposed' })),
      originals, attachments: attach };
    email.jobId = matchJob(email);
    const list = load(); list.unshift(email); save(list);
    BIZ.log({ who: 'Eli', action: 'Read an email', jobId: email.jobId, detail: `${email.subject || email.summary} · ${email.asks.length} task${email.asks.length === 1 ? '' : 's'} proposed` });
    return email;
  }));
  ipcMain.handle('mail:list', wrap(() => load().slice(0, 30)));
  ipcMain.handle('mail:folders', wrap(({ id, jobId }) => { const e = load().find(x => x.id === id); const j = jobId && BIZ.data().jobs.find(x => x.id === jobId); return BIZ.projects.suggest({ number: j ? j.number : e && e.jobNumber, name: j ? j.name : '', text: e ? `${e.site} ${e.subject}` : '' }); }));

  // Tom says yes: job (existing or new), folder, task on the board, email filed in the job folder
  ipcMain.handle('mail:start', wrap(({ id, ask, jobId, newJob, folder }) => {
    const list = load(), e = list.find(x => x.id === id); if (!e) throw new Error('That email is gone');
    const a = e.asks[ask]; if (!a) throw new Error('No such task');
    const d = BIZ.data();
    let job = jobId && d.jobs.find(j => j.id === jobId);
    if (!job) { if (!newJob || !String(newJob.number || '').trim()) throw new Error('Pick a job or give the new job a number'); job = biz.saveJob(d, { number: newJob.number, name: newJob.name || e.site || e.subject, client: newJob.client || '', notes: `From email: ${e.subject}\n${e.summary}` }, 'Eli'); }
    if (folder && fs.existsSync(folder) && job.folder !== folder) { job.folder = folder; biz.audit(d, { who: 'Tom', action: 'Project folder linked', jobId: job.id, detail: folder }); }
    const task = biz.saveTask(d, { jobId: job.id, title: a.title, detail: `${a.detail}${a.due ? '\nDue: ' + a.due : ''}\n(From email: ${e.subject || e.from})`, agentId: a.agent === 'none' ? '' : a.agent, agentName: AGENT_NAME[a.agent] || '', status: a.agent === 'none' ? 'todo' : 'doing' }, 'Tom');
    BIZ.store.save();
    if (job.folder) {   // read the folder for context, and keep a copy of the email with the job
      try { BIZ.projects.gather(job.id, job.folder, { checker, dxffix: require('./dxffix') }); } catch {}
      try { const out = BIZ.projects.outputDir(job.folder, 'email'); for (const n of e.originals) { const src = path.join(DIR(), e.id, n.replace(/[\\/:*?"<>|]+/g, '_')), dst = path.join(out, n.replace(/[\\/:*?"<>|]+/g, '_')); if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst); } } catch {}
    }
    a.status = 'started'; a.jobId = job.id; a.taskId = task.id; e.jobId = job.id; save(list);
    return { email: e, task, job: { id: job.id, number: job.number, name: job.name, folder: job.folder || '' } };
  }));
  ipcMain.handle('mail:decline', wrap(({ id, ask }) => { const list = load(), e = list.find(x => x.id === id); if (e && e.asks[ask]) { e.asks[ask].status = 'declined'; save(list); } return e; }));
  ipcMain.handle('mail:open', wrap(({ id }) => { shell.openPath(path.join(DIR(), id)); return true; }));

  // ---------- Dex makes a DXF ----------
  ipcMain.handle('dex:make', wrap(async ({ jobId = '', request = '', answers = [], emailId = '' }) => {
    if (!String(request).trim()) throw new Error('Say what Dex should draw');
    const d = BIZ.data(), job = jobId && d.jobs.find(j => j.id === jobId);
    const skill = library.skillFor('dex', '');
    const system = dxfmaker.SYSTEM + (skill ? `\n\nYOUR SKILLS (house rules from the File Room):\n${skill.slice(0, 12000)}` : '') + (job ? '\n\n' + BIZ.contextFor(job.id, 'Dex') : '');
    const content = [];
    // the PDFs in the project folder that look relevant (an existing SLD, a schedule), and the email's screenshots / PDFs
    const pdfs = job ? BIZ.projects.relevantFiles(job.id, request, { exts: ['.pdf'], max: 3 }) : [];
    for (const p of pdfs) { try { content.push({ type: 'text', text: 'Project file: ' + path.basename(p) }); content.push(checker.contentBlock('pdf', p, fs.readFileSync(p))); } catch {} }
    const em = emailId && load().find(x => x.id === emailId);
    if (em) for (const a of em.attachments.slice(0, 3)) { try { const buf = fs.readFileSync(path.join(DIR(), em.id, a.name)); content.push({ type: 'text', text: 'From the email: ' + a.name }); content.push(checker.contentBlock(a.mime === 'application/pdf' ? 'pdf' : 'image', a.name, buf)); } catch {} }
    content.push({ type: 'text', text: `REQUEST: ${request}${answers.length ? '\n\nANSWERS FROM THE ENGINEER:\n' + answers.map(x => `Q: ${x.q}\nA: ${x.a}`).join('\n') : ''}` });
    const { text } = await claudeFull({ system, who: 'dex', maxTokens: 6000, messages: [{ role: 'user', content }] });
    const spec = dxfmaker.parseReply(text);
    if (spec.questions && spec.questions.length && !answers.length) return { questions: spec.questions.slice(0, 4).map(String), read: pdfs.map(p => path.basename(p)) };
    if (!spec.boards && !spec.busbars) throw new Error('Dex did not produce a drawing: ' + String(text).slice(0, 200));
    const outDir = (job && BIZ.outputDirFor(job.id, 'dxf')) || path.join(userDir(), 'dxf-made');
    const r = dxfmaker.make(spec, outDir, spec.drawingNumber && spec.drawingNumber !== 'TBC' ? spec.drawingNumber : (job ? job.number + '_SLD' : 'SLD'));
    BIZ.log({ who: 'Dex', action: 'Drew', jobId: job ? job.id : '', detail: `${path.basename(r.path)} · ${spec.summary || spec.title || 'SLD'}` });
    return { path: r.path, folder: outDir, svg: r.svg, summary: spec.summary || '', title: spec.title || '', notes: spec.notes || [], read: pdfs.map(p => path.basename(p)), inJobFolder: !!(job && job.folder) };
  }));
}

module.exports = { register, parseEml, parseMsg, EMAIL_SYSTEM, AGENTS };
