// One runner for the job agents (Dex, Cal, Lex, Wren, Eli): a real working loop on the Claude Agent SDK instead of one call.
// The agent reads the job's files, uses its skills (loaded as real skills, not pasted text), looks at what it made (render, zoom),
// runs the checks, fixes and looks again, and only then hands over. Same run / stage / usage reporting as claudeFull, so the job
// screen shows each step and the Server Room counts the spend.
// SAFETY: the agent works in the job's folder (read only) and its own work folder (the only place it may write). It can read its
// skills and templates. Nothing else on the PC. No shell, no deletes, no web. Originals are never written to.
'use strict';
const fs = require('fs'), path = require('path');
const { inside } = require('./agenttools');

let DEPS = null;   // { loadSettings, usage, runs, userDir, library, agentMs }
function init(deps) { DEPS = deps; }

let sdkP = null;
function sdk() {   // the SDK is an ES module: loaded once, on first use
  if (!sdkP) sdkP = Promise.all([import('@anthropic-ai/claude-agent-sdk'), import('zod')]).then(([s, z]) => ({ ...s, z: z.z || z.default || z }));
  return sdkP;
}

// the Claude Code binary the SDK drives. In the installed app it lives in app.asar.unpacked (a program cannot run from inside the asar)
function binaryPath() {
  const plat = process.platform === 'win32' ? 'win32' : process.platform, arch = process.arch, exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const names = [`@anthropic-ai/claude-agent-sdk-${plat}-${arch}`, `@anthropic-ai/claude-agent-sdk-${plat}-${arch}-musl`];
  for (const n of names) {
    try { const dir = path.dirname(require.resolve(n + '/package.json')).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); const p = path.join(dir, exe); if (fs.existsSync(p)) return p; } catch {}
  }
  return undefined;   // let the SDK find it
}

// the agent's skills as a local plugin: one folder per skill with its SKILL.md (and the bundled skill's other files)
const slug = (s) => String(s || 'skill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'skill';
function skillsPlugin(who, chosen) {
  const L = DEPS.library, base = path.join(DEPS.userDir, 'agent-skills'), dir = path.join(base, `${slug(who)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`), sk = path.join(dir, 'skills');
  try { for (const f of fs.readdirSync(base)) { const full = path.join(base, f); if (Date.now() - fs.statSync(full).mtimeMs > 6 * 3600e3) fs.rmSync(full, { recursive: true, force: true }); } } catch {}   // old runs' copies (the app's own folder, not Tom's files)
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true }); fs.mkdirSync(sk, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'atomax', version: '1.0.0', description: 'Atomax-UK house skills from the File Room' }, null, 2));
  const all = L.list('skills'), names = [];
  const pick = Array.isArray(chosen) ? all.filter(i => chosen.includes(i.file)) : all.filter(i => i.on && (i.agents || []).includes(who));
  const bundled = path.join(__dirname, 'skills');
  for (const i of pick) {
    let text = L.readText('skills', i.file); if (!text.trim()) continue;
    const name = slug(((text.match(/^---\r?\n[\s\S]*?\bname:\s*(.+)\r?\n[\s\S]*?---/) || [])[1] || i.name).replace(/^["']|["']$/g, ''));
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) text = `---\nname: ${name}\ndescription: ${String(i.description || i.name).replace(/\s+/g, ' ').slice(0, 900)}\n---\n\n${text}`;
    const d = path.join(sk, name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'SKILL.md'), text, 'utf8');
    const src = path.join(bundled, name); try { if (fs.existsSync(src)) for (const f of fs.readdirSync(src)) if (f !== 'SKILL.md') fs.cpSync(path.join(src, f), path.join(d, f), { recursive: true }); } catch {}
    names.push(name);
  }
  return { dir, names };
}

