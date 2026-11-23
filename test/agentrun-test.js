// The agent runner end to end against a stand-in API (no key needed): tools run, pictures come back, the guard refuses
// reads outside the job and writes outside the work folder, skills load as real skills, usage is recorded.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const { start } = require('./mock-messages');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentrun-')), job = path.join(tmp, 'job'), work = path.join(tmp, 'work'), user = path.join(tmp, 'user');
  fs.mkdirSync(job, { recursive: true }); fs.mkdirSync(user, { recursive: true });
  const X = require('../src/dxfmaker'), spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'northwich-dex-bcd.json'), 'utf8'));
  const made = X.make(spec.spec || spec, path.join(tmp, 'm'), 'SHEET'); fs.copyFileSync(made.path, path.join(job, 'SHEET.dxf'));
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'outside');
  const rows = [], library = require('../src/library'); library.init(user, [], 'check skill');
  library.newSkill({ name: 'Atomax drawing rules', description: 'house CAD rules', text: 'Text height 2.' }); const it = library.list('skills').find(i => /drawing rules/i.test(i.name)); library.save('skills', it.file, { agents: ['dex'] });
  const A = require('../src/agentrun');
  A.init({ loadSettings: () => ({ anthropicKey: 'sk-test', claudeModel: 'claude-sonnet-4-5' }), usage: { guard() {}, record: (r) => rows.push(r) }, runs: { stage: (id, t) => rows.push({ stage: t }), signal: () => undefined }, userDir: user, library, agentMs: {} });
  const S = await A.sdk(), T = require('../src/agenttools'), ctx = { jobDir: job, workDir: work, cables: [], log: () => {} };
  const tools = T.toolsFor(ctx, S);
  const m = await start([
    [{ type: 'tool_use', name: 'mcp__atomax__render_drawing', input: { file: 'SHEET.dxf' } }],
    [{ type: 'tool_use', name: 'mcp__atomax__run_checks', input: { file: 'SHEET.dxf' } }],
    [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(tmp, 'secret.txt') } }],
    [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(job, 'NEW.txt'), content: 'x' } }],
    [{ type: 'tool_use', name: 'mcp__atomax__edit_dxf', input: { file: 'SHEET.dxf', ops: [{ op: 'add_text', x: 10, y: 10, text: 'HELLO' }] } }],
    [{ type: 'tool_use', name: 'mcp__atomax__zoom', input: { file: 'SHEET_edit.dxf', region: 'title block' } }],
    [{ type: 'text', text: '{"final":"SHEET_edit.dxf","still_wrong":[]}' }],
  ]);
  process.env.AMO_AGENT_BASE_URL = m.url;
  const r = await A.run({ who: 'dex', name: 'Dex', system: 'You are Dex.', prompt: [{ type: 'text', text: 'Fix the sheet.' }], jobDir: job, workDir: work, tools, run: 'r1', test: true });
  m.srv.close();
  const main = m.log.filter(l => l.body && Array.isArray(l.body.tools) && l.body.tools.length);
  const results = main.flatMap(l => (l.body.messages || []).flatMap(x => Array.isArray(x.content) ? x.content : []).filter(c => c.type === 'tool_result'));
  const last = results.slice(-6).map(c => JSON.stringify(c.content).slice(0, 200));
  console.log(last.join('\n'));
  assert(results.some(c => JSON.stringify(c.content).includes('image/png') || JSON.stringify(c.content).includes('"type":"image"')), 'a picture came back');
  assert(results.some(c => /outside the job folder/.test(JSON.stringify(c.content))), 'read outside refused');
  assert(results.some(c => /write only in your work folder/.test(JSON.stringify(c.content))), 'write into the job refused');
  assert(!fs.existsSync(path.join(job, 'NEW.txt')), 'nothing written in the job folder');
  assert(fs.existsSync(path.join(work, 'SHEET_edit.dxf')), 'edit saved in the work folder');
  console.log('tools:', main[0].body.tools.map(t => t.name).join(','), 'any skill mention:', m.log.some(l => JSON.stringify(l.body).includes('drawing-rules')));
  const sys = JSON.stringify(main[0].body.system) + JSON.stringify(main[0].body.tools.map(t => t.name)) + JSON.stringify(main[0].body.messages[0]);
  console.log('skills seen:', r.skills, /atomax-drawing-rules/.test(sys));
  assert(/atomax-drawing-rules/.test(sys), 'the skill is listed to the model');
  assert(rows.some(x => x.provider === 'claude' && x.tokensIn > 0), 'usage recorded');
  assert(/\{"final"/.test(r.text));
  console.log('steps:', r.steps.map(s => s.line).join(' / '));
  console.log('agentrun-test OK', r.turns, 'turns', r.ms, 'ms');
})().catch(e => { console.error(e); process.exit(1); });
