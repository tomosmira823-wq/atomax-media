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
const msgfile = require('./msgfile');

const AGENTS = {
  dex: 'Dex — DXF maker and fixer: draws NEW electrical drawings as DXF from the project files and attached documents (single line diagrams, earthing schematics / earthing design drawings), and fixes text on existing DXFs',
  cal: 'Cal — drawing checker: checks drawings against cable schedules and makes red markups',
  documents: 'Dot — documents: drafts Atomax-format Word documents (reports, study reports, quotations and fee proposals, transmittals, RAMS, method statements, letters)',
  milo: 'Milo — 3D modeller: changes an existing 3D model (adds a pipe, a rail, moves equipment)',
  theo: 'Theo — 3D builder: builds a new 3D model from scratch',
  eli: 'Eli himself — admin: sets up a new job number and its project folder (with Drawings, Documents and Correspondence folders) and files the email and attachments in it',
  excel: 'Lex — Excel: builds and edits workbooks (cable schedules, registers, trackers, calculation sheets) from the email, attachments and project files',
  word: 'Wren — Word: writes Atomax-format Word documents (reports, technical notes, letters, specifications) from the email, attachments and project files',
  engineer: 'Ada — general engineer: works through calculations, studies, feasibility checks and technical questions with Claude from the email, attachments and project files (e.g. a first-pass fault level check, cable sizing, an earthing estimate, can this be done without PowerFactory) and writes a technical note into the job folder, saying plainly what still needs proper study software or data',
  none: 'Tom himself: anything the agents cannot do (pricing, meetings, phone calls, site visits, replies that need a decision)'
};
const AGENT_NAME = { excel: 'Lex', word: 'Wren', dex: 'Dex', cal: 'Cal', documents: 'Dot', milo: 'Milo', theo: 'Theo', eli: 'Eli', engineer: 'Ada', none: '' };

const EMAIL_SYSTEM = `You are Eli, the email checker at the Atomax-UK reception. Atomax-UK is an electrical engineering consultancy (electrical CAD, drawings, schedules, document control).
Read the email (and any screenshots or attachments) and work out exactly what the sender is asking Atomax to do. Split it into separate tasks and give each one to the agent who can do it:
${Object.entries(AGENTS).map(([k, v]) => `- "${k}": ${v}`).join('\n')}
Rules for splitting and giving out work:
- Every separate piece of work the email names is its own task, even when the email lists them as one block or only asks for a price.
- Give a task to an agent whenever that agent can produce the drawing or document for it, or a first draft of it, even if engineering calculations or data are also needed (say what is needed in "detail", e.g. "draft earthing schematic from the fault level study; soil resistivity still needed for the design").
- Setting up a job, a job number or a project folder, and filing the email, is "eli". Calculations, studies, feasibility tests and technical questions are "engineer" (Ada does a first pass and says what needs PowerFactory / ETAP).
- Use "none" only for things that need a person: a decision, a price, a phone call or meeting, a site visit.
- If the email asks for a quote or fee proposal, add one task for "documents" to draft the quotation letter listing every item.
- Read attached PDFs and drawings: they tell you what an agent can work from (an SLD, a fault level study, cable data).
Forwarded emails: the person forwarding it (often someone at Atomax) may add their own instruction on top ("set this up", "can we do this", "test if this can be done"). List their instruction AND every item the original sender asked for, each as its own task for the agent who can do it. A "can we do this / test it" instruction means: give each item to its agent so the result shows whether it can be done.
Who does what (use these, do not send them to "none"):
- Earthing design: two tasks, "dex" draws the earthing schematic, "engineer" does the earthing calculations (fault current, conductor sizing, what soil data is needed).
- SLDs and other electrical drawings: "dex".
- Fault level, load flow, reactive power capability, protection co-ordination, harmonics (G5/5), flicker and unbalance (P28 / P29), G99 / G100 compliance studies, intertripping scheme design: "engineer" for a first-pass note (say in the detail that a full study needs PowerFactory if it does).
- A quote or fee proposal: "documents".
Existing jobs: the list of Atomax's jobs is given below the email. If the email is about one of them (same job number, site, client or project), set "existingJob" to that job number and do not add an "eli" task to set the job up again.
Client comments: if the email returns comments on issued drawings or documents (a comment sheet, a marked-up PDF, "please address the following"), set "commentReturn": true, list every comment under "comments" (document number, the comment as written, who made it) and make one task per document for the agent who changes it (drawings: "dex", schedules and registers: "excel", documents: "documents" or "word").
Deliverables: list what Atomax is being asked to produce under "deliverables" (e.g. {"type":"BCD","title":"Block cable diagram - Malt RIO1","qty":2}, {"type":"cable schedule","title":"Cable schedule","qty":1}); type is one of BCD, cable schedule, SLD, earthing, loop, layout, document, other.
Inputs: list every input document the client sent or refers to under "inputs" with its revision as written, and under "missingInputs" what is needed to do the work properly but has not been sent (e.g. instrument index, IO list, cable datasheets, latest tag list, panel GA).
Only list real asks from the email. Do not invent work. Copy site names, job numbers, drawing numbers, ratings and dates exactly as written.
Also work out, from the whole thread:
- who is who: the client asking, anyone the quote or work is for or must go to, the Atomax person forwarding and what they want.
- how urgent it is, in their words.
- what each attachment is (read it) and which tasks can use it.
- what Atomax still needs from the client before the work can be done properly (data, drawings, site info), as short questions.
The suggested reply goes to the person who should get it (say who), answers what was asked (turnaround, quote to follow), and asks those questions. Plain British English, short, no promises on price or dates that Tom has not given.
${require('./docnumber').RULES_TEXT}
Reply with JSON only, no markdown:
{"from":"name <address>","subject":"...","date":"...","summary":"two or three lines: who wants what, for which site, and any instruction from the person forwarding","site":"site or project name, as written","jobNumber":"a job number if one is written (e.g. X11475), else empty",
"people":[{"name":"...","company":"...","role":"e.g. client asking for the quote / the quote goes to / forwarded it at Atomax"}],
"urgency":"urgent|normal","urgencyWhy":"their words, e.g. 'really urgent, ASAP'",
"attachmentNotes":[{"name":"file name","what":"what it is, in a line","usefulFor":"which tasks can use it"}],
"asks":[{"title":"short task title, e.g. Draw the earthing schematic for Gwrhyd PV Farm","detail":"everything the agent needs for this task: what to produce, which attachment to use and the key data from it, what is missing","agent":"dex|engineer|documents|cal|milo|theo|eli|none","kind":"sld|earthing|dxf-fix|drawing-check|document|study|model|admin|other","due":"deadline if given, else empty"}],
"clientQuestions":["short question for the client"],
"existingJob":"job number from the existing jobs list if this email is about one, else empty",
"deliverables":[{"type":"BCD|cable schedule|SLD|earthing|loop|layout|document|other","title":"...","qty":1}],
"inputs":[{"name":"document name or number as written","rev":"revision if shown","what":"what it is"}],"missingInputs":["..."],
"commentReturn":false,"comments":[{"doc":"document number","comment":"as written","by":"name"}],
"replyTo":"name <address> the reply should go to","reply":"the suggested reply"}`;

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
// Outlook .msg is a binary container. The full message (including anything forwarded) is usually stored as HTML; the transport headers carry From / To / Subject.
const htmlToText = (h) => h.replace(/<head[\s\S]*?<\/head>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n))
  .replace(/[\x91\x92]/g, "'").replace(/[\x93\x94]/g, '"').replace(/\x96|\x97/g, '-')
  .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
