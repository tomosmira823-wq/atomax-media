// The job desk on the project board: numbering and the drawing register, job rules and corrections, client profile,
// inputs and RFIs, the master device list (build, edit in Excel, approve) and the comment response sheet.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const base = (p) => String(p || '').split(/[\\/]/).pop();
const open = {};   // which sections are open, kept while the board re-renders

export async function renderJobDesk(api, el, job, { getAgents } = {}) {
  if (!el || !job) return;
  let V; try { V = await api.desk.get({ jobId: job.id }); } catch (e) { el.innerHTML = `<div class="bsub">${esc(clean(e))}</div>`; return; }
  const agents = (getAgents ? getAgents() : []).filter(a => a.enabled !== false);
  const sec = (key, title, badge, body) => `<details class="jd" data-sec="${key}" ${open[key] ? 'open' : ''}><summary><b>${title}</b> <span class="bsub">${badge}</span></summary><div class="jdb">${body}</div></details>`;
  const m = V.master, openR = V.rfis.filter(r => !/closed|answered/i.test(r.status)).length, openC = V.crs.filter(c => !/closed/i.test(c.status)).length;

  const regBody = `<div class="jdrow"><label>Project ref <input value="${esc(V.project)}" disabled style="width:100px"></label><label>Area code <input id="jdArea" value="${esc(V.area)}" placeholder="e.g. MLT" style="width:70px"></label>
      <label>Discipline <select id="jdDisc"><option value="06" ${V.disc !== '05' ? 'selected' : ''}>06 Electrical</option><option value="05" ${V.disc === '05' ? 'selected' : ''}>05 Instrumentation / combined E&I</option></select></label><button id="jdNum">Save</button></div>
    <div class="jdrow"><label>Drawing border <select id="jdBorder">${[['auto', 'Automatic (by client)'], ['atomax', 'Atomax'], ['bgen', 'BGEN'], ['pbe', 'PBE Group'], ['ng', 'National Grid'], ['client', 'Client title block from the File Room']].map(([k, t]) => `<option value="${k}" ${V.border === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Sheet <select id="jdSize">${[['', 'Size to fit'], ['A3', 'A3'], ['A2', 'A2'], ['A1', 'A1'], ['A0', 'A0']].map(([k, t]) => `<option value="${k}" ${(V.sheetSize || '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label><span class="bsub">Drawings use: <b>${esc(V.borderUsed)}</b></span></div>
    ${V.borderWarning ? `<div class="err">${esc(V.borderWarning)}</div>` : ''}
    <div class="bsub">Numbers follow QS 006: ${esc(V.project)}-${esc(V.area || 'AREA')}-${esc(V.disc || '06')}-type-0001 (70 SLD, 71 BCD, 72 interconnection, 73 cable routing, 74 earthing, 23 schedules).</div>
    <div class="jdrow">${V.registerFile ? `Register: <span class="bp">${esc(base(V.registerFile))}</span> <button data-show="${esc(V.registerFile)}">Show</button>` : V.registerChecked ? 'No drawing register found in the job folder.' : 'Register not checked yet.'}
      <button id="jdReg">Check the job folder for a register</button>${!V.registerFile ? '<button id="jdMkReg">Make one</button>' : '<button id="jdMkReg">Export the list as a new register</button>'}</div>
    <table class="jdt"><tr><th>Number</th><th>Title</th><th>Rev</th><th>Status</th></tr>${V.drawings.map(d => `<tr><td>${/^TBC-/.test(d.no) ? `<input data-renum="${esc(d.no)}" value="${esc(d.no)}" style="width:190px">` : esc(d.no)}</td><td>${esc(d.title)}</td><td>${esc(d.rev)}</td><td>${esc(d.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="bsub">No drawings on the list yet.</td></tr>'}</table>`;

  const rulesBody = `<div class="bsub">Every agent reads these on this job.${V.rulesFile ? ' Saved as ' + esc(base(V.rulesFile)) + ' in the job folder.' : ' (Link a job folder to keep them there.)'}</div>
    <textarea id="jdRules" rows="6" placeholder="e.g. BCDs 06-71-0001 and 0002 govern over the MCC BCDs 0003/0004 where they disagree.&#10;Match devices by channel, never by name.&#10;Keep this plant's files separate from the other plant.">${esc(V.rules)}</textarea><button id="jdRulesSave">Save rules</button>
    <div class="jdrow" style="margin-top:8px"><b>Keep a correction</b> <select id="jdCorrAgent">${agents.map(a => `<option value="${esc(a.id)}" data-name="${esc(a.name)}">${esc(a.name)}</option>`).join('')}</select>
      <select id="jdCorrScope"><option value="job">for this job</option><option value="client">for this client</option><option value="all">on every job</option></select></div>
    <textarea id="jdCorr" rows="2" placeholder="What the agent got wrong and what to do instead"></textarea><button id="jdCorrSave">Save correction</button> <span class="bsub" id="jdCorrMsg"></span>`;

  const clientBody = V.client ? (V.clientProfile ? `Client profile: <b>${esc(V.clientProfile)}</b> (File Room, Clients cabinet). ${V.titleBlock ? 'Title block: <b>' + esc(V.titleBlock) + '</b>' : 'No title block DXF for this client yet: drop one in the Clients cabinet with the client\'s name in the file name.'}`
    : `No profile for ${esc(V.client)} yet. <button id="jdNewClient">Make a client profile</button> <span class="bsub">(title block, numbering, issue format; then fill it in the File Room)</span>`) : 'No client set on this job (Edit details).';

  const rfiBody = `${V.inputs.length ? `<b>Inputs received</b><table class="jdt"><tr><th>Document</th><th>Rev</th><th>What</th><th>Received</th></tr>${V.inputs.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.rev)}</td><td>${esc(i.what)}</td><td>${esc(i.received)}</td></tr>`).join('')}</table>` : '<div class="bsub">No inputs logged yet (Eli logs them from emails).</div>'}
    <b>RFIs</b><table class="jdt"><tr><th>No</th><th>Question</th><th>Status</th><th>Answer</th></tr>${V.rfis.map(r => `<tr><td>${esc(r.no)}</td><td>${esc(r.q)}</td><td><select data-rfi="${esc(r.no)}">${['Draft', 'Sent', 'Answered', 'Closed'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><input data-rfians="${esc(r.no)}" value="${esc(r.answer)}" placeholder="Client's answer"></td></tr>`).join('') || '<tr><td colspan="4" class="bsub">None.</td></tr>'}</table>
    <div class="jdrow"><input id="jdNewRfi" placeholder="Add a question for the client" style="flex:1"><button id="jdAddRfi">Add</button><button data-export="rfi">Export RFI register</button></div>`;

  const masterBody = !m ? `<div class="bsub">One list of every device, JB, panel and cable, built from the documents in the job folder. The BCDs and the cable schedule are drawn from it once you approve it.</div>
      <input id="jdMNote" placeholder="Anything Lex should know (optional), e.g. only RIO1" style="width:100%"><button class="bprim" id="jdBuild">Build the master list</button> <span class="bsub" id="jdMMsg"></span>`
    : `<div><b>${m.status === 'approved' ? '✓ Approved' : 'Draft, not approved yet'}</b> · ${m.devices} devices · ${m.cables} cables · built from ${esc((m.read || []).join(', '))}${m.approvedAt ? ' · approved ' + esc(m.approvedAt.slice(0, 10)) : ''}</div>
      ${m.incomplete ? '<div class="err">The list was cut off. Build it again or split it by panel.</div>' : ''}
      ${m.gaps.length ? `<div class="mlqs"><b>Gaps and disagreements (${m.gaps.length})</b><ul>${m.gaps.slice(0, 30).map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
      <div class="jdrow"><button id="jdMExport">Open in Excel</button><button id="jdMImport">Load my edited Excel</button>${m.status !== 'approved' ? '<button class="bprim" id="jdMApprove">Approve the master list</button>' : ''}<button id="jdBuild">Build again</button><span class="bsub" id="jdMMsg"></span></div>
      <input id="jdMNote" placeholder="Note for a rebuild (optional)" style="width:100%">
      <table class="jdt"><tr><th>Cable</th><th>From</th><th>To</th><th>Type</th><th>Cores</th><th>Size</th></tr>${(m.preview || []).map(c => `<tr><td>${esc(c.no)}</td><td>${esc(c.from)}</td><td>${esc(c.to)}</td><td>${esc(c.type)}</td><td>${esc(c.cores)}</td><td>${esc(c.size)}</td></tr>`).join('')}</table>${m.cables > 40 ? `<div class="bsub">First 40 of ${m.cables}. Open in Excel for all of it.</div>` : ''}`;

  const fl = V.flow, stIcon = (s) => ({ done: '✓', running: '…', 'needs you': '!', failed: '✗', skipped: '–' })[s] || '';
  const flowBody = `<div class="bsub">Once the master list is approved: Dex draws a BCD for each panel (DXF and PDF), Lex makes the cable schedule, then Cal checks one against the other both ways. Only the results come back to you.</div>
    <div class="jdrow"><label><input type="checkbox" id="jdAuto" ${V.autoFlow ? 'checked' : ''}> Start it automatically when I approve the master list</label>
      <button class="bprim" id="jdRun" ${m && m.status === 'approved' && !(fl && fl.status === 'running') ? '' : 'disabled'}>${fl && fl.status === 'running' ? 'Running…' : 'Run it now'}</button>${m && m.status === 'approved' ? '' : '<span class="bsub">Approve the master list first.</span>'}</div>
    ${fl ? `<table class="jdt"><tr><th></th><th>Step</th><th>Result</th></tr>${fl.steps.map(s => `<tr><td>${stIcon(s.status)}</td><td>${esc(s.name)}</td><td>${esc(s.status)}${s.summary ? ' · ' + esc(s.summary) : ''}${(s.files || []).map(f => ` <button data-show="${esc(f)}">${esc(base(f))}</button>`).join('')}</td></tr>`).join('')}</table><div class="bsub">${esc(fl.status)} · started ${esc(String(fl.startedAt).slice(0, 16).replace('T', ' '))}</div>` : ''}`;
  const crsBody = `<table class="jdt"><tr><th>No</th><th>Document</th><th>Comment</th><th>Response</th><th>Status</th></tr>${V.crs.map(c => `<tr><td>${esc(c.no)}</td><td>${esc(c.doc)}</td><td>${esc(c.comment)}${c.by ? '<div class="bsub">' + esc(c.by) + '</div>' : ''}</td><td><textarea data-crsresp="${esc(c.no)}" rows="2">${esc(c.response)}</textarea></td><td><select data-crs="${esc(c.no)}">${['Open', 'Responded', 'Closed'].map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td colspan="5" class="bsub">No client comments yet. Eli adds them when a comment sheet or marked-up drawing comes in.</td></tr>'}</table><button data-export="crs">Export comment response sheet</button>`;

  el.innerHTML = `<h3>Job desk</h3>
    ${sec('reg', 'Numbering and drawing register', `${V.drawings.length} on the list${V.registerFile ? '' : ' · no register file'}`, regBody)}
    ${sec('rules', 'Job rules and corrections', V.rules.trim() ? 'set' : 'none yet', rulesBody)}
    ${sec('client', 'Client profile', V.clientProfile ? esc(V.clientProfile) : 'none', clientBody)}
    ${sec('rfi', 'Inputs and RFIs', `${V.inputs.length} inputs · ${openR} open RFI${openR === 1 ? '' : 's'}`, rfiBody)}
    ${sec('master', 'Master device list', m ? (m.status === 'approved' ? 'approved' : 'draft') : 'not built', masterBody)}
    ${sec('flow', 'Hands-off run', fl ? fl.status : (V.autoFlow ? 'automatic' : 'not run'), flowBody)}
    ${sec('crs', 'Client comments (CRS)', `${openC} open`, crsBody)}
    <div class="err" id="jdErr"></div>`;

  const $ = (s) => el.querySelector(s), again = () => renderJobDesk(api, el, job, { getAgents });
  const run = async (btn, fn) => { if (btn) btn.disabled = true; try { await fn(); } catch (e) { $('#jdErr').textContent = clean(e); if (btn) btn.disabled = false; return; } again(); };
  el.querySelectorAll('details.jd').forEach(d => d.addEventListener('toggle', () => { open[d.dataset.sec] = d.open; }));
  el.querySelectorAll('[data-show]').forEach(b => b.onclick = () => api.desk.show({ p: b.dataset.show }));
  $('#jdBorder').onchange = (e) => run(null, () => api.desk.border({ jobId: job.id, key: e.target.value }));
  $('#jdSize').onchange = (e) => run(null, () => api.desk.border({ jobId: job.id, size: e.target.value }));
  $('#jdNum').onclick = (e) => run(e.target, () => api.desk.numbering({ jobId: job.id, area: $('#jdArea').value, disc: $('#jdDisc').value }));
  $('#jdReg').onclick = (e) => run(e.target, () => api.desk.checkRegister({ jobId: job.id }));
  $('#jdMkReg').onclick = (e) => run(e.target, async () => { const r = await api.desk.makeRegister({ jobId: job.id }); api.desk.show({ p: r.path }); });
  el.querySelectorAll('[data-renum]').forEach(i => i.onchange = () => run(null, () => api.desk.setNumber({ jobId: job.id, from: i.dataset.renum, to: i.value })));
  $('#jdRulesSave').onclick = (e) => run(e.target, () => api.desk.setRules({ jobId: job.id, text: $('#jdRules').value }));
  $('#jdCorrSave').onclick = async (e) => { const o = $('#jdCorrAgent').selectedOptions[0]; try { const r = await api.desk.correction({ jobId: job.id, agent: $('#jdCorrAgent').value, agentName: o ? o.dataset.name : '', text: $('#jdCorr').value, scope: $('#jdCorrScope').value }); $('#jdCorrMsg').textContent = r.saved; $('#jdCorr').value = ''; if ($('#jdCorrScope').value === 'job') $('#jdRules').value = r.view.rules; } catch (err) { $('#jdCorrMsg').textContent = clean(err); } };
  const nc = $('#jdNewClient'); if (nc) nc.onclick = (e) => run(e.target, () => api.library.newClient({ name: V.client }));
  el.querySelectorAll('[data-rfi]').forEach(s => s.onchange = () => run(null, () => api.desk.rfi({ jobId: job.id, rfi: { no: s.dataset.rfi, status: s.value } })));
  el.querySelectorAll('[data-rfians]').forEach(s => s.onchange = () => run(null, () => api.desk.rfi({ jobId: job.id, rfi: { no: s.dataset.rfians, answer: s.value, status: s.value ? 'Answered' : undefined } })));
  $('#jdAddRfi').onclick = (e) => { const q = $('#jdNewRfi').value.trim(); if (q) run(e.target, () => api.desk.addRfi({ jobId: job.id, q })); };
  el.querySelectorAll('[data-export]').forEach(b => b.onclick = async () => { try { await api.desk.export({ jobId: job.id, kind: b.dataset.export }); } catch (e) { $('#jdErr').textContent = clean(e); } });
  el.querySelectorAll('[data-crs]').forEach(s => s.onchange = () => run(null, () => api.desk.crs({ jobId: job.id, row: { no: s.dataset.crs, status: s.value } })));
  el.querySelectorAll('[data-crsresp]').forEach(s => s.onchange = () => run(null, () => api.desk.crs({ jobId: job.id, row: { no: s.dataset.crsresp, response: s.value, status: s.value ? 'Responded' : undefined } })));
  const b = $('#jdBuild'); if (b) b.onclick = (e) => { $('#jdMMsg').textContent = 'Lex is reading the job documents and building the list (a minute or two)…'; run(e.target, () => api.desk.buildMaster({ jobId: job.id, note: $('#jdMNote') ? $('#jdMNote').value : '' })); };
  const me = $('#jdMExport'); if (me) me.onclick = (e) => run(e.target, () => api.desk.exportMaster({ jobId: job.id }));
  const mi = $('#jdMImport'); if (mi) mi.onclick = (e) => run(e.target, () => api.desk.importMaster({ jobId: job.id }));
  $('#jdAuto').onchange = () => api.flow.auto({ jobId: job.id, on: $('#jdAuto').checked });
  $('#jdRun').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Running…'; const poll = setInterval(() => renderJobDesk(api, el, job, { getAgents }), 4000); try { await api.flow.run({ jobId: job.id }); } catch (err) { $('#jdErr').textContent = clean(err); } clearInterval(poll); again(); };
  if (fl && fl.status === 'running' && !el.dataset.polling) { el.dataset.polling = '1'; setTimeout(() => { delete el.dataset.polling; renderJobDesk(api, el, job, { getAgents }); }, 4000); }
  const ma = $('#jdMApprove'); if (ma) ma.onclick = (e) => run(e.target, () => api.desk.approveMaster({ jobId: job.id }));
}
export function openDeskSection(key) { open[key] = true; }
