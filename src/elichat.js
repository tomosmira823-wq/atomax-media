// Talk to Eli about a job. He has the job in front of him (the register rows and their files, the RFIs, the open comments, what the scope
// documents said, the folder) and can change things when Tom tells him to: remove or rename a deliverable, add one, renumber it, close or
// raise an RFI, close a comment, make a note. He answers in plain English and says exactly what he changed. Nothing changes unless Tom asked.
'use strict';
const fs = require('fs'), path = require('path');

// what can be done on a job from a chat: Eli's list, shared with Dave and Tom (leadchat.js)
const ACTIONS = `- remove a deliverable row: {"do":"remove","no":"<row number>"}
- rename a row (new title): {"do":"rename","no":"<row number>","title":"..."}
- renumber a row: {"do":"renumber","no":"<row number>","to":"<new number>"}
- add a deliverable: {"do":"add","type":"SLD|BCD|earthing|loop|layout|cable schedule|schedule|calculation|document|other","title":"...","qty":1}
- set a row's revision as the register knows it: {"do":"rev","no":"<row number>","rev":"P03"}
- close an RFI (the client answered, or it is not needed): {"do":"closeRfi","no":"RFI-001","answer":"..."}
- raise an RFI: {"do":"addRfi","q":"..."}
- close a client comment: {"do":"closeComment","no":"C-001","response":"..."}
- note a fact about the job for everyone (the job rules): {"do":"note","text":"..."}
- rev up a drawing that has a DXF on file (new issue box with the next P rev, today's date, the status; the title block ISSUE field; content unchanged) or a document that has a Word/Excel file on file (new revision rows, header and cover to the next rev, dated today; content unchanged): {"do":"revUp","no":"<row number>","to":"P04 (optional)","status":"ISSUED FOR COMMENT (optional)"}
- rev up every drawing that has a DXF (e.g. "rev up all the P03s"): {"do":"revUpAll","rev":"P03 (optional: only rows at this rev)","status":"ISSUED FOR COMMENT (optional)"}; for documents name each one with "revUp"
- have Dex draw a drawing again from the job's inputs (an SLD, BCD or earthing drawing; not an edit of the file on disk): {"do":"redraw","no":"<row number>","note":"what to change (optional)"}
- log a change Tom wants on a drawing (so Dex makes it on Revise): {"do":"comment","no":"<row number>","text":"the change, in Tom's words"}
- have Dex make the logged changes on a drawing now (text edits on the DXF on file, rev up, PDF, checked): {"do":"revise","no":"<row number>","note":"extra instruction (optional)"}
- the issue being built has gone out (Tom sent it himself): {"do":"issueSent"} — the next revision then opens the next ISSUE folder
- make the PDFs for the issue being built (AutoCAD plots every DXF in the issue folder without a PDF; Word and Excel make the PDFs of the documents in its NATIVES folder): {"do":"plot"}
- write a Document Request to BGEN document control for NG numbers (every deliverable without one, or the ones named): {"do":"docRequest","nos":["<row numbers, optional>"]}
On a National Grid job nothing is issued under our own number: a deliverable without an NG number (X11475-BGN-ZZ-XX-DR-E-7153 style) goes on a Document Request before the issue; the NG number is the primary number and the file name, ours (42_BG_0055) sits beside it.
A drawing with only a DWG is saved as DXF by AutoCAD first, then revved; if AutoCAD is not on this PC, say so and name the file to save as DXF by hand. A change to what is drawn (a new switchroom, a moved board) is CAD work for Tom or a redraw by Dex, not a rev up; say which.
`;

const SYSTEM = `You are Eli, the document controller at Atomax-UK (an electrical engineering consultancy). You are talking to Tom, the CAD engineer running this job, in a chat on the job's page. You have the job's register (its deliverables with numbers, revisions and the files on disk), the RFIs, the client's open comments, what the scope documents said, and the job folder's file list.
How you talk: short, plain British English, like a colleague across the desk. Answer what he asked. If something he says contradicts the register, say so and ask rather than guess. When he tells you to change something, do it and say exactly what you did (numbers and titles). Never invent a document number, revision or file: use the ones in front of you. If you cannot do something from here, say what he or the app would need to do instead.
What you can change (only when Tom asks, never on your own initiative):
${ACTIONS}Reply with JSON only, no markdown: {"reply":"what you say to Tom","actions":[...]} ("actions" empty when nothing is to change).`;