function parseMsg(buf) {
  // the proper reader first (body, headers and attachments); the text scrape below only if the file will not open as a compound file
  try {
    const m = msgfile.readMsg(buf);
    const body = (m.html ? htmlToText(m.html) : '') || m.text;
    if (body && body.length > 20) return { from: m.fromName + (m.fromEmail ? ' <' + m.fromEmail + '>' : ''), to: m.to, cc: m.cc, subject: m.subject, date: ((m.headers || '').match(/(?:^|\n)Date:[ \t]*([^\r\n]+)/i) || [])[1] || '', body: body.slice(0, 30000), attachments: m.attachments.filter(a => !a.inline) };
  } catch {}
  const lat = buf.toString('latin1');
  const u16 = buf.toString('utf16le');   // the transport headers are stored as UTF-16
  const hdr = (k) => (u16.match(new RegExp('(?:^|\n)' + k + ':[ \t]*([^\r\n]+(?:\r?\n[ \t]+[^\r\n]+)*)', 'i')) || lat.match(new RegExp('(?:^|\\n)' + k + ':[ \\t]*([^\\r\\n]+(?:\\r?\\n[ \\t]+[^\\r\\n]+)*)', 'i')) || [])[1] || '';
  // the HTML body (Outlook keeps forwarded emails here); there can be more than one copy, take the longest
  let html = '', at = 0;
  for (;;) { const hs = lat.indexOf('<html', at); if (hs < 0) break; const he = lat.indexOf('</html>', hs); const chunk = lat.slice(hs, he > 0 ? he + 7 : Math.min(lat.length, hs + 400000)); if (chunk.length > html.length) html = chunk; at = hs + 5; }
  let body = html ? htmlToText(html) : '';
  if (body.length < 40) {   // no HTML: fall back to the readable UTF-16 text runs, without Outlook's internal names
    const runs = (buf.toString('utf16le').match(/[\x20-\x7E\u00A0-\u017F\r\n\t]{12,}/g) || []).map(x => x.trim())
      .filter(x => x.length > 12 && !/^__substg|^\/O=EXCHANGE|^[A-Za-z0-9+\/=]{40,}$|^[A-Z0-9_]+$/.test(x));
    body = [...new Set(runs)].join('\n');
  }
  const clean = (v) => decodeWords(v.replace(/\r?\n[ \t]+/g, ' ').trim());
  return { from: clean(hdr('From')), to: clean(hdr('To')), cc: clean(hdr('Cc')), subject: clean(hdr('Subject')), date: clean(hdr('Date')), body: body.slice(0, 30000), attachments: [] };
}

// Drawing work always reaches Dex, whatever Claude decided: if the email (or Eli's own tasks) mention a drawing Dex can make and no task is his, add one.
const DRAWINGS = [
  { re: /earthing\s*(design|layout|schematic|drawing|arrangement|system|study)?|earth(ing)?\s*(grid|mat|mesh)/i, kind: 'earthing', title: (site) => `Draw the earthing schematic${site ? ' for ' + site : ''}` },
  { re: /\b(sld|slds|single[\s-]*line(\s*diagram)?s?)\b/i, kind: 'sld', title: (site) => `Draw the single line diagram${site ? ' for ' + site : ''}` },
];
function ensureDrafter(email, emailText = '') {
  const asksText = (a) => a.title + ' ' + a.detail;
  for (const d of DRAWINGS) {
    const inEmail = d.re.test(emailText) || d.re.test(email.summary || '') || email.asks.some(a => d.re.test(asksText(a)));
    if (!inEmail) continue;
    if (email.asks.some(a => a.agent === 'dex' && (d.re.test(asksText(a)) || a.kind === d.kind))) continue;
    const related = email.asks.filter(a => d.re.test(asksText(a)));
    email.asks.push({ i: email.asks.length, title: d.title(email.site), detail: `Dex draws a first draft from the email and its attachments${related.length ? ': ' + related.map(a => a.title).join('; ') : ''}. Anything not in the documents is marked TBC.`, agent: 'dex', kind: d.kind, due: (related[0] || {}).due || '', status: 'proposed', auto: true });
  }
  return email;
}

