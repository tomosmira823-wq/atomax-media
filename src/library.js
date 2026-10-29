// The File Room library: skills, templates, company knowledge, jobs, brand files and agent rulebooks, kept in userData/library/<cabinet>/.
// Each cabinet has an index.json: { "<file>": { name, description, agents: [agentIds], on } }.
// Agents read from here in code: enabled skills (and the rulebook, and ticked context files) go into their prompts.
'use strict';
const fs = require('fs');
const path = require('path');

const CABINETS = [
  { key: 'skills', label: 'Skills', colour: '#40c057' },
  { key: 'templates', label: 'Templates', colour: '#ffd43b' },
  { key: 'knowledge', label: 'Company knowledge', colour: '#4dabf7' },
  { key: 'jobs', label: 'Jobs', colour: '#b197fc' },
  { key: 'brand', label: 'Brand', colour: '#f783ac' },
  { key: 'rulebooks', label: 'Agent rulebooks', colour: '#38d9a9' },
];
const CONTEXT_CABINETS = ['templates', 'knowledge', 'jobs', 'brand'];
const TEXT_EXT = new Set(['.md', '.txt', '.csv', '.json', '.tsv', '.html']);
const READ_LIMIT = 12000, CONTEXT_LIMIT = 30000;

let ROOT = null;
const dirOf = (key) => path.join(ROOT, key);
const indexOf = (key) => path.join(dirOf(key), 'index.json');
function readIndex(key) { try { return JSON.parse(fs.readFileSync(indexOf(key), 'utf8')); } catch { return {}; } }
function writeIndex(key, idx) { fs.mkdirSync(dirOf(key), { recursive: true }); fs.writeFileSync(indexOf(key), JSON.stringify(idx, null, 2)); }
const slug = (s) => String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';
function uniqueFile(key, base) {
  let f = base, n = 2; const ext = path.extname(base), stem = path.basename(base, ext);
  while (fs.existsSync(path.join(dirOf(key), f))) f = `${stem}-${n++}${ext}`;
  return f;
}

// First run: put today's skill text into the library so nothing changes for the agents.
function seed(agents, standardSkill) {
  CABINETS.forEach(c => fs.mkdirSync(dirOf(c.key), { recursive: true }));
  if (Object.keys(readIndex('skills')).length) return;
  const idx = {};
  const write = (file, text, meta) => { fs.writeFileSync(path.join(dirOf('skills'), file), text, 'utf8'); idx[file] = { on: true, agents: [], ...meta }; };
  write('electrical-drawing-check.md', standardSkill, { name: 'Electrical drawing check', description: 'Cross-checks drawings against cable schedules, makes red markups in a MARKUPS folder', agents: ['cal'] });
  for (const a of agents) {
    if (!a.rules || !a.rules.trim() || a.rules === standardSkill) continue;
    write(`${slug(a.id)}-rules.md`, a.rules, { name: `${a.platform} rules`, description: `The format and check rules for ${a.name}`, agents: [a.id] });
  }
  writeIndex('skills', idx);
  for (const a of agents) { const f = path.join(dirOf('rulebooks'), `${a.id}.md`); if (!fs.existsSync(f)) fs.writeFileSync(f, '', 'utf8'); }
}

function init(userDir, agents, standardSkill) {
  ROOT = path.join(userDir, 'library');
  seed(agents || [], standardSkill || '');
}

