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
Existing jobs: the list of Atomax's jobs (its project folders) is given below the email. If the email is about one or more of them (same job number, site, client or project, e.g. "malt" and "wheat" are two jobs), list every one in "existingJobs" (job numbers) and do not add an "eli" task to set them up again. When it is about several jobs, put the job number each change is for in that change's "job".
Client comments and changes: if the email returns comments on issued drawings or documents (a comment sheet, a marked-up PDF, "please address the following") OR asks for changes to drawings / documents Atomax has already made, even informally ("can you change F3 to 125A on the SLD", "the generator is now 600kVA"), set "commentReturn": true, list every comment under "comments" (document number, or its title when no number is given, e.g. "SLD"; the comment or change as written; who made it) and make one task per document for the agent who changes it (drawings: "dex", schedules and registers: "excel", documents: "documents" or "word").
Deliverables: list what Atomax is being asked to produce under "deliverables" (e.g. {"type":"BCD","title":"Block cable diagram - Malt RIO1","qty":2}, {"type":"cable schedule","title":"Cable schedule","qty":1}); type is one of BCD, cable schedule, SLD, earthing, loop, layout, document, other.
Inputs: list every input document the client sent or refers to under "inputs" with its revision as written, and under "missingInputs" what is needed to do the work properly but has not been sent (e.g. instrument index, IO list, cable datasheets, latest tag list, panel GA).
A revision, reissue or update of a drawing Atomax has already made ("please revise and reissue as P02", comments on P01) is NOT a new deliverable: list nothing under deliverables for it, its changes go under comments against that drawing's number. Only list real asks from the email. Do not invent work. Copy site names, job numbers, drawing numbers, ratings and dates exactly as written.
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
"existingJob":"the first job number from the existing jobs list this email is about, else empty","existingJobs":["every job number from the existing jobs list this email is about"],
"deliverables":[{"type":"BCD|cable schedule|SLD|earthing|loop|layout|document|other","title":"...","qty":1}],
"inputs":[{"name":"document name or number as written","rev":"revision if shown","what":"what it is"}],"missingInputs":["..."],
"commentReturn":false,"comments":[{"doc":"document number","comment":"as written","by":"name","job":"job number it is for, when the email is about several jobs"}],
"replyTo":"name <address> the reply should go to","reply":"the suggested reply"}`;

const SCOPE_SYSTEM = `You are Eli at Atomax-UK, an electrical engineering consultancy. You are given the documents that define a job: a scope of works, a fee proposal or quotation, a client requirements statement or specification, an enquiry, an order.
Work out the DELIVERABLES REGISTER: every drawing, schedule, calculation and document Atomax-UK itself must produce on this job. Rules:
- Where the documents disagree (a draft scope lists more than the fee proposal that was priced), the latest and most contractual document wins (an order > an accepted fee proposal > a quotation > a draft scope), and you list each disagreement under "conflicts" so the engineer can decide.
- Only Atomax-UK's own deliverables go in "deliverables". Work by subconsultants or others (process, structural, installer, system integrator) goes in "byOthers" with who does it.
- One row per deliverable as it will be issued, and "qty" is the number of separate sheets or documents in it: "IS loop drawings (16 off)" is qty 16, "8 off Rotork schematics" is qty 8, "15 spool GAs" is qty 15, a stress report covering 8 calcs is qty 1. Never leave a count in the title with qty 1. "LV single line diagram" and "earthing drawing" are two rows. Keep the client's wording in the title, with the system or area, and copy circuit numbers and references exactly as written.
- type: SLD, BCD, earthing, loop, layout, cable schedule, schedule (any other schedule: load, I/O, actuator, label, PDB, telemetry), calculation, document, other.
- "inputs": every client document, drawing, standard or record Atomax needs or has been given, with its revision as written; "missingInputs": what is needed but not seen.
- "facts": the job's key facts as written (end client, intermediate client, references such as enquiry / order / UU numbers, site, design stages, standards).
Do not invent deliverables; if a document lists them, use that list. Plain British English.
Reply with JSON only, no markdown:
{"summary":"three lines: the job, who it is for, what Atomax produces","facts":[{"name":"...","value":"..."}],
"deliverables":[{"type":"SLD|BCD|earthing|loop|layout|cable schedule|schedule|calculation|document|other","title":"...","qty":1,"discipline":"E&I|piping|mechanical|structural|process|general","source":"document and section it comes from"}],
"byOthers":[{"title":"...","who":"..."}],"conflicts":["..."],"inputs":[{"name":"...","rev":"...","what":"..."}],"missingInputs":["..."]}`;

const MATCH_SYSTEM = `You are Eli at Atomax-UK. An email has been read and filed against a job. You are given what the email asks for (the deliverables, which may be whole packages such as "LVAC SLDs stage by stage"), what it says is still needed from the client, and the list of files already in the job's folder (path inside the job folder).
When the job has a DRAWING REGISTER / transmittal, it is the authority on document numbers: it lists each drawing's client (BGEN / NG) number, Atomax's own number and the title, so a drawing can be named by any of them; a document number allocation or drawing register asked for as "still needed" is on file when the register holds it.
Tom may add notes ("TOM SAYS"): they are facts about this job and override the email (e.g. "the document list is in the transmittal folder" means that item is on file: find it there).
1. For each deliverable, list the documents Atomax has ALREADY made for it that are in the job folder (Atomax's own drawings, schedules, calculations and reports: usually in folders such as "006 Atomax-UK Drawings", "008 Schedules & Calculations", "020 Issued", "7. Electrical"; never the client's files in incoming correspondence). A package can hold several documents (an SLD for each stage, a block diagram for each phase). For each document give its number exactly as written in the file name (e.g. "42_BG_0055", "X11475-BGN-ZZ-XX-DR-E-7014"), its title as written, and the latest revision found (P02, C01, A...; the highest one where several revision files exist). Ignore Archive / Superseded copies. Only list documents that really belong to that deliverable; a deliverable with nothing made yet gets an empty list.
2. For each "still needed" item, say whether the job folder already holds it (the client may have sent it before, or Tom says where it is), and which files. Only say found where the file name plainly is that thing (a load study for "load schedule" is found; a site photo is not a cable route).
3. For each comment, the document it is about: the document number as written in the job folder's file names when the comment names a drawing in any way ("drawing 153" is the file whose number ends in 153, e.g. X11475-BGN-ZZ-XX-DR-E-7153; give its title and latest revision too). A comment about every drawing / all documents gets "*". A comment about nothing in particular gets "".
4. "reply": one or two plain sentences to Tom saying what you found and what is still missing (and, after a note from Tom, what you did with it).
Reply with JSON only, no markdown:
{"deliverables":[{"i":0,"existing":[{"number":"","title":"","rev":"","file":"path"}]}],"found":[{"need":"the still-needed item exactly as given","files":["path"]}],"comments":[{"i":0,"doc":"number or * or","title":"","rev":"","file":""}],"reply":"..."}`;

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
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw new Error(require('./runs').plain(e)); } };
  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const IMG = /^image\/(png|jpe?g|gif|webp)$/;
  const extMime = (n) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' })[path.extname(n).toLowerCase()] || '';

  // every job an email is about (Eli's list): an app job, else the live project folder with that number (set up for drawings)
  function matchJobs(e) {
    const nos = [...new Set([...(Array.isArray(e.existingJobs) ? e.existingJobs : []), e.existingJob].map(x => String(x || '').trim().toUpperCase()).filter(Boolean))], ids = [];
    let folders = null;
    for (const no of nos) {
      const rec = BIZ.data().jobs.find(j => String(j.number).toUpperCase() === no && j.folder && fs.existsSync(j.folder)) || BIZ.data().jobs.find(j => String(j.number).toUpperCase() === no);
      if (rec) { ids.push(rec.id); continue; }
      try { folders = folders || BIZ.projects.allJobFolders(BIZ.data().jobs.map(j => j.number)); const f = folders.find(x => x.number === no); if (f) ids.push(BIZ.adoptFolder(f.folder, 'Eli').id); } catch {}
    }
    return [...new Set(ids)];
  }
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

  // once the job is known, Eli is shown the job folder: a package the email asks for becomes the documents Atomax already has for it (their
  // numbers and revisions), and a "still needed" item the folder already holds is moved to inputs received. The email's own list is kept
  // (e.asked) so filing on another job matches again from the original
  async function matchFolder(job, e, run = '') {
    if (!job || !job.folder || !fs.existsSync(job.folder)) return false;
    e.asked = e.asked || { deliverables: e.deliverables || [], missingInputs: e.missingInputs || [], comments: e.comments || [] };
    const want = e.asked.deliverables, need = e.asked.missingInputs, cms = e.asked.comments || []; if (!want.length && !need.length && !cms.length) return false;
    const files = BIZ.projects.filesUnder([job.folder], 3000).map(f => f.rel.replace(/\\/g, '/')).filter(r => !/(^|\/)(archive|superseded|markups?|old)(\/|$)/i.test(r) && !/\.(bak|dwl2?|tmp|lnk|ini)$/i.test(r));
    if (!files.length) return false;
    // the job's drawing register / transmittal (013, 7.9...) is the one place the drawing numbers, titles and revisions are written down:
    // Eli reads it, not just the file names, so "NG number", "our number" and a title all find the same drawing
    let register = '';
    try { const regs = files.filter(r => /register|transmittal/i.test(path.basename(r)) && /\.(xlsx|xlsm|csv)$/i.test(r) && !/document request/i.test(r)).sort((a, b) => (/master/i.test(b) - /master/i.test(a)) || b.length - a.length).slice(0, 2);
      for (const r of regs) { const b = fs.readFileSync(path.join(job.folder, r)); const t = checker.sheetsAsText(/\.csv$/i.test(r) ? checker.readCsv(b.toString('utf8')) : checker.readXlsx(b), 25000); if (t && t.trim()) register += `\n\nDRAWING REGISTER ${r}:\n${t}`; } } catch {}
    const notes = (e.notes || []).map(n => `TOM SAYS: ${n.text}`).join('\n');
    const text = `JOB: ${job.number} ${job.name || ''}\n\nDELIVERABLES THE EMAIL ASKS FOR:\n${want.map((d, i) => `${i}. ${d.title || d.type}${d.qty > 1 ? ' (x' + d.qty + ')' : ''}`).join('\n') || '(none)'}\n\nSTILL NEEDED FROM THE CLIENT:\n${need.map(x => '- ' + x).join('\n') || '(none)'}\n\nCOMMENTS IN THE EMAIL:\n${cms.map((c, i) => `${i}. about "${c.doc || ''}": ${c.comment}`).join('\n') || '(none)'}${notes ? '\n\n' + notes : ''}${register}\n\nFILES IN THE JOB FOLDER (${files.length}):\n${files.slice(0, 900).join('\n')}`;
    let m = null; try { const r = await claudeFull({ system: MATCH_SYSTEM, who: 'email', maxTokens: 8000, messages: [{ role: 'user', content: [{ type: 'text', text }] }], run }); m = dxfmaker.parseReply(r.text); } catch { return false; }
    if (!m || typeof m !== 'object') return false;
    // comments: the document each one is about, as the folder names it; a drawing named by a comment that is not a deliverable yet becomes one (its own number and rev)
    const cdocs = new Map(); for (const x of m.comments || []) if (x && Number.isInteger(+x.i)) cdocs.set(+x.i, x);
    const extraRows = [];
    e.comments = cms.map((c, i) => { const x = cdocs.get(i); if (!x) return c; const doc = String(x.doc || '').trim(); if (doc && doc !== '*' && !extraRows.some(r => r.no.toUpperCase() === doc.toUpperCase())) extraRows.push({ type: 'drawing', title: String(x.title || doc).trim(), no: doc, rev: String(x.rev || '').trim(), file: x.file || '', from: 'named in the email', qty: 1 }); return { ...c, doc }; });
    e.eliSays = String(m.reply || e.eliSays || '');   // Eli's word to Tom (e.reply is the suggested reply to the client)
    const got = new Map(); for (const x of m.deliverables || []) if (x && Number.isInteger(+x.i) && Array.isArray(x.existing)) got.set(+x.i, x.existing.filter(d => d && d.number));
    const out = []; want.forEach((d, i) => { const ex = e.commentReturn ? [] : got.get(i) || []; /* a comment return: the drawings it asks for are revisions of what exists, left as Eli read them */ if (!ex.length) { out.push(d); return; } const seen = new Set(); for (const x of ex) { const k = String(x.number).toUpperCase(); if (seen.has(k)) continue; seen.add(k); out.push({ type: d.type, title: String(x.title || x.number).trim(), no: String(x.number).trim(), rev: String(x.rev || '').trim(), file: x.file || '', from: d.title || d.type, qty: 1 }); } });
    const found = (m.found || []).filter(f => f && f.need && (f.files || []).length && need.some(n => n.toLowerCase() === String(f.need).toLowerCase()));
    for (const r of extraRows) if (!out.some(o => o.no && o.no.toUpperCase() === r.no.toUpperCase())) out.push(r);
    e.deliverables = out; e.missingInputs = need.filter(n => !found.some(f => String(f.need).toLowerCase() === n.toLowerCase()));
    e.foundInputs = found.map(f => ({ need: String(f.need), files: f.files.slice(0, 4).map(String) })); e.matchedJob = job.id;
    return true;
  }
  const readEmail = async ({ files = [], text = '', reuseId = '', paths = [], skills, run = '' }) => {
    files = [...files, ...paths.filter(p => fs.existsSync(p)).map(p => ({ name: path.basename(p), mime: extMime(p), base64: fs.readFileSync(p).toString('base64') }))];
    const id = reuseId || uid(), dir = path.join(DIR(), id); fs.mkdirSync(dir, { recursive: true });
    const content = [], parts = [], originals = [], attach = []; let hdr = null;   // the headers as written in the email file: what the record says it is, whatever Eli made of it
    for (const f of files) {
      const buf = Buffer.from(f.base64, 'base64'), ext = path.extname(f.name).toLowerCase(), mime = f.mime || extMime(f.name);
      fs.writeFileSync(path.join(dir, f.name.replace(/[\\/:*?"<>|]+/g, '_')), buf); originals.push(f.name);
      if (ext === '.eml') { const m = parseEml(buf); hdr = hdr || m; parts.push(`From: ${m.from}\nTo: ${m.to}${m.cc ? '\nCc: ' + m.cc : ''}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`); m.attachments.forEach(a => { const n = a.name.replace(/[\\/:*?"<>|]+/g, '_'); fs.writeFileSync(path.join(dir, n), a.data); attach.push({ name: n, mime: a.mime }); }); }
      else if (ext === '.msg') { const m = parseMsg(buf); hdr = hdr || m; parts.push(`From: ${m.from}\nTo: ${m.to}${m.cc ? '\nCc: ' + m.cc : ''}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`); m.attachments.forEach(a => { const n = a.name.replace(/[\\/:*?"<>|]+/g, '_'); fs.writeFileSync(path.join(dir, n), a.data); attach.push({ name: n, mime: a.mime || extMime(n) }); }); }
      else if (IMG.test(mime)) { attach.push({ name: f.name, mime }); }
      else if (mime === 'application/pdf') { attach.push({ name: f.name, mime }); }
      else parts.push(buf.toString('utf8'));
    }
    // a zip in the email (a client's folder of drawings) is opened up: its files become attachments, filed and read like the rest
    for (const z of attach.filter(a => /\.zip$/i.test(a.name))) {
      try { const zip = await require('jszip').loadAsync(fs.readFileSync(path.join(dir, z.name))); let n = 0;
        for (const [name, entry] of Object.entries(zip.files)) { if (entry.dir || n >= 120) continue; const base = path.basename(name).replace(/[\\/:*?"<>|]+/g, '_'); if (!base || base.startsWith('.') || /^__MACOSX/.test(name)) continue; const data = await entry.async('nodebuffer'); fs.writeFileSync(path.join(dir, base), data); attach.push({ name: base, mime: extMime(base) || 'application/octet-stream', fromZip: z.name }); n++; }
      } catch (err) { parts.push(`(${z.name} could not be opened: ${err.message})`); }
    }
    // the same file dropped and also inside the email (or dropped twice): keep the first copy, matched by contents or name
    { const seen = new Set(), keep = []; for (const x of attach) { let key = x.name; try { key = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(dir, x.name))).digest('hex'); } catch {} if (seen.has(key) || seen.has('n:' + x.name)) continue; seen.add(key); seen.add('n:' + x.name); keep.push(x); } attach.length = 0; attach.push(...keep); }
    if (text.trim()) parts.push(text.trim());
    // screenshots and PDFs go to Claude to read: the real screenshots first (an email signature's logos are tiny), then PDFs that carry one
    // of our document numbers (the drawings being commented on), then the other PDFs; up to 8
    const sizeOf = (a) => { try { return fs.statSync(path.join(dir, a.name)).size; } catch { return 0; } };
    const ours = /X\d{5,6}-\d{4}-\d{2}-\d{2}-\d{3,5}|\b\d{2}_[A-Z]{2}_\d{4}\b/i;
    const shots = attach.filter(a => IMG.test(a.mime) && sizeOf(a) >= 25000).sort((a, b) => sizeOf(b) - sizeOf(a));
    const pdfs = attach.filter(a => a.mime === 'application/pdf').sort((a, b) => (ours.test(b.name) ? 1 : 0) - (ours.test(a.name) ? 1 : 0));
    const toRead = [...shots.slice(0, 4), ...pdfs].slice(0, 8);
    for (const a of toRead) { try { content.push({ type: 'text', text: (IMG.test(a.mime) ? 'Screenshot in the email: ' : 'Attached PDF: ') + a.name }); content.push(checker.contentBlock(a.mime === 'application/pdf' ? 'pdf' : 'image', a.name, fs.readFileSync(path.join(dir, a.name)))); } catch {} }
    const unread = attach.filter(a => !toRead.includes(a) && !(IMG.test(a.mime) && sizeOf(a) < 25000));
    if (unread.length) parts.push(`ATTACHMENTS NOT OPENED FOR YOU (filed on the job, listed by name): ${unread.map(a => a.name).join(', ')}`);
    if (!parts.length && !content.length) throw new Error('Drop an email (.eml, .msg), a screenshot of it, or paste its text');
    content.push({ type: 'text', text: `THE EMAIL:\n${parts.join('\n\n---\n\n').slice(0, 30000)}${attach.length ? '\n\nATTACHMENTS: ' + attach.map(a => a.name).join(', ') : ''}` });
    // the jobs: Tom's live project folders (number and folder name) plus any job the app already knows
    const seenNo = new Set(), lines0 = [];
    try { for (const f of BIZ.projects.allJobFolders(BIZ.data().jobs.map(j => j.number))) { if (seenNo.has(f.number)) continue; seenNo.add(f.number); lines0.push(`- ${f.number} ${f.name}`); } } catch {}
    for (const j of BIZ.data().jobs.filter(j => j.status !== 'Closed')) { if (seenNo.has(String(j.number).toUpperCase())) continue; seenNo.add(String(j.number).toUpperCase()); lines0.push(`- ${j.number} ${j.name}${j.client ? ' (' + j.client + ')' : ''}`); }
    const jobsList = lines0.slice(0, 200).join('\n');
    content.push({ type: 'text', text: 'EXISTING JOBS:\n' + (jobsList || '(none yet)') });
    let r = await claudeFull({ system: EMAIL_SYSTEM, who: 'email', skills, maxTokens: 8000, messages: [{ role: 'user', content }], run });
    if (r.stop === 'max_tokens') r = await claudeFull({ system: EMAIL_SYSTEM + '\nKeep every field short: details under 60 words, the reply under 150 words.', who: 'email', skills, maxTokens: 16000, messages: [{ role: 'user', content }] });
    const reply = r.text;
    try { fs.writeFileSync(path.join(dir, 'eli-reply.txt'), String(reply || '')); } catch {}   // kept next to the email so a bad reply can be looked at
    let e; try { e = dxfmaker.parseReply(reply); } catch (err) { throw new Error(`Eli got a reply he could not read (${r.stop === 'max_tokens' ? 'it was cut off' : String(err.message || err).slice(0, 80)}). It is saved as eli-reply.txt with the email. Press Read it again.`); }
    const email = { id, at: new Date().toISOString(), from: (hdr && hdr.from) || e.from || '', subject: (hdr && hdr.subject) || e.subject || '', date: (hdr && hdr.date) || e.date || '', summary: e.summary || '', site: e.site || '', jobNumber: e.jobNumber || '', reply: e.reply || '', replyTo: e.replyTo || '',
      people: Array.isArray(e.people) ? e.people.slice(0, 8) : [], urgency: e.urgency === 'urgent' ? 'urgent' : 'normal', urgencyWhy: e.urgencyWhy || '', attachmentNotes: Array.isArray(e.attachmentNotes) ? e.attachmentNotes.slice(0, 10) : [], clientQuestions: Array.isArray(e.clientQuestions) ? e.clientQuestions.slice(0, 8).map(String) : [],
      asks: (e.asks || []).map((a, i) => ({ i, title: String(a.title || 'Task').slice(0, 160), detail: String(a.detail || ''), agent: AGENTS[a.agent] ? a.agent : 'none', kind: a.kind || 'other', due: a.due || '', status: 'proposed' })),
      originals, attachments: attach, pasted: text || '',
      existingJob: String(e.existingJob || ''), deliverables: Array.isArray(e.deliverables) ? e.deliverables.slice(0, 20) : [], inputs: Array.isArray(e.inputs) ? e.inputs.slice(0, 40) : [], missingInputs: Array.isArray(e.missingInputs) ? e.missingInputs.slice(0, 20).map(String) : [],
      commentReturn: !!e.commentReturn, comments: Array.isArray(e.comments) ? e.comments.slice(0, 200) : [] };
    if (!email.commentReturn) ensureDrafter(email, parts.join('\n'));
    email.existingJobs = Array.isArray(e.existingJobs) ? e.existingJobs.map(String).slice(0, 10) : [];
    email.jobIds = matchJobs(email); email.jobId = email.jobIds[0] || matchJob(email); if (email.jobId && !email.jobIds.includes(email.jobId)) email.jobIds.unshift(email.jobId);
    // an existing job: no second "set up the job" task; a job folder on disk that is not yet a job in the office is offered for linking
    if (email.jobId) email.asks = email.asks.filter(a => a.agent !== 'eli' || !/set ?up|new job|job number|project folder/i.test(a.title + ' ' + a.detail)).map((a, i) => ({ ...a, i }));
    else if (email.jobNumber) { try { const f = BIZ.projects.suggest({ number: email.jobNumber }, { limitMs: 2500 }).find(x => x.why && /number/i.test(x.why)); if (f) email.folderFound = f.path; } catch {} }
    if (email.jobId) { try { await matchFolder(BIZ.data().jobs.find(j => j.id === email.jobId), email, run); } catch {} }
    const list = load(), at = reuseId ? list.findIndex(x => x.id === reuseId) : -1;
    if (at >= 0) list[at] = email; else list.unshift(email); save(list);
    BIZ.log({ who: 'Eli', action: 'Read an email', jobId: email.jobId, detail: `${email.subject || email.summary} · ${email.asks.length} task${email.asks.length === 1 ? '' : 's'} proposed` });
    return email;
  };
  ipcMain.handle('mail:read', wrap(readEmail));
  // read an email again (after Eli's rules change): the same files and pasted text, a fresh list of tasks; tasks already started are kept
  // Tom answers Eli on the email card ("that list is in the transmittal folder"): the note is kept with the email and the job folder is
  // matched again with it in view; Eli's reply comes back for the card
  ipcMain.handle('mail:tell', wrap(async ({ id, jobId = '', text = '' }) => {
    const list = load(), e = list.find(x => x.id === id); if (!e) throw new Error('That email is gone');
    const t = String(text || '').trim(); if (!t) throw new Error('Type what you want to tell Eli');
    e.notes = [...(e.notes || []), { text: t, at: new Date().toISOString() }];
    const job = BIZ.data().jobs.find(j => j.id === (jobId || e.jobId));
    if (job) { try { const desk = require('./jobdesk'), d = desk.load(job.id); if (!(d.rules || '').includes(t)) desk.setRules(job.id, `${d.rules ? d.rules + '\n' : ''}${t}`); } catch {} }   // what Tom tells Eli about the job is a job rule from then on (the chat and the agents see it)
    if (!job) { save(list); return { email: e, reply: 'Noted. Pick the job first and I will look in its folder.' }; }
    e.matchedJob = ''; const ok = await matchFolder(job, e);
    save(list); return { email: e, reply: ok ? (e.eliSays || 'Noted.') : 'Noted, but I could not look at the job folder (is it linked?).' };
  }));
  ipcMain.handle('mail:reread', wrap(async ({ id }) => {
    const old = load().find(x => x.id === id); if (!old) throw new Error('That email is gone');
    const files = (old.originals || []).map(n => { const p = path.join(DIR(), id, n.replace(/[\\/:*?"<>|]+/g, '_')); return fs.existsSync(p) ? { name: n, mime: extMime(n), base64: fs.readFileSync(p).toString('base64') } : null; }).filter(Boolean);
    const e = await readEmail({ files, text: old.pasted || '', reuseId: id });
    const kept = old.asks.filter(a => a.status !== 'proposed');
    if (kept.length) { e.asks = [...kept, ...e.asks.filter(n => !kept.some(k => k.title.toLowerCase() === n.title.toLowerCase()))].map((a, i) => ({ ...a, i })); const list = load(); list[list.findIndex(x => x.id === id)] = e; save(list); }
    return e;
  }));
  ipcMain.handle('mail:list', wrap(() => load().slice(0, 30)));
  // Eli reads it; on a job's page the job is that job
  ipcMain.handle('jobs:addEmail', wrap(async ({ files = [], text = '', jobId = '' }) => {
    const e = await readEmail({ files, text });
    if (jobId) { e.jobId = jobId; if (e.matchedJob !== jobId) { try { await matchFolder(BIZ.data().jobs.find(j => j.id === jobId), e); } catch {} } const list = load(), i = list.findIndex(x => x.id === e.id); if (i >= 0) { list[i] = e; save(list); } }   // added on a job's page: that job's folder, even when Eli did not name the job himself
    const job = e.jobId && BIZ.data().jobs.find(j => j.id === e.jobId);
    const company = (e.people || []).find(p => /client|asking|from/i.test(p.role || '') && p.company && !/atomax/i.test(p.company)) || (e.people || []).find(p => p.company && !/atomax/i.test(p.company));
    let D = {}; try { D = BIZ.projects ? { nextNumber: BIZ.projects.nextJobNumber(BIZ.data().jobs.map(j => j.number), (loadSettings && loadSettings().jobsFolder) || BIZ.projects.jobParent(BIZ.data().jobs.map(j => j.number))) } : {}; } catch {}
    const jobs = (jobId ? [jobId] : (e.jobIds || [])).map(id => BIZ.data().jobs.find(j => j.id === id)).filter(Boolean).map(j => ({ id: j.id, number: j.number, name: j.name, client: j.client || '' }));
    return { jobs, email: e, job: job ? { id: job.id, number: job.number, name: job.name, client: job.client || '' } : null, suggest: { number: String(e.jobNumber || D.nextNumber || '').toUpperCase(), name: e.site || e.subject || '', client: company ? company.company : '', folderFound: e.folderFound || '' } };
  }));
  // file it: on the job (new one made if asked), its deliverables added, its changes logged against the drawings they are for, a copy kept in the job folder
  const attachmentKind = (name) => BIZ.projects.fileKind(name);
  // the documents that define a job (scope of works, fee proposal, requirements, enquiry, order): Eli reads them for the deliverables register
  const SCOPE_DOC = /scope|proposal|quot(e|ation)|requirement|specification|enquiry|\benq\d|tender|\bitt\b|\brfq\b|order|brief|works information|employer/i;
  const isScopeDoc = (f) => SCOPE_DOC.test(f.name) && /\.(docx|pdf|txt|md)$/i.test(f.name) && !/superseded|\bold\b|copy\b/i.test(f.rel || f.name);
  // what makes an email the same email: who sent it, what it is called, when (the file can differ: re-saved from Outlook, forwarded copy)
  const mailIdentity = (e) => { const f = String(e.from || '').toLowerCase(), addr = (f.match(/[\w.+-]+@[\w.-]+/) || [f.replace(/<.*$/, '').trim()])[0], subj = String(e.subject || '').toLowerCase().replace(/^(re|fw|fwd)\s*:\s*/g, '').replace(/\s+/g, ' ').trim(); let d = ''; try { const t = Date.parse(e.date || ''); if (t) d = String(Math.round(t / 60000)); } catch {} return addr && subj ? `${addr}|${subj}|${d}` : ''; };
  async function docText(p) { const ext = path.extname(p).toLowerCase(); if (ext === '.docx') { try { const JSZip = require('jszip'); const z = await JSZip.loadAsync(fs.readFileSync(p)); const f = z.file('word/document.xml'); if (!f) return ''; const xml = await f.async('string'); return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n)); } catch { return ''; } } if (ext === '.txt' || ext === '.md') { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } } return ''; }
  // Eli's scope reply as an object: plain JSON first, then the same repair Dex's replies get (a quote inside a title such as 8" main,
  // a cut-off tail); the reply is kept on disk when it still cannot be read, and the error says so instead of quoting a JSON position
  function scopeJson(text, stop) {
    const raw = String(text || '').replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(raw); } catch {}
    try { return dxfmaker.repairJson(raw); } catch (e) {
      let kept = ''; try { kept = path.join(DIR(), 'scope-reply-' + Date.now() + '.txt'); fs.mkdirSync(DIR(), { recursive: true }); fs.writeFileSync(kept, raw); } catch { kept = ''; }
      throw new Error(`Eli's reply could not be read${stop === 'max_tokens' ? ' (it was cut off)' : ''}${kept ? '; it is saved as ' + path.basename(kept) : ''}. Drop the documents on the job again to retry.`);
    }
  }
  async function readScope({ jobId, files = [], skills, run = '' }) {
    const content = []; let n = 0;
    for (const f of files.slice(0, 8)) {
      const ext = path.extname(f.name).toLowerCase(); let mt = 0; try { mt = fs.statSync(f.path).mtimeMs; } catch {}
      const head = `DOCUMENT ${++n}: ${f.name} (file dated ${mt ? new Date(mt).toISOString().slice(0, 10) : 'unknown'})`;
      if (ext === '.pdf') { content.push({ type: 'text', text: head }); try { content.push(checker.contentBlock('pdf', f.name, fs.readFileSync(f.path))); } catch {} }
      else { const t = (await docText(f.path)).trim(); if (t) content.push({ type: 'text', text: `${head}\n${t.slice(0, 60000)}` }); }
    }
    if (!content.length) return null;
    const r = await claudeFull({ system: SCOPE_SYSTEM, who: 'email', skills, maxTokens: 16000, messages: [{ role: 'user', content }], run });
    const out = scopeJson(r.text, r.stop);
    if (!out || typeof out !== 'object') return null;
    const desk = require('./jobdesk');
    try { desk.checkRegister(jobId, checker); } catch {}
    const rows = (out.deliverables || []).filter(d => d && d.title).map(d => ({ type: d.type || 'document', title: d.title, qty: d.qty || 1, discipline: d.discipline || '', source: d.source || '' }));
    let added = 0; try { added = (desk.addDeliverables(jobId, rows, { source: 'scope' }) || []).length; } catch {}
    try { desk.tidyRows(jobId); } catch {}
    try { desk.addInputs(jobId, { inputs: out.inputs || [], missing: out.missingInputs || [], questions: [] }); } catch {}
    try { await desk.writeRfiRegister(jobId, { templateDir: BIZ.projects.templateDir() }); } catch {}
    try { desk.setScopeNotes && desk.setScopeNotes(jobId, { summary: out.summary || '', facts: out.facts || [], byOthers: out.byOthers || [], conflicts: out.conflicts || [], from: files.map(f => f.name) }); } catch {}
    BIZ.log({ who: 'Eli', action: `Read the scope documents: ${rows.length} deliverable(s) listed, ${added} added${(out.conflicts || []).length ? `, ${out.conflicts.length} point(s) where the documents disagree` : ''}`, jobId, detail: files.map(f => f.name).join(', ') });
    return { listed: rows.length, added, conflicts: out.conflicts || [], byOthers: out.byOthers || [], summary: out.summary || '', files: files.map(f => f.name) };
  }
  // drop the client's whole folder (or any files) on a job: emails go through Eli (scope, deliverables, comments, their attachments filed),
  // everything else is filed where it lives in the job folder; then the folder is read again
  ipcMain.handle('jobs:fileIn', wrap(async ({ jobId, paths = [] }) => {
    const d = BIZ.data(), job = d.jobs.find(j => j.id === jobId); if (!job) throw new Error('No such job');
    if (!job.folder || !fs.existsSync(job.folder)) throw new Error('This job has no folder yet: give it one on the job desk first.');
    const runs = require('./runs'); if (runs.live().some(r => r.jobId === jobId && r.no === 'FILES')) throw new Error('Files are already being filed on this job. Wait for that to finish.');
    const R = runs.start({ kind: 'file-in', who: 'Eli', jobId, no: 'FILES' }), stage = (t, pct) => runs.stage(R.id, t, pct);
    const result = { filed: [], skipped: [], emails: [], errors: [] }; let all = [], mails = [];
    try {
      stage('Looking at what was dropped', 2);
      all = BIZ.projects.filesUnder(paths); mails = all.filter(f => /\.(eml|msg)$/i.test(f.name)); const rest = all.filter(f => !/\.(eml|msg)$/i.test(f.name));
      stage(`Filing ${rest.length} file${rest.length === 1 ? '' : 's'} into the job folder`, 8);
      if (rest.length) { const r = BIZ.projects.fileIn(job.folder, rest); result.filed = r.filed; result.skipped = r.skipped; }
      let i = 0; for (const m of mails) { if (runs.aborted(R.id)) break; stage(`Eli is reading email ${++i} of ${mails.length}: ${m.name}`, 15 + Math.round(35 * (i - 1) / Math.max(1, mails.length)));
        let h = ''; try { h = require('crypto').createHash('sha1').update(fs.readFileSync(m.path)).digest('hex'); } catch {}
        const onJob = (x) => (x.jobIds || []).includes(jobId) || x.jobId === jobId;
        let idn = ''; try { const buf = fs.readFileSync(m.path), hd = /\.msg$/i.test(m.name) ? parseMsg(buf) : parseEml(buf); idn = mailIdentity(hd); } catch {}
        const before = load().find(x => onJob(x) && ((h && x.fileHash === h) || (idn && mailIdentity(x) === idn))); if (before) { result.skipped.push(m.rel + ' (email already read)'); continue; }   // the same email dropped again (by file, or by sender + subject + date when it was first read before files were fingerprinted): its tasks and comments are already on the job
        try { const e = await readEmail({ paths: [m.path], run: R.id }); try { const list = load(), rec = list.find(x => x.id === e.id); if (rec) { rec.fileHash = h; rec.jobId = jobId; fs.writeFileSync(FILE(), JSON.stringify(list)); } } catch {} const a = await applyEmail({ emailId: e.id, jobId }); result.emails.push({ name: m.name, subject: e.subject || '', deliverables: (a && a.deliverables) || 0, comments: (a && a.comments) || 0, filed: (a && a.filed) || [] }); } catch (err) { result.errors.push(`${m.name}: ${String(err && err.message || err)}`); } }
      const scopeDocs = all.filter(isScopeDoc); if (scopeDocs.length && !runs.aborted(R.id)) { stage(`Eli is reading the scope documents (${scopeDocs.length}): ${scopeDocs.map(f => f.name).join(', ').slice(0, 120)}`, 55); try { result.scope = await readScope({ jobId, files: scopeDocs, run: R.id }); if (!result.scope) result.errors.push('scope documents: Eli could not read anything usable from ' + scopeDocs.map(f => f.name).join(', ')); } catch (err) { result.errors.push('scope documents: ' + String(err && err.message || err)); try { require('./jobdesk').setScopeNotes(jobId, { summary: '', facts: [], byOthers: [], conflicts: ['Eli could not read the scope documents: ' + String(err && err.message || err)], from: scopeDocs.map(f => f.name) }); } catch {} } }
      stage('Reading the job folder', 90);
      try { BIZ.projects.gather(job.id, job.folder, { checker }); } catch {}
      try { require('./jobdesk').checkRegister(job.id); } catch {}
      runs.finish(R.id, { ok: !runs.aborted(R.id) });
    } catch (e) { runs.finish(R.id, { ok: false, error: String(e && e.message || e) }); throw e; }
    if (runs.aborted(R.id)) { result.errors.push('Stopped before everything was read.'); }
    const drawings = (BIZ.data().jobs.find(j => j.id === jobId) || {}).drawings || [];
    result.suggest = !drawings.length && all.some(f => /cable schedule/i.test(f.name)) ? ['SLD', 'BCD'] : [];
    BIZ.log({ who: 'Tom', action: `Filed ${result.filed.length} file${result.filed.length === 1 ? '' : 's'}${mails.length ? ` and ${mails.length} email${mails.length === 1 ? '' : 's'}` : ''} into the job folder`, jobId });
    return result;
  }));
  const applyEmail = async ({ emailId, jobId = '', newJob = null, client = '' }) => {
    const list = load(), e = list.find(x => x.id === emailId); if (!e) throw new Error('That email is gone');
    const d = BIZ.data(), desk = require('./jobdesk');
    let job = jobId && d.jobs.find(j => j.id === jobId);
    if (!job) {
      if (!newJob || !String(newJob.number || '').trim()) throw new Error('Give the new job a number');
      const number = String(newJob.number).trim().toUpperCase();
      if (d.jobs.some(j => String(j.number).toUpperCase() === number)) throw new Error(number + ' is already a job: pick it instead');
      let folder = '';
      if (newJob.mode === 'create') { const s = loadSettings ? loadSettings() : {}; const parent = newJob.folder || s.jobsFolder; if (!parent || !fs.existsSync(parent)) throw new Error('Choose where your job folders live'); if (saveSettings && s.jobsFolder !== parent) saveSettings({ ...s, jobsFolder: parent }); folder = BIZ.projects.createJobFolder(parent, number, newJob.name || ''); }
      else if (newJob.mode === 'link') { if (!newJob.folder || !fs.existsSync(newJob.folder)) throw new Error('Choose the job folder'); folder = newJob.folder; }
      job = biz.saveJob(d, { number, name: String(newJob.name || e.site || e.subject || '').trim(), client: String(newJob.client || client || '').trim(), folder, notes: `From email: ${e.subject}\n${e.summary}` }, 'Eli');
    }
    if (!job.client && client) job.client = String(client).trim();
    BIZ.store.save();
    if (job.folder) { try { BIZ.projects.gather(job.id, job.folder, { checker, dxffix: require('./dxffix') }); } catch {} }
    // changes / comments go against the drawing they are for: by number, else by its title (SLD, BCD, cable schedule ...)
    const WORDS = { SLD: 'single line', BCD: 'block cable', 'CABLE SCHEDULE': 'cable schedule', EARTHING: 'earthing' };
    const docOf = (doc) => { const t = String(doc || '').trim(); if (!t) return ''; const up = t.toUpperCase(); const ds = job.drawings || [];
      if (t === '*' || /^(all|every)\b.*(drawing|document)|^general$/i.test(t)) return '*';   // every drawing on the job
      const exact = ds.find(x => String(x.no).toUpperCase() === up) || ds.filter(x => x.no.length > 6 && new RegExp('(^|[^0-9])' + String(x.no).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])').test(up)).sort((a, b) => b.no.length - a.no.length)[0];   // the whole number, not the start of a longer one: a comment on -72-00012 P02 is not -72-0001's if (exact) return exact.no;
      const tail = (up.match(/(\d{3,4})\)?$/) || [])[1]; if (tail) { const ends = ds.filter(x => new RegExp('[-_]?' + tail + '$').test(String(x.no).toUpperCase().replace(/\s*[PCA]\d\d$/, ''))); if (ends.length === 1) return ends[0].no; }   // "drawing 153" / "7153"

      const CODE = { SLD: '70', 'SINGLE LINE': '70', 'SINGLE LINE DIAGRAM': '70', BCD: '71', 'BLOCK CABLE DIAGRAM': '71', EARTHING: '74' }, code = CODE[up];   // QS 006 type code in the number
      const byCode = code && ds.filter(x => new RegExp('-' + code + '-\\d{3,4}$').test(String(x.no))); if (byCode && byCode.length === 1) return byCode[0].no;
      { const DK = require('./jobdesk'), same = ds.filter(x => DK.sameDeliverable(x.title, t)); if (same.length === 1) return same[0].no;   // "the G5/5 report", "protection study": the one row it can only mean
        const key = [...DK.dwords(t)].filter(w => /^[gp]\d{2,3}(_\d)?$/.test(w) || w.length >= 4); if (key.length) { const hit = ds.filter(x => { const W = DK.dwords(x.title); return key.every(w => W.has(w)); }); if (hit.length === 1) return hit[0].no; } }
      const want = (WORDS[up] || t).toLowerCase(), raw = t.toLowerCase(), words = want.split(/[^a-z0-9]+/).filter(w => w.length > 2);
      let best = null, score = 0; for (const x of ds) { const tl = String(x.title || '').toLowerCase(); const sc = tl.includes(want) || new RegExp('\\b' + raw.replace(/[^a-z0-9 ]/g, '') + '\\b').test(tl) ? 99 : words.filter(w => tl.includes(w)).length; if (sc > score) { score = sc; best = x; } }
      return best && score >= Math.min(2, words.length) ? best.no : t; };
    const r = { job: { id: job.id, number: job.number }, deliverables: 0, comments: 0, docs: [] };
    const mine = (x) => !x || !x.job || !(e.jobIds || []).length || (e.jobIds || []).length < 2 || String(job.number).toUpperCase().includes(String(x.job).trim().toUpperCase()) || String(x.job).toUpperCase().includes(String(job.number).toUpperCase());
    try { desk.checkRegister(job.id, checker); } catch {}   // the register's numbers first, so the email's deliverables land on the rows that exist
    if (e.matchedJob !== job.id) { try { await matchFolder(job, e); } catch {} }   // filed on a job other than the one it was read against: match that job's folder
    for (const f of e.foundInputs || []) { e.inputs = [...(e.inputs || []), { name: f.need, rev: '', what: 'already in the job folder: ' + f.files.join(', ') }]; try { desk.closeRfisFor(job.id, f.need, f.files.join(', ')); } catch {} }   // an RFI raised for it earlier closes itself
    try { r.deliverables = (desk.addDeliverables(job.id, (e.deliverables || []).filter(mine), { commentReturn: !!e.commentReturn }) || []).length; } catch {}
    try { desk.tidyRows(job.id); } catch {}
    try { desk.addInputs(job.id, { inputs: e.inputs || [], missing: e.missingInputs || [], questions: e.clientQuestions || [], fromEmail: e.subject || e.from }); } catch {}
    try { r.rfiRegister = await desk.writeRfiRegister(job.id, { templateDir: BIZ.projects.templateDir() }); } catch (err) { BIZ.log({ who: 'Eli', action: 'Could not write the RFI register: ' + String(err.message || err), jobId: job.id }); }   // the questions go on the house RFI register in the job folder
    if (e.comments && e.comments.filter(mine).length) { const cs = e.comments.filter(mine).map(c => ({ ...c, doc: docOf(c.doc) })); try { r.comments = desk.addComments(job.id, cs, e.subject || e.from).length; } catch {} r.docs = [...new Set(cs.map(c => c.doc).filter(Boolean))]; }
    // the email itself goes in correspondence; its attachments go where that kind of file lives in the job folder (schedules in 7.8 / 008, drawings and
    // site information in site data), so Dex and Lex find them where Tom would look
    if (job.folder) { try { const filed = []; for (const n of [...(e.originals || []), ...(e.attachments || []).map(x => x.name)]) { const safe = n.replace(/[\\/:*?"<>|]+/g, '_'), src = path.join(DIR(), e.id, safe); if (!fs.existsSync(src)) continue; const out = BIZ.projects.outputDir(job.folder, attachmentKind(n)) || BIZ.projects.outputDir(job.folder, 'email'); const dst = path.join(out, safe); if (!fs.existsSync(dst)) fs.copyFileSync(src, dst); filed.push(path.relative(job.folder, dst)); } if (filed.length) r.filed = filed; } catch {} }
    e.jobId = job.id; e.desk = { ...(e.desk || {}), [job.id]: r }; save(list);
    BIZ.log({ who: 'Eli', action: 'Filed an email on the job', jobId: job.id, detail: `${e.subject || e.summary} · ${r.deliverables} deliverable(s) added · ${r.comments} change(s) logged` });
    return r;
  };
  ipcMain.handle('jobs:applyEmail', wrap(applyEmail));
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
  ipcMain.handle('mail:pickParent', wrap(async () => { if (process.env.AMO_PICK_DIR) return process.env.AMO_PICK_DIR; const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'], title: 'Where should the new job folder go?' }); return r.canceled ? null : r.filePaths[0]; }));
  // a new job straight from the projects whiteboard: number, name, client and its folder (made from the Atomax template, an existing one linked, or none yet)
  ipcMain.handle('board:newJob', wrap(({ number, name, client, mode, folder }) => {
    number = String(number || '').trim().toUpperCase(); if (!number) throw new Error('Give the job a number');
    const d = BIZ.data(); if (d.jobs.some(j => String(j.number).toUpperCase() === number)) throw new Error(number + ' is already a job');
    if (mode === 'create') { const s = loadSettings ? loadSettings() : {}; if (!folder || !fs.existsSync(folder)) throw new Error('Choose where your job folders live'); if (saveSettings && s.jobsFolder !== folder) saveSettings({ ...s, jobsFolder: folder }); folder = BIZ.projects.createJobFolder(folder, number, name || ''); }
    else if (mode === 'link') { if (!folder || !fs.existsSync(folder)) throw new Error('Choose the job folder'); }
    else folder = '';
    const job = biz.saveJob(d, { number, name: String(name || '').trim(), client: String(client || '').trim(), folder }, 'Tom');
    BIZ.store.save();
    if (folder) { try { BIZ.projects.gather(job.id, folder, { checker: require('./checker'), dxffix: require('./dxffix') }); } catch {} }
    return { id: job.id, folder };
  }));
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
  // Ada's technical note on a task Dave or Tom hands her from their chat: the job's PDFs that fit the task go with it, the note is saved in
  // the job's documents folder, the same as one she writes from an email
  module.exports.adaNote = async ({ jobId = '', title = '', detail = '', from = '' }) => {
    const job = jobId && BIZ.data().jobs.find(j => j.id === jobId), content = [];
    const pdfs = job ? BIZ.projects.relevantFiles(job.id, title + ' ' + detail, { exts: ['.pdf'], max: 2 }) : [];
    for (const p of pdfs) { try { content.push({ type: 'text', text: 'Project file: ' + path.basename(p) }); content.push(checker.contentBlock('pdf', p, fs.readFileSync(p))); } catch {} }
    content.push({ type: 'text', text: `THE TASK: ${title}\n${detail}${from ? `\n\nASKED BY: ${from}` : ''}` });
    const system = ENG_SYSTEM + (job ? '\n\n' + BIZ.contextFor(job.id, 'Ada') : '');
    const r = await claudeFull({ system, who: 'engineer', maxTokens: 16000, messages: [{ role: 'user', content }] });
    let text = String(r.text || '').trim(); if (!text) throw new Error('Ada got an empty reply from Claude');
    if (r.stop === 'max_tokens') text += '\n\n_(Ada ran out of room here: the note is cut short.)_';
    text = '**DRAFT for review** (asked for by ' + (from || 'a lead') + '; an engineer checks it before it is used)\n\n' + text;
    const outDir = (job && BIZ.outputDirFor(job.id, 'documents')) || path.join(userDir(), 'engineering'); fs.mkdirSync(outDir, { recursive: true });
    const safe = String(title || 'Technical note').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 70);
    let file = path.join(outDir, `Technical note - ${safe} DRAFT.md`), k = 2; while (fs.existsSync(file)) file = path.join(outDir, `Technical note - ${safe} DRAFT (${k++}).md`);
    fs.writeFileSync(file, text, 'utf8');
    if (job && job.folder) { try { BIZ.projects.gather(job.id, job.folder, { checker, dxffix: require('./dxffix') }); } catch {} }
    const summary = ((text.match(/## Summary\s*\n([\s\S]*?)(\n## |$)/) || [])[1] || text.slice(0, 400)).trim();
    BIZ.log({ who: 'Ada', action: `Wrote a technical note for ${from || 'a lead'}`, jobId, detail: path.basename(file) + ' · ' + summary.slice(0, 160) });
    return { path: file, summary };
  };
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
  const runs = require('./runs');
  ipcMain.handle('dex:make', wrap(async ({ jobId = '', request = '', answers = [], emailId = '', skills, revision = null, drawingNumber = '', drawn = '', checked = '', approved = '', run = '', kind: askedKind = '' }) => {
    if (!String(request).trim()) throw new Error('Say what Dex should draw');
    const stage = (t, pct) => runs.stage(run, t, pct);
    stage('reading the job\'s inputs', 5);
    const d = BIZ.data(), job = jobId && d.jobs.find(j => j.id === jobId);
    // his skills for MAKING a drawing: drawing skills first, fixer-only rules and spreadsheet skills only when the request needs them
    const all = library.skillsFor('dex');
    const wantsSheets = /excel|xlsx|schedule|spreadsheet/i.test(request), wantsFix = /\b(fix|correct|redline|markup)\b/i.test(request);
    const rank = (sk) => /sld|single.?line|dxf|cad|earth|drawing|schematic/i.test(sk.name + ' ' + sk.file) ? 0 : 1;
    // the skills Tom ticked for this run win; otherwise his drawing skills (fixer-only and spreadsheet skills only when the request needs them)
    const lib = library.list('skills');
    // by default only the skills made for THIS kind of drawing (an SLD skill is not used for earthing), plus general CAD house rules; none if nothing fits
    // the kind of drawing: from the deliverable row when the Jobs screen says (comments folded into the request may name other drawings), else from the request's first line
    const DK = require('./drawkinds'), kind = ['sld', 'bcd', 'earthing', 'loop', 'layout', 'termination'].includes(String(askedKind || '').toLowerCase()) ? String(askedKind).toLowerCase() : DK.kindOf(String(request).split(/\n|\. /)[0]);
    if (kind === 'termination') throw new Error('Dex cannot draw termination diagrams yet. The Atomax termination skill is in the File Room ready for when he can (send Claude your termination examples).');
    const picked = (Array.isArray(skills) ? skills.map(f => { const i = lib.find(x => x.file === f); return i ? { name: i.name, file: i.file, text: library.readText('skills', i.file).trim() } : null; }).filter(x => x && x.text) : all.filter(sk => { const fit = DK.skillFit({ ...sk, description: (lib.find(x => x.file === sk.file) || {}).description }, kind); return fit || (wantsFix && /fix/i.test(sk.name) && !DK.skillKinds(sk).some(k => k !== kind)) || (wantsSheets && /excel|xlsx|spreadsheet/i.test(sk.name + ' ' + sk.file)); })).sort((a, b) => rank(a) - rank(b));
    let room = 30000; const used = [];
    const skillText = picked.map(sk => { if (room <= 0) return ''; const t = sk.text.slice(0, room); room -= t.length; used.push(sk.name + (t.length < sk.text.length ? ' (cut short)' : '')); return `--- SKILL: ${sk.name} ---\n${t}`; }).filter(Boolean).join('\n\n');
    const system = dxfmaker.SYSTEM + (skillText ? `\n\nYOUR SKILLS (house rules from the File Room; follow them where they fit this drawing):\n${skillText}` : '') + (job ? '\n\n' + BIZ.contextFor(job.id, 'Dex') : '');
    const content = [];
    // the PDFs in the project folder that look relevant (an existing SLD, a schedule), and the email's screenshots / PDFs
    const pdfs = job ? BIZ.projects.relevantFiles(job.id, request, { exts: ['.pdf'], max: 3 }) : [];
    for (const p of pdfs) { try { content.push({ type: 'text', text: 'Project file: ' + path.basename(p) }); content.push(checker.contentBlock('pdf', p, fs.readFileSync(p))); } catch {} }
    // the job's spreadsheets: a BCD or SLD is usually drawn from the cable schedule / load schedule / IO list (files named by their QS 006 number are found by type code and sheet names)
    const sheetsRead = [], workbooks = [];
    if (job && /bcd|sld|block|single.?line|cable|earthing/i.test(request + ' ' + kind)) {
      const want = kind === 'bcd' ? 'cable schedule instrument index io list tag list' : kind === 'earthing' ? 'earthing conductors cable schedule' : 'cable schedule load schedule protection settings';
      for (const p of BIZ.projects.relevantFiles(job.id, request + ' ' + want, { exts: ['.xlsx', '.xlsm', '.csv'], max: 3 }).filter(p => !/register/i.test(path.basename(p)))) {
        try { const b = fs.readFileSync(p), wb = /\.csv$/i.test(p) ? checker.readCsv(b.toString('utf8')) : checker.readXlsx(b); workbooks.push(...wb); content.push({ type: 'text', text: `PROJECT WORKBOOK ${path.basename(p)} (copy cable numbers, from / to, cores, sizes, types, voltages, lengths and locations exactly as written; TBC stays TBC):\n` + checker.sheetsAsText(wb, 40000) }); sheetsRead.push(path.basename(p)); } catch {}
      }
    }
    const em = emailId && load().find(x => x.id === emailId);
    if (em) for (const a of em.attachments.slice(0, 3)) { try { const buf = fs.readFileSync(path.join(DIR(), em.id, a.name)); content.push({ type: 'text', text: 'From the email: ' + a.name }); content.push(checker.contentBlock(a.mime === 'application/pdf' ? 'pdf' : 'image', a.name, buf)); } catch {} }
    // the engineer's technical notes for this job (conductor sizes, electrode design): Dex draws from these instead of TBC
    const notesRead = [];
    try { const nd = job && BIZ.outputDirFor(job.id, 'documents'); if (nd && fs.existsSync(nd)) { const want = /earth/i.test(request) ? /earth/i : /./; const ns = fs.readdirSync(nd).filter(f => /^Technical note - .*\.md$/i.test(f)).map(f => ({ f, t: fs.statSync(path.join(nd, f)).mtimeMs })).sort((a, b) => b.t - a.t).filter(x => want.test(x.f) || /earth|conductor/i.test(fs.readFileSync(path.join(nd, x.f), 'utf8').slice(0, 3000))).slice(0, 2); for (const n of ns) { content.push({ type: 'text', text: `ENGINEER'S TECHNICAL NOTE (${n.f}) - use its sizes and say "per ${n.f.replace(/\.md$/, '')}" in the notes:\n` + fs.readFileSync(path.join(nd, n.f), 'utf8').slice(0, 20000) }); notesRead.push(n.f); } } } catch {}
    // the job's own reports for this kind of drawing (an earthing study for the earthing drawing, the protection and fault studies for an SLD): their figures are design inputs, read as text
    try { if (job && ['earthing', 'sld'].includes(kind)) { const want = kind === 'earthing' ? /earth/i : /protection|short circuit|fault|load flow/i; const DT = require('./datatable');
      const reps = BIZ.projects.relevantFiles(job.id, request + (kind === 'earthing' ? ' earthing design basis epr' : ' protection short circuit fault load flow study'), { exts: ['.docx'], max: 4 }).filter(p => want.test(path.basename(p)) && !/DRAFT|do not issue/i.test(p)).slice(0, 2);
      for (const p of reps) { const t = await DT.docxText(fs.readFileSync(p)); content.push({ type: 'text', text: `JOB REPORT ${path.basename(p)} - a design input: use its figures (conductor sizes, fault levels, settings) and cite it in the notes:\n${t.slice(0, 40000)}` }); notesRead.push(path.basename(p)); } } } catch {}
    content.push({ type: 'text', text: `REQUEST: ${request}${answers.length ? '\n\nANSWERS FROM THE ENGINEER:\n' + answers.map(x => `Q: ${x.q}\nA: ${x.a}`).join('\n') : ''}` });
    // a big site needs a long spec: give room, retry with more if it is cut off, and never pass off a cut-off spec as complete
    stage(revision && revision.on ? 'Dex is working out the changes' : 'Dex is drawing', 20);
    let r = await claudeFull({ system, who: 'dex', skills: false, maxTokens: 24000, messages: [{ role: 'user', content }], run });
    if (r.stop === 'max_tokens') r = await claudeFull({ run, system: system + '\nKeep labels short (four lines at most) and give a feeder label only when it adds something the end item label does not say.', who: 'dex', skills: false, maxTokens: 48000, messages: [{ role: 'user', content }] });
    let text = r.text, cutOff = r.stop === 'max_tokens';
    // a reply that still cannot be read (a stray quote or bracket the repair cannot place): kept for a look, and Dex is asked once to send it again as strict JSON
    let spec;
    try { spec = dxfmaker.parseReply(text); }
    catch (err) {
      try { const dd = path.join(userDir(), 'dxf-made'); fs.mkdirSync(dd, { recursive: true }); fs.writeFileSync(path.join(dd, `dex-reply-${Date.now()}.txt`), String(text || '')); } catch {}
      const again = await claudeFull({ system, who: 'dex', skills: false, maxTokens: 24000, messages: [{ role: 'user', content }, { role: 'assistant', content: String(text || '').slice(0, 60000) }, { role: 'user', content: `That reply is not valid JSON (${String(err.message || err).slice(0, 120)}). Send the same drawing spec again as strict JSON only: escape any " inside text as \\", commas between every item, no markdown.` }] });
      text = again.text; cutOff = again.stop === 'max_tokens';
      try { spec = dxfmaker.parseReply(text); } catch (err2) { throw new Error(`Dex's reply could not be read twice (${String(err2.message || err2).slice(0, 100)}). Press Make again.`); }
    }
    if (spec.questions && spec.questions.length && !answers.length) return { questions: spec.questions.slice(0, 4).map(String), read: [...pdfs.map(p => path.basename(p)), ...sheetsRead, ...notesRead], skills: used };
    if ((kind === 'bcd' && !spec.boards && !spec.busbars) || (Array.isArray(spec.cables) && spec.cables.length && !spec.boards)) spec.kind = 'bcd';   // what Dex drew decides when it is plainly an SLD
    // the wrong kind of drawing is never saved under the asked-for number (an SLD spec filed as the BCD)
    if (askedKind && ((askedKind === 'bcd' && spec.kind !== 'bcd') || (askedKind === 'sld' && spec.kind === 'bcd'))) throw new Error(`Dex drew a ${spec.kind === 'bcd' ? 'block cable diagram' : 'single line diagram'} when the ${askedKind === 'bcd' ? 'block cable diagram' : 'single line diagram'} was asked for. Press Make again.`);
    // National Grid jobs and LVAC block diagrams use the National Grid style (filled energised / de-energised blocks, coloured cable runs, legend)
    if (spec.kind === 'bcd' && !spec.style && (/national grid|\bNGET?\b|\blvac\b/i.test(request) || (job && /national grid/i.test(job.client || '')))) spec.style = 'ng';
    if (spec.kind === 'bcd' ? !(spec.cables || []).length : (!spec.boards && !spec.busbars)) {
      // the reply is kept beside the GIVEN files so the fault can be found, never guessed at
      let kept = ''; try { const gd = path.join(userDir(), 'runs', String(job ? job.id : 'nojob')); fs.mkdirSync(gd, { recursive: true }); kept = path.join(gd, `dex-reply-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`); fs.writeFileSync(kept, String(text || '')); } catch {}
      throw new Error(cutOff ? 'Dex\'s drawing was cut off before the end (max_tokens) and could not be read. Press Make again.' : `Dex's reply had no drawing in it that could be read. The reply is kept at ${kept || '(could not save)'} — send it to Claude. Press Make again meanwhile.`);
    }
    const desk = require('./jobdesk'), DN = require('./docnumber');
    // REFERENCE DOCUMENTS: what Dex says he used, plus every file he was actually given (a document he read is always referenced)
    {
      const refs = (Array.isArray(spec.references) ? spec.references : []).map(x => String(x).trim()).filter(Boolean);
      const QS = /X\d{4,6}(?:-[A-Z0-9]{2,4}){2,5}-\d{4}/i, has = (n) => refs.some(r => r.toUpperCase().includes(n.toUpperCase()));
      for (const f of [...pdfs.map(p => path.basename(p)), ...sheetsRead, ...notesRead]) {
        const stem = f.replace(/\.[^.]+$/, ''), no = (stem.match(QS) || [])[0];
        if (no ? has(no) : has(stem)) continue;
        refs.push(no ? `${no} - ${stem.replace(no, '').replace(/^[\s_-]+|[\s_-]+$/g, '').replace(/[_]+/g, ' ') || 'INPUT'}` : stem.replace(/[_]+/g, ' '));
      }
      spec.references = refs.filter(r => (!spec.drawingNumber || !r.toUpperCase().startsWith(String(spec.drawingNumber).toUpperCase())) && !/master (device )?list/i.test(r));   // never itself, never our internal lists
    }
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
        // reported back to Tom (masterCheck), never written on the client's drawing
        masterCheck = { added: missing.map(c => c.no), extra: extra.map(c => c.no), touches: !!touches };
      }
    }
    // the notes go to the client: questions, TQs and our own working come off the drawing and go to the job's RFI register
    // the schedule is the source: cable type (with voltage), cores, size, length and locations copied from its own columns
    if (revision && revision.on && revision.note) spec.revisionNote = String(revision.note).slice(0, 2000);   // known before the schedule pass: a cable the comments delete is not put back from the schedule
    stage('matching the drawing to the schedule', 65);
    const fromSched = dxfmaker.fromSchedule(spec, workbooks);   // with no workbook it still applies the revision's deletions
    if (fromSched.length) BIZ.log({ who: 'Dex', action: 'Matched the BCD to the schedule', jobId: job ? job.id : '', detail: fromSched.slice(0, 12).join('; ') + (fromSched.length > 12 ? ' …' : '') });
    dxfmaker.cleanLabels(spec);   // no SEE TQ / RFI pointers in labels: TBC is enough, the question is in the RFI register
    const cn = dxfmaker.clientNotes(spec), queries = [...new Set([...(Array.isArray(spec.queries) ? spec.queries : []), ...cn.moved].map(q => String(q || '').trim()).filter(Boolean))];
    spec.notes = cn.notes; delete spec.queries;
    // the drawing number: from the job's drawing list when one matches, else the next QS 006 number for this kind
    if (drawingNumber) spec.drawingNumber = drawingNumber;   // made from the Jobs screen for a given deliverable
    if (job && (!spec.drawingNumber || /tbc/i.test(spec.drawingNumber))) {
      const want = spec.kind === 'bcd' ? /bcd|block cable/i : spec.kind === 'earthing' ? /earth/i : /single line|\bsld\b/i;
      const onList = job.drawings.find(d => want.test(d.title) && !/^TBC-/.test(d.no) && /to do|live/i.test(d.status || 'Live'));
      spec.drawingNumber = onList ? onList.no : (desk.proposeNumber(job, spec.kind === 'bcd' ? 'BCD' : spec.kind === 'earthing' ? 'earthing' : 'SLD', [], job.id, [], true) || 'TBC');
    }
    if (job && queries.length) { try { desk.addInputs(job.id, { questions: queries, fromEmail: 'Dex (drawing ' + (spec.drawingNumber || spec.title || '') + ')' }); } catch {} }
    // the drawing's own place in an Atomax project folder (7.3 Block Diagrams, 7.4 Single Line Diagrams, 6.3 for instrument BCDs ...)
    const outKind = spec.kind === 'bcd' ? ((job && /^05$/.test(require('./jobdesk').load(job.id).disc || '')) || /instrument|\bRIO\b|loop/i.test(request) ? 'bcd-instrument' : 'bcd') : spec.kind === 'earthing' ? 'earthing' : 'sld';
    const outDir = (job && BIZ.outputDirFor(job.id, outKind)) || path.join(userDir(), 'dxf-made');
    if (cutOff) spec.notes = [...(spec.notes || []), 'INCOMPLETE: Dex ran out of room before the end of the drawing. Parts after the last board shown are missing. Ask him again.'];
    const kindName = spec.kind === 'earthing' ? 'EARTHING' : spec.kind === 'bcd' ? 'BCD' : 'SLD';
    const base = spec.drawingNumber && spec.drawingNumber !== 'TBC' ? spec.drawingNumber + '_' + kindName : (job ? job.number + '_' + kindName : kindName);
    // optional: a new revision of a drawing Dex made before (changes clouded on BCDs, history carried in the notes)
    // the drawing as it is now (its last saved spec, in the folder or its Archive)
    const realNo = spec.drawingNumber && !/^TBC/i.test(spec.drawingNumber) ? spec.drawingNumber : '';
    let prior = dxfmaker.previousSpec(outDir, realNo || base);
    let previous = null;
    if (revision && revision.on) {
      // a revision: the next one at the same stage (P01 > P02), or the one asked for (e.g. "C01")
      const to = String(revision.to || '').toUpperCase().replace(/^([A-Z])(\d)$/, '$10$2');
      spec.revision = /^[A-Z]\d{2}$/.test(to) ? to : DN.nextRev(prior ? prior.spec.revision : 'P01', revision.stage || '');
      // the same revision made again (a P02 redone): compared with the revision before it, so the clouds and the note show the real changes
      if (prior && String(prior.spec.revision || '').toUpperCase() === spec.revision) prior = dxfmaker.previousSpec(outDir, realNo || base, spec.revision) || prior;
      previous = prior;
      if (revision.note) spec.revisionNote = revision.note;
      if (revision.desc) spec.revisionDesc = String(revision.desc).toUpperCase().slice(0, 40).replace(/(.{1,20})\s+(?=.)/, '$1\n');   // the revision table's description, over two short lines
    } else {
      // make again: the same revision the drawing has now (P01 for a first make), its revision history kept
      spec.revision = prior ? prior.spec.revision : 'P01';
      if (prior && prior.spec.revHistory) spec.revHistory = prior.spec.revHistory;
    }
    spec.revision = String(spec.revision).toUpperCase().replace(/^([A-Z])(\d)$/, '$10$2');   // two digits: P01
    const today = (() => { const d = new Date(); return [d.getDate(), d.getMonth() + 1, d.getFullYear()].map((v, i) => String(v).padStart(i < 2 ? 2 : 4, '0')).join('.'); })();
    spec.people = { drawn, checked, approved, date: today };
    const bd = job ? desk.borderFor(job) : { key: 'atomax', name: 'Atomax A1' }, template = bd.template || '';
    if (bd.warning) spec.notes = [...(spec.notes || [])];
    // saved as NUMBER_REV (older versions moved to Archive); a drawing with no real number yet keeps the old draft naming
    stage('laying out the drawing', 75);
    const res = dxfmaker.make(spec, outDir, realNo ? realNo + '_' + spec.revision : base, { exact: !!realNo, archivePrefix: [realNo, job ? job.number + '_' + kindName : '', kindName], template, border: bd.key, previous, fill: job ? { drawn, checked, approved, client: job.client || spec.client || '', project: `${job.number} ${job.name || ''}`.trim(), site: (desk.load(job.id).ng || {}).site || job.name || '', ngInvestment: (desk.load(job.id).ng || {}).investment || '' } : { drawn, checked, approved, client: spec.client || '' } });
    // every DXF gets its monochrome PDF beside it (issues go out as DXF and PDF)
    stage('writing the DXF and PDF', 90);
    let madePdfs = []; try { madePdfs = await require('./pdfout').writePdfs(res); } catch (e) { (res.files || []).forEach(f => delete f.prims); }
    BIZ.log({ who: 'Dex', action: 'Drew', jobId: job ? job.id : '', detail: `${path.basename(res.path)} · ${spec.summary || spec.title || 'SLD'}${used.length ? ' · skills: ' + used.join(', ') : ' · no skills'}` });
    // what Dex was given, kept beside the app's data (not in the job folder) so Tom can see exactly what went in when something looks wrong
    let givenFile = '';
    try { const gd = path.join(userDir(), 'runs', String(job ? job.id : 'nojob')); fs.mkdirSync(gd, { recursive: true }); givenFile = path.join(gd, `${(spec.drawingNumber || base).replace(/[\\/:*?"<>|]+/g, '_')}_${spec.revision}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`);
      const textParts = content.map(c => c.type === 'text' ? c.text : `[${c.type}: ${c.source && c.source.media_type || ''}]`).join('\n\n');
      fs.writeFileSync(givenFile, `WHAT DEX WAS GIVEN\n${new Date().toISOString()}\nDrawing: ${spec.drawingNumber || base} ${spec.revision}\n\n=== SKILLS ===\n${used.join('\n') || '(none)'}\n\n=== FILES READ ===\n${[...pdfs.map(p => path.basename(p)), ...sheetsRead, ...notesRead].join('\n') || '(none)'}\n\n=== SYSTEM PROMPT ===\n${system}\n\n=== USER MESSAGE ===\n${textParts}\n\n=== DEX'S REPLY (summary) ===\n${spec.summary || ''}\n\n=== SCHEDULE MATCHES ===\n${fromSched.join('\n') || '(none)'}\n\n=== QUERIES ===\n${queries.join('\n') || '(none)'}\n\n=== LAYOUT WARNINGS ===\n${(spec._warnings || []).join('\n') || '(none)'}\n`, 'utf8'); } catch {}
    return { givenFile, request, fromSchedule: fromSched, queries, warnings: spec._warnings || [], archived: (res.archived || []).length, border: bd.name, borderWarning: bd.warning || '', pdfs: madePdfs, masterCheck, sheets: (res.files || []).map(f => ({ path: f.path, pdf: f.pdf || '', label: f.label })), diff: res.diff, revision: spec.revision, previousFound: !!previous, titleBlock: template ? path.basename(template) : '', drawingNumber: spec.drawingNumber, skills: used, incomplete: cutOff, path: res.path, folder: outDir, svg: res.svg, summary: spec.summary || '', title: spec.title || '', notes: spec.notes || [], read: [...pdfs.map(p => path.basename(p)), ...sheetsRead, ...notesRead], inJobFolder: !!(job && job.folder) };
  }));
}

module.exports = { register, ensureDrafter, parseEml, parseMsg, EMAIL_SYSTEM, AGENTS };