const rel = (job, p) => { try { const r = path.relative(job.folder || '', p); return r && !r.startsWith('..') ? r : p; } catch { return p; } };   // where it went, from the job folder
const cap = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };

// everything Eli can see about the job, as text
function context({ job, overview, desk, files, history, nextIssue, needNg }) {
  const rows = (overview.rows || []).map(r => `${r.no}${r.alt ? ' (' + r.alt + ')' : ''} | ${r.rev || '-'} | ${r.group} | ${r.title}${r.src ? (r.src.dxf ? ' | DXF: ' + r.src.dxf.split('/').pop() : r.src.dwg ? ' | DWG only: ' + r.src.dwg.split('/').pop() : r.src.docx ? ' | Word: ' + r.src.docx.split('/').pop() : r.src.xlsx ? ' | Excel: ' + r.src.xlsx.split('/').pop() : ' | no file') : ''}${r.work && r.work.status ? ' | ' + r.work.status + (r.work.rev ? ' ' + r.work.rev : '') : ''}`);
  const rfis = (desk.rfis || []).map(r => `${r.no} | ${r.status} | ${r.q}${r.answer ? ' | answer: ' + r.answer : ''}`);
  const crs = (desk.crs || []).filter(c => !/responded|closed/i.test(c.status || '')).map(c => `${c.no} | on ${c.doc === '*' ? 'every drawing' : c.doc || 'the job'} | ${c.by || ''}: ${c.comment}`);
  const inputs = (desk.inputs || []).map(i => `${i.name}${i.rev ? ' ' + i.rev : ''}${i.what ? ' — ' + i.what : ''}`);
  const sc = desk.scope || {};
  const scope = sc.summary || sc.facts || sc.byOthers || sc.conflicts ? `SCOPE (from the documents): ${sc.summary || ''}\nFACTS: ${(sc.facts || []).map(f => `${f.name}: ${f.value}`).join('; ')}\nBY OTHERS: ${(sc.byOthers || []).map(b => `${b.title} (${b.who})`).join('; ')}\nWHERE THE DOCUMENTS DISAGREE: ${(sc.conflicts || []).join(' | ')}` : '';
  const hist = (history || []).slice(-24).map(m => `${m.role === 'tom' ? 'TOM' : String(m.name || 'ELI').toUpperCase()}: ${cap(m.text, 1200)}`).join('\n');
  return [
    `JOB: ${job.number} ${job.name || ''} | client ${job.client || '-'} | folder ${job.folder || '-'}${nextIssue ? ` | ${nextIssue.open ? 'issue being built' : 'next issue'}: ISSUE ${nextIssue.n}${nextIssue.previous ? ' (ISSUE ' + nextIssue.previous.n + ' went out)' : ''} — rev ups are written there as new files; the working set (CLAUDE DESGIN / 006) and earlier issue folders are never written to or moved; each rev up makes its PDF beside it and is checked against the working file; the issue closes when its transmittal is on file or Tom says it has gone` : ''} | rules: ${cap(desk.rules || '', 1500)}`,
    `REGISTER (${rows.length} rows; number | rev | group | title | file):\n${rows.join('\n') || '(empty)'}`,
    needNg && needNg.length ? `NO NG NUMBER YET (need a Document Request before the issue): ${needNg.join(', ')}` : (overview.ngJob ? 'Every deliverable has its NG number.' : ''),
    `RFIs:\n${rfis.join('\n') || '(none)'}`,
    `OPEN CLIENT COMMENTS:\n${crs.join('\n') || '(none)'}`,
    `INPUTS RECEIVED:\n${inputs.join('\n') || '(none)'}`,
    scope,
    `JOB FOLDER (${files.length} files, Archive left out):\n${files.slice(0, 500).join('\n')}`,
    hist ? `CONVERSATION SO FAR:\n${hist}` : ''
  ].filter(Boolean).join('\n\n');
}