function register({ ipcMain, dialog, shell, getWin, userDir, claudeFull, checker, BIZ, loadSettings, saveSettings }) {
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
    const ex = String(e.existingJob || '').trim().toLowerCase(); const byEli = ex && jobs.find(j => j.number.toLowerCase() === ex); if (byEli) return byEli.id;
    const byNo = jobs.find(j => j.number && hay.includes(j.number.toLowerCase())); if (byNo) return byNo.id;
    const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    let best = null, score = 0;
    for (const j of jobs) { const s = words(j.name + ' ' + j.client).filter(w => hay.includes(w)).length; if (s > score) { score = s; best = j; } }
    return best ? best.id : '';
  }

  const readEmail = async ({ files = [], text = '', reuseId = '', paths = [], skills }) => {
    files = [...files, ...paths.filter(p => fs.existsSync(p)).map(p => ({ name: path.basename(p), mime: extMime(p), base64: fs.readFileSync(p).toString('base64') }))];
    const id = reuseId || uid(), dir = path.join(DIR(), id); fs.mkdirSync(dir, { recursive: true });
    const content = [], parts = [], originals = [], attach = [];
    for (const f of files) {
      const buf = Buffer.from(f.base64, 'base64'), ext = path.extname(f.name).toLowerCase(), mime = f.mime || extMime(f.name);
      fs.writeFileSync(path.join(dir, f.name.replace(/[\\/:*?"<>|]+/g, '_')), buf); originals.push(f.name);
      if (ext === '.eml') { const m = parseEml(buf); parts.push(`From: ${m.from}\nTo: ${m.to}${m.cc ? '\nCc: ' + m.cc : ''}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`); m.attachments.forEach(a => { const n = a.name.replace(/[\\/:*?"<>|]+/g, '_'); fs.writeFileSync(path.join(dir, n), a.data); attach.push({ name: n, mime: a.mime }); }); }
      else if (ext === '.msg') { const m = parseMsg(buf); parts.push(`From: ${m.from}\nTo: ${m.to}${m.cc ? '\nCc: ' + m.cc : ''}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`); m.attachments.forEach(a => { const n = a.name.replace(/[\\/:*?"<>|]+/g, '_'); fs.writeFileSync(path.join(dir, n), a.data); attach.push({ name: n, mime: a.mime || extMime(n) }); }); }
      else if (IMG.test(mime)) { attach.push({ name: f.name, mime }); }
      else if (mime === 'application/pdf') { attach.push({ name: f.name, mime }); }
      else parts.push(buf.toString('utf8'));
    }
    // the same file dropped and also inside the email (or dropped twice): keep the first copy, matched by contents or name
    { const seen = new Set(), keep = []; for (const x of attach) { let key = x.name; try { key = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(dir, x.name))).digest('hex'); } catch {} if (seen.has(key) || seen.has('n:' + x.name)) continue; seen.add(key); seen.add('n:' + x.name); keep.push(x); } attach.length = 0; attach.push(...keep); }
    if (text.trim()) parts.push(text.trim());
    // screenshots and PDFs (sent or attached) go to Claude to read: up to 4
    for (const a of attach.filter(a => IMG.test(a.mime) || a.mime === 'application/pdf').slice(0, 4)) content.push(checker.contentBlock(a.mime === 'application/pdf' ? 'pdf' : 'image', a.name, fs.readFileSync(path.join(dir, a.name))));
    if (!parts.length && !content.length) throw new Error('Drop an email (.eml, .msg), a screenshot of it, or paste its text');
    content.push({ type: 'text', text: `THE EMAIL:\n${parts.join('\n\n---\n\n').slice(0, 30000)}${attach.length ? '\n\nATTACHMENTS: ' + attach.map(a => a.name).join(', ') : ''}` });
    const jobsList = BIZ.data().jobs.filter(j => j.status !== 'Closed').slice(0, 80).map(j => `- ${j.number} ${j.name}${j.client ? ' (' + j.client + ')' : ''}`).join('\n');
    content.push({ type: 'text', text: 'EXISTING JOBS:\n' + (jobsList || '(none yet)') });
    let r = await claudeFull({ system: EMAIL_SYSTEM, who: 'email', skills, maxTokens: 8000, messages: [{ role: 'user', content }] });
    if (r.stop === 'max_tokens') r = await claudeFull({ system: EMAIL_SYSTEM + '\nKeep every field short: details under 60 words, the reply under 150 words.', who: 'email', skills, maxTokens: 16000, messages: [{ role: 'user', content }] });
    const reply = r.text;
    try { fs.writeFileSync(path.join(dir, 'eli-reply.txt'), String(reply || '')); } catch {}   // kept next to the email so a bad reply can be looked at
    let e; try { e = dxfmaker.parseReply(reply); } catch (err) { throw new Error(`Eli got a reply he could not read (${r.stop === 'max_tokens' ? 'it was cut off' : String(err.message || err).slice(0, 80)}). It is saved as eli-reply.txt with the email. Press Read it again.`); }
    const email = { id, at: new Date().toISOString(), from: e.from || '', subject: e.subject || '', date: e.date || '', summary: e.summary || '', site: e.site || '', jobNumber: e.jobNumber || '', reply: e.reply || '', replyTo: e.replyTo || '',
      people: Array.isArray(e.people) ? e.people.slice(0, 8) : [], urgency: e.urgency === 'urgent' ? 'urgent' : 'normal', urgencyWhy: e.urgencyWhy || '', attachmentNotes: Array.isArray(e.attachmentNotes) ? e.attachmentNotes.slice(0, 10) : [], clientQuestions: Array.isArray(e.clientQuestions) ? e.clientQuestions.slice(0, 8).map(String) : [],
      asks: (e.asks || []).map((a, i) => ({ i, title: String(a.title || 'Task').slice(0, 160), detail: String(a.detail || ''), agent: AGENTS[a.agent] ? a.agent : 'none', kind: a.kind || 'other', due: a.due || '', status: 'proposed' })),
      originals, attachments: attach, pasted: text || '',
      existingJob: String(e.existingJob || ''), deliverables: Array.isArray(e.deliverables) ? e.deliverables.slice(0, 20) : [], inputs: Array.isArray(e.inputs) ? e.inputs.slice(0, 40) : [], missingInputs: Array.isArray(e.missingInputs) ? e.missingInputs.slice(0, 20).map(String) : [],
      commentReturn: !!e.commentReturn, comments: Array.isArray(e.comments) ? e.comments.slice(0, 200) : [] };
    if (!email.commentReturn) ensureDrafter(email, parts.join('\n'));
    email.jobId = matchJob(email);
    // an existing job: no second "set up the job" task; a job folder on disk that is not yet a job in the office is offered for linking
    if (email.jobId) email.asks = email.asks.filter(a => a.agent !== 'eli' || !/set ?up|new job|job number|project folder/i.test(a.title + ' ' + a.detail)).map((a, i) => ({ ...a, i }));
    else if (email.jobNumber) { try { const f = BIZ.projects.suggest({ number: email.jobNumber }, { limitMs: 2500 }).find(x => x.why && /number/i.test(x.why)); if (f) email.folderFound = f.path; } catch {} }
    const list = load(), at = reuseId ? list.findIndex(x => x.id === reuseId) : -1;
    if (at >= 0) list[at] = email; else list.unshift(email); save(list);
    BIZ.log({ who: 'Eli', action: 'Read an email', jobId: email.jobId, detail: `${email.subject || email.summary} · ${email.asks.length} task${email.asks.length === 1 ? '' : 's'} proposed` });
    return email;
  };
  ipcMain.handle('mail:read', wrap(readEmail));
  // read an email again (after Eli's rules change): the same files and pasted text, a fresh list of tasks; tasks already started are kept
  ipcMain.handle('mail:reread', wrap(async ({ id }) => {
    const old = load().find(x => x.id === id); if (!old) throw new Error('That email is gone');
    const files = (old.originals || []).map(n => { const p = path.join(DIR(), id, n.replace(/[\\/:*?"<>|]+/g, '_')); return fs.existsSync(p) ? { name: n, mime: extMime(n), base64: fs.readFileSync(p).toString('base64') } : null; }).filter(Boolean);
    const e = await readEmail({ files, text: old.pasted || '', reuseId: id });
    const kept = old.asks.filter(a => a.status !== 'proposed');
    if (kept.length) { e.asks = [...kept, ...e.asks.filter(n => !kept.some(k => k.title.toLowerCase() === n.title.toLowerCase()))].map((a, i) => ({ ...a, i })); const list = load(); list[list.findIndex(x => x.id === id)] = e; save(list); }
    return e;
  }));
  ipcMain.handle('mail:list', wrap(() => load().slice(0, 30)));
  ipcMain.handle('mail:folders', wrap(({ id, jobId }) => { const e = load().find(x => x.id === id); const j = jobId && BIZ.data().jobs.find(x => x.id === jobId); return BIZ.projects.suggest({ number: j ? j.number : e && e.jobNumber, name: j ? j.name : '', text: e ? `${e.site} ${e.subject}` : '' }); }));

  // Tom says yes: job (existing or new), folder, task on the board, email filed in the job folder
  // where a new job folder would go, and the next free job number
  ipcMain.handle('mail:defaults', wrap(() => {
    const known = BIZ.data().jobs.map(j => j.number), s = loadSettings ? loadSettings() : {};
    const saved = s.jobsFolder && fs.existsSync(s.jobsFolder) ? s.jobsFolder : '';
    const guess = saved ? '' : BIZ.projects.jobParent(known);
    return { saved, guess, nextNumber: BIZ.projects.nextJobNumber(known, saved || guess) };
  }));
  // Tom says where his job folders live; remembered for next time
  ipcMain.handle('mail:setJobsFolder', wrap(({ folder }) => { if (!folder || !fs.existsSync(folder)) throw new Error('That folder does not exist'); if (saveSettings && loadSettings) saveSettings({ ...loadSettings(), jobsFolder: folder }); return { saved: folder, nextNumber: BIZ.projects.nextJobNumber(BIZ.data().jobs.map(j => j.number), folder) }; }));
  ipcMain.handle('mail:pickParent', wrap(async () => { const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'], title: 'Where should the new job folder go?' }); return r.canceled ? null : r.filePaths[0]; }));
  ipcMain.handle('mail:start', wrap(({ id, ask, jobId, newJob, folder, createIn }) => {
    const list = load(), e = list.find(x => x.id === id); if (!e) throw new Error('That email is gone');
    const a = e.asks[ask]; if (!a) throw new Error('No such task');
    const d = BIZ.data();
    let job = jobId && d.jobs.find(j => j.id === jobId);
    if (!job) { if (!newJob || !String(newJob.number || '').trim()) throw new Error('Pick a job or give the new job a number'); job = biz.saveJob(d, { number: newJob.number, name: newJob.name || e.site || e.subject, client: newJob.client || '', notes: `From email: ${e.subject}\n${e.summary}` }, 'Eli'); }
    if (createIn) { const s = loadSettings ? loadSettings() : {}; if (!s.jobsFolder || s.jobsFolder !== createIn) throw new Error('Confirm where your job folders live first'); folder = BIZ.projects.createJobFolder(createIn, job.number, job.name); }   // a new folder for the job, next to the other job folders
    if (folder && fs.existsSync(folder) && job.folder !== folder) { job.folder = folder; biz.audit(d, { who: 'Tom', action: 'Project folder linked', jobId: job.id, detail: folder }); }
    const task = biz.saveTask(d, { jobId: job.id, title: a.title, detail: `${a.detail}${a.due ? '\nDue: ' + a.due : ''}\n(From email: ${e.subject || e.from})`, agentId: a.agent === 'none' ? '' : a.agent, agentName: AGENT_NAME[a.agent] || '', status: a.agent === 'none' ? 'todo' : a.agent === 'eli' ? 'done' : 'doing' }, 'Tom');
    BIZ.store.save();
    if (job.folder) {   // read the folder for context, and keep a copy of the email with the job
      try { BIZ.projects.gather(job.id, job.folder, { checker, dxffix: require('./dxffix') }); } catch {}
      try { const out = BIZ.projects.outputDir(job.folder, 'email'); for (const n of [...e.originals, ...(e.attachments || []).map(x => x.name)]) { const src = path.join(DIR(), e.id, n.replace(/[\\/:*?"<>|]+/g, '_')), dst = path.join(out, n.replace(/[\\/:*?"<>|]+/g, '_')); if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst); } } catch {}
    }
    a.status = 'started'; a.jobId = job.id; a.taskId = task.id; e.jobId = job.id;
    // the first task started for a job files the email's job admin: register checked, deliverables listed, inputs and RFIs, client comments
    e.desk = e.desk || {};
    if (!e.desk[job.id]) {
      const desk = require('./jobdesk'), r = {};
      try { r.register = desk.checkRegister(job.id, checker); } catch (err) { r.register = { error: err.message }; }
      try { r.deliverables = desk.addDeliverables(job.id, e.deliverables || []); } catch {}
      try { desk.addInputs(job.id, { inputs: e.inputs || [], missing: e.missingInputs || [], questions: e.clientQuestions || [], fromEmail: e.subject || e.from }); r.rfis = (e.missingInputs || []).length + (e.clientQuestions || []).length; } catch {}
      if (e.commentReturn && e.comments.length) { try { r.comments = desk.addComments(job.id, e.comments, e.subject || e.from).length; } catch {} }
      e.desk[job.id] = r;
    }
    if (a.agent === 'eli') { a.status = 'done'; a.result = { summary: job.folder ? 'Job ' + job.number + ' set up, folder ready and the email filed in it.' : 'Job ' + job.number + ' set up (no folder).', path: job.folder || '' }; BIZ.log({ who: 'Eli', action: 'Set up job', jobId: job.id, detail: job.number + (job.folder ? ' · ' + job.folder : '') }); }
    save(list);
    return { email: e, task, desk: e.desk[job.id], job: { id: job.id, number: job.number, name: job.name, folder: job.folder || '' } };
  }));
  ipcMain.handle('mail:reassign', wrap(({ id, ask, agent }) => { const list = load(), e = list.find(x => x.id === id); if (!e || !e.asks[ask] || !AGENTS[agent]) throw new Error('Cannot change that task'); e.asks[ask].agent = agent; save(list); return e; }));
  ipcMain.handle('mail:decline', wrap(({ id, ask }) => { const list = load(), e = list.find(x => x.id === id); if (e && e.asks[ask]) { e.asks[ask].status = 'declined'; save(list); } return e; }));
  ipcMain.handle('mail:open', wrap(({ id }) => { shell.openPath(path.join(DIR(), id)); return true; }));

  // ---------- Ada works a technical task ----------
  const ENG_SYSTEM = `You are Ada, the general engineer at Atomax-UK (electrical engineering consultancy, UK). Work through the task using only the email, its attachments and the project files given. Use standard methods: IEC 60909 for fault levels, BS 7671 / IEC 60364 for cable sizing, ENA TS 41-24 / IEEE 80 for earthing, G99 / G5/5 / P28 / P29 for grid code questions.
Show where every input came from (document and table). Do the arithmetic step by step and check it. Never invent data: if something is missing, say what and why it matters.
Be honest about limits: a first-pass hand calculation is not a full study. Say plainly what can be relied on, what needs PowerFactory / ETAP, and what data is still needed.
Write in plain British English as Markdown: "# title", "## Summary" (3 lines max, the answer first), "## Inputs used", "## Method and working", "## Results" (tables), "## Limits and what is still needed".
EARTHING tasks: size every protective / earth conductor the drawing needs (MET to each switchboard, transformer tank and neutral links, RMU earth bars, cable screen bonds, mesh and electrode tails) with the adiabatic equation S = I·√t / k (BS 7671 543.1.3 / ENA TS 41-24), using the documented earth fault currents for each voltage level. State the fault duration t (the protection clearing time if documented, otherwise ENA TS 41-24 1 s for 33 kV / 11 kV and 3 s for conductor rating checks) and k (Cu 143, bare Cu 159 for buried conductors, Al 94, with the table reference) as assumptions. Round up to the next standard size (mm²) and give a "## Conductor schedule" table: From | To | Fault current (kA) | t (s) | k | Min size (mm²) | Selected size and material. Electrode count, mesh size and rise of earth potential need soil resistivity: if it is not given, say so and leave those TBC.`;
  ipcMain.handle('eng:run', wrap(async ({ id, ask, skills }) => {
    const list = load(), e = list.find(x => x.id === id); if (!e || !e.asks[ask]) throw new Error('No such task');
    const a = e.asks[ask], job = a.jobId && BIZ.data().jobs.find(j => j.id === a.jobId);
    const content = [];
    for (const at of e.attachments.slice(0, 4)) { try { const buf = fs.readFileSync(path.join(DIR(), e.id, at.name)); content.push({ type: 'text', text: 'Attachment: ' + at.name }); content.push(checker.contentBlock(at.mime === 'application/pdf' ? 'pdf' : 'image', at.name, buf)); } catch {} }
    const pdfs = job ? BIZ.projects.relevantFiles(job.id, a.title + ' ' + a.detail, { exts: ['.pdf'], max: 2 }).filter(p => !e.attachments.some(x => x.name === path.basename(p))) : [];
    for (const p of pdfs) { try { content.push({ type: 'text', text: 'Project file: ' + path.basename(p) }); content.push(checker.contentBlock('pdf', p, fs.readFileSync(p))); } catch {} }
    content.push({ type: 'text', text: `THE TASK: ${a.title}\n${a.detail}\n\nFROM THE EMAIL (${e.from}, "${e.subject}"): ${e.summary}` });
    const system = ENG_SYSTEM + (job ? '\n\n' + BIZ.contextFor(job.id, 'Ada') : '');
    // a long study can use up the reply before any text comes out: give her room, try once more with more, never save an empty note
    let r = await claudeFull({ system, who: 'engineer', skills, maxTokens: 16000, messages: [{ role: 'user', content }] });
    let text = String(r.text || '').trim();
    if (!text || r.stop === 'max_tokens' && text.length < 400) { r = await claudeFull({ system: system + '\nKeep the note under 2500 words: summary and results first, the full working only for the key nodes.', who: 'engineer', skills, maxTokens: 32000, messages: [{ role: 'user', content }] }); text = String(r.text || '').trim(); }
    if (!text) throw new Error(`Ada got an empty reply from Claude (stop reason: ${r.stop || 'unknown'}). Press "Ask Ada again", or pick another Claude model in Settings.`);
    if (r.stop === 'max_tokens') text += '\n\n_(Ada ran out of room here: the note is cut short. Ask her again for the rest.)_';
    const outDir = (job && BIZ.outputDirFor(job.id, 'documents')) || path.join(userDir(), 'engineering');
    fs.mkdirSync(outDir, { recursive: true });
    const safe = a.title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 70);
    let file = path.join(outDir, `Technical note - ${safe}.md`), k = 2; while (fs.existsSync(file)) file = path.join(outDir, `Technical note - ${safe} (${k++}).md`);
    fs.writeFileSync(file, text, 'utf8');
    // read the job folder again so Dex and the others see this note
    if (job && job.folder) { try { BIZ.projects.gather(job.id, job.folder, { checker, dxffix: require('./dxffix') }); } catch {} }
    const summary = ((text.match(/## Summary\s*\n([\s\S]*?)(\n## |$)/) || [])[1] || text.slice(0, 400)).trim();
    a.status = 'done'; a.result = { summary, path: file, text: text.slice(0, 20000) }; save(list);
    if (a.taskId) { try { const d = BIZ.data(); const t = d.tasks.find(x => x.id === a.taskId); if (t) { biz.saveTask(d, { ...t, status: 'done', note: 'Note: ' + path.basename(file) }, 'Ada'); BIZ.store.save(); } } catch {} }
    BIZ.log({ who: 'Ada', action: 'Wrote a technical note', jobId: a.jobId || '', detail: path.basename(file) + ' · ' + summary.slice(0, 160) });
    return { email: e, result: a.result };
  }));

  // ---------- Dex makes a DXF ----------
  ipcMain.handle('dex:make', wrap(async ({ jobId = '', request = '', answers = [], emailId = '', skills, revision = null }) => {
    if (!String(request).trim()) throw new Error('Say what Dex should draw');
    const d = BIZ.data(), job = jobId && d.jobs.find(j => j.id === jobId);
    // his skills for MAKING a drawing: drawing skills first, fixer-only rules and spreadsheet skills only when the request needs them
    const all = library.skillsFor('dex');
    const wantsSheets = /excel|xlsx|schedule|spreadsheet/i.test(request), wantsFix = /\b(fix|correct|redline|markup)\b/i.test(request);
    const rank = (sk) => /sld|single.?line|dxf|cad|earth|drawing|schematic/i.test(sk.name + ' ' + sk.file) ? 0 : 1;
    // the skills Tom ticked for this run win; otherwise his drawing skills (fixer-only and spreadsheet skills only when the request needs them)
    const lib = library.list('skills');
    // by default only the skills made for THIS kind of drawing (an SLD skill is not used for earthing), plus general CAD house rules; none if nothing fits
    const DK = require('./drawkinds'), kind = DK.kindOf(request);
    const picked = (Array.isArray(skills) ? skills.map(f => { const i = lib.find(x => x.file === f); return i ? { name: i.name, file: i.file, text: library.readText('skills', i.file).trim() } : null; }).filter(x => x && x.text) : all.filter(sk => { const fit = DK.skillFit({ ...sk, description: (lib.find(x => x.file === sk.file) || {}).description }, kind); return fit || (wantsFix && /fix/i.test(sk.name) && !DK.skillKinds(sk).some(k => k !== kind)) || (wantsSheets && /excel|xlsx|spreadsheet/i.test(sk.name + ' ' + sk.file)); })).sort((a, b) => rank(a) - rank(b));
    let room = 30000; const used = [];
    const skillText = picked.map(sk => { if (room <= 0) return ''; const t = sk.text.slice(0, room); room -= t.length; used.push(sk.name + (t.length < sk.text.length ? ' (cut short)' : '')); return `--- SKILL: ${sk.name} ---\n${t}`; }).filter(Boolean).join('\n\n');
    const system = dxfmaker.SYSTEM + (skillText ? `\n\nYOUR SKILLS (house rules from the File Room; follow them where they fit this drawing):\n${skillText}` : '') + (job ? '\n\n' + BIZ.contextFor(job.id, 'Dex') : '');
    const content = [];
    // the PDFs in the project folder that look relevant (an existing SLD, a schedule), and the email's screenshots / PDFs
    const pdfs = job ? BIZ.projects.relevantFiles(job.id, request, { exts: ['.pdf'], max: 3 }) : [];
    for (const p of pdfs) { try { content.push({ type: 'text', text: 'Project file: ' + path.basename(p) }); content.push(checker.contentBlock('pdf', p, fs.readFileSync(p))); } catch {} }
    const em = emailId && load().find(x => x.id === emailId);
    if (em) for (const a of em.attachments.slice(0, 3)) { try { const buf = fs.readFileSync(path.join(DIR(), em.id, a.name)); content.push({ type: 'text', text: 'From the email: ' + a.name }); content.push(checker.contentBlock(a.mime === 'application/pdf' ? 'pdf' : 'image', a.name, buf)); } catch {} }
    // the engineer's technical notes for this job (conductor sizes, electrode design): Dex draws from these instead of TBC
    const notesRead = [];
    try { const nd = job && BIZ.outputDirFor(job.id, 'documents'); if (nd && fs.existsSync(nd)) { const want = /earth/i.test(request) ? /earth/i : /./; const ns = fs.readdirSync(nd).filter(f => /^Technical note - .*\.md$/i.test(f)).map(f => ({ f, t: fs.statSync(path.join(nd, f)).mtimeMs })).sort((a, b) => b.t - a.t).filter(x => want.test(x.f) || /earth|conductor/i.test(fs.readFileSync(path.join(nd, x.f), 'utf8').slice(0, 3000))).slice(0, 2); for (const n of ns) { content.push({ type: 'text', text: `ENGINEER'S TECHNICAL NOTE (${n.f}) - use its sizes and say "per ${n.f.replace(/\.md$/, '')}" in the notes:\n` + fs.readFileSync(path.join(nd, n.f), 'utf8').slice(0, 20000) }); notesRead.push(n.f); } } } catch {}
    content.push({ type: 'text', text: `REQUEST: ${request}${answers.length ? '\n\nANSWERS FROM THE ENGINEER:\n' + answers.map(x => `Q: ${x.q}\nA: ${x.a}`).join('\n') : ''}` });
    // a big site needs a long spec: give room, retry with more if it is cut off, and never pass off a cut-off spec as complete
    let r = await claudeFull({ system, who: 'dex', skills: false, maxTokens: 12000, messages: [{ role: 'user', content }] });
    if (r.stop === 'max_tokens') r = await claudeFull({ system: system + '\nKeep labels short (four lines at most) and give a feeder label only when it adds something the end item label does not say.', who: 'dex', skills: false, maxTokens: 24000, messages: [{ role: 'user', content }] });
    const text = r.text, cutOff = r.stop === 'max_tokens';
    const spec = dxfmaker.parseReply(text);
    if (spec.questions && spec.questions.length && !answers.length) return { questions: spec.questions.slice(0, 4).map(String), read: [...pdfs.map(p => path.basename(p)), ...notesRead], skills: used };
    if (kind === 'bcd' || (Array.isArray(spec.cables) && spec.cables.length && !spec.boards)) spec.kind = 'bcd';
    // National Grid jobs and LVAC block diagrams use the National Grid style (filled energised / de-energised blocks, coloured cable runs, legend)
    if (spec.kind === 'bcd' && !spec.style && (/national grid|\bNGET?\b|\blvac\b/i.test(request) || (job && /national grid/i.test(job.client || '')))) spec.style = 'ng';
    if (spec.kind === 'bcd' ? !(spec.cables || []).length : (!spec.boards && !spec.busbars)) throw new Error('Dex did not produce a drawing: ' + String(text).slice(0, 200));
    const desk = require('./jobdesk'), DN = require('./docnumber');
    // a BCD made from an approved master list must carry exactly its cables (for the panels drawn): missing ones are added, extra ones flagged
    let masterCheck = null;
    if (spec.kind === 'bcd' && job) {
      const m = desk.masterOf(job.id);
      if (m && m.status === 'approved') {
        const panels = new Set((spec.nodes || []).filter(n => /panel|rio|mcc/i.test(n.type || '')).map(n => String(n.tag).toUpperCase()));
        const touches = (c) => panels.has(String(c.from).toUpperCase()) || panels.has(String(c.to).toUpperCase()) || (spec.cables || []).some(x => [x.from, x.to].map(v => String(v).toUpperCase()).includes(String(c.from).toUpperCase()) && [x.from, x.to].map(v => String(v).toUpperCase()).includes(String(c.to).toUpperCase()));
        const mine = new Set(spec.cables.map(c => String(c.no).toUpperCase())), inMaster = new Set(m.cables.map(c => String(c.no).toUpperCase()));
        const devs = new Set(spec.cables.flatMap(c => [c.from, c.to]).map(v => String(v).toUpperCase()));
        const missing = m.cables.filter(c => !mine.has(String(c.no).toUpperCase()) && (devs.has(String(c.from).toUpperCase()) || devs.has(String(c.to).toUpperCase())));
        const extra = spec.cables.filter(c => !inMaster.has(String(c.no).toUpperCase()));
        missing.forEach(c => spec.cables.push({ no: c.no, from: c.from, to: c.to, type: c.type, cores: c.cores, size: c.size }));
        if (missing.length) spec.notes = [...(spec.notes || []), `Added from the master list (Dex had left them out): ${missing.map(c => c.no).join(', ')}`];
        if (extra.length) spec.notes = [...(spec.notes || []), `NOT ON THE MASTER LIST, check: ${extra.map(c => c.no).join(', ')}`];
        masterCheck = { added: missing.map(c => c.no), extra: extra.map(c => c.no), touches: !!touches };
      }
    }
    // the drawing number: from the job's drawing list when one matches, else the next QS 006 number for this kind
    if (job && (!spec.drawingNumber || /tbc/i.test(spec.drawingNumber))) {
      const want = spec.kind === 'bcd' ? /bcd|block cable/i : spec.kind === 'earthing' ? /earth/i : /single line|\bsld\b/i;
      const onList = job.drawings.find(d => want.test(d.title) && !/^TBC-/.test(d.no) && /to do|live/i.test(d.status || 'Live'));
      spec.drawingNumber = onList ? onList.no : (desk.proposeNumber(job, spec.kind === 'bcd' ? 'BCD' : spec.kind === 'earthing' ? 'earthing' : 'SLD', [], job.id) || 'TBC');
    }
    // the drawing's own place in an Atomax project folder (7.3 Block Diagrams, 7.4 Single Line Diagrams, 6.3 for instrument BCDs ...)
    const outKind = spec.kind === 'bcd' ? ((job && /^05$/.test(require('./jobdesk').load(job.id).disc || '')) || /instrument|\bRIO\b|loop/i.test(request) ? 'bcd-instrument' : 'bcd') : spec.kind === 'earthing' ? 'earthing' : 'sld';
    const outDir = (job && BIZ.outputDirFor(job.id, outKind)) || path.join(userDir(), 'dxf-made');
    if (cutOff) spec.notes = [...(spec.notes || []), 'INCOMPLETE: Dex ran out of room before the end of the drawing. Parts after the last board shown are missing. Ask him again.'];
    const kindName = spec.kind === 'earthing' ? 'EARTHING' : spec.kind === 'bcd' ? 'BCD' : 'SLD';
    const base = spec.drawingNumber && spec.drawingNumber !== 'TBC' ? spec.drawingNumber + '_' + kindName : (job ? job.number + '_' + kindName : kindName);
    // optional: a new revision of a drawing Dex made before (changes clouded on BCDs, history carried in the notes)
    let previous = null;
    if (revision && revision.on) { previous = dxfmaker.previousSpec(outDir, base); spec.revision = DN.nextRev(previous ? previous.spec.revision : (spec.revision || ''), revision.stage || ''); if (revision.note) spec.revisionNote = revision.note; }
    else if (!spec.revision || /^P0?1$/i.test(spec.revision)) spec.revision = 'P1';
    const template = job ? desk.titleBlockFor(job) : '';
    const res = dxfmaker.make(spec, outDir, base, { template, previous, fill: job ? { client: job.client || '', project: `${job.number} ${job.name || ''}`.trim() } : {} });
    // every DXF gets its monochrome PDF beside it (issues go out as DXF and PDF)
    let madePdfs = []; try { madePdfs = await require('./pdfout').writePdfs(res); } catch (e) { (res.files || []).forEach(f => delete f.prims); }
    BIZ.log({ who: 'Dex', action: 'Drew', jobId: job ? job.id : '', detail: `${path.basename(res.path)} · ${spec.summary || spec.title || 'SLD'}${used.length ? ' · skills: ' + used.join(', ') : ' · no skills'}` });
    return { pdfs: madePdfs, masterCheck, sheets: (res.files || []).map(f => ({ path: f.path, pdf: f.pdf || '', label: f.label })), diff: res.diff, revision: spec.revision, previousFound: !!previous, titleBlock: template ? path.basename(template) : '', drawingNumber: spec.drawingNumber, skills: used, incomplete: cutOff, path: res.path, folder: outDir, svg: res.svg, summary: spec.summary || '', title: spec.title || '', notes: spec.notes || [], read: [...pdfs.map(p => path.basename(p)), ...notesRead], inJobFolder: !!(job && job.folder) };
  }));
}

module.exports = { register, ensureDrafter, parseEml, parseMsg, EMAIL_SYSTEM, AGENTS };