// where the agent may go
function guard({ jobDir, workDir, readDirs, allowBash }) {
  const readable = [jobDir, workDir, ...(readDirs || [])].filter(Boolean);
  const pathsOf = (input) => ['file_path', 'path', 'notebook_path'].map(k => input && input[k]).filter(Boolean).map(p => path.isAbsolute(p) ? p : path.join(jobDir, p));
  return (name, input) => {
    if (/^mcp__/.test(name) || name === 'Skill' || name === 'TodoWrite' || name === 'ToolSearch') return null;
    if (name === 'Bash') return allowBash ? null : 'No shell for this agent: use your tools.';
    if (name === 'Read' || name === 'Glob' || name === 'Grep') { const ps = pathsOf(input); if (!ps.length) return null; const bad = ps.find(p => !readable.some(r => inside(p, r))); return bad ? `Not allowed: ${bad} is outside the job folder.` : null; }
    if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') { const ps = pathsOf(input); const bad = ps.find(p => !inside(p, workDir)); return bad ? `Not allowed to write ${bad}: write only in your work folder ${workDir} (new files; the job's own files are never changed).` : null; }
    return `${name} is not available to this agent.`;
  };
}

const describe = (name, input = {}) => {
  const f = (p) => p ? path.basename(String(p)) : '';
  const n = name.replace(/^mcp__\w+__/, '');
  return ({ render_drawing: `looking at ${f(input.file)}`, zoom: `zooming into ${input.region} of ${f(input.file)}`, run_checks: `checking ${f(input.file)}`, compare: `comparing ${f(input.file)} with ${f(input.reference)}`, find_entities: `finding items in ${f(input.file)}`, edit_dxf: `editing ${f(input.file)}`, make_drawing: 'laying out the drawing', ask_tom: 'asking Tom a question', Read: `reading ${f(input.file_path)}`, Glob: `looking for ${input.pattern || 'files'}`, Grep: `searching for "${String(input.pattern || '').slice(0, 30)}"`, Write: `writing ${f(input.file_path)}`, Edit: `editing ${f(input.file_path)}`, Skill: `opening skill ${input.skill || input.name || ''}` })[n] || n;
};

// runs an agent. Returns { text, steps, tokensIn, tokensOut, costUsd, turns, ctx }
async function run({ who, name = who, system, prompt, jobDir, workDir, readDirs = [], tools = [], skills, maxTurns = 80, run: runId = '', model, allowBash = false, budgetUsd, pctFrom = 15, pctTo = 90, test = false }) {
  if (!DEPS) throw new Error('agent runner not set up');
  const s = DEPS.loadSettings(), { runs, usage } = DEPS;
  if (!s.anthropicKey && !process.env.AMO_AGENT_BASE_URL) throw new Error('No Claude API key. Add it in Settings.');
  if (!test) usage.guard('claude', s);
  if (!jobDir || !fs.existsSync(jobDir)) throw new Error('The job folder is not linked or cannot be found, so the agent has nowhere to work. Link the job folder first.');
  fs.mkdirSync(workDir, { recursive: true });
  const S = await sdk();
  const server = S.createSdkMcpServer({ name: 'atomax', version: '1.0.0', tools });
  const plug = skillsPlugin(who, skills);
  const deny = guard({ jobDir, workDir, readDirs: [...readDirs, plug.dir], allowBash });
  const ac = new AbortController(); const sig = runId && runs.signal(runId); if (sig) { if (sig.aborted) ac.abort(); else sig.addEventListener('abort', () => ac.abort(), { once: true }); }
  const env = {};   // a clean environment: nothing of Tom's own Claude setup, his shell or other keys gets in
  for (const k of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'LANG', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'SystemDrive', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'PSModulePath', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'CLAUDE_CODE_GIT_BASH_PATH']) if (process.env[k]) env[k] = process.env[k];
  Object.assign(env, { ANTHROPIC_API_KEY: s.anthropicKey || 'sk-test', CLAUDE_CONFIG_DIR: path.join(DEPS.userDir, 'agent-config'), DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' });
  if (process.env.AMO_AGENT_BASE_URL) { env.ANTHROPIC_BASE_URL = process.env.AMO_AGENT_BASE_URL; env.NO_PROXY = '127.0.0.1,localhost'; delete env.HTTPS_PROXY; delete env.HTTP_PROXY; }
  const useModel = model || s.claudeModel || undefined;
  const steps = [], t0 = Date.now(); let text = '', result = null, turn = 0, lastThought = '';
  const say = (line) => { steps.push({ at: Date.now() - t0, line }); };
  const stage = (line) => { if (runId) runs.stage(runId, `${name}: ${line}`, Math.min(pctTo, pctFrom + Math.round((pctTo - pctFrom) * Math.min(1, turn / Math.max(10, maxTurns * 0.6))))); };
  const options = {
    cwd: jobDir, systemPrompt: system, model: useModel, maxTurns, abortController: ac, env, settingSources: [], persistSession: false,
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', ...(plug.names.length ? ['Skill'] : []), ...(allowBash ? ['Bash'] : [])],
    disallowedTools: ['WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit', ...(allowBash ? [] : ['Bash'])],
    mcpServers: { atomax: server }, allowedTools: tools.map(t => `mcp__atomax__${t.name}`),
    plugins: plug.names.length ? [{ type: 'local', path: plug.dir }] : [], ...(plug.names.length ? { skills: 'all' } : {}),
    permissionMode: 'default',
    canUseTool: async (toolName, input) => { const why = deny(toolName, input); return why ? { behavior: 'deny', message: why } : { behavior: 'allow', updatedInput: input }; },
    hooks: { PreToolUse: [{ hooks: [async (inp) => { const why = deny(inp.tool_name, inp.tool_input || {}); return why ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } } : {}; }] }] },
    maxBudgetUsd: budgetUsd || s.agentBudgetUsd || 6,   // one run never spends more than this (US$, the SDK's own count): Settings agentBudgetUsd
    pathToClaudeCodeExecutable: binaryPath(),
    stderr: (d) => { if (process.env.AMO_AGENT_DEBUG) process.stderr.write(d); },
  };
  stage('starting');
  try {
    // a prompt with files in it (PDF pages, pictures) goes in as one user message of content blocks
    const input = Array.isArray(prompt) ? (async function* () { yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: '' }; })() : prompt;
    for await (const m of S.query({ prompt: input, options })) {
      if (m.type === 'assistant') {
        turn++;
        for (const c of (m.message && m.message.content) || []) {
          if (c.type === 'tool_use') { const d = describe(c.name, c.input); say(d); stage(d); }
          else if (c.type === 'text' && c.text.trim()) { lastThought = c.text.trim(); }
        }
      } else if (m.type === 'result') result = m;
    }
  } catch (e) {
    if (ac.signal.aborted) throw new Error('Stopped by Tom (aborted)');
    usage.record({ provider: 'claude', who, model: useModel || '', error: e.message || String(e) }); throw e;
  }
  const u = (result && result.usage) || {}, tIn = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), tOut = u.output_tokens || 0, usd = (result && result.total_cost_usd) || 0;
  usage.record({ provider: 'claude', who, model: useModel || '', tokensIn: tIn, tokensOut: tOut, ...(usd ? { gbp: usd * 0.79 } : {}), error: result && result.is_error ? String(result.subtype || 'error') + (result.errors ? ': ' + result.errors.join('; ') : '') : '' });
  if (who && !test && DEPS.agentMs) DEPS.agentMs[who] = (DEPS.agentMs[who] || 0) + (Date.now() - t0);
  text = result && typeof result.result === 'string' && result.result.trim() ? result.result : lastThought;
  if (result && result.is_error && !text) throw new Error(result.subtype === 'error_max_turns' ? `${name} used all ${maxTurns} turns without finishing` : result.subtype === 'error_max_budget_usd' ? `${name} hit the spend limit for one run` : `${name} stopped: ${result.subtype}`);
  return { text, steps, tokensIn: tIn, tokensOut: tOut, costUsd: usd, turns: result ? result.num_turns : turn, subtype: result && result.subtype, ms: Date.now() - t0, skills: plug.names };
}

module.exports = { init, run, sdk, binaryPath, skillsPlugin, guard, describe };