// apply what Eli decided; returns one line per change, as done (or why not)
async function apply(actions, { job, desk, deskMod, biz, BIZ, overview, doers = {} }) {
  const done = []; const rows = () => job.drawings;
  // a short number ("7153", "00012") is fine when it names one row; when it fits several, nothing is changed and Eli says so
  const find = (no) => { const up = String(no || '').trim().toUpperCase(); const exact = rows().find(r => r.no.toUpperCase() === up || (r.alt && r.alt.toUpperCase() === up)); if (exact) return exact; if (!up) return null; const ends = rows().filter(r => new RegExp('(^|[^0-9])' + up.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').test(r.no.toUpperCase())); if (ends.length > 1) throw new Error(`"${no}" fits ${ends.length} drawings (${ends.map(r => r.no).join(', ')}): say the full number`); return ends[0] || null; };
  const how = (w) => w && w.status && w.status !== 'made' ? ` — ${w.status.toUpperCase()}: ${(w.verify && w.verify.fails || []).join('; ') || w.warning || w.summary || ''}` : '';
  let jobChanged = false;
  for (const a of actions || []) {
    try {
      if (!a || !a.do) continue;
      if (a.do === 'remove') { const r = find(a.no); if (!r) { done.push(`${a.no}: not on the list`); continue; } rows().splice(rows().indexOf(r), 1); const d = deskMod.load(job.id); for (const c of d.crs || []) if (c.doc === r.no) c.doc = ''; deskMod.saveRaw(job.id, d); jobChanged = true; done.push(`removed ${r.no} ${r.title}`); }
      else if (a.do === 'rename') { const r = find(a.no); if (!r || !a.title) { done.push(`${a.no}: not on the list`); continue; } const was = r.title; r.title = String(a.title).trim(); jobChanged = true; done.push(`renamed ${r.no}: "${was}" -> "${r.title}"`); }
      else if (a.do === 'renumber') { const r = find(a.no); if (!r || !a.to) { done.push(`${a.no}: not on the list`); continue; } const ok = deskMod.renameRow(job.id, r.no, String(a.to).trim().toUpperCase()); done.push(ok ? `renumbered ${a.no} -> ${String(a.to).toUpperCase()}` : `${a.no}: could not renumber (is ${a.to} taken?)`); }
      else if (a.do === 'add') { const added = deskMod.addDeliverables(job.id, [{ type: a.type || 'document', title: a.title || a.type, qty: a.qty || 1 }], { source: 'eli-chat' }) || []; done.push(added.length ? `added ${added.map(x => x.no + ' ' + x.title).join(', ')}` : `${a.title}: already on the list`); }
      else if (a.do === 'rev') { const r = find(a.no); if (!r) { done.push(`${a.no}: not on the list`); continue; } r.rev = String(a.rev || '').toUpperCase(); jobChanged = true; done.push(`${r.no} now at ${r.rev || 'no rev'}`); }
      else if (a.do === 'closeRfi') { const d = deskMod.load(job.id), n = (String(a.no || '').match(/(\d+)\s*$/) || [])[1], r = (d.rfis || []).find(x => x.no === a.no) || (n ? (d.rfis || []).find(x => +((x.no.match(/(\d+)$/) || [])[1]) === +n) : null); if (!r) { done.push(`${a.no}: no such RFI`); continue; } deskMod.saveRfi(job.id, { no: r.no, status: 'Closed', answer: a.answer || r.answer || 'Closed by Tom' }); done.push(`closed ${r.no}`); }
      else if (a.do === 'addRfi') { if (!a.q) continue; deskMod.addInputs(job.id, { inputs: [], missing: [], questions: [String(a.q)], fromEmail: 'Tom (chat)' }); done.push(`raised an RFI: ${a.q}`); }
      else if (a.do === 'closeComment') { const d = deskMod.load(job.id), n = (String(a.no || '').match(/(\d+)\s*$/) || [])[1], c = (d.crs || []).find(x => x.no === a.no) || (n ? (d.crs || []).find(x => +((x.no.match(/(\d+)$/) || [])[1]) === +n) : null); if (!c) { done.push(`${a.no}: no such comment`); continue; } deskMod.saveCrs(job.id, { no: c.no, status: 'Closed', response: a.response || 'Closed by Tom' }); done.push(`closed comment ${c.no}`); }
      else if (a.do === 'note') { if (!a.text) continue; const d = deskMod.load(job.id); deskMod.setRules(job.id, `${d.rules ? d.rules + '\n' : ''}${String(a.text).trim()}`); done.push(`noted: ${a.text}`); }
      else if (a.do === 'revUp') { const r = find(a.no); if (!r) { done.push(`${a.no}: not on the list`); continue; } if (!doers.revUp) { done.push('rev up: not available here'); continue; } const w = await doers.revUp({ ...a, no: r.no }); done.push(`revved up ${r.no} to ${w.rev} → ${rel(job, w.files[0])}${how(w)}`); }
      else if (a.do === 'revUpAll') { if (!doers.revUp || !doers.rows) { done.push('rev up: not available here'); continue; } const want = String(a.rev || '').toUpperCase(); const list = doers.rows().filter(r => r.group === 'drawing' && r.src && (r.src.dxf || r.src.dwg) && (!want || String(r.rev || '').toUpperCase() === want)); /* DWG-only ones: Dex saves them as DXF with AutoCAD first */ if (!list.length) { done.push(`rev up all: no drawing with a DXF${want ? ' at ' + want : ''}`); continue; } let ok = 0; const bad = []; for (const r of list) { try { const w = await doers.revUp({ no: r.no, status: a.status || '' }); ok++; done.push(`revved up ${r.no} to ${w.rev} → ${rel(job, w.files[0])}${how(w)}`); } catch (e) { bad.push(`${r.no}: ${String(e.message || e)}`); } } if (bad.length) done.push(...bad); }
      else if (a.do === 'comment') { const r = find(a.no); if (!r || !a.text) { done.push(`${a.no}: not on the list`); continue; } if (!doers.comment) { done.push('comment: not available here'); continue; } doers.comment({ no: r.no, text: String(a.text) }); done.push(`logged against ${r.no}: ${a.text}`); }
      else if (a.do === 'revise') { const r = find(a.no); if (!r) { done.push(`${a.no}: not on the list`); continue; } if (!doers.revise) { done.push('revise: not available here'); continue; } const w = await doers.revise({ no: r.no, note: a.note || '', status: a.status || '' }); done.push(`Dex revised ${r.no} to ${w.rev} → ${rel(job, (w.files || [''])[0])}${how(w)}`); }
      else if (a.do === 'issueSent') { if (!doers.issueSent) { done.push('issue sent: not available here'); continue; } try { const r = doers.issueSent(); done.push(`ISSUE ${r.n} marked as sent; the next revision opens ISSUE ${r.n + 1}`); } catch (e) { done.push(String(e.message || e)); } }
      else if (a.do === 'plot') { if (!doers.plot) { done.push('plot: not available here'); continue; } const r = await doers.plot(a); for (const d of r.done) done.push(`plotted → ${rel(job, d.pdf)}`); for (const f of r.failed) done.push(`NOT plotted: ${f.error}`); if (r.note) done.push(r.note); }
      else if (a.do === 'docRequest') { if (!doers.docRequest) { done.push('document request: not available here'); continue; } const r = await doers.docRequest(a); done.push(`Document Request written → ${rel(job, r.file)} for ${r.rows.map(x => x.no + ' (' + (x.category || '?') + ')').join(', ')}`); }
      else if (a.do === 'redraw') { const r = find(a.no); if (!r) { done.push(`${a.no}: not on the list`); continue; } if (!doers.make) { done.push('redraw: not available here'); continue; } const w = await doers.make({ no: r.no, note: a.note || '' }); done.push(`Dex ${w && w.status === 'made' ? 'drew' : 'is on'} ${r.no}${w && w.status && w.status !== 'made' ? ' (' + w.status + ')' : ''}`); }
      else done.push(`${a.do}: not something I can do from here`);
    } catch (e) { done.push(`${a.do} ${a.no || a.title || ''}: ${String(e.message || e)}`); }
  }
  if (jobChanged) { biz.saveJob(BIZ.data(), job, 'Eli'); BIZ.store.save(); }
  return done;
}

module.exports = { SYSTEM, ACTIONS, context, apply };
