// Dave and Tom as agents in the office: each works from his own brief (src/briefs/<id>.md) and can do everything Eli can on a job, plus
// hand work to the rest of the office: Wren (Word), Lex (Excel), Ada (calcs / technical notes), Cal (checks drawings against the schedule).
// The brief's autonomy levels hold: engineering output is a DRAFT for review, settings and safety conclusions are advice only, and nothing is
// sent, approved, signed or committed commercially by the agent.
'use strict';
const fs = require('fs'), path = require('path');
const E = require('./elichat');

const brief = (id) => { try { return fs.readFileSync(path.join(__dirname, 'briefs', `${id}.md`), 'utf8'); } catch { return ''; } };

const EXTRA = `- have Wren write a Word document (report, technical note, scope, fee proposal, comment response, RAMS review…): {"do":"word","request":"what to write, with every fact and input it needs"}
- have Lex make an Excel workbook (load schedule, cable schedule, IO schedule, hour estimate, register…): {"do":"excel","request":"what to make, with the data"}
- have Ada write a calculation / technical note from the job's files (cable sizing, volt drop, fault level, earthing, protection…): {"do":"calc","title":"...","detail":"the question, the inputs and where they came from"}
- have Cal check drawings against the cable schedule (both ways): {"do":"check","nos":["<row numbers, optional: all of Dex's drawings>"]}
`;

const RULES = `AUTONOMY (from the brief, always):
- A, do it: numbering, register, revisions, filing, PDFs, transmittal drafts, title-block and spelling checks.
- B, draft for review: calcs, studies, drawings, schedules, reports, fee proposals, RFIs, comment responses. Everything you have Wren, Lex or Ada write is marked DRAFT and lists its inputs, assumptions and limitations.
- C, advise only: protection settings, earthing safety conclusions, hazardous-area acceptance, SIL / safety functions, switching sequences. Recommend; never present it as decided.
- D, never: sending anything to a client, approving, signing, certifying, permits, live systems, commercial commitments. Say that a person does it.
Missing data (Ze, CT ratio, cable length, gas group…): raise an RFI ({"do":"addRfi"}) rather than guess. Only use values from the job's files, standards or manufacturer data, and say where each came from.`;

function system(agent) {
  const name = agent.name || 'Dave', who = agent.platform || '';
  const b = brief(agent.id) || String(agent.rules || '');
  return `You are ${name}${who ? ', ' + who : ''} at Atomax-UK (an electrical engineering consultancy), working as an AI agent in the office app. Below is your brief: what you do and the limits you work within. You are in a chat on a job's page with the person running it.
How you talk: short, plain British English, like a colleague across the desk. Answer what you were asked. Do the work rather than describe it: when something can be done with an action below, do it. Say exactly what you did (numbers, titles, files). Never invent a document number, revision, file or value: use the ones in front of you. If the register contradicts what you are told, say so and ask.
${agent.tone ? 'Your manner: ' + agent.tone + '\n' : ''}
YOUR BRIEF:
${b.slice(0, 18000)}

${RULES}

What you can do on this job (when asked, or when the brief clearly makes it your job; never anything at level D):
${E.ACTIONS}${EXTRA}Reply with JSON only, no markdown: {"reply":"what you say","actions":[...]} ("actions" empty when nothing is to change).`;
}

// the extra actions; everything else goes through Eli's list
async function apply(actions, ctx, { agent, doers = {} }) {
  const done = [], rest = [];
  const name = agent.name || 'Dave';
  const draft = `Prepared by ${name} (AI agent) — DRAFT for review: list every input and assumption and a limitations section; nothing to be issued until an engineer approves it.`;
  for (const a of actions || []) {
    try {
      if (!a || !a.do) continue;
      if (a.do === 'word' || a.do === 'excel') {
        if (!doers.office) { done.push(`${a.do}: not available here`); continue; }
        const r = await doers.office({ role: a.do, request: `${String(a.request || '')}\n\n${draft}`, prepared: agent.initials || String(name).slice(0, 2).toUpperCase() });   // the approval cell takes initials; the DRAFT instruction goes to Wren / Lex with the request
        done.push(`${a.do === 'excel' ? 'Lex' : 'Wren'} made ${path.basename(r.path)} (DRAFT)`);
      } else if (a.do === 'calc') {
        if (!doers.calc) { done.push('calc: not available here'); continue; }
        const r = await doers.calc({ title: String(a.title || 'Technical note'), detail: String(a.detail || ''), from: name });
        done.push(`Ada wrote ${path.basename(r.path)} (DRAFT)`);
      } else if (a.do === 'check') {
        if (!doers.check) { done.push('check: not available here'); continue; }
        const r = await doers.check({ nos: Array.isArray(a.nos) && a.nos.length ? a.nos : null });
        done.push(`Cal checked against ${r.schedule}: ${r.findings} finding${r.findings === 1 ? '' : 's'}${r.headline ? ' — ' + r.headline : ''}`);
      } else rest.push(a);
    } catch (e) { done.push(`${a.do}: ${String(e && e.message || e)}`); }
  }
  if (rest.length) done.push(...await E.apply(rest, { ...ctx, doers }));
  return done;
}

module.exports = { system, apply, brief, EXTRA, RULES };
