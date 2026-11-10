// Dave and Tom as agents: their brief and autonomy in the prompt, their own actions handed to the office, the rest through Eli's list
'use strict';
const assert = require('assert'), path = require('path');
const L = require(path.join(__dirname, '..', 'src', 'leadchat.js'));
(async () => {
  const dave = { id: 'dave', name: 'Dave', platform: 'Director / Lead E&I' }, tom = { id: 'tom', name: 'Tom', platform: 'CAD & Document Control' };
  const sd = L.system(dave), st = L.system(tom);
  assert.ok(/AI Engineer Brief – David Mira/.test(sd) && /Autonomy levels/i.test(sd), 'Dave has his brief');
  assert.ok(/Brief – Tom \(CAD & Document Control\)/.test(st) && !/David Mira/.test(st), 'Tom has his own');
  for (const s of [sd, st]) assert.ok(/D, never/.test(s) && /"do":"word"/.test(s) && /"do":"excel"/.test(s) && /"do":"calc"/.test(s) && /"do":"check"/.test(s) && /"do":"revise"/.test(s) && /"do":"addRfi"/.test(s));
  const seen = {};
  const doers = { office: async (a) => { seen[a.role] = a; return { path: `C:/job/${a.role === 'word' ? 'Note.docx' : 'Load.xlsx'}` }; }, calc: async (a) => { seen.calc = a; return { path: 'C:/job/Technical note - VD DRAFT.md' }; }, check: async (a) => { seen.check = a; return { schedule: 'Cable Schedule.xlsx', findings: 2, headline: 'two sizes differ' }; } };
  const job = { id: 'j', folder: '', drawings: [] };
  const ctx = { job, desk: {}, deskMod: { load: () => ({}), saveRaw() {}, setRules() {}, addInputs() {} }, biz: { saveJob() {} }, BIZ: { data: () => ({}), store: { save() {} } }, overview: { rows: [] } };
  const done = await L.apply([{ do: 'word', request: 'scope' }, { do: 'excel', request: 'loads' }, { do: 'calc', title: 'Volt drop', detail: 'PDB feeder' }, { do: 'check', nos: ['0008'] }, { do: 'note', text: 'Ze TBC' }], ctx, { agent: dave, doers });
  assert.deepStrictEqual(done, ['Wren made Note.docx (DRAFT)', 'Lex made Load.xlsx (DRAFT)', 'Ada wrote Technical note - VD DRAFT.md (DRAFT)', 'Cal checked against Cable Schedule.xlsx: 2 findings — two sizes differ', 'noted: Ze TBC']);
  assert.ok(/Prepared by Dave \(AI agent\) — DRAFT for review/.test(seen.word.prepared) && /DRAFT/.test(seen.excel.prepared), 'everything Wren and Lex make for Dave is marked DRAFT');
  assert.strictEqual(seen.calc.from, 'Dave'); assert.deepStrictEqual(seen.check.nos, ['0008']);
  const none = await L.apply([{ do: 'word', request: 'x' }], ctx, { agent: tom, doers: {} }); assert.deepStrictEqual(none, ['word: not available here']);
  const err = await L.apply([{ do: 'calc', title: 't' }], ctx, { agent: tom, doers: { calc: async () => { throw new Error('no files'); } } }); assert.deepStrictEqual(err, ['calc: no files']);
  console.log('lead ok');
})().catch(e => { console.error(e); process.exit(1); });