function list(key) {
  const idx = readIndex(key);
  return Object.entries(idx).map(([file, m]) => {
    const full = path.join(dirOf(key), file);
    let size = 0; try { size = fs.statSync(full).size; } catch { return null; }
    return { file, name: m.name || file, description: m.description || '', agents: m.agents || [], on: m.on !== false, size, readable: TEXT_EXT.has(path.extname(file).toLowerCase()) };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

function readText(key, file) { try { return fs.readFileSync(path.join(dirOf(key), file), 'utf8'); } catch { return ''; } }

function save(key, file, { name, description, agents, on, text }) {
  const idx = readIndex(key);
  if (!idx[file]) throw new Error('No such item in the ' + key + ' cabinet');
  if (text != null) fs.writeFileSync(path.join(dirOf(key), file), String(text), 'utf8');
  idx[file] = { ...idx[file], ...(name != null ? { name: String(name).slice(0, 120) } : {}), ...(description != null ? { description: String(description).slice(0, 300) } : {}), ...(agents ? { agents } : {}), ...(on != null ? { on: !!on } : {}) };
  writeIndex(key, idx);
  return list(key);
}

function remove(key, file) {
  const idx = readIndex(key); delete idx[file]; writeIndex(key, idx);
  try { fs.unlinkSync(path.join(dirOf(key), file)); } catch {}
  return list(key);
}

// Files dropped on a cabinet. Text files become items straight away; other files are filed and listed, but not read by agents.
function addFiles(key, files) {
  if (!ROOT) throw new Error('Library not ready');
  const idx = readIndex(key);
  for (const f of files) {
    const ext = path.extname(f.name).toLowerCase(), base = slug(path.basename(f.name, ext)) + ext;
    const file = uniqueFile(key, base);
    fs.mkdirSync(dirOf(key), { recursive: true });
    fs.writeFileSync(path.join(dirOf(key), file), f.data);
    const name = path.basename(f.name, ext);
    idx[file] = { name, description: TEXT_EXT.has(ext) ? '' : 'Stored, not read by agents (only text files are read)', agents: [], on: true };
  }
  writeIndex(key, idx);
  return list(key);
}

// "Import from Claude": a folder with a SKILL.md. Its instructions become a skill in the Skills cabinet.
function importSkill(folder) {
  const md = path.join(folder, 'SKILL.md');
  if (!fs.existsSync(md)) throw new Error('No SKILL.md in that folder');
  const text = fs.readFileSync(md, 'utf8');
  const fm = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const field = (k) => ((fm.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')) || [])[1] || '').replace(/^["']|["']$/g, '').trim();
  const name = field('name') || path.basename(folder);
  const description = field('description');
  const file = uniqueFile('skills', slug(name) + '.md');
  fs.writeFileSync(path.join(dirOf('skills'), file), text.replace(/^---\n[\s\S]*?\n---\n?/, ''), 'utf8');
  const idx = readIndex('skills'); idx[file] = { name, description, agents: [], on: true }; writeIndex('skills', idx);
  return list('skills');
}

function newSkill({ name, description, text }) {
  const file = uniqueFile('skills', slug(name) + '.md');
  fs.writeFileSync(path.join(dirOf('skills'), file), text || '', 'utf8');
  const idx = readIndex('skills'); idx[file] = { name: name || 'New skill', description: description || '', agents: [], on: true }; writeIndex('skills', idx);
  return list('skills');
}

// ---- what the agents read ----
const enabledFor = (key, agentId) => list(key).filter(i => i.on && i.agents.includes(agentId) && i.readable);

// the skill text for an agent: every enabled skill ticked for it. Falls back to the agent's own rules, so nothing goes blank.
function skillFor(agentId, fallback = '') {
  if (!ROOT) return fallback;
  const parts = enabledFor('skills', agentId).map(i => readText('skills', i.file).trim()).filter(Boolean);
  return parts.length ? parts.join('\n\n') : fallback;
}

function rulebookFor(agentId) {
  if (!ROOT) return '';
  return readText('rulebooks', `${agentId}.md`).trim();
}

// the block added to an agent's prompt: its rulebook, plus the context files Tom ticked for it
function promptBlock(agentId) {
  if (!ROOT) return '';
  let out = '';
  const rb = rulebookFor(agentId);
  if (rb) out += `\nYOUR RULEBOOK (lessons from Tom's corrections, always follow these):\n${rb.slice(0, READ_LIMIT)}\n`;
  let room = CONTEXT_LIMIT;
  const files = CONTEXT_CABINETS.flatMap(k => enabledFor(k, agentId).map(i => ({ k, i })));
  if (files.length) out += '\nFILES FROM THE FILE ROOM YOU CAN USE:\n';
  for (const { k, i } of files) {
    if (room <= 0) break;
    const body = readText(k, i.file).slice(0, Math.min(READ_LIMIT, room));
    room -= body.length;
    out += `\n--- ${i.name} (${k}) ---\n${body}\n`;
  }
  return out;
}

function setRulebook(agentId, text) {
  fs.mkdirSync(dirOf('rulebooks'), { recursive: true });
  fs.writeFileSync(path.join(dirOf('rulebooks'), `${slug(agentId)}.md`), String(text || ''), 'utf8');
  return rulebookFor(agentId);
}

// save a correction into the agent's rulebook
function addCorrection(agentId, text) {
  const t = String(text || '').trim(); if (!t) throw new Error('Write the correction first');
  const f = path.join(dirOf('rulebooks'), `${agentId}.md`);
  fs.mkdirSync(dirOf('rulebooks'), { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(f, `${fs.existsSync(f) && fs.readFileSync(f, 'utf8').trim() ? '\n' : ''}- ${day}: ${t}\n`, 'utf8');
  return rulebookFor(agentId);
}

module.exports = { CABINETS, init, list, readText, save, remove, addFiles, importSkill, newSkill, skillFor, rulebookFor, promptBlock, addCorrection, setRulebook, _root: () => ROOT };
