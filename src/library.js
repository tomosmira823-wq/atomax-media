// The File Room library: skills, templates, company knowledge, jobs, brand files and agent rulebooks, kept in userData/library/<cabinet>/.
// Each cabinet has an index.json: { "<file>": { name, description, agents: [agentIds], on } }.
// Agents read from here in code: enabled skills (and the rulebook, and ticked context files) go into their prompts.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
  if (key === 'skills') {   // .skill packages and SKILL.md files become skills
    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if (ext === '.skill' || ext === '.zip') { const t = skillMdFromZip(f.data); if (t) upsertSkill(t, path.basename(f.name, ext)); }
      else if (ext === '.md' || ext === '.txt') upsertSkill(f.data.toString('utf8'), path.basename(f.name, ext));
    }
    return list('skills');
  }
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

// read every entry of a zip (a Claude .skill package is a zip with a folder holding SKILL.md)
function unzipText(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip / .skill package');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen); p += 46 + nlen + elen + clen;
    if (name.endsWith('/') || !/\.(md|txt)$/i.test(name)) continue;
    const ln = buf.readUInt16LE(loff + 26), le = buf.readUInt16LE(loff + 28), st = loff + 30 + ln + le;
    const data = buf.subarray(st, st + csize);
    try { files[name] = (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8'); } catch {}
  }
  return files;
}

// a skill whose name hints at its job is ticked for the agent that does that job (Tom can change it after)
const AUTO_TICK = [[/drawing.?check|schedule.?check/i, ['cal']], [/dxf|sld|cad/i, ['dex']], [/document|transmittal|register|doc.?number|deliverable|word|docx/i, ['documents']], [/model|3d|plant/i, ['milo', 'theo']], [/excel|xlsx|spreadsheet/i, ['cal', 'dex']], [/email|inbox|mail/i, ['email']]];

// add or update one skill from SKILL.md text; a skill with the same name is updated, not duplicated
function upsertSkill(text, fallbackName) {
  const fm = (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  const field = (k) => ((fm.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')) || [])[1] || '').replace(/^["']|["']$/g, '').trim();
  const name = field('name') || fallbackName;
  const description = field('description');
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const idx = readIndex('skills');
  const same = Object.entries(idx).find(([f, m]) => slug(m.name || f) === slug(name) || f === slug(name) + '.md');
  let file, agents;
  if (same) { file = same[0]; agents = same[1].agents || []; }
  else { file = uniqueFile('skills', slug(name) + '.md'); agents = [...new Set(AUTO_TICK.filter(([re]) => re.test(name + ' ' + description)).flatMap(([, a]) => a))]; }
  fs.writeFileSync(path.join(dirOf('skills'), file), body, 'utf8');
  idx[file] = { ...(idx[file] || {}), name, description: description.slice(0, 300), agents, on: idx[file] ? idx[file].on !== false : true };
  writeIndex('skills', idx);
  return { name, updated: !!same, agents };
}

function skillMdFromZip(buf) {
  const files = unzipText(buf);
  const names = Object.keys(files).filter(n => /(^|\/)SKILL\.md$/i.test(n)).sort((a, b) => a.length - b.length);
  return names.length ? files[names[0]] : null;
}

// "Import from Claude": a folder with SKILL.md, a folder of .skill packages, subfolders that hold SKILL.md, or .skill files themselves
function importSkills(paths) {
  const done = [], skipped = [];
  const fromFile = (f) => {
    const ext = path.extname(f).toLowerCase();
    try {
      if (ext === '.skill' || ext === '.zip') { const t = skillMdFromZip(fs.readFileSync(f)); if (t) done.push(upsertSkill(t, path.basename(f, ext))); else skipped.push(path.basename(f) + ' (no SKILL.md inside)'); }
      else if (/^skill\.md$/i.test(path.basename(f))) done.push(upsertSkill(fs.readFileSync(f, 'utf8'), path.basename(path.dirname(f))));
    } catch (e) { skipped.push(path.basename(f) + ' (' + e.message + ')'); }
  };
  const walk = (dir, depth) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const md = ents.find(e => e.isFile() && /^skill\.md$/i.test(e.name));
    if (md) { fromFile(path.join(dir, md.name)); return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isFile() && /\.(skill|zip)$/i.test(e.name)) fromFile(full);
      else if (e.isDirectory() && depth < 2 && !e.name.startsWith('.')) walk(full, depth + 1);
    }
  };
  for (const p of [].concat(paths || [])) { let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) walk(p, 0); else fromFile(p); }
  if (!done.length) throw new Error('No skills found there. Pick a folder with .skill files or a SKILL.md' + (skipped.length ? ' (' + skipped.slice(0, 3).join(', ') + ')' : ''));
  return { done, skipped, items: list('skills') };
}
const importSkill = (folder) => importSkills([folder]).items;

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

// the enabled skills for an agent, each with its name and text (so callers can pick and say which they used)
function skillsFor(agentId) {
  if (!ROOT) return [];
  return enabledFor('skills', agentId).map(i => ({ name: i.name, file: i.file, text: readText('skills', i.file).trim() })).filter(x => x.text);
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

module.exports = { skillsFor, CABINETS, init, list, readText, save, remove, addFiles, importSkill, importSkills, unzipText, newSkill, skillFor, rulebookFor, promptBlock, addCorrection, setRulebook, _root: () => ROOT };
