// Talk to Eli about a job. He has the job in front of him (the register rows and their files, the RFIs, the open comments, what the scope
// documents said, the folder) and can change things when Tom tells him to: remove or rename a deliverable, add one, renumber it, close or
// raise an RFI, close a comment, make a note. He answers in plain English and says exactly what he changed. Nothing changes unless Tom asked.
'use strict';
const fs = require('fs'), path = require('path');

const SYSTEM = `You are Eli, the document controller at Atomax-UK (an electrical engineering consultancy). You are talking to Tom, the CAD engineer running this job, in a chat on the job's page. You have the job's register (its deliverables with numbers, revisions and the files on disk), the RFIs, the client's open comments, what the scope documents said, and the job folder's file list.
How you talk: short, plain British English, like a colleague across the desk. Answer what he asked. If something he says contradicts the register, say so and ask rather than guess. When he tells you to change something, do it and say exactly what you did (numbers and titles). Never invent a document number, revision or file: use the ones in front of you. If you cannot do something from here, say what he or the app would need to do instead.
What you can change (only when Tom asks, never on your own initiative):
- remove a deliverable row: {"do":"remove","no":"<row number>"}
- rename a row (new title): {"do":"rename","no":"<row number>","title":"..."}
- renumber a row: {"do":"renumber","no":"<row number>","to":"<new number>"}
- add a deliverable: {"do":"add","type":"SLD|BCD|earthing|loop|layout|cable schedule|schedule|calculation|document|other","title":"...","qty":1}
- set a row's revision as the register knows it: {"do":"rev","no":"<row number>","rev":"P03"}
- close an RFI (the client answered, or it is not needed): {"do":"closeRfi","no":"RFI-001","answer":"..."}
- raise an RFI: {"do":"addRfi","q":"..."}
- close a client comment: {"do":"closeComment","no":"C-001","response":"..."}
- note a fact about the job for everyone (the job rules): {"do":"note","text":"..."}
Reply with JSON only, no markdown: {"reply":"what you say to Tom","actions":[...]} ("actions" empty when nothing is to change).`;

const cap = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };

// everything Eli can see about the job, as text
function context({ job, overview, desk, files, history, nextIssue }) {
  const rows = (overview.rows || []).map(r => `${r.no}${r.alt ? ' (' + r.alt + ')' : ''} | ${r.rev || '-'} | ${r.group} | ${r.title}${r.src ? (r.src.dxf ? ' | DXF: ' + r.src.dxf.split('/').pop() : r.src.dwg ? ' | DWG only: ' + r.src.dwg.split('/').pop() : ' | no file') : ''}${r.work && r.work.status ? ' | ' + r.work.status + (r.work.rev ? ' ' + r.work.rev : '') : ''}`);
  const rfis = (desk.rfis || []).map(r => `${r.no} | ${r.status} | ${r.q}${r.answer ? ' | answer: ' + r.answer : ''}`);
  const crs = (desk.crs || []).filter(c => !/responded|closed/i.test(c.status || '')).map(c => `${c.no} | on ${c.doc === '*' ? 'every drawing' : c.doc || 'the job'} | ${c.by || ''}: ${c.comment}`);
  const inputs = (desk.inputs || []).map(i => `${i.name}${i.rev ? ' ' + i.rev : ''}${i.what ? ' — ' + i.what : ''}`);
  const sc = desk.scope || {};
  const scope = sc.summary || sc.facts || sc.byOthers || sc.conflicts ? `SCOPE (from the documents): ${sc.summary || ''}\nFACTS: ${(sc.facts || []).map(f => `${f.name}: ${f.value}`).join('; ')}\nBY OTHERS: ${(sc.byOthers || []).map(b => `${b.title} (${b.who})`).join('; ')}\nWHERE THE DOCUMENTS DISAGREE: ${(sc.conflicts || []).join(' | ')}` : '';
  const hist = (history || []).slice(-24).map(m => `${m.role === 'tom' ? 'TOM' : 'ELI'}: ${cap(m.text, 1200)}`).join('\n');
  return [
    `JOB: ${job.number} ${job.name || ''} | client ${job.client || '-'} | folder ${job.folder || '-'}${nextIssue ? ` | next issue: ISSUE ${nextIssue.n}${nextIssue.previous ? ' (ISSUE ' + nextIssue.previous.n + ' is the last on file)' : ''} — issued DXF+PDF copies and the transmittal go there when Tom presses Issue; working files stay with the working set` : ''} | rules: ${cap(desk.rules || '', 1500)}`,
    `REGISTER (${rows.length} rows; number | rev | group | title | file):\n${rows.join('\n') || '(empty)'}`,
    `RFIs:\n${rfis.join('\n') || '(none)'}`,
    `OPEN CLIENT COMMENTS:\n${crs.join('\n') || '(none)'}`,
    `INPUTS RECEIVED:\n${inputs.join('\n') || '(none)'}`,
    scope,
    `JOB FOLDER (${files.length} files, Archive left out):\n${files.slice(0, 500).join('\n')}`,
    hist ? `CONVERSATION SO FAR:\n${hist}` : ''
  ].filter(Boolean).join('\n\n');
}

// apply what Eli decided; returns one line per change, as done (or why not)
function apply(actions, { job, desk, deskMod, biz, BIZ, overview }) {
  const done = []; const rows = () => job.drawings;
  const find = (no) => { const up = String(no || '').trim().toUpperCase(); return rows().find(r => r.no.toUpperCase() === up || (r.alt && r.alt.toUpperCase() === up)) || rows().find(r => up && r.no.toUpperCase().endsWith(up)); };
  let jobChanged = false;
  for (const a of actions || []) {
    try {
      if (!a || !a.do) continue;
      if (a.do === 'remove') { const r = find(a.no); if (!r) { done.push(`${a.no}: not on the list`); continue; } rows().splice(rows().indexOf(r), 1); const d = deskMod.load(job.id); for (const c of d.crs || []) if (c.doc === r.no) c.doc = ''; deskMod.saveRaw(job.id, d); jobChanged = true; done.push(`removed ${r.no} ${r.title}`); }
      else if (a.do === 'rename') { const r = find(a.no); if (!r || !a.title) { done.push(`${a.no}: not on the list`); continue; } const was = r.title; r.title = String(a.title).trim(); jobChanged = true; done.push(`renamed ${r.no}: "${was}" -> "${r.title}"`); }
      else if (a.do === 'renumber') { const r = find(a.no); if (!r || !a.to) { done.push(`${a.no}: not on the list`); continue; } const ok = deskMod.renameRow(job.id, r.no, String(a.to).trim().toUpperCase()); done.push(ok ? `renumbered ${a.no} -> ${String(a.to).toUpperCase()}` : `${a.no}: could not renumber (is ${a.to} taken?)`); }
      else if (a.do === 'add') { const added = deskMod.addDeliverables(job.id, [{ type: a.type || 'document', title: a.title || a.type, qty: a.qty || 1 }], { source: 'eli-chat' }) || []; done.push(added.length ? `added ${added.map(x => x.no + ' ' + x.title).join(', ')}` : `${a.title}: already on the list`); }
      else if (a.do === 'rev') { const r = find(a.no); if (!r) { done.push(`${a.no}: not on the list`); continue; } r.rev = String(a.rev || '').toUpperCase(); jobChanged = true; done.push(`${r.no} now at ${r.rev || 'no rev'}`); }
      else if (a.do === 'closeRfi') { const d = deskMod.load(job.id), r = (d.rfis || []).find(x => x.no === a.no); if (!r) { done.push(`${a.no}: no such RFI`); continue; } deskMod.saveRfi(job.id, { no: r.no, status: 'Closed', answer: a.answer || r.answer || 'Closed by Tom' }); done.push(`closed ${r.no}`); }
      else if (a.do === 'addRfi') { if (!a.q) continue; deskMod.addInputs(job.id, { inputs: [], missing: [], questions: [String(a.q)], fromEmail: 'Tom (chat)' }); done.push(`raised an RFI: ${a.q}`); }
      else if (a.do === 'closeComment') { const d = deskMod.load(job.id), c = (d.crs || []).find(x => x.no === a.no); if (!c) { done.push(`${a.no}: no such comment`); continue; } deskMod.saveCrs(job.id, { no: c.no, status: 'Closed', response: a.response || 'Closed by Tom' }); done.push(`closed comment ${c.no}`); }
      else if (a.do === 'note') { if (!a.text) continue; const d = deskMod.load(job.id); deskMod.setRules(job.id, `${d.rules ? d.rules + '\n' : ''}${String(a.text).trim()}`); done.push(`noted: ${a.text}`); }
      else done.push(`${a.do}: not something I can do from here`);
    } catch (e) { done.push(`${a.do} ${a.no || a.title || ''}: ${String(e.message || e)}`); }
  }
  if (jobChanged) { biz.saveJob(BIZ.data(), job, 'Eli'); BIZ.store.save(); }
  return done;
}

module.exports = { SYSTEM, context, apply };
